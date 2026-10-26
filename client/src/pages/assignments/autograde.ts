// Autograding on the assignment page: what autograde can check for an assignment, which work it grades, the score
// for one submission and the PATCH that stores it, and the wording of the modal and the summary. The page runs it
// (useAutograde.tsx); everything here is pure, with the code runner passed in, so it can be unit-tested.

import {
  computeAutoScore,
  gradeFromAutoScore,
  kindSupportsTests,
  matchesSolution,
  outputsMatch,
  type Assignment,
  type CompareMode,
  type GradeSubmissionInput,
  type LanguageKind,
  type Submission,
  type SubmissionRow,
  type TestCase,
  type TestResult,
} from '@codeclass/shared';
import { runnerFailed, type RunOutcome } from '../../runtime';

/** How autograde scores work for one assignment. */
export interface AutogradeMethod {
  /** Run every test (hidden ones included); the score is the weighted share passed. */
  tests: boolean;
  /** Work that matches the teacher's solution gets full marks. */
  solution: boolean;
  /** No tests: run the solution and each submission without input, and give full marks when they print the same. */
  output: boolean;
}

/** What autograde can check for this assignment, or null when it can't score anything (no tests and no solution). */
export function autogradeMethod(kind: LanguageKind, assignment: Pick<Assignment, 'tests' | 'hasSolution'>): AutogradeMethod | null {
  const runnable = kindSupportsTests(kind);
  const tests = runnable && assignment.tests.length > 0;
  const solution = assignment.hasSolution;
  if (!tests && !solution) return null;
  return { tests, solution, output: !tests && solution && runnable };
}

/**
 * Which work to autograde:
 * - `waiting`: handed in and not graded yet;
 * - `handed-in`: everything handed in; work autograde graded before is regraded, grades the teacher entered are kept;
 * - `replace-all`: everything handed in, replacing every grade.
 */
export type AutogradeScope = 'waiting' | 'handed-in' | 'replace-all';

export interface AutogradeOptions {
  scope: AutogradeScope;
  /** Set grades from the scores; off = only refresh test results and auto scores. */
  setGrades: boolean;
}

export const DEFAULT_AUTOGRADE_OPTIONS: AutogradeOptions = { scope: 'handed-in', setGrades: true };

const isHandedIn = (submission: Submission) => submission.status === 'submitted' || submission.status === 'graded';

/** The rows a scope covers, in table order. Work that wasn't handed in is never autograded. */
export function autogradeTargets(rows: SubmissionRow[], scope: AutogradeScope): SubmissionRow[] {
  return rows.filter(({ submission }) => (scope === 'waiting' ? submission.status === 'submitted' : isHandedIn(submission)));
}

/** Autograde may set this work's grade: waiting to be graded, or graded by autograde (or every grade, for `replace-all`). */
export function mayAutograde(submission: Submission, scope: AutogradeScope): boolean {
  if (submission.status === 'submitted') return true;
  return submission.status === 'graded' && (submission.autoGraded || scope === 'replace-all');
}

/** What autograde worked out for one submission. */
export interface AutogradeResult {
  /** 0–100, or null when autograde can't score this work (it's left for the teacher). */
  score: number | null;
  /** Results of every test, hidden ones included; absent when the assignment's tests weren't run. */
  testResults?: TestResult[];
  matchesSolution: boolean;
  /**
   * The code runner itself failed (the language couldn't load or start), so this work wasn't really checked: it's
   * left exactly as it is rather than scored as if every test failed.
   */
  runnerError?: string;
}

/** What scoring a submission needs to know about the assignment. */
export interface AutogradeSetup {
  method: AutogradeMethod;
  /** Every test, hidden ones included. */
  tests: TestCase[];
  compareMode: CompareMode;
  /** The teacher's solution ('' = none). */
  solutionCode: string;
  /** What the solution printed when run without input; null when output isn't compared (see `referenceProblem`). */
  referenceOutput: string | null;
  /**
   * The code runner didn't start when the solution ran (output comparison only): work that doesn't match the
   * solution exactly can't be checked. Null otherwise.
   */
  runnerError: string | null;
}

/** One submission's test run. */
export interface AutogradeTestRun {
  results: TestResult[];
  /** The code runner failed for at least one test, so the results say nothing about the code (null = it didn't). */
  runnerError: string | null;
}

/** Runs a submission's code. The page passes the real runtime (fresh worker, abort signal); tests pass fakes. */
export interface AutogradeRunner {
  /** Runs every test on `code`. */
  runTests(code: string): Promise<AutogradeTestRun>;
  /** Runs `code` once, non-interactive, without input. */
  runProgram(code: string): Promise<RunOutcome>;
}

/** The message of a run the code runner couldn't start. */
function runnerErrorMessage(outcome: RunOutcome): string {
  return outcome.error?.message ?? "The code runner didn't start.";
}

/**
 * Scores one submission: full marks when it matches the solution (the tests still run, so their results are
 * stored); otherwise the weighted share of tests passed; with no tests, full marks when it prints what the solution
 * prints, and no score when it doesn't (or when it asks for input). When the code runner itself fails, the work
 * isn't scored (`runnerError`), except that an exact match with the solution still gets full marks.
 */
export async function scoreSubmission(code: string, setup: AutogradeSetup, runner: AutogradeRunner): Promise<AutogradeResult> {
  const matches = setup.method.solution && matchesSolution(code, setup.solutionCode);
  if (setup.method.tests) {
    const run = await runner.runTests(code);
    if (run.runnerError) {
      // Every test "failed" because nothing ran; storing those results would score the work 0.
      return matches ? { score: 100, matchesSolution: true } : { score: null, matchesSolution: false, runnerError: run.runnerError };
    }
    return { score: matches ? 100 : computeAutoScore(setup.tests, run.results), testResults: run.results, matchesSolution: matches };
  }
  if (matches) return { score: 100, matchesSolution: true };
  if (setup.method.output && setup.runnerError) return { score: null, matchesSolution: false, runnerError: setup.runnerError };
  if (setup.method.output && setup.referenceOutput != null) {
    const outcome = await runner.runProgram(code);
    if (runnerFailed(outcome)) return { score: null, matchesSolution: false, runnerError: runnerErrorMessage(outcome) };
    // Work that asks for input printed what it did without any, so its output says nothing about it.
    const same = outcome.status === 'ok' && !outcome.readInput && outputsMatch(outcome.stdout, setup.referenceOutput, setup.compareMode);
    return { score: same ? 100 : null, matchesSolution: false };
  }
  return { score: null, matchesSolution: false };
}

/**
 * Why the solution's output can't be compared with the students':
 * - `runner`: the code runner didn't start, so nothing could be run;
 * - `failed`: it didn't finish without input — it asks for input (even in languages where that isn't an error,
 *   such as JavaScript's prompt()), or it has an error;
 * - `silent`: it prints nothing (an empty program would match it).
 * Null when it can be compared.
 */
export type ReferenceProblem = 'runner' | 'failed' | 'silent';

export function referenceProblem(outcome: RunOutcome): ReferenceProblem | null {
  if (runnerFailed(outcome)) return 'runner';
  if (outcome.status !== 'ok' || outcome.readInput) return 'failed';
  return outcome.stdout.trim() === '' ? 'silent' : null;
}

/** What the solution's run without input means for the setup: what to compare with, or why nothing can be. */
export function referenceSetup(outcome: RunOutcome): {
  problem: ReferenceProblem | null;
  referenceOutput: string | null;
  runnerError: string | null;
} {
  const problem = referenceProblem(outcome);
  return {
    problem,
    referenceOutput: problem === null ? outcome.stdout : null,
    runnerError: problem === 'runner' ? runnerErrorMessage(outcome) : null,
  };
}

/**
 * What happened to one submission:
 * - `graded`: autograde set its grade;
 * - `kept`: it has a grade the teacher entered, which is kept (its test results are still refreshed);
 * - `scored`: its auto score was refreshed (grades weren't being set);
 * - `unscored`: autograde couldn't score it, so it's left for the teacher;
 * - `cleared`: autograde graded it before but can't score it now, so that grade was taken off and it's back in
 *   To grade;
 * - `unchecked`: the code runner didn't start for it, so it was left exactly as it was.
 */
export type AutogradeOutcome = 'graded' | 'kept' | 'scored' | 'unscored' | 'cleared' | 'unchecked';

/**
 * The PATCH that stores a result (null = nothing to store), and what it does. Every PATCH carries the submission's
 * `updatedAt` from when the rows were loaded, so work that changed meanwhile (the student unsubmitted) is refused.
 */
export function autogradePatch(
  submission: Submission,
  result: AutogradeResult,
  options: AutogradeOptions & { points: number },
): { patch: GradeSubmissionInput | null; outcome: AutogradeOutcome } {
  if (result.runnerError) return { patch: null, outcome: 'unchecked' };
  const regrade = options.setGrades && mayAutograde(submission, options.scope);
  // A grade the teacher entered (autograde's own grades are always regraded when grades are being set).
  const handGraded = submission.status === 'graded' && !submission.autoGraded;
  const results: GradeSubmissionInput = {
    ...(result.testResults ? { testResults: result.testResults } : {}),
    autoScore: result.score,
    expectedUpdatedAt: submission.updatedAt,
  };
  if (result.score == null) {
    if (regrade && submission.status === 'graded' && submission.autoGraded) {
      // An earlier run's grade that this run can't give (e.g. the solution changed): take it off so the teacher
      // grades the work, rather than leaving a stale full-marks grade outside To grade.
      return { patch: { ...results, status: 'submitted' }, outcome: 'cleared' };
    }
    const outcome = options.setGrades && handGraded ? 'kept' : 'unscored';
    // Clear an auto score this run can't give (e.g. from tests the assignment no longer has); nothing else changes.
    const stale = result.testResults != null || submission.autoScore != null;
    return { patch: stale ? results : null, outcome };
  }
  if (regrade) {
    return {
      patch: { ...results, grade: gradeFromAutoScore(result.score, options.points), status: 'graded', autoGraded: true },
      outcome: 'graded',
    };
  }
  return { patch: results, outcome: options.setGrades && handGraded ? 'kept' : 'scored' };
}

// --- Wording -------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Autograde 1 submission" / "Autograde 12 submissions". */
export function autogradeButtonLabel(count: number): string {
  return `Autograde ${plural(count, 'submission')}`;
}

export interface AutogradeScopeOption {
  value: AutogradeScope;
  label: string;
  description: string;
}

/**
 * The "Which work" choices for the modal. When only auto scores are being refreshed, no grade changes whichever
 * work is chosen, so replacing every grade isn't offered (see `effectiveScope`).
 */
export function autogradeScopeOptions(setGrades: boolean): AutogradeScopeOption[] {
  const options: AutogradeScopeOption[] = [
    { value: 'waiting', label: 'Work waiting to be graded', description: "Handed-in work that hasn't been graded yet." },
  ];
  if (!setGrades) {
    options.push({
      value: 'handed-in',
      label: 'All handed-in work',
      description: "Graded work too. Only the auto scores are refreshed; grades aren't changed.",
    });
    return options;
  }
  options.push(
    {
      value: 'handed-in',
      label: 'All handed-in work',
      description:
        'Also regrades work that autograde graded before (work it can no longer score goes back to To grade). Grades you entered yourself are kept.',
    },
    { value: 'replace-all', label: 'All handed-in work, replacing every grade', description: 'Also replaces grades you entered yourself.' },
  );
  return options;
}

/** The scope to run: without grades being set, "replacing every grade" covers the same work as "All handed-in work". */
export function effectiveScope(scope: AutogradeScope, setGrades: boolean): AutogradeScope {
  return !setGrades && scope === 'replace-all' ? 'handed-in' : scope;
}

/** How scores are worked out for this assignment, one plain-words rule per item, for the modal. */
export function autogradeRules(method: AutogradeMethod, kind: LanguageKind, points: number, setGrades: boolean): string[] {
  const rules: string[] = [];
  const otherwise = setGrades ? 'anything else is left for you to grade' : 'anything else gets no auto score';
  if (method.solution) {
    rules.push("Work that matches your solution gets full marks. Blank lines and spaces at the ends of lines don't count.");
  }
  if (method.tests) {
    rules.push(
      `${method.solution ? 'Other work scores' : 'Each submission scores'} the share of tests it passes, hidden tests included and weighted by their points.`,
    );
    if (setGrades) rules.push(`The score becomes a grade out of ${points}: ${scoreExample(points)}.`);
  } else if (method.output) {
    rules.push(
      `There are no tests, so your solution runs once without any input. Other work that prints the same thing without asking for input gets full marks; ${otherwise}.`,
    );
  } else {
    const what = kind === 'web' ? "Web pages can't be run here" : "Work in this language can't be run here";
    rules.push(`${what}, so only an exact match with your solution gets a score. ${otherwise[0]!.toUpperCase()}${otherwise.slice(1)}.`);
  }
  return rules;
}

function scoreExample(points: number): string {
  return `passing 75% of the tests gives ${gradeFromAutoScore(75, points).toLocaleString('en-US')}`;
}

export interface AutogradeTally {
  /** Submissions in the chosen scope. */
  total: number;
  graded: number;
  kept: number;
  scored: number;
  unscored: number;
  /** An earlier auto grade was taken off because this run couldn't score the work; it's back in To grade. */
  cleared: number;
  /** The code runner didn't start for this work, so it was left as it was. */
  unchecked: number;
  /** Refused with 409: the work changed while autograding (e.g. the student unsubmitted). */
  changed: number;
  /** Couldn't be saved for another reason. */
  failed: number;
}

export function emptyTally(total: number): AutogradeTally {
  return { total, graded: 0, kept: 0, scored: 0, unscored: 0, cleared: 0, unchecked: 0, changed: 0, failed: 0 };
}

function referenceNote(problem: ReferenceProblem, setGrades: boolean): string {
  const verb = setGrades ? 'graded' : 'scored';
  switch (problem) {
    case 'runner':
      return `The code runner didn't start when your solution ran, so only work that matches it exactly was ${verb}. Reload the page and run autograde again to check the rest.`;
    case 'failed':
      return `Your solution didn't finish without input (it may ask for some), so only work that matches it exactly could be ${verb}.`;
    case 'silent':
      return `Your solution doesn't print anything, so only work that matches it exactly could be ${verb}.`;
  }
}

/** The notification shown when autograding ends. */
export function autogradeSummary(
  tally: AutogradeTally,
  { stopped, setGrades, reference = null }: { stopped: boolean; setGrades: boolean; reference?: ReferenceProblem | null },
): { title: string; message: string; color: 'teal' | 'yellow' | 'red' } {
  const count = (n: number) => n.toLocaleString('en-US');
  const counts = setGrades
    ? [
        tally.graded > 0 ? `${count(tally.graded)} graded` : null,
        tally.unscored > 0 ? `${count(tally.unscored)} left for you to grade` : null,
        tally.cleared > 0 ? `${plural(tally.cleared, 'earlier auto grade')} taken off` : null,
        tally.kept > 0 ? `${plural(tally.kept, 'grade')} you entered kept` : null,
      ]
    : [
        tally.scored > 0 ? `${plural(tally.scored, 'auto score')} updated` : null,
        tally.unscored > 0 ? `${count(tally.unscored)} couldn't be scored` : null,
      ];
  counts.push(
    tally.unchecked > 0 ? `${count(tally.unchecked)} couldn't be checked` : null,
    tally.changed > 0 ? `${count(tally.changed)} changed while autograding` : null,
    tally.failed > 0 ? `${count(tally.failed)} couldn't be saved` : null,
  );
  const parts = counts.filter((part) => part !== null);
  const done =
    tally.graded + tally.kept + tally.scored + tally.unscored + tally.cleared + tally.unchecked + tally.changed + tally.failed;

  const sentences: string[] = [];
  if (parts.length > 0) sentences.push(parts.join(' · '));
  else sentences.push(stopped ? 'Stopped before any work was checked.' : 'Nothing was checked.');
  if (stopped && done > 0 && done < tally.total) sentences.push(`Stopped after ${done} of ${tally.total}.`);
  if (reference) sentences.push(referenceNote(reference, setGrades));
  if (tally.cleared > 0) {
    sentences.push("Work autograde graded before but can't score now is back in To grade without that grade.");
  }
  if (tally.unchecked > 0 && reference !== 'runner') {
    sentences.push("The code runner didn't start for some work, so it was left as it was. Reload the page and run autograde again to check it.");
  }
  if (tally.changed > 0) sentences.push('Work that changed was skipped; check it again.');
  if (tally.failed > 0) sentences.push("Run autograde again to retry the ones that couldn't be saved.");
  else if (setGrades && tally.graded > 0 && !stopped) sentences.push('Students can see their new grades now.');

  const problems = tally.failed > 0 || tally.unchecked > 0;
  return {
    title: stopped
      ? 'Autograding stopped'
      : tally.failed > 0
        ? 'Some results could not be saved'
        : tally.unchecked > 0
          ? 'Some work could not be checked'
          : 'Autograding finished',
    message: sentences.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' '),
    color: problems ? 'red' : stopped || tally.changed > 0 || tally.cleared > 0 ? 'yellow' : 'teal',
  };
}
