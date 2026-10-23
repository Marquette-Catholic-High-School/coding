import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './output';
import { OUTPUT_LIMIT_MESSAGE } from './protocol';
import type { OutputChunk } from './types';

function setup(maxChars = 1000) {
  let time = 0;
  const sent: OutputChunk[][] = [];
  const scheduled: Array<() => void> = [];
  const buffer = new OutputBuffer({
    send: (chunks) => sent.push(chunks),
    intervalMs: 30,
    maxChars,
    now: () => time,
    schedule: (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    cancel: () => {},
  });
  return {
    buffer,
    sent,
    advance: (ms: number) => {
      time += ms;
    },
    runTimers: () => scheduled.splice(0).forEach((fn) => fn()),
  };
}

describe('OutputBuffer', () => {
  it('sends the first write immediately and batches writes within the interval', () => {
    const { buffer, sent, advance } = setup();
    buffer.write('stdout', 'a\n');
    expect(sent).toEqual([[{ stream: 'stdout', text: 'a\n' }]]);
    advance(10);
    buffer.write('stdout', 'b\n');
    buffer.write('stdout', 'c\n');
    buffer.write('stderr', 'oops\n');
    expect(sent).toHaveLength(1);
    advance(30);
    buffer.write('stdout', 'd\n');
    expect(sent[1]).toEqual([
      { stream: 'stdout', text: 'b\nc\n' },
      { stream: 'stderr', text: 'oops\n' },
      { stream: 'stdout', text: 'd\n' },
    ]);
  });

  it('flushes leftover output from the timer when the program goes quiet', () => {
    const { buffer, sent, advance, runTimers } = setup();
    buffer.write('stdout', 'first');
    advance(5);
    buffer.write('stdout', ' second');
    expect(sent).toHaveLength(1);
    runTimers();
    expect(sent[1]).toEqual([{ stream: 'stdout', text: ' second' }]);
  });

  it('tracks the unfinished stdout line as the prompt', () => {
    const { buffer } = setup();
    buffer.write('stdout', 'Hello\nWhat is your ');
    buffer.write('stdout', 'name? ');
    expect(buffer.pendingPrompt).toBe('What is your name? ');
    buffer.echoInput('Sam');
    expect(buffer.pendingPrompt).toBe('');
    buffer.write('stderr', 'warning');
    expect(buffer.pendingPrompt).toBe('');
  });

  it('cuts output at the limit and adds one system line', () => {
    const { buffer, sent } = setup(10);
    buffer.write('stdout', '12345');
    buffer.write('stdout', '67890abc');
    buffer.write('stdout', 'more');
    const all = sent.flat();
    expect(all.filter((c) => c.stream === 'stdout').map((c) => c.text).join('')).toBe('1234567890');
    expect(all.filter((c) => c.stream === 'system')).toEqual([{ stream: 'system', text: `\n${OUTPUT_LIMIT_MESSAGE}\n` }]);
    expect(buffer.limitReached).toBe(true);
  });

  it('does not add a blank line before the limit message when output ended with a newline', () => {
    const { buffer, sent } = setup(4);
    buffer.write('stdout', 'abc\n');
    buffer.write('stdout', 'x');
    expect(sent.flat().find((c) => c.stream === 'system')?.text).toBe(`${OUTPUT_LIMIT_MESSAGE}\n`);
  });

  it('ignores empty writes and sends nothing when there is nothing to flush', () => {
    const { buffer, sent } = setup();
    buffer.write('stdout', '');
    buffer.flush();
    expect(sent).toEqual([]);
  });
});
