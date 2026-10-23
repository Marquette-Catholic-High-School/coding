// React state for one editor's runs and test runs. Function identities are stable; the hook always runs the
// latest target, stops a running program when the language/config changes, and stops everything on unmount.

import type { CompareMode, TestCase, TestResult } from '@codeclass/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runTests as runTestCases, startRun } from './index';
import type { OutputChunk, RunHandle, RunOutcome, RunPhase, RunTarget } from './types';

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
  runTests(code: string, tests: TestCase[], compareMode: CompareMode): Promise<TestResult[]>;
  clearOutput(): void;
}

const INITIAL_STATE: CodeRunnerState = {
  phase: null,
  output: [],
  inputPrompt: null,
  lastOutcome: null,
  testResults: null,
  testsRunning: false,
  currentTestIndex: null,
};

function appendChunk(output: OutputChunk[], chunk: OutputChunk): OutputChunk[] {
  if (!chunk.text) return output;
  const last = output[output.length - 1];
  if (last && last.stream === chunk.stream) {
    return [...output.slice(0, -1), { stream: chunk.stream, text: last.text + chunk.text }];
  }
  return [...output, { stream: chunk.stream, text: chunk.text }];
}

export function useCodeRunner(target: RunTarget): CodeRunner {
  const [state, setState] = useState<CodeRunnerState>(INITIAL_STATE);
  const targetRef = useRef(target);
  const runRef = useRef<{ token: number; handle: RunHandle } | null>(null);
  const testsRef = useRef<{ token: number; controller: AbortController } | null>(null);
  const tokenRef = useRef(0);

  // Pseudocode configs often arrive as new objects with the same content (e.g. the language builder's draft).
  const targetKey = useMemo(() => `${target.kind}\u0000${JSON.stringify(target.pseudocode ?? null)}`, [target.kind, target.pseudocode]);

  useEffect(() => {
    targetRef.current = target;
  });

  const stopAll = useCallback(() => {
    runRef.current?.handle.stop();
    testsRef.current?.controller.abort();
  }, []);

  // A different language or configuration: whatever is running belongs to the old one.
  useEffect(() => stopAll, [targetKey, stopAll]);

  const stop = useCallback(() => stopAll(), [stopAll]);

  const run = useCallback(async (code: string, stdin?: string[]): Promise<RunOutcome> => {
    stopAll();
    const token = ++tokenRef.current;
    const isCurrent = () => runRef.current?.token === token;
    // 'running' until the worker says otherwise ('loading' only when a runtime has to be downloaded).
    setState((s) => ({ ...s, phase: 'running', output: [], inputPrompt: null, lastOutcome: null }));
    const handle = startRun(targetRef.current, code, {
      stdin,
      interactive: true,
      onOutput: (chunk) => {
        if (isCurrent()) setState((s) => ({ ...s, output: appendChunk(s.output, chunk) }));
      },
      onPhase: (phase) => {
        if (isCurrent()) setState((s) => ({ ...s, phase, inputPrompt: phase === 'waiting-input' ? s.inputPrompt : null }));
      },
      onInputRequest: (prompt) => {
        if (isCurrent()) setState((s) => ({ ...s, phase: 'waiting-input', inputPrompt: prompt }));
      },
    });
    runRef.current = { token, handle };
    const outcome = await handle.done;
    if (isCurrent()) {
      runRef.current = null;
      setState((s) => ({ ...s, phase: null, inputPrompt: null, lastOutcome: outcome }));
    }
    return outcome;
  }, [stopAll]);

  const submitInput = useCallback((line: string) => {
    const current = runRef.current;
    if (!current) return;
    setState((s) => ({
      ...s,
      output: appendChunk(s.output, { stream: 'stdin', text: `${line}\n` }),
      phase: s.phase === 'waiting-input' ? 'running' : s.phase,
      inputPrompt: null,
    }));
    current.handle.provideInput(line);
  }, []);

  const runTests = useCallback(
    async (code: string, tests: TestCase[], compareMode: CompareMode): Promise<TestResult[]> => {
      stopAll();
      const token = ++tokenRef.current;
      const controller = new AbortController();
      testsRef.current = { token, controller };
      const isCurrent = () => testsRef.current?.token === token;
      setState((s) => ({ ...s, testsRunning: tests.length > 0, currentTestIndex: tests.length > 0 ? 0 : null, testResults: [] }));
      const results = await runTestCases(targetRef.current, code, tests, {
        compareMode,
        signal: controller.signal,
        onProgress: ({ index, result }) => {
          if (!isCurrent()) return;
          setState((s) => ({
            ...s,
            testResults: [...(s.testResults ?? []), result],
            currentTestIndex: index + 1 < tests.length ? index + 1 : null,
          }));
        },
      });
      if (isCurrent()) {
        testsRef.current = null;
        setState((s) => ({ ...s, testsRunning: false, currentTestIndex: null, testResults: results }));
      }
      return results;
    },
    [stopAll],
  );

  const clearOutput = useCallback(() => {
    setState((s) => ({ ...s, output: [], lastOutcome: s.phase === null ? null : s.lastOutcome }));
  }, []);

  return useMemo(
    () => ({ ...state, isRunning: state.phase !== null, run, stop, submitInput, runTests, clearOutput }),
    [state, run, stop, submitInput, runTests, clearOutput],
  );
}
