import type { TestCase } from '@codeclass/shared';
import { describe, expect, it, vi } from 'vitest';
import { TIMEOUT_MESSAGE } from './protocol';
import { MAX_TEST_OUTPUT_CHARS, outcomeErrorText, runnerFailed, runTestsWith, testResultFromOutcome, type StartRun } from './testRunner';
import type { RunOptions, RunOutcome } from './types';

const target = { kind: 'python' as const };

function test(id: string, input: string, expectedOutput: string): TestCase {
  return { id, name: id, input, expectedOutput, hidden: false, points: 1 };
}

function outcome(partial: Partial<RunOutcome>): RunOutcome {
  return { status: 'ok', error: null, stdout: '', durationMs: 12.4, started: true, readInput: false, ...partial };
}

/** A fake runner that "doubles" its first input line. */
const doubler: StartRun = (_target, _code, options?: RunOptions) => ({
  done: Promise.resolve(outcome({ stdout: `${Number(options?.stdin?.[0] ?? 0) * 2}\n` })),
  stop() {},
  provideInput() {},
  endInput() {},
});

describe('runTestsWith', () => {
  it('runs each test non-interactively with its input lines and compares output', async () => {
    const start = vi.fn(doubler);
    const progress: number[] = [];
    const results = await runTestsWith(start, target, 'code', [test('a', '2\n', '4'), test('b', '5', '11')], {
      compareMode: 'trim',
      onProgress: ({ index }) => progress.push(index),
    });
    expect(start).toHaveBeenCalledWith(target, 'code', { stdin: ['2'], interactive: false, timeoutMs: 10_000 });
    expect(results).toEqual([
      { testId: 'a', passed: true, actualOutput: '4\n', error: null, durationMs: 12 },
      { testId: 'b', passed: false, actualOutput: '10\n', error: null, durationMs: 12 },
    ]);
    expect(progress).toEqual([0, 1]);
  });

  it('honours a custom timeout', async () => {
    const start = vi.fn(doubler);
    await runTestsWith(start, target, 'code', [test('a', '', '0')], { compareMode: 'exact', timeoutMs: 500 });
    expect(start.mock.calls[0]![2]).toMatchObject({ timeoutMs: 500 });
  });

  it('stops at an abort and leaves the interrupted test out', async () => {
    const controller = new AbortController();
    let stopped = false;
    const start: StartRun = () => {
      let resolve!: (o: RunOutcome) => void;
      const done = new Promise<RunOutcome>((r) => {
        resolve = r;
      });
      return {
        done,
        stop() {
          stopped = true;
          resolve(outcome({ status: 'stopped' }));
        },
        provideInput() {},
        endInput() {},
      };
    };
    const pending = runTestsWith(start, target, 'code', [test('a', '', ''), test('b', '', '')], {
      compareMode: 'exact',
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual([]);
    expect(stopped).toBe(true);
  });

  it('never throws, even when starting a run fails', async () => {
    const start: StartRun = () => {
      throw new Error('no workers');
    };
    const onRunnerError = vi.fn();
    const [result] = await runTestsWith(start, target, 'code', [test('a', '', '')], { compareMode: 'exact', onRunnerError });
    expect(result).toMatchObject({ testId: 'a', passed: false, error: "Couldn't run this test: no workers" });
    expect(onRunnerError).toHaveBeenCalledWith("Couldn't run this test: no workers");
  });

  it("reports tests the code runner couldn't run, apart from tests the program failed", async () => {
    const loadFailure = outcome({
      status: 'error',
      started: false,
      durationMs: 0,
      error: { message: "Couldn't load the Python runner. Reload the page and try again." },
    });
    const outcomes = [outcome({ status: 'error', error: { message: 'NameError' } }), loadFailure];
    const start: StartRun = () => ({ done: Promise.resolve(outcomes.shift()!), stop() {}, provideInput() {}, endInput() {} });
    const onRunnerError = vi.fn();
    const results = await runTestsWith(start, target, 'code', [test('a', '', 'x'), test('b', '', 'x')], { compareMode: 'exact', onRunnerError });
    expect(results.map((r) => r.passed)).toEqual([false, false]);
    expect(onRunnerError).toHaveBeenCalledTimes(1);
    expect(onRunnerError).toHaveBeenCalledWith("Couldn't load the Python runner. Reload the page and try again.");
  });
});

describe('runnerFailed', () => {
  it('is an error before the program started', () => {
    expect(runnerFailed(outcome({ status: 'error', started: false }))).toBe(true);
  });

  it("isn't the program's own error, or a run stopped while loading", () => {
    expect(runnerFailed(outcome({ status: 'error' }))).toBe(false);
    expect(runnerFailed(outcome({ status: 'stopped', started: false }))).toBe(false);
    expect(runnerFailed(outcome({}))).toBe(false);
  });
});

describe('test results', () => {
  it('fails tests that error even when the output matches', () => {
    const result = testResultFromOutcome(
      test('a', '', 'hi'),
      outcome({ status: 'error', stdout: 'hi', error: { message: "NameError: name 'x' is not defined", line: 3 } }),
      'exact',
    );
    expect(result).toMatchObject({ passed: false, error: "Line 3: NameError: name 'x' is not defined" });
  });

  it('describes timeouts and stops', () => {
    expect(outcomeErrorText(outcome({ status: 'timeout' }))).toBe(TIMEOUT_MESSAGE);
    expect(outcomeErrorText(outcome({ status: 'stopped' }))).toBe('Stopped before it finished.');
    expect(outcomeErrorText(outcome({ status: 'error', error: { message: 'Oops', hint: 'Did you mean "OUTPUT"?' } }))).toBe(
      'Oops Did you mean "OUTPUT"?',
    );
  });

  it('compares the full output but stores a shortened copy', () => {
    const long = 'x'.repeat(MAX_TEST_OUTPUT_CHARS + 50);
    const result = testResultFromOutcome(test('a', '', long), outcome({ stdout: long }), 'exact');
    expect(result.passed).toBe(true);
    expect(result.actualOutput.length).toBeLessThan(MAX_TEST_OUTPUT_CHARS + 30);
    expect(result.actualOutput.endsWith('(output cut off)')).toBe(true);
  });
});
