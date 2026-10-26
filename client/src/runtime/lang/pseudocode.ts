// Pseudocode runner: the shared engine, configured with the teacher's language. Input either blocks on the
// worker's input source or, without SharedArrayBuffer, uses "replay": the program stops when it needs a typed
// line and is re-run from the start once the line arrives, with the same random seed and the output that was
// already shown skipped (the engine is deterministic for a given seed and input).

import type { PseudoDiagnostic, PseudoIO, PseudocodeConfig } from '@codeclass/shared';
import { createPseudocodeConfig, runPseudocode } from '@codeclass/shared/pseudocode';
import type { RunError } from '../types';
import { describeError, failure, OK, type LangResult, type LanguageRunner } from './io';

export function diagnosticToRunError(diagnostic: PseudoDiagnostic): RunError {
  const error: RunError = { message: diagnostic.message, line: diagnostic.line, column: diagnostic.column };
  if (diagnostic.hint) error.hint = diagnostic.hint;
  return error;
}

/** Small deterministic PRNG (mulberry32) so replays draw the same RANDOM numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Transcript {
  write(stream: 'stdout' | 'stdin', text: string): void;
  /** Next input line, or null at end of input. May throw to abandon the run. */
  readLine(): string | null;
}

function execute(code: string, config: PseudocodeConfig | null, transcript: Transcript, random?: () => number): LangResult {
  let partialLine = '';
  const io: PseudoIO = {
    write: (text) => {
      transcript.write('stdout', text);
      const newline = text.lastIndexOf('\n');
      partialLine = newline >= 0 ? text.slice(newline + 1) : partialLine + text;
    },
    readLine: (prompt) => {
      // Show the INPUT("…") prompt unless the engine already printed it.
      if (prompt && !partialLine.endsWith(prompt)) io.write(prompt);
      const line = transcript.readLine();
      if (line !== null) partialLine = '';
      return line;
    },
  };
  const result = runPseudocode(code, config ?? createPseudocodeConfig(), io, random ? { random } : undefined);
  if (result.ok) return OK;
  return failure(result.error ? diagnosticToRunError(result.error) : { message: 'The program stopped because of an error.' });
}

export const pseudocodeRunner: LanguageRunner = {
  loaded: () => true,
  load: async () => {},
  run: async (code, io, context) => {
    try {
      return execute(code, context.pseudocode, {
        write: (_stream, text) => io.write('stdout', text),
        readLine: () => io.readLine(),
      });
    } catch (err) {
      return failure({ message: `The pseudocode engine hit a problem: ${describeError(err)}` });
    }
  },
};

export interface ReplayState {
  code: string;
  config: PseudocodeConfig | null;
  /** Lines given up front (echoed like typed input). */
  stdin: readonly string[];
  /** Lines typed so far in answer to input requests (the page echoes these itself). */
  typed: string[];
  /** The user ended the input: once the typed lines run out, reads get end of input instead of waiting. */
  ended: boolean;
  seed: number;
  /** Characters of output already shown by earlier attempts. */
  shown: number;
  /** The program asked for a line of input in some attempt (set by `runReplayAttempt`). */
  readInput?: boolean;
}

export interface ReplayOutput {
  write(stream: 'stdout' | 'stdin', text: string): void;
}

const NEEDS_INPUT = Symbol('needs input');

/**
 * One attempt of a replay run. Returns null when the program stopped to wait for a typed line (`state.shown` is
 * updated), or the final result.
 */
export function runReplayAttempt(state: ReplayState, out: ReplayOutput): LangResult | null {
  let skip = state.shown;
  let produced = 0;
  let waiting = false;
  const emit = (stream: 'stdout' | 'stdin', text: string) => {
    if (waiting || !text) return;
    produced += text.length;
    if (skip >= text.length) {
      skip -= text.length;
      return;
    }
    out.write(stream, skip > 0 ? text.slice(skip) : text);
    skip = 0;
  };
  const stdin = [...state.stdin];
  const typed = [...state.typed];
  let result: LangResult;
  try {
    result = execute(
      state.code,
      state.config,
      {
        write: emit,
        readLine: () => {
          state.readInput = true;
          const given = stdin.shift();
          if (given !== undefined) {
            emit('stdin', `${given}\n`);
            return given;
          }
          const answer = typed.shift();
          if (answer !== undefined) return answer;
          if (state.ended) return null;
          waiting = true;
          throw NEEDS_INPUT;
        },
      },
      seededRandom(state.seed),
    );
  } catch (err) {
    if (err !== NEEDS_INPUT) return failure({ message: `The pseudocode engine hit a problem: ${describeError(err)}` });
    result = OK;
  }
  if (waiting) {
    state.shown = produced;
    return null;
  }
  return result;
}
