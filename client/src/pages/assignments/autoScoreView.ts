// The "Auto score" part of the grading page (GradeForm.tsx): which score it shows and offers with "Use auto-score",
// and how it describes where that score came from. Pure, so it can be unit-tested.

import { computeAutoScore, type Assignment, type TestCase, type TestResult } from '@codeclass/shared';
import { compareRule, passesSolutionTests, type AutogradeMethod } from './autograde';

export interface AutoScoreView {
  /** The score shown in the ring and offered with "Use auto-score"; null = none. */
  score: number | null;
  /** Nothing to show: the assignment has no tests and the work has no auto score. */
  empty: boolean;
  /** The line next to the ring. */
  summary: string;
  /** Smaller lines under it. */
  notes: string[];
}

export function autoScoreView({
  tests,
  testResults,
  autoScore,
  rerunResults,
  matchesSolution,
  solutionFails = null,
}: {
  /** The assignment's tests, hidden ones included. */
  tests: TestCase[];
  /** Stored results and auto score of the work. */
  testResults: TestResult[] | null;
  autoScore: number | null;
  /** Results of tests the teacher re-ran on this page (not saved yet), or null. */
  rerunResults: TestResult[] | null;
  /** The work is the same program as the teacher's solution (`sameProgram`). */
  matchesSolution: boolean;
  /** The ids of the tests the solution fails, among those the re-run work failed; null = not known (yet). */
  solutionFails?: readonly string[] | null;
}): AutoScoreView {
  // Work that is the same program as the solution gets full marks, as autograde gives it, even when it fails a test
  // the solution fails too (a typo in a test's expected output, say), so re-running the tests here doesn't lower its
  // score. A test only it fails means it isn't really the same program (`passesSolutionTests`).
  const full = matchesSolution && rerunResults != null && passesSolutionTests(tests, rerunResults, solutionFails);
  const score = rerunResults ? (full ? 100 : computeAutoScore(tests, rerunResults)) : autoScore;

  if (tests.length === 0) {
    if (score == null) return { score, empty: true, summary: '', notes: [] };
    // Without tests, only autograde gives a score, and only full marks: for being the same program as the solution,
    // or printing what it prints. Any other score is left over from tests the assignment no longer has.
    if (score !== 100) return { score, empty: false, summary: 'From tests this assignment no longer has.', notes: [] };
    return {
      score,
      empty: false,
      summary: matchesSolution ? "From autograde: it's the same program as your solution." : "From autograde: its output matches your solution's.",
      notes: [],
    };
  }

  const results = rerunResults ?? testResults;
  const passed = results ? tests.filter((t) => results.some((r) => r.testId === t.id && r.passed)).length : 0;
  const hiddenNotRun = !!results && tests.some((t) => t.hidden && !results.some((r) => r.testId === t.id));
  const notes: string[] = [];
  if (matchesSolution && score === 100 && passed < tests.length) notes.push("Full marks: it's the same program as your solution.");
  if (rerunResults) notes.push('From your test run, not saved yet.');
  else if (hiddenNotRun || !results) notes.push('Use Run tests to include the hidden tests.');
  return {
    score,
    empty: false,
    summary: results ? `${passed} of ${tests.length} tests passed` : "Tests haven't been run yet",
    notes,
  };
}

/**
 * What the Auto score section says when the assignment has no tests and the work has no auto score: what autograde
 * can still give full marks for. `method` null = autograde can't check anything, or the language hasn't loaded yet.
 */
export function noTestsNote(method: AutogradeMethod | null, assignment: Pick<Assignment, 'hasSolution' | 'compareMode'>): string {
  const none = "This assignment has no tests, so there's no auto score.";
  if (method?.output) {
    return `${none} Autograde can still give full marks to work that is the same program as your solution, or that prints the same as your solution when both run without input. ${compareRule(assignment.compareMode)}`;
  }
  if (method?.solution ?? assignment.hasSolution) return `${none} Autograde can still give full marks to work that is the same program as your solution.`;
  return none;
}
