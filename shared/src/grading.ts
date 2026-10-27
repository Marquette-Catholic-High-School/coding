// Output comparison and auto-scoring used by both the student IDE and the teacher grading view.

import type { CompareMode, TestCase, TestResult } from './types';

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/** Unicode spaces (no-break, thin, ideographic, …), vertical tab and form feed: plain spaces unless matching is exact. */
const OTHER_SPACES = /[\p{Zs}\v\f]/gu;
/** Invisible characters pasted text can carry (byte order mark, zero-width space): dropped unless matching is exact. */
const ZERO_WIDTH = /[\ufeff\u200b]/g;

/**
 * Normalizes program output for comparison under the given mode (see COMPARE_MODE_DESCRIPTIONS). Line endings are
 * always unified. 'exact' keeps everything except one final line break; the other modes also treat Unicode spaces
 * as spaces.
 */
export function normalizeOutput(output: string, mode: CompareMode): string {
  const s = normalizeNewlines(output);
  if (mode === 'exact') return s.endsWith('\n') ? s.slice(0, -1) : s;
  const spaced = s.replace(ZERO_WIDTH, '').replace(OTHER_SPACES, ' ');
  if (mode === 'trim') {
    return spaced
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .filter((line) => line !== '')
      .join('\n');
  }
  // 'ignore-whitespace' and 'ignore-case': no whitespace counts, so "Total:8" = "Total: 8" = "Total:\n8".
  const bare = spaced.replace(/\s+/g, '');
  return mode === 'ignore-case' ? bare.toLowerCase() : bare;
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

/** Points for an auto score (0–100) on an assignment worth `points`, rounded to 1 decimal. */
export function gradeFromAutoScore(autoScore: number, points: number): number {
  return Math.round((autoScore / 100) * points * 10) / 10;
}

export const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  exact: 'Exact match (every space counts)',
  trim: 'Ignore spaces at line ends and blank lines',
  'ignore-whitespace': 'Ignore all spaces and line breaks',
  'ignore-case': 'Ignore spaces, line breaks and capitals',
};

/** What each compare mode ignores, with an example (shown under the editor's compare-mode select). */
export const COMPARE_MODE_DESCRIPTIONS: Record<CompareMode, string> = {
  exact: 'Spaces, line breaks and capitals all count; only a line break at the very end doesn\'t. "Total: 8" doesn\'t match "Total:8".',
  trim: 'Spaces at the ends of lines and blank lines don\'t count; other spaces do. "Total: 8" matches "Total: 8  " but not "Total:8".',
  'ignore-whitespace':
    'Spaces, tabs and line breaks don\'t count at all; capitals do. "Total: 8" matches "Total:8", and "Total:" with 8 on the next line.',
  'ignore-case': 'Spaces, tabs, line breaks and capitals don\'t count. "Total: 8" matches "TOTAL:8".',
};
