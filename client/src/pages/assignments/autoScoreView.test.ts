import type { TestCase, TestResult } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { autoScoreView } from './autoScoreView';

const test = (id: string, hidden = false): TestCase => ({ id, name: id, input: '', expectedOutput: 'x', hidden, points: 1 });
const result = (testId: string, passed: boolean): TestResult => ({ testId, passed, actualOutput: '', error: null, durationMs: 1 });
const view = (partial: Partial<Parameters<typeof autoScoreView>[0]>) =>
  autoScoreView({ tests: [], testResults: null, autoScore: null, rerunResults: null, matchesSolution: false, ...partial });

const TESTS = [test('a'), test('b'), test('c'), test('d'), test('e', true)];
const THREE_OF_FIVE = [result('a', true), result('b', true), result('c', true), result('d', false), result('e', false)];

describe('autoScoreView', () => {
  it('shows the stored score and how many tests passed', () => {
    expect(view({ tests: TESTS, testResults: THREE_OF_FIVE, autoScore: 60 })).toEqual({
      score: 60,
      empty: false,
      summary: '3 of 5 tests passed',
      notes: [],
    });
  });

  it('asks for a test run when the hidden tests have not run', () => {
    expect(view({ tests: TESTS, testResults: THREE_OF_FIVE.slice(0, 4), autoScore: 75 }).notes).toEqual([
      'Use Run tests to include the hidden tests.',
    ]);
    expect(view({ tests: TESTS }).summary).toBe("Tests haven't been run yet");
  });

  it("scores the teacher's own test run", () => {
    expect(view({ tests: TESTS, testResults: null, autoScore: null, rerunResults: THREE_OF_FIVE })).toEqual({
      score: 60,
      empty: false,
      summary: '3 of 5 tests passed',
      notes: ['From your test run, not saved yet.'],
    });
  });

  it('gives work that matches the solution full marks, as autograde does, and says why', () => {
    // Autograde stored 100 for a match even though a test's expected output has a typo.
    expect(view({ tests: TESTS, testResults: THREE_OF_FIVE, autoScore: 100, matchesSolution: true })).toEqual({
      score: 100,
      empty: false,
      summary: '3 of 5 tests passed',
      notes: ['Full marks: its code matches your solution.'],
    });
    // Running the tests again here doesn't lower it.
    const rerun = view({ tests: TESTS, testResults: THREE_OF_FIVE, autoScore: 100, rerunResults: THREE_OF_FIVE, matchesSolution: true });
    expect(rerun.score).toBe(100);
    expect(rerun.notes).toEqual(['Full marks: its code matches your solution.', 'From your test run, not saved yet.']);
  });

  it('has nothing to show without tests or a score', () => {
    expect(view({}).empty).toBe(true);
  });

  it("describes autograde's full marks without tests", () => {
    expect(view({ autoScore: 100, matchesSolution: true }).summary).toBe('From autograde: its code matches your solution.');
    expect(view({ autoScore: 100 }).summary).toBe("From autograde: its output matches your solution's.");
  });

  it("doesn't claim a solution match for a score left over from deleted tests", () => {
    expect(view({ autoScore: 50, testResults: [result('gone', true)] })).toEqual({
      score: 50,
      empty: false,
      summary: 'From tests this assignment no longer has.',
      notes: [],
    });
  });
});
