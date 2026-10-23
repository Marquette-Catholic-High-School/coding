// Contract for in-browser code execution. Implementations live in this folder (workers per language).
// Everything a page or the IDE needs goes through `index.ts`; nothing else imports worker files directly.

import type { CompareMode, LanguageKind, PseudocodeConfig, TestResult } from '@codeclass/shared';

/** What to run: the language kind plus, for pseudocode, the teacher's configuration. */
export interface RunTarget {
  kind: LanguageKind;
  pseudocode?: PseudocodeConfig | null;
}

export type OutputStream = 'stdout' | 'stderr' | 'stdin' | 'system';

export interface OutputChunk {
  stream: OutputStream;
  /** Raw text; may contain several lines or a partial line. 'stdin' echoes what the user typed (with "\n"). */
  text: string;
}

export interface RunError {
  /** Student-friendly message (first line of a traceback/stack, or the pseudocode diagnostic). */
  message: string;
  /** Full traceback / details, if any. */
  details?: string;
  /** 1-based source position of the error, when known. */
  line?: number;
  column?: number;
  hint?: string;
}

export type RunPhase =
  /** Downloading/initialising the language runtime (first run of Python can take a few seconds). */
  | 'loading'
  | 'running'
  | 'waiting-input';

export type RunOutcomeStatus = 'ok' | 'error' | 'stopped' | 'timeout';

export interface RunOutcome {
  status: RunOutcomeStatus;
  error: RunError | null;
  /** Everything written to stdout (used by tests). */
  stdout: string;
  durationMs: number;
}

export interface RunOptions {
  /** Lines of input given up front. Read first, before asking the user interactively. */
  stdin?: string[];
  /**
   * When true and input runs out, the program pauses and `onInputRequest` fires; call `handle.provideInput`.
   * Requires cross-origin isolation (SharedArrayBuffer) for every language except pseudocode; when it is not
   * available, running out of input behaves like end-of-file (see `interactiveInputSupported`).
   */
  interactive?: boolean;
  /** Kill the run after this long (excluding runtime loading). Default: none when interactive, 10 s otherwise. */
  timeoutMs?: number;
  onOutput?: (chunk: OutputChunk) => void;
  onPhase?: (phase: RunPhase) => void;
  /** Program is waiting for a line of input; `prompt` is any text the program printed without a newline, if known. */
  onInputRequest?: (prompt: string | null) => void;
}

export interface RunHandle {
  readonly done: Promise<RunOutcome>;
  /** Stop the program (terminates the worker; the next run starts a fresh one). */
  stop(): void;
  /** Answer an input request (no trailing newline). */
  provideInput(line: string): void;
}

export interface TestProgress {
  /** Index of the test that just finished. */
  index: number;
  result: TestResult;
}

export interface RunTestsOptions {
  compareMode: CompareMode;
  /** Per-test time limit. Default 10 s. */
  timeoutMs?: number;
  onProgress?: (progress: TestProgress) => void;
  /** Abort remaining tests. */
  signal?: AbortSignal;
}
