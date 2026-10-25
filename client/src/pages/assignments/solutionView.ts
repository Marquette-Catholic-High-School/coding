// Solution helpers for the assignment pages: what a student sees of the solution, and the editor's "Check solution".

import { solutionPendingNote, solutionReleased, type Assignment, type SubmissionStatus, type TestCase, type TestResult } from '@codeclass/shared';

type SolutionRules = Pick<Assignment, 'dueAt' | 'allowLate' | 'solutionVisibility'>;

/** CodeWorkspace's solution props for a student whose work has `status`, worked out from the full solution ('' = none). */
export function solutionForStudent(
  rules: SolutionRules,
  solutionCode: string,
  status: SubmissionStatus,
  now: number = Date.now(),
): { solutionCode: string | null; solutionNote: string | null } {
  const hasSolution = solutionCode.trim() !== '';
  return {
    solutionCode: solutionReleased(rules, hasSolution, status, now) ? solutionCode : null,
    solutionNote: solutionPendingNote(rules, hasSolution, status, now),
  };
}

/** "Test 2: Works when the list is empty", as tests are named across the editor. */
export function testLabel(test: Pick<TestCase, 'name'>, index: number): string {
  const name = test.name.trim();
  return `Test ${index + 1}${name ? `: ${name}` : ''}`;
}

export interface SolutionCheck {
  passed: number;
  total: number;
  failing: { id: string; label: string; error: string | null }[];
}

/** Summary of running the solution against every test. A test without a result counts as failing. */
export function summarizeSolutionCheck(tests: Pick<TestCase, 'id' | 'name'>[], results: TestResult[]): SolutionCheck {
  const byId = new Map(results.map((r) => [r.testId, r]));
  const failing = tests.flatMap((test, index) => {
    const result = byId.get(test.id);
    if (result?.passed) return [];
    return [{ id: test.id, label: testLabel(test, index), error: result ? result.error : 'This test did not run.' }];
  });
  return { passed: tests.length - failing.length, total: tests.length, failing };
}
