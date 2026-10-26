// The "Auto score" part of the grading page (GradeForm.tsx): which score it shows and offers with "Use auto-score",
// and how it describes where that score came from. Pure, so it can be unit-tested.

import { computeAutoScore, type TestCase, type TestResult } from '@codeclass/shared';

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
}: {
  /** The assignment's tests, hidden ones included. */
  tests: TestCase[];
  /** Stored results and auto score of the work. */
  testResults: TestResult[] | null;
  autoScore: number | null;
  /** Results of tests the teacher re-ran on this page (not saved yet), or null. */
  rerunResults: TestResult[] | null;
  /** The work's code matches the teacher's solution. */
  matchesSolution: boolean;
}): AutoScoreView {
  // Work that matches the solution gets full marks, as autograde gives it, even when a test fails (a typo in a
  // test's expected output, say), so re-running the tests here doesn't lower its score.
  const score = rerunResults ? (matchesSolution ? 100 : computeAutoScore(tests, rerunResults)) : autoScore;

  if (tests.length === 0) {
    if (score == null) return { score, empty: true, summary: '', notes: [] };
    // Without tests, only autograde gives a score, and only full marks: for matching the solution's code or its
    // output. Any other score is left over from tests the assignment no longer has.
    if (score !== 100) return { score, empty: false, summary: 'From tests this assignment no longer has.', notes: [] };
    return {
      score,
      empty: false,
      summary: matchesSolution ? 'From autograde: its code matches your solution.' : "From autograde: its output matches your solution's.",
      notes: [],
    };
  }

  const results = rerunResults ?? testResults;
  const passed = results ? tests.filter((t) => results.some((r) => r.testId === t.id && r.passed)).length : 0;
  const hiddenNotRun = !!results && tests.some((t) => t.hidden && !results.some((r) => r.testId === t.id));
  const notes: string[] = [];
  if (matchesSolution && score === 100 && passed < tests.length) notes.push('Full marks: its code matches your solution.');
  if (rerunResults) notes.push('From your test run, not saved yet.');
  else if (hiddenNotRun || !results) notes.push('Use Run tests to include the hidden tests.');
  return {
    score,
    empty: false,
    summary: results ? `${passed} of ${tests.length} tests passed` : "Tests haven't been run yet",
    notes,
  };
}
