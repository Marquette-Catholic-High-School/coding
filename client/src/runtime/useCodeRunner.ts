// React state for one editor's runs and test runs. Function identities are stable; the hook always runs the
// latest target, stops a running program when the language/config changes, and stops everything on unmount.
// Output is collected in a Transcript and put into state at most once per animation frame.

import type { CompareMode, TestCase, TestResult } from '@codeclass/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runTests as runTestCases, startRun } from './index';
import { Transcript } from './transcript';
import type { OutputChunk, RunHandle, RunOutcome, RunPhase, RunTarget } from './types';

export interface CodeRunnerState {
  /** null when idle. */
  phase: RunPhase | null;
  /**
   * Console transcript for the current/last run (cleared on each run). Updated at most once per animation frame;
   * after thousands of switches between streams the oldest part is merged into one plain 'stdout' segment.
   */
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
  /** End the program's input (Ctrl+D): reads get end-of-file from now on. Echoed as the system line "(end of input)". */
  endInput(): void;
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

const END_OF_INPUT_LINE = '(end of input)\n';

/** Calls `fn` on the next animation frame (or soon, where there are none); returns a cancel function. */
function onNextFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
}

type StateUpdate = (s: CodeRunnerState) => Partial<CodeRunnerState>;

export interface CodeRunnerOptions {
  /** Run every program and test batch in a worker of its own (see RunOptions.freshWorker): for other people's code. */
  freshWorker?: boolean;
}

export function useCodeRunner(target: RunTarget, options: CodeRunnerOptions = {}): CodeRunner {
  const [state, setState] = useState<CodeRunnerState>(INITIAL_STATE);
  const [transcript] = useState(() => new Transcript());
  const frameRef = useRef<(() => void) | null>(null);
  const targetRef = useRef(target);
  const freshWorkerRef = useRef(options.freshWorker === true);
  const runRef = useRef<{ token: number; handle: RunHandle; inputEnded: boolean } | null>(null);
  const testsRef = useRef<{ token: number; controller: AbortController } | null>(null);
  const tokenRef = useRef(0);

  // Pseudocode configs often arrive as new objects with the same content (e.g. the language builder's draft).
  const targetKey = useMemo(() => `${target.kind}\u0000${JSON.stringify(target.pseudocode ?? null)}`, [target.kind, target.pseudocode]);

  useEffect(() => {
    targetRef.current = target;
    freshWorkerRef.current = options.freshWorker === true;
  });

  const cancelPublish = useCallback(() => {
    frameRef.current?.();
    frameRef.current = null;
  }, []);

  /** Puts the transcript into state now, together with `update`. */
  const publish = useCallback(
    (update?: StateUpdate) => {
      cancelPublish();
      setState((s) => ({ ...s, ...update?.(s), output: transcript.snapshot() }));
    },
    [cancelPublish, transcript],
  );

  /** Puts the transcript into state on the next animation frame. */
  const schedulePublish = useCallback(() => {
    frameRef.current ??= onNextFrame(() => {
      frameRef.current = null;
      setState((s) => {
        const output = transcript.snapshot();
        return output === s.output ? s : { ...s, output };
      });
    });
  }, [transcript]);

  useEffect(() => cancelPublish, [cancelPublish]);

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
    transcript.clear();
    // 'running' until the worker says otherwise ('loading' only when a runtime has to be downloaded).
    publish(() => ({ phase: 'running', inputPrompt: null, lastOutcome: null }));
    const handle = startRun(targetRef.current, code, {
      stdin,
      interactive: true,
      freshWorker: freshWorkerRef.current,
      onOutput: (chunk) => {
        if (!isCurrent()) return;
        transcript.append(chunk);
        schedulePublish();
      },
      onPhase: (phase) => {
        if (isCurrent()) setState((s) => ({ ...s, phase, inputPrompt: phase === 'waiting-input' ? s.inputPrompt : null }));
      },
      onInputRequest: (prompt) => {
        // The prompt the program printed must be on screen together with the input field.
        if (isCurrent()) publish(() => ({ phase: 'waiting-input', inputPrompt: prompt }));
      },
    });
    runRef.current = { token, handle, inputEnded: false };
    const outcome = await handle.done;
    if (isCurrent()) {
      runRef.current = null;
      publish(() => ({ phase: null, inputPrompt: null, lastOutcome: outcome }));
    }
    return outcome;
  }, [stopAll, transcript, publish, schedulePublish]);

  const submitInput = useCallback((line: string) => {
    const current = runRef.current;
    if (!current || current.inputEnded) return;
    transcript.append({ stream: 'stdin', text: `${line}\n` });
    publish((s) => ({ phase: s.phase === 'waiting-input' ? 'running' : s.phase, inputPrompt: null }));
    current.handle.provideInput(line);
  }, [transcript, publish]);

  const endInput = useCallback(() => {
    const current = runRef.current;
    if (!current || current.inputEnded) return;
    current.inputEnded = true;
    transcript.append({ stream: 'system', text: END_OF_INPUT_LINE });
    publish((s) => ({ phase: s.phase === 'waiting-input' ? 'running' : s.phase, inputPrompt: null }));
    current.handle.endInput();
  }, [transcript, publish]);

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
        freshWorker: freshWorkerRef.current,
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
    transcript.clear();
    publish((s) => ({ lastOutcome: s.phase === null ? null : s.lastOutcome }));
  }, [transcript, publish]);

  return useMemo(
    () => ({ ...state, isRunning: state.phase !== null, run, stop, submitInput, endInput, runTests, clearOutput }),
    [state, run, stop, submitInput, endInput, runTests, clearOutput],
  );
}
