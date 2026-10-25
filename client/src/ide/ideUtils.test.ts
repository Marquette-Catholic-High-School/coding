import type { TestCase } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import type { OutputChunk } from '../runtime';
import {
  consoleInputKey,
  formatDuration,
  loadingMessage,
  nextFitLevel,
  parseSideTab,
  resolveSideTab,
  solutionContent,
  summarizeTests,
  tailSegments,
  testName,
  testsBadgeColor,
} from './ideUtils';

const test = (id: string, name = ''): TestCase => ({ id, name, input: '', expectedOutput: '', hidden: false, points: 1 });

describe('ideUtils', () => {
  it('formats run durations', () => {
    expect(formatDuration(240)).toBe('0.24 s');
    expect(formatDuration(12_345)).toBe('12.3 s');
    expect(formatDuration(-5)).toBe('0.00 s');
  });

  it('merges consecutive chunks of the same stream', () => {
    expect(
      tailSegments(
        [
          { stream: 'stdout', text: 'Name? ' },
          { stream: 'stdin', text: 'Sam\n' },
          { stream: 'stdout', text: 'Hi ' },
          { stream: 'stdout', text: 'Sam\n' },
          { stream: 'stderr', text: '' },
        ],
        100,
      ),
    ).toEqual({
      segments: [
        { stream: 'stdout', text: 'Name? ', key: 0 },
        { stream: 'stdin', text: 'Sam\n', key: 1 },
        { stream: 'stdout', text: 'Hi Sam\n', key: 2 },
      ],
      hidden: false,
    });
  });

  it('keeps only the last segments of a long transcript, with stable keys', () => {
    const output: OutputChunk[] = [];
    for (let i = 0; i < 100_000; i++) output.push({ stream: i % 2 ? 'stderr' : 'stdout', text: `${i}\n` });
    const started = performance.now();
    const { segments, hidden } = tailSegments(output, 2000);
    expect(performance.now() - started).toBeLessThan(100);
    expect(hidden).toBe(true);
    expect(segments).toHaveLength(2000);
    expect(segments[0]).toEqual({ stream: 'stdout', text: '98000\n', key: 98_000 });
    expect(segments[1999]).toEqual({ stream: 'stderr', text: '99999\n', key: 99_999 });

    // A segment at the edge of the window is never cut in half.
    const edge = tailSegments(
      [
        { stream: 'stdout', text: 'a' },
        { stream: 'stdout', text: 'b' },
        { stream: 'stderr', text: 'c' },
      ],
      2,
    );
    expect(edge).toEqual({
      segments: [
        { stream: 'stdout', text: 'ab', key: 0 },
        { stream: 'stderr', text: 'c', key: 2 },
      ],
      hidden: false,
    });
    expect(tailSegments(edge.segments, 1)).toEqual({ segments: [{ stream: 'stderr', text: 'c', key: 1 }], hidden: true });
  });

  it('describes runtime downloads from the language catalog', () => {
    expect(loadingMessage('python')).toBe('Starting Python… the first run downloads about 10 MB');
    expect(loadingMessage('pseudocode')).toBe('Starting Pseudocode…');
  });

  it('names and summarizes tests', () => {
    expect(testName(test('a'), 0)).toBe('Test 1');
    expect(testName(test('a', ' Adds up '), 0)).toBe('Adds up');
    const tests = [test('a'), test('b'), test('c')];
    expect(summarizeTests(tests, null)).toBeNull();
    expect(summarizeTests(tests, [{ testId: 'zz', passed: true, actualOutput: '', error: null, durationMs: 1 }])).toBeNull();
    expect(
      summarizeTests(tests, [
        { testId: 'a', passed: true, actualOutput: '', error: null, durationMs: 1 },
        { testId: 'b', passed: false, actualOutput: '', error: null, durationMs: 1 },
      ]),
    ).toEqual({ passed: 1, total: 3, ran: 2 });
  });

  it('colors the Tests badge only once results are complete or a test failed', () => {
    expect(testsBadgeColor(null)).toBe('gray');
    expect(testsBadgeColor({ passed: 3, total: 3, ran: 3 })).toBe('teal');
    expect(testsBadgeColor({ passed: 1, total: 3, ran: 2 })).toBe('red');
    // Stopped part-way with no failures so far: not a pass yet.
    expect(testsBadgeColor({ passed: 1, total: 3, ran: 1 })).toBe('gray');
  });

  it('fits a row by stepping to more compact levels and back', () => {
    const natural: (number | undefined)[] = [];
    // Overflowing at level 0 → level 1 (the caller remembers that level 0 needed 700px).
    expect(nextFitLevel(0, 2, 600, 700, natural)).toBe(1);
    natural[0] = 700;
    // Fits at level 1, but not enough room for level 0 yet.
    expect(nextFitLevel(1, 2, 600, 560, natural)).toBe(1);
    expect(nextFitLevel(1, 2, 690, 560, natural)).toBe(1);
    // Room again → back to level 0.
    expect(nextFitLevel(1, 2, 700, 560, natural)).toBe(0);
    // The last level never steps further, however narrow.
    expect(nextFitLevel(2, 2, 100, 400, natural)).toBe(2);
    expect(nextFitLevel(0, 2, 700, 700, natural)).toBe(0);
  });

  it('reads a remembered side tab and falls back when the panel no longer has it', () => {
    expect(parseSideTab('solution')).toBe('solution');
    expect(parseSideTab('words')).toBe('words');
    expect(parseSideTab('answers')).toBeNull();
    expect(parseSideTab(3)).toBeNull();
    expect(parseSideTab(null)).toBeNull();

    expect(resolveSideTab('solution', ['instructions', 'tests', 'solution'])).toBe('solution');
    // The solution was taken away (or isn't released to this student): show the first tab instead.
    expect(resolveSideTab('solution', ['instructions', 'tests'])).toBe('instructions');
    expect(resolveSideTab(null, ['tests', 'solution'])).toBe('tests');
    expect(resolveSideTab('solution', [])).toBeNull();
  });

  it('shows the solution code, else the note about when it will be available', () => {
    expect(solutionContent('print(1)\n', null)).toEqual({ code: 'print(1)\n' });
    // Code wins over a note.
    expect(solutionContent('print(1)', 'Later')).toEqual({ code: 'print(1)' });
    expect(solutionContent('', ' After the due date. ')).toEqual({ note: 'After the due date.' });
    expect(solutionContent(null, "Your teacher's solution will appear here once your work is graded.")).toEqual({
      note: "Your teacher's solution will appear here once your work is graded.",
    });
    // Blank code and no note: no Solution tab at all.
    expect(solutionContent('  \n', null)).toBeNull();
    expect(solutionContent(undefined, '   ')).toBeNull();
    expect(solutionContent(null, undefined)).toBeNull();
  });

  it('sends a line on Enter and ends input on Ctrl+D', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing', boolean>> = {}) =>
      consoleInputKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods });
    expect(key('Enter')).toBe('submit');
    expect(key('Enter', { isComposing: true })).toBeNull();
    expect(key('d', { ctrlKey: true })).toBe('end');
    expect(key('D', { ctrlKey: true })).toBe('end');
    expect(key('d')).toBeNull();
    expect(key('d', { metaKey: true })).toBeNull();
    expect(key('d', { ctrlKey: true, shiftKey: true })).toBeNull();
  });
});
