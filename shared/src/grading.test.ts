import { describe, expect, it } from 'vitest';
import { computeAutoScore, gradeFromAutoScore, matchesSolution, normalizeCode } from './grading';
import type { TestCase, TestResult } from './types';

const test = (id: string, points: number): TestCase => ({ id, name: id, input: '', expectedOutput: '', hidden: false, points });
const result = (testId: string, passed: boolean): TestResult => ({ testId, passed, actualOutput: '', error: null, durationMs: 1 });

describe('computeAutoScore', () => {
  it('weights tests by their points', () => {
    expect(computeAutoScore([test('a', 1), test('b', 3)], [result('a', false), result('b', true)])).toBe(75);
    expect(computeAutoScore([test('a', 1), test('b', 2)], [result('a', true), result('b', false)])).toBe(33.3);
  });

  it('gives 0-point tests no weight', () => {
    const tests = [test('main', 10), test('practice', 0)];
    expect(computeAutoScore(tests, [result('main', true), result('practice', false)])).toBe(100);
    expect(computeAutoScore(tests, [result('main', false), result('practice', true)])).toBe(0);
    expect(computeAutoScore([test('main', 1), test('practice', 0)], [result('main', true), result('practice', false)])).toBe(100);
  });

  it('counts tests equally when every test is worth 0 points', () => {
    const tests = [test('a', 0), test('b', 0), test('c', 0), test('d', 0)];
    expect(computeAutoScore(tests, [result('a', true), result('b', true), result('c', true), result('d', false)])).toBe(75);
  });

  it('treats missing points as the default weight of 1', () => {
    const legacy = { ...test('a', 0), points: undefined } as unknown as TestCase;
    expect(computeAutoScore([legacy, test('b', 3)], [result('a', true), result('b', false)])).toBe(25);
  });

  it('counts tests without a result as failed and ignores results for unknown tests', () => {
    expect(computeAutoScore([test('a', 1), test('b', 1)], [result('a', true), result('zzz', true)])).toBe(50);
  });

  it('returns null without tests or results', () => {
    expect(computeAutoScore([], [result('a', true)])).toBeNull();
    expect(computeAutoScore([test('a', 1)], [])).toBeNull();
  });
});

describe('matchesSolution', () => {
  const solution = 'INPUT n\nOUTPUT n * 2\n';

  it('ignores line endings, trailing spaces and blank lines', () => {
    expect(matchesSolution('INPUT n\r\n\r\nOUTPUT n * 2   ', solution)).toBe(true);
    expect(matchesSolution('\n\nINPUT n\nOUTPUT n * 2', solution)).toBe(true);
    expect(normalizeCode('a  \r\n\r\n  b\t\n')).toBe('a\n  b');
  });

  it('still counts indentation, spacing inside lines and capital letters', () => {
    expect(matchesSolution('  INPUT n\nOUTPUT n * 2', solution)).toBe(false);
    expect(matchesSolution('INPUT n\nOUTPUT n*2', solution)).toBe(false);
    expect(matchesSolution('input n\noutput n * 2', solution)).toBe(false);
  });

  it('never matches a blank solution', () => {
    expect(matchesSolution('', '')).toBe(false);
    expect(matchesSolution('   \n', ' \n\n')).toBe(false);
    expect(matchesSolution('x', null)).toBe(false);
  });
});

describe('gradeFromAutoScore', () => {
  it('scales to the points and rounds to 1 decimal', () => {
    expect(gradeFromAutoScore(100, 10)).toBe(10);
    expect(gradeFromAutoScore(33.3, 10)).toBe(3.3);
    expect(gradeFromAutoScore(66.7, 15)).toBe(10);
    expect(gradeFromAutoScore(0, 100)).toBe(0);
    expect(gradeFromAutoScore(50, 0)).toBe(0);
  });
});
