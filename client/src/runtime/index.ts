// STUB — replaced by the real runtime (workers per language). Signatures are the contract.
import type { TestCase, TestResult } from '@codeclass/shared';
import type { RunHandle, RunOptions, RunTarget, RunTestsOptions } from './types';

export type * from './types';

/** Whether a kind can run in the console runner ('web' renders in <WebPreview> instead). */
export function isRunnable(kind: RunTarget['kind']): boolean {
  return kind !== 'web';
}

/** True when the page is cross-origin isolated, so programs can pause for typed input. */
export function interactiveInputSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

/** Starts running `code`. Never throws; failures resolve `done` with status 'error'. */
export function startRun(_target: RunTarget, _code: string, _options: RunOptions = {}): RunHandle {
  const done = Promise.resolve({ status: 'error' as const, error: { message: 'Runner not implemented yet' }, stdout: '', durationMs: 0 });
  return { done, stop() {}, provideInput() {} };
}

/** Runs `code` once per test (non-interactive, test.input as stdin) and compares output. Never throws. */
export async function runTests(_target: RunTarget, _code: string, tests: TestCase[], _options: RunTestsOptions): Promise<TestResult[]> {
  return tests.map((t) => ({ testId: t.id, passed: false, actualOutput: '', error: 'Runner not implemented yet', durationMs: 0 }));
}

/** Warm up a runtime (e.g. download Pyodide) before the user presses Run. Safe to call repeatedly. */
export function preloadRuntime(_target: RunTarget): void {}
