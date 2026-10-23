import type { TestCase } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { formatDuration, loadingMessage, mergeChunks, summarizeTests, testName } from './ideUtils';

const test = (id: string, name = ''): TestCase => ({ id, name, input: '', expectedOutput: '', hidden: false, points: 1 });

describe('ideUtils', () => {
  it('formats run durations', () => {
    expect(formatDuration(240)).toBe('0.24 s');
    expect(formatDuration(12_345)).toBe('12.3 s');
    expect(formatDuration(-5)).toBe('0.00 s');
  });

  it('merges consecutive chunks of the same stream', () => {
    expect(
      mergeChunks([
        { stream: 'stdout', text: 'Name? ' },
        { stream: 'stdin', text: 'Sam\n' },
        { stream: 'stdout', text: 'Hi ' },
        { stream: 'stdout', text: 'Sam\n' },
        { stream: 'stderr', text: '' },
      ]),
    ).toEqual([
      { stream: 'stdout', text: 'Name? ' },
      { stream: 'stdin', text: 'Sam\n' },
      { stream: 'stdout', text: 'Hi Sam\n' },
    ]);
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
});
