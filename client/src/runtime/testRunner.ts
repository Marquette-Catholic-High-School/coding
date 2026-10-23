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

export function testResultFromOutcome(test: TestCase, outcome: RunOutcome, compareMode: CompareMode): TestResult {
  return {
    testId: test.id,
    passed: outcome.status === 'ok' && outputsMatch(outcome.stdout, test.expectedOutput, compareMode),
    actualOutput: truncate(outcome.stdout, MAX_TEST_OUTPUT_CHARS, '\n… (output cut off)'),
    error: outcomeErrorText(outcome),
    durationMs: Math.max(0, Math.round(outcome.durationMs)),
  };
}

/**
 * Runs the tests one after another (non-interactive, `test.input` as stdin). Stops early when `signal` aborts;
 * the test that was running is left out of the results. Never throws.
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
  for (let index = 0; index < tests.length; index++) {
    if (signal?.aborted) break;
    const test = tests[index]!;
    let result: TestResult;
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
    } catch (err) {
      result = {
        testId: test.id,
        passed: false,
        actualOutput: '',
        error: `Couldn't run this test: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      };
    }
    results.push(result);
    try {
      options.onProgress?.({ index, result });
    } catch {
      // A failing progress callback must not stop the remaining tests.
    }
  }
  return results;
}
