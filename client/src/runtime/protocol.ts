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
  pseudocode: PseudocodeConfig | null;
}

export interface PreloadRequest {
  type: 'preload';
  kind: LanguageKind;
}

/** A typed line for a run in 'replay' input mode. */
export interface ReplayInput {
  type: 'input';
  id: number;
  line: string;
}

export type MainToWorker = RunRequest | PreloadRequest | ReplayInput;

export type WorkerToMain =
  | { type: 'phase'; id: number; phase: Exclude<RunPhase, 'waiting-input'> }
  | { type: 'output'; id: number; chunks: OutputChunk[] }
  | { type: 'input-request'; id: number; prompt: string | null }
  | {
      type: 'done';
      id: number;
      status: 'ok' | 'error';
      error: RunError | null;
      /** The runtime may be in a bad state (crash, out of memory): do not reuse this worker. */
      recycle: boolean;
    };

/** Output after this many characters is dropped (≈ 1 MB). */
export const MAX_OUTPUT_CHARS = 1_000_000;
export const OUTPUT_LIMIT_MESSAGE = 'Output limit reached - the rest was cut off.';
/** Worker → main output batching interval. */
export const OUTPUT_FLUSH_MS = 30;
export const TIMEOUT_MESSAGE = 'Took too long — is there a loop that never ends?';
export const DEFAULT_TEST_TIMEOUT_MS = 10_000;
