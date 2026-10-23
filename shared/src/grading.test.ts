import { describe, expect, it } from 'vitest';
import { computeAutoScore } from './grading';
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
