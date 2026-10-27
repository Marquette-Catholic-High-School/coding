// What a language runner gets from the worker, and what it returns.

import type { PseudocodeConfig } from '@codeclass/shared';
import type { RunError } from '../types';

/** One language inside the worker. Modules are imported lazily, so heavy runtimes load only when needed. */
export interface LanguageRunner {
  /** True when the runtime is ready to run without downloading anything. */
  loaded(): boolean;
  /** Downloads/initialises the runtime. Safe to call repeatedly; a failed load can be retried. */
  load(): Promise<void>;
  /** Work before the timed part of a run (e.g. Python packages); calls `onDownload` if it has to fetch. */
  prepare?(code: string, onDownload: () => void): Promise<void>;
  run(code: string, io: RunIO, context: RunContext): Promise<LangResult>;
}

export interface RunContext {
  pseudocode: PseudocodeConfig | null;
}

export interface RunIO {
  write(stream: 'stdout' | 'stderr', text: string): void;
  /**
   * Next line of input without "\n", or null at end of input. Pre-supplied lines come first; after that the call
   * blocks for a typed line when the run is interactive (until the user ends the input).
   *
   * `prompt` is the text the input call itself has just printed to stdout (Python's input("Name: "), JavaScript's
   * prompt("Name: "), pseudocode's INPUT "Name: ", n), or '' when it printed none. Runners leave it out only for
   * input calls that can't print a prompt of their own (Lua's io.read()): the prompt is then the unfinished stdout
   * line, unless input was already read on that line. See `RunOutcome.promptlessStdout`.
   */
  readLine(prompt?: string): string | null;
  /** Unfinished stdout line, i.e. the prompt shown before an input request. */
  pendingPrompt(): string;
  /** Send buffered output to the page now. */
  flush(): void;
}

export interface LangResult {
  status: 'ok' | 'error';
  error: RunError | null;
  /** The runtime may be broken (e.g. out of memory): the worker should not be reused. */
  recycle?: boolean;
}

export const OK: LangResult = { status: 'ok', error: null };

export function failure(error: RunError, recycle = false): LangResult {
  return { status: 'error', error, recycle };
}

/** Message of an unknown thrown value. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
