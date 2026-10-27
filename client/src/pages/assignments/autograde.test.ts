import type { Submission, SubmissionRow, TestCase, TestResult } from '@codeclass/shared';
import { createPseudocodeConfig } from '@codeclass/shared/pseudocode';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { RunOutcome } from '../../runtime';
import {
  AUTOGRADE_ONE_OPTIONS,
  autogradeAllBlocker,
  autogradeButtonLabel,
  autogradeMethod,
  autogradeOneBlocker,
  autogradeOneConfirmation,
  autogradeOneSummary,
  autogradePatch,
  autogradeRules,
  autogradeScopeOptions,
  autogradeSubmission,
  autogradeSummary,
  autogradeTargets,
  autogradeWarning,
  effectiveScope,
  emptyTally,
  handGradeToReplace,
  mayAutograde,
  prepareAutograde,
  referenceProblem,
  referenceSetup,
  reusablePreparation,
  scoreSubmission,
  solutionCheckWarning,
  tallyStep,
  type AutogradeMethod,
  type AutogradeRunner,
  type AutogradeSetup,
  type AutogradeStep,
  type AutogradeTally,
  type PreparedAutograde,
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
/** A run; without input prompts (`promptlessStdout`), it printed `stdout`. */
const outcome = (partial: Partial<RunOutcome> = {}): RunOutcome => ({
  status: 'ok',
  error: null,
  stdout: '',
  promptlessStdout: partial.stdout ?? '',
  durationMs: 1,
  started: true,
  readInput: false,
  ...partial,
});
/** What a run without input prompts printed. */
const printed = (stdout: string, promptlessStdout = stdout) => ({ stdout, promptlessStdout });
const PYTHON = { kind: 'python' } as const;
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
    target: PYTHON,
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
  const withTests = (tests: TestCase[]) => setup({ method: { tests: true, solution: true, output: false }, tests });
  const withOutput = (reference: string) => setup({ method: { tests: false, solution: true, output: true }, referenceOutput: printed(reference) });

  it('scores the weighted share of tests passed', async () => {
    const tests = [test('a', 1), test('b', 3)];
    const r = runner([result('a', true), result('b', false)]);
    const scored = await scoreSubmission('other', withTests(tests), r);
    expect(scored).toEqual({ score: 25, testResults: [result('a', true), result('b', false)], matchesSolution: false });
  });

  it('gives full marks to the same program as the solution, and still stores the test results', async () => {
    const r = runner([result('a', false), result('b', true)]);
    // Spacing inside lines, blank lines, CRLF line ends and a comment don't count. The solution fails test a too (a
    // wrong expected output, say), so failing it doesn't lower the score.
    const scored = await scoreSubmission('x=1   \r\n\r\nprint( x )  # my answer\r\n', { ...withTests([test('a'), test('b')]), solutionFails: ['a'] }, r);
    expect(scored).toEqual({ score: 100, testResults: [result('a', false), result('b', true)], matchesSolution: true });
  });

  it('scores the tests when work that looks like the solution fails a test the solution passes', async () => {
    const tests = [test('a'), test('b')];
    const failsB = [result('a', true), result('b', false)];
    // What the solution fails is known (a), or isn't (then every test has to pass).
    for (const solutionFails of [['a'], null, undefined]) {
      const scored = await scoreSubmission('x=1\nprint(x)\n', { ...withTests(tests), solutionFails }, runner(failsB));
      expect(scored, String(solutionFails)).toEqual({ score: 50, testResults: failsB, matchesSolution: false });
    }
    const passesAll = [result('a', true), result('b', true)];
    expect(await scoreSubmission('x=1\nprint(x)\n', withTests(tests), runner(passesAll))).toEqual({ score: 100, testResults: passesAll, matchesSolution: true });
  });

  it("doesn't give full marks to a look-alike that fails the tests (real comparison)", async () => {
    const tests = [test('a')];
    const fails = runner([result('a', false)]);
    const python = (solutionCode: string, compareMode: AutogradeSetup['compareMode'] = 'ignore-whitespace') => ({
      ...withTests(tests),
      solutionCode,
      compareMode,
      solutionFails: [],
    });
    // Python that crashes with an IndentationError, or compares other text.
    expect(await scoreSubmission('name = input()\n    print("Hi", name)\n', python('name = input()\nprint("Hi", name)\n'), fails)).toMatchObject({
      score: 0,
      matchesSolution: false,
    });
    const city = 'city = input()\nif city == "New York":\n    print("Big Apple")\n';
    expect(await scoreSubmission(city.replace('New York', 'NewYork'), python(city), fails)).toMatchObject({ score: 0, matchesSolution: false });
    const yes = { ...python('if (input() === "Yes") console.log("ok");\n', 'ignore-case'), target: { kind: 'javascript' as const } };
    expect(await scoreSubmission('if (input() === "yes") console.log("ok");\n', yes, fails)).toMatchObject({ score: 0, matchesSolution: false });
  });

  it('knows the same pseudocode program typed differently, with the language its configuration describes', async () => {
    const pseudo = setup({
      target: { kind: 'pseudocode', pseudocode: createPseudocodeConfig() },
      solutionCode: 'INPUT n\nIF n > 3 THEN\n  OUTPUT "big"\nEND IF\n',
    });
    // The leftover starter comment, no indentation and extra spacing.
    const student = '// Write your program below\nINPUT n\nIF n>3 THEN\nOUTPUT   "big"\nEND IF';
    expect(await scoreSubmission(student, pseudo, runner([]))).toEqual({ score: 100, matchesSolution: true });
    // A statement moved out of the IF is another program.
    expect((await scoreSubmission('INPUT n\nIF n > 3 THEN\nEND IF\nOUTPUT "big"\n', pseudo, runner([]))).matchesSolution).toBe(false);
  });

  it("doesn't treat a different program as the solution", async () => {
    // Different text in quotes, and a statement moved into a block (indentation counts in Python).
    const solution = setup({ solutionCode: 'for i in range(3):\n    x = i\nprint(x)\n' });
    for (const code of ['for i in range(3):\n    x = i\nprint("x")\n', 'for i in range(3):\n    x = i\n    print(x)\n']) {
      expect(await scoreSubmission(code, solution, runner([]))).toEqual({ score: null, matchesSolution: false, unscoredReason: 'not-runnable' });
    }
  });

  it('gives full marks to the same program without running anything when there are no tests', async () => {
    const r = runner([]);
    expect(await scoreSubmission(SOLUTION, withOutput('1\n'), r)).toEqual({ score: 100, matchesSolution: true });
    expect(r.runProgram).not.toHaveBeenCalled();
    expect(r.runTests).not.toHaveBeenCalled();
  });

  it("compares output with the solution's under the compare mode when there are no tests", async () => {
    const reference = withOutput('Total: 8\n');
    expect((await scoreSubmission('print(8)', reference, runner([], outcome({ stdout: 'Total: 8  \n\n' })))).score).toBe(100);
    expect(await scoreSubmission('print(9)', reference, runner([], outcome({ stdout: 'Total: 9\n' })))).toEqual({
      score: null,
      matchesSolution: false,
      unscoredReason: 'output-differs',
    });
    const spacing = runner([], outcome({ stdout: 'Total:8\n' }));
    expect((await scoreSubmission('print(8)', reference, spacing)).unscoredReason).toBe('output-differs');
    expect((await scoreSubmission('print(8)', { ...reference, compareMode: 'ignore-whitespace' }, spacing)).score).toBe(100);
  });

  it('matches output with or without input prompts', async () => {
    const reference = setup({ method: { tests: false, solution: true, output: true }, referenceOutput: printed('Name? 8\n', '8\n') });
    expect((await scoreSubmission('print(8)', reference, runner([], outcome({ stdout: '8\n' })))).score).toBe(100);
  });

  it('says why work that ran without input has no score', async () => {
    const reference = withOutput('1\n');
    const score = async (run: RunOutcome) => (await scoreSubmission('print(1)', reference, runner([], run))).unscoredReason;
    // Printing the right thing and then crashing isn't a match.
    expect(await score(outcome({ status: 'error', stdout: '1\n' }))).toBe('student-error');
    expect(await score(outcome({ status: 'timeout', stdout: '1\n' }))).toBe('student-timeout');
    // Running out of input is an error in some languages; it's still work that asks for input.
    expect(await score(outcome({ status: 'error', readInput: true }))).toBe('student-input');
  });

  it('gives no score to work that asks for input, even when it finishes and prints the same', async () => {
    // JavaScript's prompt() returns null and Lua's io.read() returns nil without an error.
    const asks = runner([], outcome({ stdout: 'Number? 0\n', promptlessStdout: '0\n', readInput: true }));
    expect(await scoreSubmission('const n = Number(prompt("Number? ")); console.log(n * 3)', withOutput('0\n'), asks)).toEqual({
      score: null,
      matchesSolution: false,
      unscoredReason: 'student-input',
    });
  });

  it("doesn't score work when the code runner fails to load, instead of failing every test", async () => {
    const tests = [test('a'), test('b')];
    const failedToLoad = [result('a', false), result('b', false)];
    expect(await scoreSubmission('other', withTests(tests), runner(failedToLoad, outcome(), LOAD_ERROR))).toEqual({
      score: null,
      matchesSolution: false,
      runnerError: LOAD_ERROR,
    });
    // The same program doesn't need running, so it still gets full marks (without the meaningless results).
    expect(await scoreSubmission(SOLUTION, withTests(tests), runner(failedToLoad, outcome(), LOAD_ERROR))).toEqual({
      score: 100,
      matchesSolution: true,
    });
    expect(await scoreSubmission('print(1)', withOutput('1\n'), runner([], loadFailure))).toEqual({
      score: null,
      matchesSolution: false,
      runnerError: LOAD_ERROR,
    });
  });

  it("checks only the same program when the runner didn't start for the solution", async () => {
    const r = runner([]);
    const noRunner = setup({ method: { tests: false, solution: true, output: true }, runnerError: LOAD_ERROR });
    expect(await scoreSubmission('print(1)', noRunner, r)).toEqual({ score: null, matchesSolution: false, runnerError: LOAD_ERROR });
    expect(await scoreSubmission('x = 1\nprint(x)  # same', noRunner, r)).toEqual({ score: 100, matchesSolution: true });
    expect(r.runProgram).not.toHaveBeenCalled();
  });

  it("leaves work for the teacher when the solution's output can't be compared", async () => {
    const r = runner([]);
    expect(await scoreSubmission('print(1)', setup({ method: { tests: false, solution: true, output: true }, referenceOutput: null }), r)).toEqual({
      score: null,
      matchesSolution: false,
      unscoredReason: 'no-reference',
    });
    expect(r.runProgram).not.toHaveBeenCalled();
  });

  it('only checks for the same program for web pages', async () => {
    const web = setup({ target: { kind: 'web' }, solutionCode: '<h1>Hi</h1>\n<p>My page</p>' });
    expect(await scoreSubmission('<H1>Hi</H1>\n\n  <p>My   page</p>\n', web, runner([]))).toEqual({ score: 100, matchesSolution: true });
    expect(await scoreSubmission('<h1>Hello</h1>', web, runner([]))).toEqual({ score: null, matchesSolution: false, unscoredReason: 'not-runnable' });
  });
});

describe('referenceProblem', () => {
  it('accepts a solution that finished and printed something', () => {
    expect(referenceProblem(outcome({ stdout: 'Hello\n' }))).toBeNull();
  });

  it("says why a solution that didn't finish without input, or printed nothing, can't be compared with", () => {
    expect(referenceProblem(outcome({ status: 'error', stdout: 'Name? ', readInput: true }))).toBe('input');
    expect(referenceProblem(outcome({ status: 'error', stdout: '1\n' }))).toBe('error');
    expect(referenceProblem(outcome({ status: 'timeout' }))).toBe('timeout');
    expect(referenceProblem(outcome({ stdout: ' \n' }))).toBe('silent');
  });

  it('rejects a solution that reads input even though it finished (JavaScript, TypeScript, Lua)', () => {
    // const n = Number(prompt('Number? ')); console.log(n * 2) — prompt() returned null, so it printed "Number? 0".
    expect(referenceProblem(outcome({ stdout: 'Number? 0\n', readInput: true }))).toBe('input');
  });

  it("tells the runner not starting apart from the solution's own problems", () => {
    expect(referenceProblem(loadFailure)).toBe('runner');
  });
});

describe('referenceSetup', () => {
  it('compares with what the solution printed, with and without prompts', () => {
    expect(referenceSetup(outcome({ stdout: '42\n' }))).toEqual({ problem: null, referenceOutput: printed('42\n'), runnerError: null });
  });

  it('compares nothing when the solution reads input', () => {
    expect(referenceSetup(outcome({ stdout: 'Number? 0\n', readInput: true }))).toEqual({ problem: 'input', referenceOutput: null, runnerError: null });
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
  const SAME_PROGRAM =
    "Work that is the same program as your solution gets full marks — spacing, indentation, blank lines and comments don't count.";

  it('explains the solution, the tests and how output is compared, with an example grade', () => {
    const rules = autogradeRules({ tests: true, solution: true, output: false }, 'python', 10, true, 'ignore-whitespace');
    expect(rules).toEqual([
      SAME_PROGRAM,
      'Other work scores the share of tests it passes, hidden tests included and weighted by their points.',
      'Output is compared: Ignore all spaces and line breaks.',
      'The score becomes a grade out of 10: passing 75% of the tests gives 7.5.',
    ]);
  });

  it('names the compare mode the assignment uses', () => {
    expect(autogradeRules({ tests: true, solution: false, output: false }, 'python', 10, true, 'trim')).toContain(
      'Output is compared: Ignore spaces at line ends and blank lines.',
    );
  });

  it('leaves out the solution when there is none', () => {
    const rules = autogradeRules({ tests: true, solution: false, output: false }, 'python', 20, true, 'trim');
    expect(rules[0]).toMatch(/^Each submission scores/);
    expect(rules[2]).toMatch(/gives 15\.$/);
  });

  it('explains output comparison, and the same program only for web pages', () => {
    const output = autogradeRules({ tests: false, solution: true, output: true }, 'python', 10, true, 'ignore-case');
    expect(output[0]).toBe(SAME_PROGRAM);
    expect(output[1]).toMatch(/prints the same thing without asking for input gets full marks; anything else is left for you to grade\.$/);
    expect(output[2]).toBe('Output is compared: Ignore spaces, line breaks and capitals.');
    expect(autogradeRules({ tests: false, solution: true, output: false }, 'web', 10, true, 'trim')).toEqual([
      SAME_PROGRAM,
      "Web pages can't be run here, so only the same program as your solution gets a score. Anything else is left for you to grade.",
      "Text on the page counts as a browser shows it: extra spaces and line breaks don't count; capitals do.",
    ]);
  });

  it("doesn't talk about grades when only auto scores are refreshed", () => {
    const tests = autogradeRules({ tests: true, solution: true, output: false }, 'python', 10, false, 'trim');
    expect(tests).toHaveLength(3);
    expect(tests.join(' ')).not.toMatch(/grade/);
    expect(autogradeRules({ tests: false, solution: true, output: true }, 'python', 10, false, 'trim')[1]).toMatch(/anything else gets no auto score\.$/);
    expect(autogradeRules({ tests: false, solution: true, output: false }, 'web', 10, false, 'trim')[1]).toMatch(/Anything else gets no auto score\.$/);
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

describe('tallyStep', () => {
  it('counts outcomes, and why work was left without a score', () => {
    const tally = emptyTally(5);
    const step = (outcome: AutogradeStep['outcome'], unscoredReason?: AutogradeStep['result']['unscoredReason']): AutogradeStep => ({
      outcome,
      result: { score: unscoredReason ? null : 100, matchesSolution: false, ...(unscoredReason ? { unscoredReason } : {}) },
      saved: null,
    });
    tallyStep(tally, step('graded'));
    tallyStep(tally, step('unscored', 'student-input'));
    tallyStep(tally, step('cleared', 'output-differs'));
    // The teacher's own grade stays, so this work isn't waiting for them.
    tallyStep(tally, step('kept', 'student-error'));
    expect(tally).toMatchObject({ graded: 1, unscored: 1, cleared: 1, kept: 1 });
    expect(tally.reasons).toEqual({
      'student-input': 1,
      'student-error': 0,
      'student-timeout': 0,
      'output-differs': 1,
      'no-reference': 0,
      'not-runnable': 0,
    });
  });
});

describe('autogradeSummary', () => {
  const withReasons = (partial: Partial<AutogradeTally>, reasons: Partial<AutogradeTally['reasons']>): AutogradeTally => {
    const tally = { ...emptyTally(partial.total ?? 0), ...partial };
    return { ...tally, reasons: { ...tally.reasons, ...reasons } };
  };

  it('sums up a finished run', () => {
    const summary = autogradeSummary({ ...emptyTally(15), graded: 9, unscored: 3, kept: 2, changed: 1 }, { stopped: false, setGrades: true });
    expect(summary.title).toBe('Autograding finished');
    expect(summary.message).toMatch(/^9 graded · 3 left for you to grade · 2 grades you entered kept · 1 changed while autograding\./);
    expect(summary.color).toBe('yellow');
    expect(summary.keepOpen).toBe(true);
  });

  it('is a success when everything was graded, and closes by itself', () => {
    expect(autogradeSummary({ ...emptyTally(4), graded: 3, kept: 1 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Autograding finished',
      message: '3 graded · 1 grade you entered kept. Students can see their new grades now.',
      color: 'teal',
      keepOpen: false,
    });
  });

  it('stays open, in yellow, when work was left for the teacher, and says why', () => {
    const tally = withReasons({ total: 6, graded: 2, unscored: 4 }, { 'student-input': 2, 'student-error': 1, 'output-differs': 1 });
    expect(autogradeSummary(tally, { stopped: false, setGrades: true })).toEqual({
      title: 'Autograding finished',
      message:
        '2 graded · 4 left for you to grade. Not graded: 2 ask for input, 1 stops with an error, 1 prints something different from your solution. Students can see their new grades now.',
      color: 'yellow',
      keepOpen: true,
    });
    const web = withReasons({ total: 2, unscored: 1, scored: 1 }, { 'not-runnable': 1, 'student-timeout': 0 });
    expect(autogradeSummary(web, { stopped: false, setGrades: false }).message).toBe(
      "1 auto score updated · 1 couldn't be scored. Not scored: 1 isn't the same program as your solution.",
    );
  });

  it('says how far a stopped run got', () => {
    expect(autogradeSummary({ ...emptyTally(12), graded: 4 }, { stopped: true, setGrades: true })).toEqual({
      title: 'Autograding stopped',
      message: '4 graded. Stopped after 4 of 12.',
      color: 'yellow',
      keepOpen: false,
    });
    expect(autogradeSummary(emptyTally(12), { stopped: true, setGrades: true }).message).toBe('Stopped before any work was checked.');
  });

  it('reports results that could not be saved', () => {
    const summary = autogradeSummary({ ...emptyTally(3), graded: 1, failed: 2 }, { stopped: false, setGrades: true });
    expect(summary.title).toBe('Some results could not be saved');
    expect(summary.message).toBe("1 graded · 2 couldn't be saved. Run autograde again to retry the ones that couldn't be saved.");
    expect(summary.color).toBe('red');
    expect(summary.keepOpen).toBe(true);
  });

  it('talks about auto scores when grades were not set', () => {
    expect(autogradeSummary({ ...emptyTally(3), scored: 2, unscored: 1 }, { stopped: false, setGrades: false }).message).toBe(
      "2 auto scores updated · 1 couldn't be scored.",
    );
  });

  it("explains why only the same program as the solution was graded, and what to do", () => {
    const tally = withReasons({ total: 3, graded: 1, unscored: 2 }, { 'no-reference': 2 });
    const asks = autogradeSummary(tally, { stopped: false, setGrades: true, reference: 'input' });
    expect(asks.message).toBe(
      "1 graded · 2 left for you to grade. Your solution asks for input, and with no tests autograde runs programs without any, so only work that's the same program as your solution could be graded. Add tests (Edit → Tests → Fill expected outputs from a model solution) so autograde can check programs that ask for input. Students can see their new grades now.",
    );
    expect(asks).toMatchObject({ color: 'yellow', keepOpen: true });
    expect(autogradeSummary(tally, { stopped: false, setGrades: true, reference: 'error' }).message).toMatch(
      /Your solution stops with an error when it runs without input, so only work that's the same program as your solution could be graded\. Fix your solution \(Edit → Solution\) so it runs to the end without input, or add tests \(Edit → Tests\)\./,
    );
    expect(autogradeSummary(tally, { stopped: false, setGrades: true, reference: 'timeout' }).message).toMatch(
      /doesn't finish in time .* Fix your solution \(Edit → Solution\) so it runs to the end without input/,
    );
    // Even with nothing left for the teacher, a solution autograde can't compare with is worth knowing about.
    const silent = autogradeSummary({ ...emptyTally(1), graded: 1 }, { stopped: false, setGrades: true, reference: 'silent' });
    expect(silent.message).toMatch(
      /Your solution doesn't print anything, so only work that's the same program as your solution could be graded\. Make your solution print its result \(Edit → Solution\), or add tests \(Edit → Tests\)\./,
    );
    expect(silent).toMatchObject({ color: 'yellow', keepOpen: true });
  });

  it('warns when the solution fails some of the tests', () => {
    const solutionCheck = { passed: 2, total: 3, failing: [{ id: 'b', label: 'Test 2', error: null }] };
    expect(autogradeSummary({ ...emptyTally(2), graded: 2 }, { stopped: false, setGrades: true, solutionCheck })).toEqual({
      title: 'Autograding finished',
      message:
        "2 graded. Your solution fails 1 of 3 tests. Check that test's expected output: Test 2. Students can see their new grades now.",
      color: 'yellow',
      keepOpen: true,
    });
    const passes = { passed: 3, total: 3, failing: [] };
    expect(autogradeSummary({ ...emptyTally(2), graded: 2 }, { stopped: false, setGrades: true, solutionCheck: passes }).color).toBe('teal');
  });

  it('says which earlier auto grades were taken off', () => {
    expect(autogradeSummary({ ...emptyTally(3), graded: 2, cleared: 1 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Autograding finished',
      message:
        "2 graded · 1 earlier auto grade taken off. Work autograde graded before but can't score now is back in To grade without that grade. Students can see their new grades now.",
      color: 'yellow',
      keepOpen: true,
    });
  });

  it("reports work it couldn't check because the code runner didn't start", () => {
    expect(autogradeSummary({ ...emptyTally(4), graded: 1, unchecked: 3 }, { stopped: false, setGrades: true })).toEqual({
      title: 'Some work could not be checked',
      message:
        "1 graded · 3 couldn't be checked. The code runner didn't start for some work, so it was left as it was. Reload the page and run autograde again to check it. Students can see their new grades now.",
      color: 'red',
      keepOpen: true,
    });
    const solutionRun = autogradeSummary({ ...emptyTally(4), graded: 1, unchecked: 3 }, { stopped: false, setGrades: true, reference: 'runner' });
    expect(solutionRun.message).toBe(
      "1 graded · 3 couldn't be checked. The code runner didn't start when your solution ran, so only work that's the same program as your solution was graded. Reload the page and run autograde again to check the rest. Students can see their new grades now.",
    );
  });
});

describe('solutionCheckWarning', () => {
  const failing = (n: number, error: string | null = null) =>
    Array.from({ length: n }, (_, i) => ({ id: `${i}`, label: `Test ${i + 1}`, error }));

  it('counts the tests the solution fails, and points at their expected outputs', () => {
    expect(solutionCheckWarning(null)).toBeNull();
    expect(solutionCheckWarning({ passed: 3, total: 3, failing: [] })).toBeNull();
    expect(solutionCheckWarning({ passed: 1, total: 3, failing: failing(2) })).toBe(
      "Your solution fails 2 of 3 tests. Check those tests' expected outputs: Test 1, Test 2.",
    );
    expect(solutionCheckWarning({ passed: 0, total: 1, failing: failing(1) })).toBe(
      "Your solution fails 1 of 1 test. Check that test's expected output: Test 1.",
    );
  });

  it("says why the solution didn't run to the end of a test, and points at the test's input", () => {
    const eof = { id: 'b', label: 'Test 2', error: 'Line 2: EOFError: EOF when reading a line' };
    expect(solutionCheckWarning({ passed: 2, total: 3, failing: [eof] })).toBe(
      "Your solution fails 1 of 3 tests. Test 2 doesn't run to the end: Line 2: EOFError: EOF when reading a line. Check that test's input (one line for each time your solution asks for input) and your solution.",
    );
    const mixed = solutionCheckWarning({
      passed: 0,
      total: 5,
      failing: [{ id: 'a', label: 'Test 1', error: null }, ...failing(4, 'Took too long — is there a loop that never ends?').map((f, i) => ({ ...f, label: `Test ${i + 2}` }))],
    });
    expect(mixed).toBe(
      "Your solution fails 5 of 5 tests. Check that test's expected output: Test 1. Test 2 doesn't run to the end: Took too long — is there a loop that never ends? Test 3 doesn't run to the end: Took too long — is there a loop that never ends? 2 more don't either. Check those tests' inputs (one line for each time your solution asks for input) and your solution.",
    );
    const long = solutionCheckWarning({ passed: 0, total: 1, failing: failing(1, `Line 1: ${'x'.repeat(300)}`) })!;
    expect(long).toMatch(/Test 1 doesn't run to the end: Line 1: x+…\. Check/);
  });
});

describe('prepareAutograde', () => {
  const assignment = { tests: [test('a'), test('b')], compareMode: 'trim' as const, solutionCode: 'print(1)' };
  const runner = (run: RunOutcome, results: TestResult[] = [], runnerError: string | null = null) => ({
    runProgram: vi.fn(async () => run),
    runTests: vi.fn(async () => ({ results, runnerError })),
  });

  it('runs nothing when there are tests and no solution', async () => {
    const r = runner(outcome({ stdout: '1\n' }));
    const prepared = await prepareAutograde(assignment, { tests: true, solution: false, output: false }, PYTHON, r);
    expect(prepared).toEqual({
      setup: {
        method: { tests: true, solution: false, output: false },
        target: PYTHON,
        tests: assignment.tests,
        compareMode: 'trim',
        solutionCode: 'print(1)',
        referenceOutput: null,
        runnerError: null,
      },
      reference: null,
      solutionCheck: null,
    });
    expect(r.runProgram).not.toHaveBeenCalled();
    expect(r.runTests).not.toHaveBeenCalled();
  });

  it('runs the solution on the tests when there are both, to find tests it fails', async () => {
    const r = runner(outcome(), [result('a', true), result('b', false)]);
    const prepared = await prepareAutograde(assignment, { tests: true, solution: true, output: false }, PYTHON, r);
    expect(r.runTests).toHaveBeenCalledWith('print(1)');
    expect(r.runProgram).not.toHaveBeenCalled();
    expect(prepared.solutionCheck).toEqual({ passed: 1, total: 2, failing: [{ id: 'b', label: 'Test 2', error: null }] });
    // Work that is the same program as the solution may fail test b too and keep full marks.
    expect(prepared.setup.solutionFails).toEqual(['b']);
    expect(prepared.reference).toBeNull();
  });

  it("doesn't judge the solution's tests when the code runner failed", async () => {
    const r = runner(outcome(), [result('a', false), result('b', false)], LOAD_ERROR);
    expect((await prepareAutograde(assignment, { tests: true, solution: true, output: false }, PYTHON, r)).solutionCheck).toBeNull();
  });

  it('runs the solution once and compares with what it printed', async () => {
    const r = runner(outcome({ stdout: '1\n' }));
    const prepared = await prepareAutograde({ ...assignment, tests: [] }, { tests: false, solution: true, output: true }, PYTHON, r);
    expect(r.runProgram).toHaveBeenCalledWith('print(1)');
    expect(prepared.setup).toMatchObject({ referenceOutput: printed('1\n'), runnerError: null });
    expect(prepared.reference).toBeNull();
  });

  it("says why the solution's output can't be compared", async () => {
    const method = { tests: false, solution: true, output: true };
    const asks = await prepareAutograde(assignment, method, PYTHON, runner(outcome({ stdout: 'Name? ', readInput: true })));
    expect(asks).toMatchObject({ reference: 'input', setup: { referenceOutput: null, runnerError: null } });
    const noRunner = await prepareAutograde(assignment, method, PYTHON, runner(loadFailure));
    expect(noRunner).toMatchObject({ reference: 'runner', setup: { referenceOutput: null, runnerError: LOAD_ERROR } });
  });

  it('compares nothing when the run was stopped while the solution ran', async () => {
    const controller = new AbortController();
    controller.abort();
    const method = { tests: false, solution: true, output: true };
    const prepared = await prepareAutograde(assignment, method, PYTHON, runner(outcome({ stdout: '1\n' })), controller.signal);
    expect(prepared).toMatchObject({ reference: null, setup: { referenceOutput: null } });
  });
});

describe('reusablePreparation', () => {
  const prepared = (partial: Partial<PreparedAutograde>, method: AutogradeMethod): PreparedAutograde => ({
    setup: { method, target: PYTHON, tests: [], compareMode: 'trim', solutionCode: 'print(1)', referenceOutput: null, runnerError: null },
    reference: null,
    solutionCheck: null,
    ...partial,
  });
  const output = { tests: false, solution: true, output: true };
  const tests = { tests: true, solution: true, output: false };

  it('lets the run start from what the modal got ready', () => {
    const ready = prepared({ reference: 'input' }, output);
    expect(reusablePreparation(ready)).toBe(ready);
    const checked = prepared({ solutionCheck: { passed: 1, total: 1, failing: [] } }, tests);
    expect(reusablePreparation(checked)).toBe(checked);
    expect(reusablePreparation(null)).toBeNull();
  });

  it('gets ready again when the code runner failed while the modal got it ready', () => {
    expect(reusablePreparation(prepared({ reference: 'runner' }, output))).toBeNull();
    expect(reusablePreparation(prepared({ solutionCheck: null }, tests))).toBeNull();
  });
});

describe('autogradeWarning', () => {
  const prepared = (partial: Partial<PreparedAutograde>): PreparedAutograde => ({
    setup: {
      method: { tests: false, solution: true, output: true },
      target: PYTHON,
      tests: [],
      compareMode: 'trim',
      solutionCode: 'print(1)',
      referenceOutput: null,
      runnerError: null,
    },
    reference: null,
    solutionCheck: null,
    ...partial,
  });

  it('warns before the run that only the same program can be graded when the solution asks for input', () => {
    expect(autogradeWarning(prepared({ reference: 'input' }), true)).toEqual({
      title: 'Your solution asks for input',
      sentences: [
        "With no tests, autograde runs programs without input, so it can't compare students' output with your solution's.",
        "Only work that's the same program as your solution will be graded.",
        'Add tests (Edit → Tests → Fill expected outputs from a model solution) so autograde can check programs that ask for input.',
      ],
      editAssignment: true,
    });
  });

  it('names the problem with a solution that errors, runs too long or prints nothing', () => {
    expect(autogradeWarning(prepared({ reference: 'error' }), false)).toEqual({
      title: 'Your solution stops with an error when it runs without input',
      sentences: [
        "There's no output to compare students' output with.",
        "Only work that's the same program as your solution will be scored.",
        'Fix your solution (Edit → Solution) so it runs to the end without input, or add tests (Edit → Tests).',
      ],
      editAssignment: true,
    });
    expect(autogradeWarning(prepared({ reference: 'timeout' }), true)).toMatchObject({
      title: "Your solution doesn't finish in time when it runs without input",
      sentences: [expect.any(String), expect.any(String), 'Fix your solution (Edit → Solution) so it runs to the end without input, or add tests (Edit → Tests).'],
    });
    expect(autogradeWarning(prepared({ reference: 'silent' }), true)).toMatchObject({
      title: "Your solution doesn't print anything",
      sentences: [expect.any(String), expect.any(String), 'Make your solution print its result (Edit → Solution), or add tests (Edit → Tests).'],
    });
    expect(autogradeWarning(prepared({ reference: 'runner' }), true)).toMatchObject({ title: "The code runner didn't start", editAssignment: false });
  });

  it('lists the tests the solution fails', () => {
    const solutionCheck = {
      passed: 1,
      total: 3,
      failing: [
        { id: 'b', label: 'Test 2: Empty list', error: null },
        { id: 'c', label: 'Test 3', error: 'Line 1: oops' },
      ],
    };
    expect(autogradeWarning(prepared({ solutionCheck }), true)).toEqual({
      title: 'Your solution fails 2 of 3 tests',
      sentences: [
        "Check that test's expected output: Test 2: Empty list.",
        "Test 3 doesn't run to the end: Line 1: oops.",
        "Check that test's input (one line for each time your solution asks for input) and your solution.",
        "Other work is graded by the tests it passes, so a mistake in a test lowers everyone's score.",
      ],
      editAssignment: true,
    });
  });

  it('has nothing to say when the solution is fine', () => {
    expect(autogradeWarning(prepared({}), true)).toBeNull();
    expect(autogradeWarning(prepared({ solutionCheck: { passed: 2, total: 2, failing: [] } }), true)).toBeNull();
  });
});

describe('autogradeSubmission', () => {
  const tests = [test('a'), test('b')];
  const setup: AutogradeSetup = {
    method: { tests: true, solution: false, output: false },
    target: PYTHON,
    tests,
    compareMode: 'trim',
    solutionCode: '',
    referenceOutput: null,
    runnerError: null,
  };
  const runner = (results: TestResult[], runnerError: string | null = null): AutogradeRunner => ({
    runTests: vi.fn(async () => ({ results, runnerError })),
    runProgram: vi.fn(async () => outcome()),
  });
  const options = { ...AUTOGRADE_ONE_OPTIONS, points: 10 };
  const halfPassed = [result('a', true), result('b', false)];

  it('saves the grade and returns the work as saved', async () => {
    const saved = submission({ status: 'graded', grade: 5, autoGraded: true, autoScore: 50 });
    const save = vi.fn(async () => saved);
    const step = await autogradeSubmission(submission(), setup, runner(halfPassed), options, save);
    expect(save).toHaveBeenCalledWith({ testResults: halfPassed, autoScore: 50, expectedUpdatedAt: UPDATED, grade: 5, status: 'graded', autoGraded: true });
    expect(step).toEqual({ outcome: 'graded', result: { score: 50, testResults: halfPassed, matchesSolution: false }, saved });
  });

  it("saves nothing when there's nothing to store", async () => {
    const save = vi.fn(async () => submission());
    const step = await autogradeSubmission(submission(), setup, runner(halfPassed, LOAD_ERROR), options, save);
    expect(step).toMatchObject({ outcome: 'unchecked', saved: null });
    expect(save).not.toHaveBeenCalled();
  });

  it('tells work that changed meanwhile (409) apart from other failures', async () => {
    const changed = new ApiError(409, "Maya Rivera's work changed while you were grading it.");
    const conflict = await autogradeSubmission(submission(), setup, runner(halfPassed), options, async () => Promise.reject(changed));
    expect(conflict).toMatchObject({ outcome: 'changed', saved: null, error: changed });
    const down = new ApiError(500, 'Server error');
    expect(await autogradeSubmission(submission(), setup, runner(halfPassed), options, async () => Promise.reject(down))).toMatchObject({
      outcome: 'failed',
      saved: null,
      error: down,
    });
  });

  it('saves nothing once the run was stopped', async () => {
    const controller = new AbortController();
    const save = vi.fn(async () => submission());
    const stopping: AutogradeRunner = {
      runTests: async () => {
        controller.abort();
        return { results: halfPassed, runnerError: null };
      },
      runProgram: async () => outcome(),
    };
    expect(await autogradeSubmission(submission(), setup, stopping, options, save, controller.signal)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('autograding one student', () => {
  const hand = submission({ status: 'graded', grade: 8, autoGraded: false });

  it('replaces any grade, a hand grade included', () => {
    expect(AUTOGRADE_ONE_OPTIONS).toEqual({ scope: 'replace-all', setGrades: true });
    expect(autogradePatch(hand, { score: 100, matchesSolution: true }, { ...AUTOGRADE_ONE_OPTIONS, points: 10 })).toMatchObject({
      patch: { grade: 10, status: 'graded', autoGraded: true },
      outcome: 'graded',
    });
  });

  it('is only offered for handed-in work, one run at a time', () => {
    expect(autogradeOneBlocker({ status: 'submitted' }, null)).toBeNull();
    expect(autogradeOneBlocker({ status: 'graded' }, null)).toBeNull();
    for (const status of ['not_started', 'in_progress'] as const) {
      expect(autogradeOneBlocker({ status }, null)).toBe('Not handed in yet. Only handed-in work can be autograded.');
    }
    expect(autogradeOneBlocker({ status: 'submitted' }, { kind: 'all' })).toBe('Wait for autograding to finish.');
    expect(autogradeOneBlocker({ status: 'submitted' }, { kind: 'one', studentId: 4, name: 'Sam Lee' })).toBe(
      "Wait until Sam Lee's work is autograded.",
    );
  });

  it("disables autograding everything while one student's work is being autograded", () => {
    expect(autogradeAllBlocker(3, null)).toBeNull();
    expect(autogradeAllBlocker(0, null)).toBe('Nothing has been handed in yet.');
    expect(autogradeAllBlocker(3, { kind: 'one', studentId: 4, name: 'Sam Lee' })).toBe("Wait until Sam Lee's work is autograded.");
    // That run's own button is "Stop autograding".
    expect(autogradeAllBlocker(3, { kind: 'all' })).toBeNull();
  });

  it('finds the grade the teacher entered, which autograding would replace', () => {
    expect(handGradeToReplace(hand, 10)).toBe('8 / 10');
    expect(handGradeToReplace(submission({ status: 'graded', grade: 7.5, autoGraded: true }), 10)).toBeNull();
    expect(handGradeToReplace(submission(), 10)).toBeNull();
  });

  it('confirms replacing a grade the teacher entered or typed', () => {
    expect(autogradeOneConfirmation(submission(), 10)).toBeNull();
    expect(autogradeOneConfirmation(submission({ status: 'graded', grade: 9, autoGraded: true }), 10)).toBeNull();
    expect(autogradeOneConfirmation(hand, 10)).toEqual([
      'This replaces the grade you entered: 8 / 10.',
      "If autograde can't score the work, your grade is kept.",
    ]);
    expect(autogradeOneConfirmation(submission(), 10, { unsavedGrade: true })).toEqual(["This replaces the grade you've typed but not saved."]);
    expect(autogradeOneConfirmation(hand, 10, { unsavedGrade: true })).toEqual([
      'This replaces the grade you entered: 8 / 10.',
      "It also replaces the grade you've typed but not saved.",
      "If autograde can't score the work, your grade is kept.",
    ]);
  });
});

describe('autogradeOneSummary', () => {
  const tests = [test('a'), test('b'), test('c'), { ...test('d'), hidden: true }];
  const context = { name: 'Maya Rivera', before: submission(), outOf: 10, tests, kind: 'python' as const, compareMode: 'trim' as const };
  const step = (partial: Partial<AutogradeStep>): AutogradeStep => ({
    outcome: 'graded',
    result: { score: null, matchesSolution: false },
    saved: null,
    ...partial,
  });
  const unscored = (unscoredReason: AutogradeStep['result']['unscoredReason']) =>
    step({ outcome: 'unscored', result: { score: null, matchesSolution: false, unscoredReason } });

  it('says what the grade is and why', () => {
    const passed = [result('a', true), result('b', true), result('c', true), result('d', false)];
    expect(autogradeOneSummary(step({ result: { score: 75, testResults: passed, matchesSolution: false } }), context)).toEqual({
      title: 'Graded 7.5 / 10 — 3 of 4 tests passed',
      message: 'Maya Rivera can see this grade now.',
      color: 'teal',
      keepOpen: false,
    });
    expect(autogradeOneSummary(step({ result: { score: 100, testResults: passed, matchesSolution: true } }), context).title).toBe(
      'Graded 10 / 10 — same program as your solution',
    );
    expect(autogradeOneSummary(step({ result: { score: 100, matchesSolution: false } }), { ...context, tests: [] }).title).toBe(
      "Graded 10 / 10 — its output matches your solution's",
    );
  });

  it('warns when the solution fails some of the tests', () => {
    const solutionCheck = { passed: 2, total: 4, failing: [{ id: 'c', label: 'Test 3', error: null }, { id: 'd', label: 'Test 4', error: null }] };
    const passed = [result('a', true), result('b', true), result('c', false), result('d', false)];
    expect(autogradeOneSummary(step({ result: { score: 50, testResults: passed, matchesSolution: false } }), { ...context, solutionCheck })).toEqual({
      title: 'Graded 5 / 10 — 2 of 4 tests passed',
      message: "Maya Rivera can see this grade now. Your solution fails 2 of 4 tests. Check those tests' expected outputs: Test 3, Test 4.",
      color: 'yellow',
      keepOpen: true,
    });
  });

  it("explains why it couldn't score the work, and what happened to its grade", () => {
    const noTests = { ...context, tests: [] };
    expect(autogradeOneSummary(unscored('output-differs'), noTests)).toEqual({
      title: "Couldn't score Maya Rivera's work",
      message: "Its output differs from your solution's. Output is compared: Ignore spaces at line ends and blank lines. It's left for you to grade.",
      color: 'yellow',
      keepOpen: true,
    });
    expect(autogradeOneSummary(unscored('student-input'), noTests).message).toBe(
      "It asks for input, and with no tests autograde runs work without any, so its output can't be checked. It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('student-error'), noTests).message).toBe(
      "It stops with an error when it runs without input. It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('student-timeout'), noTests).message).toBe(
      "It doesn't finish in time when it runs without input. It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('no-reference'), { ...noTests, reference: 'silent' }).message).toBe(
      "Your solution doesn't print anything, so only work that's the same program as your solution can be scored. Make your solution print its result (Edit → Solution), or add tests (Edit → Tests). It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('no-reference'), { ...noTests, reference: 'error' }).message).toBe(
      "Your solution stops with an error when it runs without input, so only work that's the same program as your solution can be scored. Fix your solution (Edit → Solution) so it runs to the end without input, or add tests (Edit → Tests). It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('no-reference'), { ...noTests, reference: 'input' }).message).toBe(
      "Your solution asks for input, and with no tests autograde runs programs without any, so only work that's the same program as your solution can be scored. Add tests (Edit → Tests → Fill expected outputs from a model solution) so autograde can check programs that ask for input. It's left for you to grade.",
    );
    expect(autogradeOneSummary(unscored('not-runnable'), { ...noTests, kind: 'web' }).message).toBe(
      "It isn't the same program as your solution, and web pages can't be run here. It's left for you to grade.",
    );
    const kept = autogradeOneSummary(step({ outcome: 'kept', result: { score: null, matchesSolution: false, unscoredReason: 'output-differs' } }), {
      ...noTests,
      before: submission({ status: 'graded', grade: 8 }),
    });
    expect(kept.message).toBe(
      "Its output differs from your solution's. Output is compared: Ignore spaces at line ends and blank lines. Your grade of 8 / 10 was kept.",
    );
    const cleared = autogradeOneSummary(step({ outcome: 'cleared', result: { score: null, matchesSolution: false, unscoredReason: 'student-error' } }), {
      ...noTests,
      before: submission({ status: 'graded', grade: 10, autoGraded: true }),
    });
    expect(cleared.message).toBe(
      "It stops with an error when it runs without input. Its earlier auto grade (10 / 10) was taken off, so it's back in To grade.",
    );
  });

  it("reports work it couldn't check because the code runner didn't start", () => {
    const unchecked = (runnerError: string) =>
      autogradeOneSummary(step({ outcome: 'unchecked', result: { score: null, matchesSolution: false, runnerError } }), context);
    expect(unchecked(LOAD_ERROR)).toEqual({
      title: "The code runner didn't start",
      message: `Maya Rivera's work wasn't checked, so nothing was changed. ${LOAD_ERROR}`,
      color: 'red',
      keepOpen: true,
    });
    expect(unchecked("The code runner didn't start.").message).toBe(
      "Maya Rivera's work wasn't checked, so nothing was changed. Reload the page and try again.",
    );
  });

  it('reports work that changed meanwhile, saves that failed, and a stopped run', () => {
    expect(autogradeOneSummary(step({ outcome: 'changed' }), context)).toMatchObject({ title: "Maya Rivera's work changed", color: 'yellow' });
    expect(autogradeOneSummary(step({ outcome: 'failed', error: new ApiError(500, 'The server had a problem.') }), context)).toEqual({
      title: "Couldn't autograde Maya Rivera's work",
      message: 'The server had a problem.',
      color: 'red',
      keepOpen: true,
    });
    expect(autogradeOneSummary(null, context)).toEqual({
      title: 'Autograding stopped',
      message: "Maya Rivera's work wasn't changed. Autograding stops when you leave the page.",
      color: 'yellow',
      keepOpen: false,
    });
  });
});
