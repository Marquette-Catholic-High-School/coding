import type { Submission, SubmissionRow, TestCase, TestResult } from '@codeclass/shared';
import { describe, expect, it, vi } from 'vitest';
import type { RunOutcome } from '../../runtime';
import {
  autogradeButtonLabel,
  autogradeMethod,
  autogradePatch,
  autogradeRules,
  autogradeScopeOptions,
  autogradeSummary,
  autogradeTargets,
  effectiveScope,
  emptyTally,
  mayAutograde,
  referenceProblem,
  referenceSetup,
  scoreSubmission,
  type AutogradeRunner,
  type AutogradeSetup,
} from './autograde';

const UPDATED = '2026-10-20T09:00:00.000Z';

function submission(partial: Partial<Submission> = {}): Submission {
  return {
    id: 1,
    assignmentId: 7,
    studentId: 3,
    code: 'print("hi")',
    status: 'submitted',
    submittedAt: UPDATED,
    updatedAt: UPDATED,
    testResults: null,
    autoScore: null,
    grade: null,
    autoGraded: false,
    feedback: null,
    gradedAt: null,
    returnedAt: null,
    late: false,
    ...partial,
  };
}

function row(id: number, partial: Partial<Submission> = {}): SubmissionRow {
  return { student: { id, name: `Student ${id}`, username: `s${id}` }, submission: submission({ studentId: id, ...partial }) };
}

const test = (id: string, points = 1): TestCase => ({ id, name: '', input: '', expectedOutput: 'x', hidden: false, points });
const result = (testId: string, passed: boolean): TestResult => ({ testId, passed, actualOutput: '', error: null, durationMs: 1 });
const outcome = (partial: Partial<RunOutcome> = {}): RunOutcome => ({
  status: 'ok',
  error: null,
  stdout: '',
  durationMs: 1,
  started: true,
  readInput: false,
  ...partial,
});
/** The language runtime couldn't load, so the program never ran. */
const LOAD_ERROR = "Couldn't load the Python runner. Reload the page and try again.";
const loadFailure = outcome({ status: 'error', started: false, durationMs: 0, error: { message: LOAD_ERROR } });

describe('autogradeMethod', () => {
  it('uses tests when the language can run them, and the solution when there is one', () => {
    expect(autogradeMethod('python', { tests: [test('a')], hasSolution: true })).toEqual({ tests: true, solution: true, output: false });
    expect(autogradeMethod('python', { tests: [test('a')], hasSolution: false })).toEqual({ tests: true, solution: false, output: false });
  });

  it('compares output with the solution when there are no tests', () => {
    expect(autogradeMethod('pseudocode', { tests: [], hasSolution: true })).toEqual({ tests: false, solution: true, output: true });
  });

  it('only matches the solution for web pages', () => {
    expect(autogradeMethod('web', { tests: [], hasSolution: true })).toEqual({ tests: false, solution: true, output: false });
    expect(autogradeMethod('web', { tests: [test('a')], hasSolution: true })).toEqual({ tests: false, solution: true, output: false });
  });

  it("is unavailable when there's nothing to check against", () => {
    expect(autogradeMethod('python', { tests: [], hasSolution: false })).toBeNull();
    expect(autogradeMethod('web', { tests: [test('a')], hasSolution: false })).toBeNull();
  });
});

describe('autogradeTargets', () => {
  const rows = [
    row(1, { status: 'not_started', id: null, updatedAt: null }),
    row(2, { status: 'in_progress' }),
    row(3, { status: 'submitted' }),
    row(4, { status: 'graded', grade: 8 }),
  ];

  it('picks work waiting to be graded', () => {
    expect(autogradeTargets(rows, 'waiting').map((r) => r.student.id)).toEqual([3]);
  });

  it('picks all handed-in work and never work that was not handed in', () => {
    expect(autogradeTargets(rows, 'handed-in').map((r) => r.student.id)).toEqual([3, 4]);
    expect(autogradeTargets(rows, 'replace-all').map((r) => r.student.id)).toEqual([3, 4]);
  });
});

describe('mayAutograde', () => {
  it('grades waiting work in every scope', () => {
    for (const scope of ['waiting', 'handed-in', 'replace-all'] as const) expect(mayAutograde(submission(), scope)).toBe(true);
  });

  it('regrades autograded work, and hand grades only when replacing every grade', () => {
    const auto = submission({ status: 'graded', grade: 5, autoGraded: true });
    const hand = submission({ status: 'graded', grade: 5, autoGraded: false });
    expect(mayAutograde(auto, 'handed-in')).toBe(true);
    expect(mayAutograde(hand, 'handed-in')).toBe(false);
    expect(mayAutograde(hand, 'replace-all')).toBe(true);
  });

  it('never grades work that was not handed in', () => {
    expect(mayAutograde(submission({ status: 'in_progress' }), 'replace-all')).toBe(false);
    expect(mayAutograde(submission({ status: 'not_started' }), 'replace-all')).toBe(false);
  });
});

describe('scoreSubmission', () => {
  const SOLUTION = 'x = 1\nprint(x)\n';
  const setup = (partial: Partial<AutogradeSetup>): AutogradeSetup => ({
    method: { tests: false, solution: true, output: false },
    tests: [],
    compareMode: 'trim',
    solutionCode: SOLUTION,
    referenceOutput: null,
    runnerError: null,
    ...partial,
  });
  const runner = (
    results: TestResult[],
    run: RunOutcome = outcome(),
    runnerError: string | null = null,
  ): AutogradeRunner & { runTests: ReturnType<typeof vi.fn>; runProgram: ReturnType<typeof vi.fn> } => ({
    runTests: vi.fn(async () => ({ results, runnerError })),
    runProgram: vi.fn(async () => run),
  });

  it('scores the weighted share of tests passed', async () => {
    const tests = [test('a', 1), test('b', 3)];
    const r = runner([result('a', true), result('b', false)]);
    const scored = await scoreSubmission('other', setup({ method: { tests: true, solution: true, output: false }, tests }), r);
    expect(scored).toEqual({ score: 25, testResults: [result('a', true), result('b', false)], matchesSolution: false });
  });

  it('gives full marks to the solution, ignoring blank lines and trailing spaces, and still stores the test results', async () => {
    const tests = [test('a')];
    const r = runner([result('a', false)]);
    const scored = await scoreSubmission('x = 1   \r\n\r\nprint(x)', setup({ method: { tests: true, solution: true, output: false }, tests }), r);
    expect(scored).toEqual({ score: 100, testResults: [result('a', false)], matchesSolution: true });
  });

  it('does not treat indentation changes as the same code', async () => {
    const scored = await scoreSubmission('  x = 1\nprint(x)', setup({}), runner([]));
    expect(scored).toEqual({ score: null, matchesSolution: false });
  });

  it('gives full marks to an exact match without running anything when there are no tests', async () => {
    const r = runner([]);
    expect(await scoreSubmission(SOLUTION, setup({ method: { tests: false, solution: true, output: true }, referenceOutput: '1\n' }), r)).toEqual({
      score: 100,
      matchesSolution: true,
    });
    expect(r.runProgram).not.toHaveBeenCalled();
    expect(r.runTests).not.toHaveBeenCalled();
  });

  it("compares output with the solution's when there are no tests", async () => {
    const withOutput = setup({ method: { tests: false, solution: true, output: true }, referenceOutput: '1\n' });
    expect((await scoreSubmission('print(1)', withOutput, runner([], outcome({ stdout: '1  \n\n' })))).score).toBe(100);
    expect((await scoreSubmission('print(2)', withOutput, runner([], outcome({ stdout: '2\n' })))).score).toBeNull();
    // Printing the right thing and then crashing isn't a match.
    expect((await scoreSubmission('print(1); 1/0', withOutput, runner([], outcome({ status: 'error', stdout: '1\n' })))).score).toBeNull();
  });

  it('gives no score to work that asks for input, even when it finishes and prints the same', async () => {
    // JavaScript's prompt() returns null and Lua's io.read() returns nil without an error.
    const withOutput = setup({ method: { tests: false, solution: true, output: true }, referenceOutput: 'Number? 0\n' });
    const asks = runner([], outcome({ stdout: 'Number? 0\n', readInput: true }));
    expect(await scoreSubmission('const n = Number(prompt("Number? ")); console.log(n * 3)', withOutput, asks)).toEqual({
      score: null,
      matchesSolution: false,
    });
  });

  it("doesn't score work when the code runner fails to load, instead of failing every test", async () => {
    const tests = [test('a'), test('b')];
    const failedToLoad = [result('a', false), result('b', false)];
    const withTests = setup({ method: { tests: true, solution: true, output: false }, tests });
    expect(await scoreSubmission('other', withTests, runner(failedToLoad, outcome(), LOAD_ERROR))).toEqual({
      score: null,
      matchesSolution: false,
      runnerError: LOAD_ERROR,
    });
    // An exact match doesn't need running, so it still gets full marks (without the meaningless results).
    expect(await scoreSubmission(SOLUTION, withTests, runner(failedToLoad, outcome(), LOAD_ERROR))).toEqual({ score: 100, matchesSolution: true });

    const withOutput = setup({ method: { tests: false, solution: true, output: true }, referenceOutput: '1\n' });
    expect(await scoreSubmission('print(1)', withOutput, runner([], loadFailure))).toEqual({
      score: null,
      matchesSolution: false,
      runnerError: LOAD_ERROR,
    });
  });

  it("checks only exact matches when the runner didn't start for the solution", async () => {
    const r = runner([]);
    const noRunner = setup({ method: { tests: false, solution: true, output: true }, runnerError: LOAD_ERROR });
    expect(await scoreSubmission('print(1)', noRunner, r)).toEqual({ score: null, matchesSolution: false, runnerError: LOAD_ERROR });
    expect(await scoreSubmission(SOLUTION, noRunner, r)).toEqual({ score: 100, matchesSolution: true });
    expect(r.runProgram).not.toHaveBeenCalled();
  });

  it("leaves work for the teacher when the solution's output can't be compared", async () => {
    const r = runner([]);
    expect(await scoreSubmission('print(1)', setup({ method: { tests: false, solution: true, output: true }, referenceOutput: null }), r)).toEqual({
      score: null,
      matchesSolution: false,
    });
    expect(r.runProgram).not.toHaveBeenCalled();
  });
});

describe('referenceProblem', () => {
  it('accepts a solution that finished and printed something', () => {
    expect(referenceProblem(outcome({ stdout: 'Hello\n' }))).toBeNull();
  });

  it("rejects a solution that didn't finish without input, or printed nothing", () => {
    expect(referenceProblem(outcome({ status: 'error', stdout: 'Name? ' }))).toBe('failed');
    expect(referenceProblem(outcome({ status: 'timeout' }))).toBe('failed');
    expect(referenceProblem(outcome({ stdout: ' \n' }))).toBe('silent');
  });

  it('rejects a solution that reads input even though it finished (JavaScript, TypeScript, Lua)', () => {
    // const n = Number(prompt('Number? ')); console.log(n * 2) — prompt() returned null, so it printed "Number? 0".
    expect(referenceProblem(outcome({ stdout: 'Number? 0\n', readInput: true }))).toBe('failed');
  });

  it("tells the runner not starting apart from the solution's own problems", () => {
    expect(referenceProblem(loadFailure)).toBe('runner');
  });
});

describe('referenceSetup', () => {
  it('compares with what the solution printed', () => {
    expect(referenceSetup(outcome({ stdout: '42\n' }))).toEqual({ problem: null, referenceOutput: '42\n', runnerError: null });
  });

  it('compares nothing when the solution reads input', () => {
    expect(referenceSetup(outcome({ stdout: 'Number? 0\n', readInput: true }))).toEqual({ problem: 'failed', referenceOutput: null, runnerError: null });
  });

  it("passes on why the runner didn't start", () => {
    expect(referenceSetup(loadFailure)).toEqual({ problem: 'runner', referenceOutput: null, runnerError: LOAD_ERROR });
  });
});

describe('autogradePatch', () => {
  const grades = { setGrades: true, scope: 'handed-in', points: 10 } as const;
  const results = [result('a', true)];

  it('sets a grade on waiting work, with the version it was checked against', () => {
    expect(autogradePatch(submission(), { score: 75, testResults: results, matchesSolution: false }, grades)).toEqual({
      patch: { testResults: results, autoScore: 75, expectedUpdatedAt: UPDATED, grade: 7.5, status: 'graded', autoGraded: true },
      outcome: 'graded',
    });
  });

  it("regrades autograded work but keeps the teacher's own grade (refreshing its results)", () => {
    const auto = submission({ status: 'graded', grade: 2, autoGraded: true });
    expect(autogradePatch(auto, { score: 100, matchesSolution: true }, grades).patch).toMatchObject({ grade: 10, autoGraded: true });
    const hand = submission({ status: 'graded', grade: 2 });
    expect(autogradePatch(hand, { score: 100, testResults: results, matchesSolution: false }, grades)).toEqual({
      patch: { testResults: results, autoScore: 100, expectedUpdatedAt: UPDATED },
      outcome: 'kept',
    });
  });

  it('replaces hand grades when asked to', () => {
    const hand = submission({ status: 'graded', grade: 2 });
    expect(autogradePatch(hand, { score: 50, matchesSolution: false }, { ...grades, scope: 'replace-all' })).toEqual({
      patch: { autoScore: 50, expectedUpdatedAt: UPDATED, grade: 5, status: 'graded', autoGraded: true },
      outcome: 'graded',
    });
  });

  it('only refreshes auto scores when grades are not being set', () => {
    expect(autogradePatch(submission(), { score: 80, testResults: results, matchesSolution: false }, { ...grades, setGrades: false })).toEqual({
      patch: { testResults: results, autoScore: 80, expectedUpdatedAt: UPDATED },
      outcome: 'scored',
    });
  });

  it('skips work it could not score', () => {
    expect(autogradePatch(submission(), { score: null, matchesSolution: false }, grades)).toEqual({ patch: null, outcome: 'unscored' });
    expect(autogradePatch(submission({ status: 'graded', grade: 4 }), { score: null, matchesSolution: false }, grades)).toEqual({
      patch: null,
      outcome: 'kept',
    });
  });

  it('takes an earlier auto grade off work it can no longer score, putting it back in To grade', () => {
    // E.g. graded 10/10 for matching the solution, and the teacher has since fixed the solution.
    const auto = submission({ status: 'graded', grade: 10, autoGraded: true, autoScore: 100 });
    expect(autogradePatch(auto, { score: null, matchesSolution: false }, grades)).toEqual({
      patch: { autoScore: null, expectedUpdatedAt: UPDATED, status: 'submitted' },
      outcome: 'cleared',
    });
    expect(autogradePatch(auto, { score: null, matchesSolution: false }, { ...grades, scope: 'replace-all' }).outcome).toBe('cleared');
  });

  it("keeps the teacher's own grade when replacing every grade but the work can't be scored", () => {
    const hand = submission({ status: 'graded', grade: 7 });
    expect(autogradePatch(hand, { score: null, matchesSolution: false }, { ...grades, scope: 'replace-all' })).toEqual({
      patch: null,
      outcome: 'kept',
    });
  });

  it("doesn't touch grades when only refreshing auto scores, even for autograded work it can't score", () => {
    const auto = submission({ status: 'graded', grade: 10, autoGraded: true, autoScore: 100 });
    expect(autogradePatch(auto, { score: null, matchesSolution: false }, { ...grades, setGrades: false })).toEqual({
      patch: { autoScore: null, expectedUpdatedAt: UPDATED },
      outcome: 'unscored',
    });
  });

  it("clears an auto score it can't give now, such as one from tests that were deleted", () => {
    const stale = submission({ autoScore: 50 });
    expect(autogradePatch(stale, { score: null, matchesSolution: false }, grades)).toEqual({
      patch: { autoScore: null, expectedUpdatedAt: UPDATED },
      outcome: 'unscored',
    });
  });

  it("leaves work alone when the code runner didn't start", () => {
    const failed = { score: null, matchesSolution: false, runnerError: LOAD_ERROR };
    for (const s of [submission({ autoScore: 50 }), submission({ status: 'graded', grade: 10, autoGraded: true, autoScore: 100 })]) {
      expect(autogradePatch(s, failed, grades)).toEqual({ patch: null, outcome: 'unchecked' });
      expect(autogradePatch(s, failed, { ...grades, scope: 'replace-all' })).toEqual({ patch: null, outcome: 'unchecked' });
    }
  });

  it('sends null for work that was never opened', () => {
    const notStarted = submission({ id: null, updatedAt: null });
    expect(autogradePatch(notStarted, { score: 10, matchesSolution: false }, { ...grades, setGrades: false }).patch).toMatchObject({
      expectedUpdatedAt: null,
    });
  });
});

describe('autogradeRules', () => {
  it('explains solution matches and tests, with an example grade', () => {
    const rules = autogradeRules({ tests: true, solution: true, output: false }, 'python', 10, true);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatch(/matches your solution gets full marks/);
    expect(rules[1]).toMatch(/^Other work scores the share of tests/);
    expect(rules[1]).toMatch(/hidden tests included/);
    expect(rules[2]).toBe('The score becomes a grade out of 10: passing 75% of the tests gives 7.5.');
  });

  it('leaves out the solution when there is none', () => {
    const rules = autogradeRules({ tests: true, solution: false, output: false }, 'python', 20, true);
    expect(rules[0]).toMatch(/^Each submission scores/);
    expect(rules[1]).toMatch(/gives 15\.$/);
  });

  it("explains output comparison, and exact matches for web pages", () => {
    const output = autogradeRules({ tests: false, solution: true, output: true }, 'python', 10, true)[1];
    expect(output).toMatch(/prints the same thing without asking for input gets full marks; anything else is left for you to grade\.$/);
    expect(autogradeRules({ tests: false, solution: true, output: false }, 'web', 10, true)[1]).toMatch(/^Web pages can't be run here, so only an exact match/);
  });

  it("doesn't talk about grades when only auto scores are refreshed", () => {
    const tests = autogradeRules({ tests: true, solution: true, output: false }, 'python', 10, false);
    expect(tests).toHaveLength(2);
    expect(tests.join(' ')).not.toMatch(/grade/);
    expect(autogradeRules({ tests: false, solution: true, output: true }, 'python', 10, false)[1]).toMatch(/anything else gets no auto score\.$/);
    expect(autogradeRules({ tests: false, solution: true, output: false }, 'web', 10, false)[1]).toMatch(/Anything else gets no auto score\.$/);
  });
});

describe('autogradeScopeOptions', () => {
  it('offers to keep or replace hand grades when setting grades', () => {
    const options = autogradeScopeOptions(true);
    expect(options.map((o) => o.value)).toEqual(['waiting', 'handed-in', 'replace-all']);
    expect(options[1]!.description).toMatch(/regrades work that autograde graded before \(work it can no longer score goes back to To grade\)/);
    expect(options[1]!.description).toMatch(/Grades you entered yourself are kept\.$/);
  });

  it("doesn't mention changing grades when only auto scores are refreshed", () => {
    const options = autogradeScopeOptions(false);
    expect(options.map((o) => o.value)).toEqual(['waiting', 'handed-in']);
    expect(options[1]!.description).toBe("Graded work too. Only the auto scores are refreshed; grades aren't changed.");
  });

  it('runs "replacing every grade" as all handed-in work when grades are not set', () => {
    expect(effectiveScope('replace-all', false)).toBe('handed-in');
    expect(effectiveScope('replace-all', true)).toBe('replace-all');
    expect(effectiveScope('waiting', false)).toBe('waiting');
  });
});

describe('autogradeButtonLabel', () => {
  it('counts submissions', () => {
    expect(autogradeButtonLabel(1)).toBe('Autograde 1 submission');
    expect(autogradeButtonLabel(12)).toBe('Autograde 12 submissions');
  });
});

describe('autogradeSummary', () => {
  it('sums up a finished run', () => {
    const summary = autogradeSummary({ ...emptyTally(15), graded: 9, unscored: 3, kept: 2, changed: 1 }, { stopped: false, setGrades: true });
    expect(summary.title).toBe('Autograding finished');
    expect(summary.message).toMatch(/^9 graded · 3 left for you to grade · 2 grades you entered kept · 1 changed while autograding\./);
    expect(summary.color).toBe('yellow');
  });

  it('is a success when everything was graded', () => {
    expect(autogradeSummary({ ...emptyTally(4), graded: 3, kept: 1 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Autograding finished',
      message: '3 graded · 1 grade you entered kept. Students can see their new grades now.',
      color: 'teal',
    });
  });

  it('says how far a stopped run got', () => {
    expect(autogradeSummary({ ...emptyTally(12), graded: 4 }, { stopped: true, setGrades: true })).toEqual({
      title: 'Autograding stopped',
      message: '4 graded. Stopped after 4 of 12.',
      color: 'yellow',
    });
    expect(autogradeSummary(emptyTally(12), { stopped: true, setGrades: true }).message).toBe('Stopped before any work was checked.');
  });

  it('reports results that could not be saved', () => {
    const summary = autogradeSummary({ ...emptyTally(3), graded: 1, failed: 2 }, { stopped: false, setGrades: true });
    expect(summary.title).toBe('Some results could not be saved');
    expect(summary.message).toBe("1 graded · 2 couldn't be saved. Run autograde again to retry the ones that couldn't be saved.");
    expect(summary.color).toBe('red');
  });

  it('talks about auto scores when grades were not set', () => {
    expect(autogradeSummary({ ...emptyTally(3), scored: 2, unscored: 1 }, { stopped: false, setGrades: false }).message).toBe(
      "2 auto scores updated · 1 couldn't be scored.",
    );
  });

  it("explains why only exact matches were graded", () => {
    const tally = { ...emptyTally(3), graded: 1, unscored: 2 };
    expect(autogradeSummary(tally, { stopped: false, setGrades: true, reference: 'failed' }).message).toMatch(/didn't finish without input/);
    expect(autogradeSummary(tally, { stopped: false, setGrades: true, reference: 'silent' }).message).toMatch(/doesn't print anything/);
  });

  it('says which earlier auto grades were taken off', () => {
    expect(autogradeSummary({ ...emptyTally(3), graded: 2, cleared: 1 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Autograding finished',
      message:
        "2 graded · 1 earlier auto grade taken off. Work autograde graded before but can't score now is back in To grade without that grade. Students can see their new grades now.",
      color: 'yellow',
    });
  });

  it("reports work it couldn't check because the code runner didn't start", () => {
    expect(autogradeSummary({ ...emptyTally(4), graded: 1, unchecked: 3 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Some work could not be checked',
      message:
        "1 graded · 3 couldn't be checked. The code runner didn't start for some work, so it was left as it was. Reload the page and run autograde again to check it. Students can see their new grades now.",
      color: 'red',
    });
    const solutionRun = autogradeSummary({ ...emptyTally(4), graded: 1, unchecked: 3 }, { stopped: false, setGrades: true, reference: 'runner' });
    expect(solutionRun.message).toBe(
      "1 graded · 3 couldn't be checked. The code runner didn't start when your solution ran, so only work that matches it exactly was graded. Reload the page and run autograde again to check the rest. Students can see their new grades now.",
    );
  });
});
