// Messages between the main thread (index.ts) and the code-runner worker (worker.ts), plus shared limits.

import type { LanguageKind, PseudocodeConfig } from '@codeclass/shared';
import type { OutputChunk, RunError, RunPhase } from './types';

/**
 * How a run gets input once the pre-supplied lines are used up:
 * - 'none': end of input (tests, or no cross-origin isolation).
 * - 'channel': the worker blocks on a SharedArrayBuffer until the main thread writes a line (see channel.ts).
 * - 'replay': pseudocode without SharedArrayBuffer — the worker stops at the input request and re-runs the
 *   program from the start (same random seed, already-shown output skipped) once the line arrives.
 */
export type InputMode = 'none' | 'channel' | 'replay';

export interface RunRequest {
  type: 'run';
  id: number;
  kind: LanguageKind;
  code: string;
  stdin: string[];
  inputMode: InputMode;
  channel: SharedArrayBuffer | null;
  /** Shared memory the worker mirrors its output into (see outputTail.ts); null without cross-origin isolation. */
  tail: SharedArrayBuffer | null;
  pseudocode: PseudocodeConfig | null;
}

export interface PreloadRequest {
  type: 'preload';
  kind: LanguageKind;
}

/** A typed line for a run in 'replay' input mode; null ends the input. */
export interface ReplayInput {
  type: 'input';
  id: number;
  line: string | null;
}

export type MainToWorker = RunRequest | PreloadRequest | ReplayInput;

export type WorkerToMain =
  | { type: 'phase'; id: number; phase: Exclude<RunPhase, 'waiting-input'> }
  /** `batch` counts the run's output messages from 1 (the page acknowledges them in the output tail). */
  | { type: 'output'; id: number; batch: number; chunks: OutputChunk[] }
  | { type: 'input-request'; id: number; prompt: string | null }
  | {
      type: 'done';
      id: number;
      status: 'ok' | 'error';
      error: RunError | null;
      /** The program asked for a line of input (see `RunOutcome.readInput`). */
      readInput: boolean;
      /**
       * Do not reuse this worker: the runtime may be in a bad state (crash, out of memory), or the program could
       * have changed it for the next one (JavaScript and TypeScript share one realm with the worker).
       */
      recycle: boolean;
    };

/** Output after this many characters is dropped (≈ 1 MB). */
export const MAX_OUTPUT_CHARS = 1_000_000;
export const OUTPUT_LIMIT_MESSAGE = 'Output limit reached - the rest was cut off.';
/** Worker → main output batching interval. */
export const OUTPUT_FLUSH_MS = 30;
/**
 * Output messages a worker may send straight away within one batching interval before it starts holding writes
 * back. Synchronous programs never yield to the batching timer, so the last few lines before a long computation
 * or an endless loop must not wait for it.
 */
export const OUTPUT_BURST = 20;
/**
 * How often the page reads the output tail while a program runs (outputTail.ts), so output a worker held back
 * still shows while the program is busy in a long computation or stuck in a loop.
 */
export const OUTPUT_TAIL_POLL_MS = 100;
export const TIMEOUT_MESSAGE = 'Took too long — is there a loop that never ends?';
export const DEFAULT_TEST_TIMEOUT_MS = 10_000;
