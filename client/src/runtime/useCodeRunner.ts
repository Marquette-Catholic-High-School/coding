// STUB — replaced by the real hook. Signature is the contract used by the IDE.
import type { TestCase, TestResult } from '@codeclass/shared';
import type { OutputChunk, RunOutcome, RunPhase, RunTarget } from './types';

export interface CodeRunnerState {
  /** null when idle. */
  phase: RunPhase | null;
  /** Console transcript for the current/last run (cleared on each run). */
  output: OutputChunk[];
  /** Prompt text when waiting for input (phase === 'waiting-input'). */
  inputPrompt: string | null;
  lastOutcome: RunOutcome | null;
  /** Test results from the last `runTests` call (null until tests run). */
  testResults: TestResult[] | null;
  testsRunning: boolean;
  /** Index of the test currently running, or null. */
  currentTestIndex: number | null;
}

export interface CodeRunner extends CodeRunnerState {
  isRunning: boolean;
  /** Run interactively; `stdin` lines are consumed first. */
  run(code: string, stdin?: string[]): Promise<RunOutcome>;
  stop(): void;
  /** Send a line typed in the console (echoed into output as 'stdin'). */
  submitInput(line: string): void;
  runTests(code: string, tests: TestCase[], compareMode: import('@codeclass/shared').CompareMode): Promise<TestResult[]>;
  clearOutput(): void;
}

export function useCodeRunner(_target: RunTarget): CodeRunner {
  return {
    phase: null,
    output: [],
    inputPrompt: null,
    lastOutcome: null,
    testResults: null,
    testsRunning: false,
    currentTestIndex: null,
    isRunning: false,
    run: async () => ({ status: 'error', error: { message: 'Runner not implemented yet' }, stdout: '', durationMs: 0 }),
    stop() {},
    submitInput() {},
    runTests: async (_c, tests) => tests.map((t) => ({ testId: t.id, passed: false, actualOutput: '', error: 'Not implemented', durationMs: 0 })),
    clearOutput() {},
  };
}
