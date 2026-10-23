// Output comparison and auto-scoring used by both the student IDE and the teacher grading view.

import type { CompareMode, TestCase, TestResult } from './types';

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/** Normalizes program output for comparison under the given mode. */
export function normalizeOutput(output: string, mode: CompareMode): string {
  let s = normalizeNewlines(output);
  if (mode === 'exact') return s;
  // 'trim' and stricter: ignore trailing spaces on each line and leading/trailing blank lines.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  if (mode === 'ignore-whitespace' || mode === 'ignore-case') s = s.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
  if (mode === 'ignore-case') s = s.toLowerCase();
  return s;
}

export function outputsMatch(actual: string, expected: string, mode: CompareMode): boolean {
  return normalizeOutput(actual, mode) === normalizeOutput(expected, mode);
}

/** Splits a test's input text into lines for the runner (a trailing newline does not add an empty line). */
export function inputLines(input: string): string[] {
  const s = normalizeNewlines(input);
  if (s === '') return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** A test's weight in the auto-score: its points (0 = no weight). Missing or invalid points count as 1, the default. */
function testWeight(test: TestCase): number {
  const points = test.points as number | null | undefined;
  return typeof points === 'number' && Number.isFinite(points) ? Math.max(0, points) : 1;
}

/**
 * Weighted percentage (0–100, rounded to 1 decimal) of tests passed; null when there are no tests or results.
 * Each test weighs its points, so a 0-point test doesn't change the score. If every test is worth 0 points, the
 * tests count equally.
 */
export function computeAutoScore(tests: TestCase[], results: TestResult[]): number | null {
  if (tests.length === 0 || results.length === 0) return null;
  const byId = new Map(results.map((r) => [r.testId, r]));
  let weights = tests.map(testWeight);
  if (weights.every((w) => w === 0)) weights = tests.map(() => 1);
  let total = 0;
  let earned = 0;
  tests.forEach((t, i) => {
    const weight = weights[i]!;
    total += weight;
    if (byId.get(t.id)?.passed) earned += weight;
  });
  return Math.round((earned / total) * 1000) / 10;
}

export const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  exact: 'Exact match',
  trim: 'Ignore trailing spaces and blank lines',
  'ignore-whitespace': 'Ignore all extra whitespace',
  'ignore-case': 'Ignore whitespace and capitalisation',
};
