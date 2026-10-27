// Autograding: what autograde can check for an assignment, which work it grades, the score for one submission and
// the PATCH that stores it, and the wording of the modal and the summary — for a run over the assignment's work and
// for one student's work (the grading page, or a row of the assignment page). The pages run it (useAutograde.tsx);
// everything here is pure, with the code runner and the save passed in, so it can be unit-tested.

import {
  COMPARE_MODE_LABELS,
  computeAutoScore,
  gradeFromAutoScore,
  kindSupportsTests,
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
import { ApiError, errorMessage } from '../../api/client';
import { sameProgram, type SameProgramTarget } from '../../grading/sameProgram';
import { runnerFailed, type RunOutcome } from '../../runtime';
import { summarizeSolutionCheck, type SolutionCheck } from './solutionView';

const num = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** How autograde scores work for one assignment. */
export interface AutogradeMethod {
  /** Run every test (hidden ones included); the score is the weighted share passed. */
  tests: boolean;
  /** Work that is the same program as the teacher's solution (`sameProgram`) gets full marks. */
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

const isHandedIn = (submission: Pick<Submission, 'status'>) => submission.status === 'submitted' || submission.status === 'graded';

/** The rows a scope covers, in table order. Work that wasn't handed in is never autograded. */
export function autogradeTargets(rows: SubmissionRow[], scope: AutogradeScope): SubmissionRow[] {
  return rows.filter(({ submission }) => (scope === 'waiting' ? submission.status === 'submitted' : isHandedIn(submission)));
}

/** Autograde may set this work's grade: waiting to be graded, or graded by autograde (or every grade, for `replace-all`). */
export function mayAutograde(submission: Submission, scope: AutogradeScope): boolean {
  if (submission.status === 'submitted') return true;
  return submission.status === 'graded' && (submission.autoGraded || scope === 'replace-all');
}

/**
 * Why autograde couldn't score a submission (no tests; with tests every submission gets the share it passes):
 * - `student-input`: it asks for input, and work runs without any, so its output says nothing about it;
 * - `student-error`: it stopped with an error when run without input;
 * - `student-timeout`: it didn't finish in time;
 * - `output-differs`: it printed something different from the solution;
 * - `no-reference`: the solution's own output can't be compared with (see `ReferenceProblem`);
 * - `not-runnable`: work in this language can't be run here (web pages), and it isn't the same program.
 */
export type UnscoredReason = 'student-input' | 'student-error' | 'student-timeout' | 'output-differs' | 'no-reference' | 'not-runnable';

/** What autograde worked out for one submission. */
export interface AutogradeResult {
  /** 0–100, or null when autograde can't score this work (it's left for the teacher). */
  score: number | null;
  /** Results of every test, hidden ones included; absent when the assignment's tests weren't run. */
  testResults?: TestResult[];
  /** The work is the same program as the teacher's solution. */
  matchesSolution: boolean;
  /** Why `score` is null; absent when it isn't, or when the code runner failed (`runnerError`). */
  unscoredReason?: UnscoredReason;
  /**
   * The code runner itself failed (the language couldn't load or start), so this work wasn't really checked: it's
   * left exactly as it is rather than scored as if every test failed.
   */
  runnerError?: string;
}

/** What a run printed, with and without its input prompts (see `RunOutcome.promptlessStdout`). */
export type PrintedOutput = Pick<RunOutcome, 'stdout' | 'promptlessStdout'>;

/** What scoring a submission needs to know about the assignment. */
export interface AutogradeSetup {
  method: AutogradeMethod;
  /** The assignment's language: how code is read to tell whether it's the same program as the solution. */
  target: SameProgramTarget;
  /** Every test, hidden ones included. */
  tests: TestCase[];
  compareMode: CompareMode;
  /** The teacher's solution ('' = none). */
  solutionCode: string;
  /**
   * Tests and a solution: the ids of the tests the solution itself fails (`PreparedAutograde.solutionCheck`). Absent
   * or null when that isn't known: then the same program as the solution has to pass every test for full marks.
   */
  solutionFails?: readonly string[] | null;
  /** What the solution printed when run without input; null when output isn't compared (see `referenceProblem`). */
  referenceOutput: PrintedOutput | null;
  /**
   * The code runner didn't start when the solution ran (output comparison only): work that isn't the same program
   * as the solution can't be checked. Null otherwise.
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

/** Why a run without input says nothing about the work: it asked for input, or didn't finish. Null when it finished. */
function studentProblem(outcome: RunOutcome): UnscoredReason | null {
  // Checked first: running out of input is an error in some languages, and the error isn't the work's fault.
  if (outcome.readInput) return 'student-input';
  if (outcome.status === 'timeout') return 'student-timeout';
  return outcome.status === 'ok' ? null : 'student-error';
}

/**
 * Output that matches the solution's under the compare mode, with or without input prompts (only work that reads no
 * input is compared, so today the two are the same; comparing both keeps this right if that changes).
 */
function sameOutput(output: PrintedOutput, reference: PrintedOutput, mode: CompareMode): boolean {
  return outputsMatch(output.stdout, reference.stdout, mode) || outputsMatch(output.promptlessStdout, reference.promptlessStdout, mode);
}

/**
 * Whether work that is the same program as the solution passes every test the solution passes (`solutionFails` =
 * the ids of the tests the solution fails; null = not known, so every test), as the same program must: then its
 * full marks stand even where a test the solution fails too (a wrong expected output) would lower its score. Work
 * that only looks like the solution to `sameProgram` doesn't get full marks over tests it fails.
 */
export function passesSolutionTests(
  tests: Pick<TestCase, 'id'>[],
  results: Pick<TestResult, 'testId' | 'passed'>[],
  solutionFails: readonly string[] | null | undefined,
): boolean {
  const fails = new Set(solutionFails ?? []);
  const passed = new Set(results.filter((r) => r.passed).map((r) => r.testId));
  return tests.every((t) => passed.has(t.id) || fails.has(t.id));
}

/**
 * Scores one submission: full marks when it's the same program as the solution (`sameProgram`; the tests still run,
 * so their results are stored, and it must pass every test the solution passes — `passesSolutionTests`); otherwise
 * the weighted share of tests passed; with no tests, full marks when it prints what the solution prints, and no
 * score (with the reason) when it doesn't, asks for input or doesn't finish. When the code runner itself fails, the
 * work isn't scored (`runnerError`), except that the same program as the solution still gets full marks.
 */
export async function scoreSubmission(code: string, setup: AutogradeSetup, runner: AutogradeRunner): Promise<AutogradeResult> {
  const matches = setup.method.solution && (await sameProgram(setup.target, code, setup.solutionCode, setup.compareMode));
  if (setup.method.tests) {
    const run = await runner.runTests(code);
    if (run.runnerError) {
      // Every test "failed" because nothing ran; storing those results would score the work 0.
      return matches ? { score: 100, matchesSolution: true } : { score: null, matchesSolution: false, runnerError: run.runnerError };
    }
    const full = matches && passesSolutionTests(setup.tests, run.results, setup.solutionFails);
    return { score: full ? 100 : computeAutoScore(setup.tests, run.results), testResults: run.results, matchesSolution: full };
  }
  if (matches) return { score: 100, matchesSolution: true };
  if (!setup.method.output) return { score: null, matchesSolution: false, unscoredReason: 'not-runnable' };
  if (setup.runnerError) return { score: null, matchesSolution: false, runnerError: setup.runnerError };
  if (setup.referenceOutput == null) return { score: null, matchesSolution: false, unscoredReason: 'no-reference' };
  const outcome = await runner.runProgram(code);
  if (runnerFailed(outcome)) return { score: null, matchesSolution: false, runnerError: runnerErrorMessage(outcome) };
  // Work that asks for input printed what it did without any, so its output says nothing about it.
  const problem = studentProblem(outcome) ?? (sameOutput(outcome, setup.referenceOutput, setup.compareMode) ? null : 'output-differs');
  return problem ? { score: null, matchesSolution: false, unscoredReason: problem } : { score: 100, matchesSolution: false };
}

/**
 * Why the solution's output can't be compared with the students':
 * - `runner`: the code runner didn't start, so nothing could be run;
 * - `input`: it asks for input (even in languages where running out isn't an error, such as JavaScript's prompt());
 * - `error`: it stops with an error;
 * - `timeout`: it doesn't finish in time;
 * - `silent`: it prints nothing (an empty program would match it).
 * Null when it can be compared.
 */
export type ReferenceProblem = 'runner' | 'input' | 'error' | 'timeout' | 'silent';

export function referenceProblem(outcome: RunOutcome): ReferenceProblem | null {
  if (runnerFailed(outcome)) return 'runner';
  if (outcome.readInput) return 'input';
  if (outcome.status === 'timeout') return 'timeout';
  if (outcome.status !== 'ok') return 'error';
  return outcome.stdout.trim() === '' ? 'silent' : null;
}

/** What the solution's run without input means for the setup: what to compare with, or why nothing can be. */
export function referenceSetup(outcome: RunOutcome): {
  problem: ReferenceProblem | null;
  referenceOutput: PrintedOutput | null;
  runnerError: string | null;
} {
  const problem = referenceProblem(outcome);
  return {
    problem,
    referenceOutput: problem === null ? { stdout: outcome.stdout, promptlessStdout: outcome.promptlessStdout } : null,
    runnerError: problem === 'runner' ? runnerErrorMessage(outcome) : null,
  };
}

/** A run, ready to score submissions. */
export interface PreparedAutograde {
  /** What every submission is scored with. */
  setup: AutogradeSetup;
  /** Output comparison only: why the solution's output can't be compared with the students' (null when it can). */
  reference: ReferenceProblem | null;
  /**
   * Tests and a solution: the solution's own results on the tests, so a test it fails (a mistake in an expected
   * output, say) can be pointed out. Null when it wasn't checked, or the code runner failed while checking it.
   */
  solutionCheck: SolutionCheck | null;
}

/**
 * Gets a run ready: the setup every submission is scored with, and what's wrong with the solution as a reference.
 * With output comparison, this runs the solution once without input; with tests and a solution, it runs the
 * solution on the tests.
 */
export async function prepareAutograde(
  assignment: Pick<Assignment, 'tests' | 'compareMode' | 'solutionCode'>,
  method: AutogradeMethod,
  target: SameProgramTarget,
  runner: AutogradeRunner,
  signal?: AbortSignal,
): Promise<PreparedAutograde> {
  const setup: AutogradeSetup = {
    method,
    target,
    tests: assignment.tests,
    compareMode: assignment.compareMode,
    solutionCode: assignment.solutionCode ?? '',
    referenceOutput: null,
    runnerError: null,
  };
  const prepared: PreparedAutograde = { setup, reference: null, solutionCheck: null };
  if (method.tests && method.solution && setup.solutionCode.trim() !== '') {
    const run = await runner.runTests(setup.solutionCode);
    if (signal?.aborted || run.runnerError) return prepared;
    const solutionCheck = summarizeSolutionCheck(setup.tests, run.results);
    return { ...prepared, setup: { ...setup, solutionFails: solutionCheck.failing.map((f) => f.id) }, solutionCheck };
  }
  if (!method.output) return prepared;
  // What the solution prints is what each submission's output is compared with.
  const outcome = await runner.runProgram(setup.solutionCode);
  if (signal?.aborted) return prepared;
  const solutionRun = referenceSetup(outcome);
  return {
    ...prepared,
    setup: { ...setup, referenceOutput: solutionRun.referenceOutput, runnerError: solutionRun.runnerError },
    reference: solutionRun.problem,
  };
}

/** Getting a run ready runs the solution: once without input (no tests), or on the tests (tests and a solution). */
export function runsSolution(method: AutogradeMethod): boolean {
  return method.output || (method.tests && method.solution);
}

/** The solution fails some of the tests it was checked against. */
export function solutionFailsTests(check: SolutionCheck | null): check is SolutionCheck {
  return check != null && check.failing.length > 0;
}

/** How much of a test's error to quote. */
const MAX_ERROR_CHARS = 160;

/**
 * What to check for each test the solution fails: the expected output of a test it ran to the end of (it printed
 * something else), and the input of a test it stopped on (an error, such as running out of input, or a time-out),
 * quoting why.
 */
function failingTestAdvice(check: SolutionCheck): string[] {
  const wrongOutput = check.failing.filter((f) => f.error == null);
  const stopped = check.failing.filter((f) => f.error != null);
  const advice: string[] = [];
  if (wrongOutput.length > 0) {
    const what = wrongOutput.length === 1 ? "that test's expected output" : "those tests' expected outputs";
    advice.push(`Check ${what}: ${wrongOutput.map((f) => f.label).join(', ')}`);
  }
  for (const f of stopped.slice(0, 2)) {
    const error = f.error!.length > MAX_ERROR_CHARS ? `${f.error!.slice(0, MAX_ERROR_CHARS - 1)}…` : f.error!;
    advice.push(`${f.label} doesn't run to the end: ${sentence(error)}`);
  }
  if (stopped.length > 2) advice.push(`${num(stopped.length - 2)} more ${stopped.length === 3 ? "doesn't" : "don't"} either`);
  if (stopped.length > 0) {
    const what = stopped.length === 1 ? "that test's input" : "those tests' inputs";
    advice.push(`Check ${what} (one line for each time your solution asks for input) and your solution`);
  }
  return advice;
}

/**
 * "Your solution fails 1 of 3 tests. Check that test's expected output: Test 2." Null when it passes every one.
 * See `failingTestAdvice`.
 */
export function solutionCheckWarning(check: SolutionCheck | null): string | null {
  if (!solutionFailsTests(check)) return null;
  return [`Your solution fails ${num(check.failing.length)} of ${plural(check.total, 'test')}`, ...failingTestAdvice(check)].map(sentence).join(' ');
}

/**
 * A run prepared ahead (while the Autograde modal is open) that the run the teacher starts can use as it is: null
 * when the code runner failed while preparing it, so the run tries again.
 */
export function reusablePreparation(prepared: PreparedAutograde | null): PreparedAutograde | null {
  if (!prepared) return null;
  const { method } = prepared.setup;
  const checkMissing = method.tests && method.solution && prepared.solutionCheck == null;
  return prepared.reference === 'runner' || checkMissing ? null : prepared;
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

/**
 * What happened to one submission, saving included: `changed` = the save was refused (409) because the work changed
 * while it was being checked (e.g. the student unsubmitted); `failed` = it couldn't be saved for another reason.
 */
export type AutogradeStepOutcome = AutogradeOutcome | 'changed' | 'failed';

export interface AutogradeStep {
  outcome: AutogradeStepOutcome;
  result: AutogradeResult;
  /** The work as saved, or null when nothing was saved. */
  saved: Submission | null;
  /** Why it couldn't be saved (`changed` / `failed`). */
  error?: unknown;
}

/**
 * Scores one submission and saves the result (`save` sends the PATCH and returns the saved work): what a run does
 * for each submission. Null when the run was stopped before anything was saved.
 */
export async function autogradeSubmission(
  submission: Submission,
  setup: AutogradeSetup,
  runner: AutogradeRunner,
  options: AutogradeOptions & { points: number },
  save: (patch: GradeSubmissionInput) => Promise<Submission>,
  signal?: AbortSignal,
): Promise<AutogradeStep | null> {
  const result = await scoreSubmission(submission.code, setup, runner);
  if (signal?.aborted) return null;
  const { patch, outcome } = autogradePatch(submission, result, options);
  if (!patch) return { outcome, result, saved: null };
  try {
    return { outcome, result, saved: await save(patch) };
  } catch (error) {
    return { outcome: error instanceof ApiError && error.status === 409 ? 'changed' : 'failed', result, saved: null, error };
  }
}

// --- Wording -------------------------------------------------------------------------------------------

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

/** The rule for work that is the solution typed differently (the modal, and the "Matches solution" badge's tooltip). */
export const SAME_PROGRAM_RULE =
  "Work that is the same program as your solution gets full marks — spacing, indentation, blank lines and comments don't count.";

/** "Output is compared: Ignore all spaces and line breaks." */
export function compareRule(mode: CompareMode): string {
  return `Output is compared: ${COMPARE_MODE_LABELS[mode]}.`;
}

/** Where to add tests, for assignments whose solution asks for input. */
const ADD_TESTS =
  'Add tests (Edit → Tests → Fill expected outputs from a model solution) so autograde can check programs that ask for input.';

/** How web page text is compared (it isn't output, so the compare mode doesn't apply). */
const PAGE_TEXT_RULE = "Text on the page counts as a browser shows it: extra spaces and line breaks don't count; capitals do.";

/** How scores are worked out for this assignment, one plain-words rule per item, for the modal. */
export function autogradeRules(
  method: AutogradeMethod,
  kind: LanguageKind,
  points: number,
  setGrades: boolean,
  compareMode: CompareMode,
): string[] {
  const rules: string[] = [];
  const otherwise = setGrades ? 'anything else is left for you to grade' : 'anything else gets no auto score';
  if (method.solution) rules.push(SAME_PROGRAM_RULE);
  if (method.tests) {
    rules.push(
      `${method.solution ? 'Other work scores' : 'Each submission scores'} the share of tests it passes, hidden tests included and weighted by their points.`,
    );
    rules.push(compareRule(compareMode));
    if (setGrades) rules.push(`The score becomes a grade out of ${points}: ${scoreExample(points)}.`);
  } else if (method.output) {
    rules.push(
      `There are no tests, so your solution runs once without any input. Other work that prints the same thing without asking for input gets full marks; ${otherwise}.`,
    );
    rules.push(compareRule(compareMode));
  } else {
    const what = kind === 'web' ? "Web pages can't be run here" : "Work in this language can't be run here";
    rules.push(`${what}, so only the same program as your solution gets a score. ${otherwise[0]!.toUpperCase()}${otherwise.slice(1)}.`);
    if (kind === 'web' && method.solution) rules.push(PAGE_TEXT_RULE);
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
  /** Why work wasn't scored, for the work left without a score (`unscored` and `cleared`). */
  reasons: Record<UnscoredReason, number>;
}

export function emptyTally(total: number): AutogradeTally {
  return {
    total,
    graded: 0,
    kept: 0,
    scored: 0,
    unscored: 0,
    cleared: 0,
    unchecked: 0,
    changed: 0,
    failed: 0,
    reasons: { 'student-input': 0, 'student-error': 0, 'student-timeout': 0, 'output-differs': 0, 'no-reference': 0, 'not-runnable': 0 },
  };
}

/** Counts what happened to one submission. */
export function tallyStep(tally: AutogradeTally, step: AutogradeStep): void {
  tally[step.outcome] += 1;
  const reason = step.result.unscoredReason;
  if (reason && (step.outcome === 'unscored' || step.outcome === 'cleared')) tally.reasons[reason] += 1;
}

/** Why the solution can't be a reference, and what that means: the first half of the note. */
function referenceProblemText(problem: Exclude<ReferenceProblem, 'runner'>): string {
  switch (problem) {
    case 'input':
      return 'Your solution asks for input, and with no tests autograde runs programs without any';
    case 'error':
      return 'Your solution stops with an error when it runs without input';
    case 'timeout':
      return "Your solution doesn't finish in time when it runs without input";
    case 'silent':
      return "Your solution doesn't print anything";
  }
}

/** What to do about a solution whose output can't be compared with: the second half of the note. */
function referenceFix(problem: Exclude<ReferenceProblem, 'runner'>): string {
  switch (problem) {
    case 'input':
      return ADD_TESTS;
    case 'error':
    case 'timeout':
      return 'Fix your solution (Edit → Solution) so it runs to the end without input, or add tests (Edit → Tests).';
    case 'silent':
      return 'Make your solution print its result (Edit → Solution), or add tests (Edit → Tests).';
  }
}

/** Why only work that's the same program as the solution could be scored, and what to do about it. */
function referenceNote(problem: ReferenceProblem, verb: string): string {
  if (problem === 'runner') {
    return `The code runner didn't start when your solution ran, so only work that's the same program as your solution was ${verb}. Reload the page and run autograde again to check the rest.`;
  }
  return `${referenceProblemText(problem)}, so only work that's the same program as your solution could be ${verb}. ${referenceFix(problem)}`;
}

export interface AutogradeWarning {
  title: string;
  sentences: string[];
  /** The fix is in the assignment editor (the solution or the tests). */
  editAssignment: boolean;
}

/**
 * What the Autograde modal warns about before anything is graded, from the run it got ready: a solution whose output
 * can't be compared with the students' (no tests), or one that fails some of the tests. Null when all is well.
 */
export function autogradeWarning(prepared: PreparedAutograde, setGrades: boolean): AutogradeWarning | null {
  const verb = setGrades ? 'graded' : 'scored';
  const onlySame = `Only work that's the same program as your solution will be ${verb}.`;
  switch (prepared.reference) {
    case 'runner':
      return {
        title: "The code runner didn't start",
        sentences: ["Your solution couldn't be run just now. Autograding tries again when you start it; if it still doesn't start, reload the page."],
        editAssignment: false,
      };
    case 'input':
      return {
        title: 'Your solution asks for input',
        sentences: [
          "With no tests, autograde runs programs without input, so it can't compare students' output with your solution's.",
          onlySame,
          ADD_TESTS,
        ],
        editAssignment: true,
      };
    case 'error':
    case 'timeout':
    case 'silent':
      return {
        title: referenceProblemText(prepared.reference),
        sentences: ["There's no output to compare students' output with.", onlySame, referenceFix(prepared.reference)],
        editAssignment: true,
      };
    case null:
      break;
  }
  const check = prepared.solutionCheck;
  if (!solutionFailsTests(check)) return null;
  return {
    title: `Your solution fails ${num(check.failing.length)} of ${plural(check.total, 'test')}`,
    sentences: [
      ...failingTestAdvice(check).map(sentence),
      `Other work is ${verb} by the tests it passes, so a mistake in a test lowers everyone's score.`,
    ],
    editAssignment: true,
  };
}

/** "2 ask for input", "1 stops with an error", … for the reasons a student's work wasn't scored. */
const REASON_COUNTS: Record<Exclude<UnscoredReason, 'no-reference'>, [one: string, many: string]> = {
  'student-input': ['asks for input', 'ask for input'],
  'student-error': ['stops with an error', 'stop with an error'],
  'student-timeout': ["doesn't finish in time", "don't finish in time"],
  'output-differs': ['prints something different from your solution', 'print something different from your solution'],
  'not-runnable': ["isn't the same program as your solution", "aren't the same program as your solution"],
};

/**
 * "Not graded: 2 ask for input, 1 stops with an error." Work the solution couldn't be compared with is explained by
 * the reference note instead. Null when there's nothing to break down.
 */
function reasonBreakdown(reasons: Record<UnscoredReason, number>, verb: string): string | null {
  const parts = (Object.keys(REASON_COUNTS) as (keyof typeof REASON_COUNTS)[])
    .filter((reason) => reasons[reason] > 0)
    .map((reason) => `${num(reasons[reason])} ${REASON_COUNTS[reason][reasons[reason] === 1 ? 0 : 1]}`);
  return parts.length > 0 ? `Not ${verb}: ${parts.join(', ')}.` : null;
}

export interface AutogradeSummary {
  title: string;
  message: string;
  color: 'teal' | 'yellow' | 'red';
  /** Something needs the teacher's attention, so the notification stays until they close it. */
  keepOpen: boolean;
}

/** The notification shown when autograding ends. */
export function autogradeSummary(
  tally: AutogradeTally,
  {
    stopped,
    setGrades,
    reference = null,
    solutionCheck = null,
  }: { stopped: boolean; setGrades: boolean; reference?: ReferenceProblem | null; solutionCheck?: SolutionCheck | null },
): AutogradeSummary {
  const counts = setGrades
    ? [
        tally.graded > 0 ? `${num(tally.graded)} graded` : null,
        tally.unscored > 0 ? `${num(tally.unscored)} left for you to grade` : null,
        tally.cleared > 0 ? `${plural(tally.cleared, 'earlier auto grade')} taken off` : null,
        tally.kept > 0 ? `${plural(tally.kept, 'grade')} you entered kept` : null,
      ]
    : [
        tally.scored > 0 ? `${plural(tally.scored, 'auto score')} updated` : null,
        tally.unscored > 0 ? `${num(tally.unscored)} couldn't be scored` : null,
      ];
  counts.push(
    tally.unchecked > 0 ? `${num(tally.unchecked)} couldn't be checked` : null,
    tally.changed > 0 ? `${num(tally.changed)} changed while autograding` : null,
    tally.failed > 0 ? `${num(tally.failed)} couldn't be saved` : null,
  );
  const parts = counts.filter((part) => part !== null);
  const done =
    tally.graded + tally.kept + tally.scored + tally.unscored + tally.cleared + tally.unchecked + tally.changed + tally.failed;

  const verb = setGrades ? 'graded' : 'scored';
  const sentences: string[] = [];
  if (parts.length > 0) sentences.push(parts.join(' · '));
  else sentences.push(stopped ? 'Stopped before any work was checked.' : 'Nothing was checked.');
  if (stopped && done > 0 && done < tally.total) sentences.push(`Stopped after ${done} of ${tally.total}.`);
  const breakdown = reasonBreakdown(tally.reasons, verb);
  if (breakdown) sentences.push(breakdown);
  if (reference) sentences.push(referenceNote(reference, verb));
  const warning = solutionCheckWarning(solutionCheck);
  if (warning) sentences.push(warning);
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
  // Work left without a score, a solution that can't be compared with or that fails tests, or work to check again.
  const attention = problems || tally.unscored > 0 || tally.cleared > 0 || tally.changed > 0 || reference !== null || warning !== null;
  return {
    title: stopped
      ? 'Autograding stopped'
      : tally.failed > 0
        ? 'Some results could not be saved'
        : tally.unchecked > 0
          ? 'Some work could not be checked'
          : 'Autograding finished',
    message: sentences.map(sentence).join(' '),
    color: problems ? 'red' : stopped || attention ? 'yellow' : 'teal',
    keepOpen: attention,
  };
}

// --- One student --------------------------------------------------------------------------------------------

/**
 * Autograding one student's work is the teacher asking for it explicitly, so it always sets a grade and replaces
 * whatever grade is there (after confirming a grade the teacher entered; see `autogradeOneConfirmation`).
 */
export const AUTOGRADE_ONE_OPTIONS: AutogradeOptions = { scope: 'replace-all', setGrades: true };

/** What is autograding on a page: a run over the chosen work, or one student's work. One at a time. */
export type AutogradeActivity = { kind: 'all' } | { kind: 'one'; studentId: number; name: string };

function waitFor(activity: AutogradeActivity): string {
  return activity.kind === 'all' ? 'Wait for autograding to finish.' : `Wait until ${activity.name}'s work is autograded.`;
}

/** Why one student's work can't be autograded right now (the control is disabled with this), or null when it can. */
export function autogradeOneBlocker(submission: Pick<Submission, 'status'>, activity: AutogradeActivity | null): string | null {
  if (!isHandedIn(submission)) return 'Not handed in yet. Only handed-in work can be autograded.';
  return activity ? waitFor(activity) : null;
}

/** Why the Autograde button (for the chosen work) can't be used right now, or null when it can. */
export function autogradeAllBlocker(handedInCount: number, activity: AutogradeActivity | null): string | null {
  if (handedInCount === 0) return 'Nothing has been handed in yet.';
  // While the run itself is going, the button is "Stop autograding" instead.
  return activity?.kind === 'one' ? waitFor(activity) : null;
}

/** The grade the teacher entered themselves ("8 / 10"), which autograding this work would replace; null if none. */
export function handGradeToReplace(submission: Submission, outOf: number): string | null {
  if (submission.status !== 'graded' || submission.autoGraded || submission.grade == null) return null;
  return `${num(submission.grade)} / ${num(outOf)}`;
}

/**
 * What to confirm before autograding one student's work, one sentence per item, or null when there's nothing to
 * confirm: it replaces a grade the teacher entered, or a grade they've typed on the grading page but not saved.
 */
export function autogradeOneConfirmation(submission: Submission, outOf: number, { unsavedGrade = false } = {}): string[] | null {
  const hand = handGradeToReplace(submission, outOf);
  const sentences: string[] = [];
  if (hand) sentences.push(`This replaces the grade you entered: ${hand}.`);
  if (unsavedGrade) sentences.push(`${hand ? 'It also replaces' : 'This replaces'} the grade you've typed but not saved.`);
  if (sentences.length === 0) return null;
  if (hand) sentences.push("If autograde can't score the work, your grade is kept.");
  return sentences;
}

/** Why autograde couldn't score the work (no runner error), and what to do about it: the first part of the message. */
function unscoredText(
  reason: UnscoredReason | undefined,
  { kind, reference, compareMode }: { kind: LanguageKind; reference: ReferenceProblem | null; compareMode: CompareMode },
): string[] {
  switch (reason) {
    case 'student-input':
      return ["It asks for input, and with no tests autograde runs work without any, so its output can't be checked"];
    case 'student-error':
      return ['It stops with an error when it runs without input'];
    case 'student-timeout':
      return ["It doesn't finish in time when it runs without input"];
    case 'output-differs':
      return ["Its output differs from your solution's", compareRule(compareMode)];
    case 'no-reference': {
      if (!reference || reference === 'runner') return ["Your solution's output can't be compared with"];
      return [`${referenceProblemText(reference)}, so only work that's the same program as your solution can be scored`, referenceFix(reference)];
    }
    case 'not-runnable': {
      const what = kind === 'web' ? "web pages can't be run here" : "work in this language can't be run here";
      return [`It isn't the same program as your solution, and ${what}`];
    }
    case undefined:
      return ["Autograde couldn't score it"];
  }
}

/** Why the graded work got its score: "same program as your solution", "3 of 4 tests passed", … */
function gradedReason(result: AutogradeResult, tests: TestCase[]): string {
  if (result.matchesSolution) return 'same program as your solution';
  if (result.testResults) {
    const results = result.testResults;
    const passed = tests.filter((t) => results.some((r) => r.testId === t.id && r.passed)).length;
    return `${num(passed)} of ${plural(tests.length, 'test')} passed`;
  }
  return "its output matches your solution's";
}

/**
 * The notification shown when autograding one student's work ends. `step` null = it stopped before anything was
 * saved (the teacher left the page).
 */
export function autogradeOneSummary(
  step: AutogradeStep | null,
  {
    name,
    before,
    outOf,
    tests,
    kind,
    compareMode,
    reference = null,
    solutionCheck = null,
  }: {
    /** The student's name. */
    name: string;
    /** The work as it was when autograding started. */
    before: Submission;
    /** The assignment's points. */
    outOf: number;
    /** Every test, hidden ones included. */
    tests: TestCase[];
    kind: LanguageKind;
    compareMode: CompareMode;
    reference?: ReferenceProblem | null;
    /** The solution's own results on the tests (`PreparedAutograde.solutionCheck`). */
    solutionCheck?: SolutionCheck | null;
  },
): AutogradeSummary {
  if (!step) {
    return {
      title: 'Autograding stopped',
      message: `${name}'s work wasn't changed. Autograding stops when you leave the page.`,
      color: 'yellow',
      keepOpen: false,
    };
  }
  const { result } = step;
  const join = (parts: (string | null)[]) => parts.filter((p) => p !== null).map(sentence).join(' ');
  const warning = solutionCheckWarning(solutionCheck);
  switch (step.outcome) {
    case 'graded':
      return {
        title: `Graded ${num(gradeFromAutoScore(result.score ?? 0, outOf))} / ${num(outOf)} — ${gradedReason(result, tests)}`,
        message: join([`${name} can see this grade now`, warning]),
        color: warning ? 'yellow' : 'teal',
        keepOpen: warning !== null,
      };
    case 'unchecked': {
      const detail = result.runnerError ?? '';
      return {
        title: "The code runner didn't start",
        message: join([
          `${name}'s work wasn't checked, so nothing was changed`,
          detail && detail !== "The code runner didn't start." ? detail : null,
          /reload/i.test(detail) ? null : 'Reload the page and try again',
        ]),
        color: 'red',
        keepOpen: true,
      };
    }
    case 'changed':
      return {
        title: `${name}'s work changed`,
        message: 'It changed while it was being autograded (it may have been unsubmitted), so nothing was saved. Check it and try again.',
        color: 'yellow',
        keepOpen: true,
      };
    case 'failed':
      return { title: `Couldn't autograde ${name}'s work`, message: errorMessage(step.error), color: 'red', keepOpen: true };
    case 'scored':
      // Not reached (grades are always set), but say what happened if it were.
      return { title: 'Auto score updated', message: `${name}'s grade wasn't changed.`, color: 'teal', keepOpen: false };
    case 'unscored':
    case 'kept':
    case 'cleared': {
      const grade = before.grade != null ? `${num(before.grade)} / ${num(outOf)}` : null;
      const then =
        step.outcome === 'kept'
          ? `Your grade${grade ? ` of ${grade}` : ''} was kept`
          : step.outcome === 'cleared'
            ? `Its earlier auto grade${grade ? ` (${grade})` : ''} was taken off, so it's back in To grade`
            : "It's left for you to grade";
      return {
        title: `Couldn't score ${name}'s work`,
        message: join([...unscoredText(result.unscoredReason, { kind, reference, compareMode }), then, warning]),
        color: 'yellow',
        keepOpen: true,
      };
    }
  }
}
