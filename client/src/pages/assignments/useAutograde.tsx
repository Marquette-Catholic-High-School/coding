import type { Assignment, Language, SubmissionRow } from '@codeclass/shared';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useGradeSubmission } from '../../api/assignments';
import { ApiError } from '../../api/client';
import { runTests, startRun, type RunOutcome, type RunTarget } from '../../runtime';
import {
  autogradePatch,
  autogradeSummary,
  autogradeTargets,
  emptyTally,
  referenceSetup,
  scoreSubmission,
  type AutogradeMethod,
  type AutogradeOptions,
  type AutogradeRunner,
  type AutogradeSetup,
  type ReferenceProblem,
} from './autograde';

/** Same limit as one test. */
const RUN_TIMEOUT_MS = 10_000;

/** Runs `code` once without input in a worker of its own; aborting stops it. */
async function runOnce(target: RunTarget, code: string, signal: AbortSignal): Promise<RunOutcome> {
  const handle = startRun(target, code, { stdin: [], interactive: false, freshWorker: true, timeoutMs: RUN_TIMEOUT_MS });
  const stop = () => handle.stop();
  signal.addEventListener('abort', stop, { once: true });
  try {
    return await handle.done;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/**
 * Autogrades the chosen work one submission at a time in this browser (see autograde.ts for the rules) and saves
 * each result as it goes. Progress is shown in a single updating notification; leaving the page stops the run.
 */
export function useAutograde(assignment: Assignment, language: Language, method: AutogradeMethod | null) {
  const grade = useGradeSubmission(assignment.id);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the page stops the run.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async (rows: SubmissionRow[], options: AutogradeOptions) => {
    const targets = autogradeTargets(rows, options.scope);
    if (!method || targets.length === 0 || controllerRef.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    controllerRef.current = controller;
    setRunning(true);
    const target: RunTarget = { kind: language.kind, pseudocode: language.pseudocode };
    const solutionCode = assignment.solutionCode ?? '';
    const runner: AutogradeRunner = {
      runTests: async (code) => {
        let runnerError: string | null = null;
        const results = await runTests(target, code, assignment.tests, {
          compareMode: assignment.compareMode,
          signal,
          // A new worker per submission, so one student's code can't affect the next one's results.
          freshWorker: true,
          // The language couldn't load or start (e.g. a network blip while downloading Python): not the code's fault.
          onRunnerError: (message) => {
            runnerError ??= message;
          },
        });
        return { results, runnerError };
      },
      runProgram: (code) => runOnce(target, code, signal),
    };
    const id = notifications.show({
      loading: true,
      title: `Autograding 1 of ${targets.length}`,
      message: method.output ? 'Running your solution…' : 'Getting the language ready…',
      autoClose: false,
      withCloseButton: false,
    });
    const tally = emptyTally(targets.length);
    let reference: ReferenceProblem | null = null;
    try {
      const setup: AutogradeSetup = {
        method,
        tests: assignment.tests,
        compareMode: assignment.compareMode,
        solutionCode,
        referenceOutput: null,
        runnerError: null,
      };
      if (method.output) {
        // What the solution prints is what each submission's output is compared with.
        const outcome = await runOnce(target, solutionCode, signal);
        if (!signal.aborted) {
          const solutionRun = referenceSetup(outcome);
          reference = solutionRun.problem;
          setup.referenceOutput = solutionRun.referenceOutput;
          setup.runnerError = solutionRun.runnerError;
        }
      }
      for (const [index, row] of targets.entries()) {
        if (signal.aborted) break;
        notifications.update({
          id,
          loading: true,
          title: `Autograding ${index + 1} of ${targets.length}`,
          message: `Checking ${row.student.name}'s code…`,
          autoClose: false,
          withCloseButton: false,
        });
        const result = await scoreSubmission(row.submission.code, setup, runner);
        if (signal.aborted) break;
        const { patch, outcome } = autogradePatch(row.submission, result, { ...options, points: assignment.points });
        if (!patch) {
          tally[outcome] += 1;
          continue;
        }
        try {
          await grade.mutateAsync({ studentId: row.student.id, ...patch });
          tally[outcome] += 1;
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) tally.changed += 1;
          else tally.failed += 1;
        }
      }
    } finally {
      const stopped = signal.aborted;
      controllerRef.current = null;
      setRunning(false);
      const summary = autogradeSummary(tally, { stopped, setGrades: options.setGrades, reference });
      notifications.update({
        id,
        loading: false,
        autoClose: 10_000,
        withCloseButton: true,
        color: summary.color,
        icon: summary.color === 'teal' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />,
        title: summary.title,
        message: summary.message,
      });
    }
  };

  return { running, start, stop: () => controllerRef.current?.abort() };
}
