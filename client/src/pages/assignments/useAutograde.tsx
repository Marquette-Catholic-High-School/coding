import type { Assignment, GradeSubmissionInput, Submission, SubmissionRow } from '@codeclass/shared';
import { List, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useGradeSubmission } from '../../api/assignments';
import { queryKeys } from '../../api/client';
import { runTests, startRun, type RunOutcome, type RunTarget } from '../../runtime';
import {
  AUTOGRADE_ONE_OPTIONS,
  autogradeOneConfirmation,
  autogradeOneSummary,
  autogradeSubmission,
  autogradeSummary,
  autogradeTargets,
  emptyTally,
  prepareAutograde,
  type AutogradeActivity,
  type AutogradeMethod,
  type AutogradeOptions,
  type AutogradeRunner,
  type AutogradeStep,
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

/** The real code runner for autograding, stopped by `signal`. */
function autogradeRunner(assignment: Assignment, target: RunTarget, signal: AbortSignal): AutogradeRunner {
  return {
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
}

/** Whose work to autograde on its own. */
export interface AutogradeOneTarget {
  student: { id: number; name: string };
  /** The work as the teacher sees it now; its `updatedAt` makes the save refuse work that changed meanwhile. */
  submission: Submission;
}

/** Asks the teacher to confirm; resolves true when they do. */
function confirmAutogradeOne(name: string, sentences: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title: `Autograde ${name}'s work?`,
      children:
        sentences.length === 1 ? (
          <Text size="sm">{sentences[0]}</Text>
        ) : (
          <List size="sm" spacing={4}>
            {sentences.map((s) => (
              <List.Item key={s}>{s}</List.Item>
            ))}
          </List>
        ),
      labels: { confirm: 'Autograde', cancel: 'Cancel' },
      // onConfirm runs before onClose, so the first answer wins.
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}

/**
 * Autogrades work in this browser (see autograde.ts for the rules), saving each result as it goes: the chosen work
 * one submission at a time (`start`), or one student's work (`autogradeOne`). Only one of them runs at a time
 * (`activity`), so they never write the same work at once. Progress is shown in a single updating notification;
 * leaving the page stops the run. `language` null = not loaded, nothing runs.
 */
export function useAutograde(assignment: Assignment, language: RunTarget | null, method: AutogradeMethod | null) {
  const grade = useGradeSubmission(assignment.id);
  const queryClient = useQueryClient();
  const [activity, setActivity] = useState<AutogradeActivity | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the page stops the run.
  useEffect(() => () => controllerRef.current?.abort(), []);

  /** Claims the page for a run; null when one is going already. */
  const begin = (next: AutogradeActivity): AbortController | null => {
    if (controllerRef.current) return null;
    const controller = new AbortController();
    controllerRef.current = controller;
    setActivity(next);
    return controller;
  };
  const finish = () => {
    controllerRef.current = null;
    setActivity(null);
  };

  /** Saves autograde's PATCH for one student's work and returns the work as saved. */
  const save = (studentId: number) => async (patch: GradeSubmissionInput) => (await grade.mutateAsync({ studentId, ...patch })).submission;

  const start = async (rows: SubmissionRow[], options: AutogradeOptions) => {
    const targets = autogradeTargets(rows, options.scope);
    if (!method || !language || targets.length === 0) return;
    const controller = begin({ kind: 'all' });
    if (!controller) return;
    const { signal } = controller;
    const target: RunTarget = { kind: language.kind, pseudocode: language.pseudocode };
    const runner = autogradeRunner(assignment, target, signal);
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
      const prepared = await prepareAutograde(assignment, method, runner, signal);
      reference = prepared.reference;
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
        const step = await autogradeSubmission(
          row.submission,
          prepared.setup,
          runner,
          { ...options, points: assignment.points },
          save(row.student.id),
          signal,
        );
        if (!step) break;
        tally[step.outcome] += 1;
      }
    } finally {
      const stopped = signal.aborted;
      finish();
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

  /**
   * Autogrades one student's handed-in work, replacing its grade (`AUTOGRADE_ONE_OPTIONS`) once the teacher has
   * confirmed replacing a grade they entered, or one they've typed and not saved (`unsavedGrade`). Resolves with
   * what happened (`saved` is the work as saved, if anything was), or null when it didn't run (cancelled, another run
   * going) or was stopped by leaving the page.
   */
  const autogradeOne = async (
    { student, submission }: AutogradeOneTarget,
    { unsavedGrade = false }: { unsavedGrade?: boolean } = {},
  ): Promise<AutogradeStep | null> => {
    if (!method || !language || controllerRef.current) return null;
    if (submission.status !== 'submitted' && submission.status !== 'graded') return null;
    const confirm = autogradeOneConfirmation(submission, assignment.points, { unsavedGrade });
    if (confirm && !(await confirmAutogradeOne(student.name, confirm))) return null;
    const controller = begin({ kind: 'one', studentId: student.id, name: student.name });
    if (!controller) return null;
    const { signal } = controller;
    const target: RunTarget = { kind: language.kind, pseudocode: language.pseudocode };
    const runner = autogradeRunner(assignment, target, signal);
    const id = notifications.show({
      loading: true,
      title: `Autograding ${student.name}'s work`,
      message: method.output ? 'Running your solution…' : 'Getting the language ready…',
      autoClose: false,
      withCloseButton: false,
    });
    let step: AutogradeStep | null = null;
    let reference: ReferenceProblem | null = null;
    try {
      const prepared = await prepareAutograde(assignment, method, runner, signal);
      reference = prepared.reference;
      if (!signal.aborted) {
        notifications.update({ id, message: `Checking ${student.name}'s code…` });
        step = await autogradeSubmission(
          submission,
          prepared.setup,
          runner,
          { ...AUTOGRADE_ONE_OPTIONS, points: assignment.points },
          save(student.id),
          signal,
        );
      }
    } catch (err) {
      // The code runner never throws, so this is unexpected; say so rather than leave the notification spinning.
      step = { outcome: 'failed', result: { score: null, matchesSolution: false }, saved: null, error: err };
    } finally {
      finish();
    }
    if (step?.outcome === 'changed') {
      // Show the work as it is now.
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submissions(assignment.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(assignment.id, student.id) });
    }
    const summary = autogradeOneSummary(step, {
      name: student.name,
      before: submission,
      outOf: assignment.points,
      tests: assignment.tests,
      method,
      kind: language.kind,
      reference,
    });
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
    return step;
  };

  return {
    /** What is autograding now, or null. */
    activity,
    /** A run over the chosen work is going (the page shows Stop). */
    running: activity?.kind === 'all',
    start,
    autogradeOne,
    stop: () => controllerRef.current?.abort(),
  };
}
