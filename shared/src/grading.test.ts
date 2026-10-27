import { describe, expect, it } from 'vitest';
import {
  COMPARE_MODE_DESCRIPTIONS,
  COMPARE_MODE_LABELS,
  computeAutoScore,
  gradeFromAutoScore,
  normalizeOutput,
  outputsMatch,
} from './grading';
import type { CompareMode, TestCase, TestResult } from './types';

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

describe('gradeFromAutoScore', () => {
  it('scales to the points and rounds to 1 decimal', () => {
    expect(gradeFromAutoScore(100, 10)).toBe(10);
    expect(gradeFromAutoScore(33.3, 10)).toBe(3.3);
    expect(gradeFromAutoScore(66.7, 15)).toBe(10);
    expect(gradeFromAutoScore(0, 100)).toBe(0);
    expect(gradeFromAutoScore(50, 0)).toBe(0);
  });
});

describe('outputsMatch', () => {
  const MODES: CompareMode[] = ['exact', 'trim', 'ignore-whitespace', 'ignore-case'];
  // [case, program output, expected output, matches in exact / trim / ignore-whitespace / ignore-case]
  const cases: [string, string, string, string][] = [
    ['identical, print adds a final line break', 'Total: 8\n', 'Total: 8', 'YYYY'],
    ['final line break only in the expected output', 'Total: 8', 'Total: 8\n', 'YYYY'],
    ['two final line breaks', 'Total: 8\n\n', 'Total: 8', 'NYYY'],
    ['missing space after a colon', 'Total:8\n', 'Total: 8', 'NNYY'],
    ['extra space after a colon', 'Total: 8\n', 'Total:8', 'NNYY'],
    ['space before a colon', 'Total : 8\n', 'Total: 8', 'NNYY'],
    ['list without spaces', '1,2,3\n', '1, 2, 3', 'NNYY'],
    ['words run together', 'Hello Sam\n', 'HelloSam', 'NNYY'],
    ['double space', 'Total:  8\n', 'Total: 8', 'NNYY'],
    ['tab for a space', 'Total:\t8\n', 'Total: 8', 'NNYY'],
    ['indented first line', '  Total: 8\n', 'Total: 8', 'NNYY'],
    ['indented second line', 'Line 1\n   Line 2\n', 'Line 1\nLine 2', 'NNYY'],
    ['spaces at a line end', 'Total: 8   \n', 'Total: 8', 'NYYY'],
    ['tab at a line end', 'a\t\nb\n', 'a\nb', 'NYYY'],
    ['blank line in the middle', 'a\n\nb\n', 'a\nb', 'NYYY'],
    ['line of spaces in the middle', 'a\n   \nb\n', 'a\nb', 'NYYY'],
    ['blank line first', '\nTotal: 8\n', 'Total: 8', 'NYYY'],
    ['expected with spaces at line ends and blank lines', 'a\nb\n', 'a  \n\nb \n\n', 'NYYY'],
    ['CRLF in the expected output', 'a\nb\n', 'a\r\nb\r\n', 'YYYY'],
    ['CRLF in the program output', 'a\r\nb\r\n', 'a\nb', 'YYYY'],
    ['CR line endings', 'a\rb\r', 'a\nb', 'YYYY'],
    ['no-break space pasted into the expected output', 'Total: 8\n', 'Total:\u00a08', 'NYYY'],
    ['no-break space at a line end', 'Total: 8\n', 'Total: 8\u00a0', 'NYYY'],
    ['thin space', 'Total:\u20098\n', 'Total: 8', 'NYYY'],
    ['em space', 'Total:\u20038\n', 'Total: 8', 'NYYY'],
    ['narrow no-break, math and ideographic spaces', 'a\u202fb\u205fc\u3000d\n', 'a b c d', 'NYYY'],
    ['vertical tab and form feed', 'Total:\v8\fx\n', 'Total: 8 x', 'NYYY'],
    ['byte order mark', 'Total: 8\n', '\ufeffTotal: 8', 'NYYY'],
    ['zero-width space', 'Total:\u200b 8\n', 'Total: 8', 'NYYY'],
    ['line break for a space', 'Total:\n8\n', 'Total: 8', 'NNYY'],
    ['one line for two', 'Hi Hi Hi \n', 'Hi\nHi\nHi', 'NNYY'],
    ['capital letters', 'total: 8\n', 'Total: 8', 'NNNY'],
    ['capitals and spacing', 'TOTAL:8\n', 'Total: 8', 'NNNY'],
    ['nothing printed, nothing expected', '\n', '', 'YYYY'],
    ['only spacing printed, nothing expected', ' \n\t\n', '', 'NYYY'],
    ['different number format', 'Total: 8.0\n', 'Total: 8', 'NNNN'],
    ['different text', 'Total: 9\n', 'Total: 8', 'NNNN'],
    ['input prompt in front (see RunOutcome.promptlessStdout)', 'Enter a number: Total: 8\n', 'Total: 8', 'NNNN'],
  ];

  for (const [name, actual, expected, verdicts] of cases) {
    it(`${name}: ${verdicts}`, () => {
      const got = MODES.map((mode) => (outputsMatch(actual, expected, mode) ? 'Y' : 'N')).join('');
      expect(got).toBe(verdicts);
      // Matching is symmetric.
      expect(MODES.map((mode) => (outputsMatch(expected, actual, mode) ? 'Y' : 'N')).join('')).toBe(verdicts);
    });
  }
});

describe('normalizeOutput', () => {
  it('keeps everything in exact mode except line endings and one final line break', () => {
    expect(normalizeOutput('a  b\r\n\r\n', 'exact')).toBe('a  b\n');
    expect(normalizeOutput('\u00a0a\t', 'exact')).toBe('\u00a0a\t');
  });

  it('drops spaces at line ends and every blank line in trim mode, keeping other spacing', () => {
    expect(normalizeOutput('\n  a  b \n\n \u00a0\nc\t\n\n', 'trim')).toBe('  a  b\nc');
  });

  it('removes all whitespace when spacing does not count', () => {
    expect(normalizeOutput(' Total :\n  8 \u3000\r\n', 'ignore-whitespace')).toBe('Total:8');
    expect(normalizeOutput(' Total :\n  8 ', 'ignore-case')).toBe('total:8');
  });
});

describe('compare mode texts', () => {
  it('label and describe every mode', () => {
    for (const mode of ['exact', 'trim', 'ignore-whitespace', 'ignore-case'] as const) {
      expect(COMPARE_MODE_LABELS[mode]).toBeTruthy();
      expect(COMPARE_MODE_DESCRIPTIONS[mode]).toMatch(/"Total: 8"/);
    }
  });
});
