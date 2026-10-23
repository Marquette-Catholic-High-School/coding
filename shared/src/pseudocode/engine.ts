// Public entry points of the pseudocode engine. Both functions are synchronous and never throw.
import { PseudoError } from './errors';
import { Interpreter } from './interpreter';
import { getLanguage } from './language';
import { parseProgram } from './parser';
import type { PseudoDiagnostic, PseudoIO, PseudoRunOptions, PseudoRunResult, PseudocodeConfig } from './types';

const DEFAULT_MAX_STEPS = 5_000_000;
const DEFAULT_MAX_CALL_DEPTH = 500;

/** Parses `source` and returns syntax diagnostics (empty array when the program is valid). Never throws. */
export function checkPseudocode(source: string, config: PseudocodeConfig): PseudoDiagnostic[] {
  try {
    parseProgram(typeof source === 'string' ? source : '', getLanguage(config));
    return [];
  } catch (e) {
    return [toDiagnostic(e, 'syntax', null)];
  }
}

/**
 * Parses and runs `source` synchronously. Never throws; problems are reported in the result.
 * Output goes to `io.write`. For INPUT with a prompt, the prompt is written with `io.write` first and then passed to
 * `io.readLine` for information only.
 */
export function runPseudocode(
  source: string,
  config: PseudocodeConfig,
  io: PseudoIO,
  options: PseudoRunOptions = {},
): PseudoRunResult {
  let interpreter: Interpreter | null = null;
  try {
    const lang = getLanguage(config);
    const program = parseProgram(typeof source === 'string' ? source : '', lang);
    interpreter = new Interpreter(program, lang, io, {
      maxSteps: positive(options.maxSteps, DEFAULT_MAX_STEPS),
      maxCallDepth: positive(options.maxCallDepth, DEFAULT_MAX_CALL_DEPTH),
      random: typeof options.random === 'function' ? options.random : Math.random,
    });
    interpreter.run();
    return { ok: true, error: null, steps: interpreter.steps };
  } catch (e) {
    return { ok: false, error: toDiagnostic(e, interpreter ? 'runtime' : 'syntax', interpreter), steps: interpreter?.steps ?? 0 };
  }
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function toDiagnostic(e: unknown, phase: 'syntax' | 'runtime', interpreter: Interpreter | null): PseudoDiagnostic {
  if (e instanceof PseudoError) return e.toDiagnostic();
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof RangeError) {
    // The JavaScript stack ran out (very deep recursion), or a string grew too long.
    if (/stack|recursion/i.test(message)) {
      if (interpreter) return interpreter.recursionError().toDiagnostic();
      return {
        severity: 'error',
        message: 'This program is nested too deeply for me to read.',
        hint: 'Try splitting it into smaller pieces.',
        line: 1,
        column: 1,
        phase,
      };
    }
    if (/string length/i.test(message)) {
      return { severity: 'error', message: 'Some text in your program got too long for the computer to handle.', line: 1, column: 1, phase };
    }
  }
  const what = phase === 'runtime' ? 'running' : 'reading';
  return { severity: 'error', message: `Something went wrong while ${what} your program: ${message}`, line: 1, column: 1, phase };
}
