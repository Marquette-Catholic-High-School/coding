// Runs a program once per test case and compares its output. Takes the run function as a parameter so it can be
// unit-tested without workers.

import { inputLines, outputsMatch, type CompareMode, type TestCase, type TestResult } from '@codeclass/shared';
import { DEFAULT_TEST_TIMEOUT_MS, TIMEOUT_MESSAGE } from './protocol';
import type { RunHandle, RunOptions, RunOutcome, RunTarget, RunTestsOptions } from './types';

export type StartRun = (target: RunTarget, code: string, options?: RunOptions) => RunHandle;

/** Stored test results must stay small (the API accepts at most 50,000 characters of output per test). */
export const MAX_TEST_OUTPUT_CHARS = 10_000;
const MAX_TEST_ERROR_CHARS = 2_000;

function truncate(text: string, max: number, marker: string): string {
  return text.length <= max ? text : `${text.slice(0, max)}${marker}`;
}

/**
 * The code runner itself failed before the program started: the language runtime couldn't load (e.g. Python
 * couldn't be downloaded), or the worker couldn't start or crashed while loading. The outcome says nothing about the
 * program. (A run stopped while loading isn't a failure.)
 */
export function runnerFailed(outcome: RunOutcome): boolean {
  return !outcome.started && outcome.status === 'error';
}

/** Error text for a test result: null when the program finished normally. */
export function outcomeErrorText(outcome: RunOutcome): string | null {
  switch (outcome.status) {
    case 'ok':
      return null;
    case 'timeout':
      return TIMEOUT_MESSAGE;
    case 'stopped':
      return 'Stopped before it finished.';
    case 'error': {
      const error = outcome.error;
      if (!error) return 'The program stopped with an error.';
      const text = [error.line != null ? `Line ${error.line}: ${error.message}` : error.message, error.hint]
        .filter(Boolean)
        .join(' ');
      return truncate(text, MAX_TEST_ERROR_CHARS, '…');
    }
  }
}

function shortOutput(output: string): string {
  return truncate(output, MAX_TEST_OUTPUT_CHARS, '\n… (output cut off)');
}

/**
 * A test passes when the program finished and its output matches the expected output, with or without its input
 * prompts (see `RunOutcome.promptlessStdout`): expected outputs may include the prompts or leave them out.
 */
export function testResultFromOutcome(test: TestCase, outcome: RunOutcome, compareMode: CompareMode): TestResult {
  const matches = (output: string) => outputsMatch(output, test.expectedOutput, compareMode);
  return {
    testId: test.id,
    passed:
      outcome.status === 'ok' &&
      (matches(outcome.stdout) || (outcome.promptlessStdout !== outcome.stdout && matches(outcome.promptlessStdout))),
    actualOutput: shortOutput(outcome.stdout),
    error: outcomeErrorText(outcome),
    durationMs: Math.max(0, Math.round(outcome.durationMs)),
  };
}

/**
 * Runs the tests one after another (non-interactive, `test.input` as stdin). Stops early when `signal` aborts;
 * the test that was running is left out of the results. A test the code runner couldn't run (see `runnerFailed`)
 * fails with the runner's error and is reported to `onRunnerError`. Never throws.
 */
export async function runTestsWith(
  start: StartRun,
  target: RunTarget,
  code: string,
  tests: readonly TestCase[],
  options: RunTestsOptions,
): Promise<TestResult[]> {
  const { signal } = options;
  const results: TestResult[] = [];
  const runnerError = (message: string) => {
    try {
      options.onRunnerError?.(message);
    } catch {
      // A failing callback must not stop the remaining tests.
    }
  };
  for (let index = 0; index < tests.length; index++) {
    if (signal?.aborted) break;
    const test = tests[index]!;
    let result: TestResult;
    let promptlessOutput = '';
    try {
      const handle = start(target, code, {
        stdin: inputLines(test.input),
        interactive: false,
        timeoutMs: options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
      });
      const stop = () => handle.stop();
      signal?.addEventListener('abort', stop, { once: true });
      let outcome: RunOutcome;
      try {
        outcome = await handle.done;
      } finally {
        signal?.removeEventListener('abort', stop);
      }
      if (signal?.aborted && outcome.status === 'stopped') break;
      result = testResultFromOutcome(test, outcome, options.compareMode);
      promptlessOutput = shortOutput(outcome.promptlessStdout);
      if (runnerFailed(outcome)) runnerError(result.error ?? "The code runner didn't start.");
    } catch (err) {
      result = {
        testId: test.id,
        passed: false,
        actualOutput: '',
        error: `Couldn't run this test: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      };
      runnerError(result.error!);
    }
    results.push(result);
    try {
      options.onProgress?.({ index, result, promptlessOutput });
    } catch {
      // A failing progress callback must not stop the remaining tests.
    }
  }
  return results;
}
