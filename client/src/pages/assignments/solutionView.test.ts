import type { TestResult } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { solutionForStudent, summarizeSolutionCheck, testLabel } from './solutionView';

const DUE = '2026-11-02T17:00:00.000Z';
const BEFORE = Date.parse(DUE) - 60_000;
const AFTER = Date.parse(DUE) + 60_000;
const CODE = 'print("hi")';

describe('solutionForStudent (preview as a student who has not started)', () => {
  it('shows nothing when there is no solution', () => {
    expect(solutionForStudent({ dueAt: null, allowLate: true, solutionVisibility: 'visible' }, '  ', 'not_started')).toEqual({
      solutionCode: null,
      solutionNote: null,
    });
  });

  it('shows nothing for a teachers-only solution', () => {
    expect(solutionForStudent({ dueAt: DUE, allowLate: true, solutionVisibility: 'hidden' }, CODE, 'not_started', AFTER)).toEqual({
      solutionCode: null,
      solutionNote: null,
    });
  });

  it('shows a solution that is visible now', () => {
    expect(solutionForStudent({ dueAt: null, allowLate: true, solutionVisibility: 'visible' }, CODE, 'not_started')).toEqual({
      solutionCode: CODE,
      solutionNote: null,
    });
  });

  it('explains when an after-due solution appears', () => {
    const rules = { dueAt: DUE, allowLate: true, solutionVisibility: 'after_due' } as const;
    const before = solutionForStudent(rules, CODE, 'not_started', BEFORE);
    expect(before.solutionCode).toBeNull();
    expect(before.solutionNote).toMatch(/after the due date/);
    // Late work is still accepted, so only students who handed in see it.
    const after = solutionForStudent(rules, CODE, 'not_started', AFTER);
    expect(after.solutionCode).toBeNull();
    expect(after.solutionNote).toMatch(/once you hand in/);
    // Without late work, everyone sees it once the due date passes.
    expect(solutionForStudent({ ...rules, allowLate: false }, CODE, 'not_started', AFTER)).toEqual({ solutionCode: CODE, solutionNote: null });
  });

  it('explains that an after-grading solution waits for a grade', () => {
    const view = solutionForStudent({ dueAt: null, allowLate: true, solutionVisibility: 'after_graded' }, CODE, 'not_started');
    expect(view.solutionCode).toBeNull();
    expect(view.solutionNote).toMatch(/graded/);
  });
});

describe('summarizeSolutionCheck', () => {
  const tests = [
    { id: 'a', name: 'Small numbers' },
    { id: 'b', name: '' },
    { id: 'c', name: 'Empty input' },
  ];
  const result = (testId: string, passed: boolean, error: string | null = null): TestResult => ({
    testId,
    passed,
    actualOutput: '',
    error,
    durationMs: 1,
  });

  it('counts passing tests', () => {
    expect(summarizeSolutionCheck(tests, [result('a', true), result('b', true), result('c', true)])).toEqual({
      passed: 3,
      total: 3,
      failing: [],
    });
  });

  it('names the failing tests with their errors, and counts tests that did not run as failing', () => {
    const check = summarizeSolutionCheck(tests, [result('a', true), result('b', false, 'Line 2: NameError')]);
    expect(check.passed).toBe(1);
    expect(check.total).toBe(3);
    expect(check.failing).toEqual([
      { id: 'b', label: 'Test 2', error: 'Line 2: NameError' },
      { id: 'c', label: 'Test 3: Empty input', error: 'This test did not run.' },
    ]);
  });

  it('leaves the reason empty for a wrong output', () => {
    expect(summarizeSolutionCheck([tests[0]!], [result('a', false)]).failing).toEqual([{ id: 'a', label: 'Test 1: Small numbers', error: null }]);
  });
});

describe('testLabel', () => {
  it('numbers tests from 1 and adds the trimmed name', () => {
    expect(testLabel({ name: '' }, 0)).toBe('Test 1');
    expect(testLabel({ name: '  Big list ' }, 4)).toBe('Test 5: Big list');
  });
});
