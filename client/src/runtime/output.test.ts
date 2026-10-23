import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './output';
import type { OutputTailSink } from './outputTail';
import { OUTPUT_BURST, OUTPUT_LIMIT_MESSAGE } from './protocol';
import type { OutputChunk } from './types';

function setup({ maxChars = 1000, burst = 1, tail = null }: { maxChars?: number; burst?: number; tail?: OutputTailSink | null } = {}) {
  let time = 0;
  const sent: OutputChunk[][] = [];
  const batches: number[] = [];
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const buffer = new OutputBuffer({
    send: (chunks, batch) => {
      sent.push(chunks);
      batches.push(batch);
    },
    tail,
    intervalMs: 30,
    burst,
    maxChars,
    now: () => time,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    cancel: () => {},
  });
  return {
    buffer,
    sent,
    batches,
    scheduled,
    advance: (ms: number) => {
      time += ms;
    },
    runTimers: () => scheduled.splice(0).forEach(({ fn }) => fn()),
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
    const { buffer, sent } = setup({ maxChars: 10 });
    buffer.write('stdout', '12345');
    buffer.write('stdout', '67890abc');
    buffer.write('stdout', 'more');
    const all = sent.flat();
    expect(all.filter((c) => c.stream === 'stdout').map((c) => c.text).join('')).toBe('1234567890');
    expect(all.filter((c) => c.stream === 'system')).toEqual([{ stream: 'system', text: `\n${OUTPUT_LIMIT_MESSAGE}\n` }]);
    expect(buffer.limitReached).toBe(true);
  });

  it('does not add a blank line before the limit message when output ended with a newline', () => {
    const { buffer, sent } = setup({ maxChars: 4 });
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

describe('OutputBuffer without a chance to yield', () => {
  it('sends the last lines before a long computation straight away', () => {
    // A synchronous program prints two lines and then never yields: no timer can fire.
    const { buffer, sent } = setup({ burst: OUTPUT_BURST });
    buffer.write('stdout', 'first\n');
    buffer.write('stdout', 'second\n');
    expect(sent.flat().map((c) => c.text).join('')).toBe('first\nsecond\n');
  });

  it('holds back a flood once the burst is used up and sends it with the next write after the interval', () => {
    const { buffer, sent, batches, scheduled, advance } = setup({ burst: 3 });
    for (let i = 0; i < 10; i++) buffer.write('stdout', `${i}\n`);
    expect(sent).toHaveLength(3);
    // Held for the end of the interval (fires only for code that yields).
    expect(scheduled.map((s) => s.ms)).toEqual([30]);
    advance(30);
    buffer.write('stdout', 'next\n');
    expect(sent).toHaveLength(4);
    expect(sent[3]).toEqual([{ stream: 'stdout', text: '3\n4\n5\n6\n7\n8\n9\nnext\n' }]);
    expect(batches).toEqual([1, 2, 3, 4]);
  });

  it('mirrors every write into the tail with the batch it goes out in', () => {
    const events: string[] = [];
    const tail: OutputTailSink = {
      record: (batch, stream, text) => events.push(`record ${batch} ${stream} ${JSON.stringify(text)}`),
    };
    const { buffer, batches } = setup({ burst: 1, tail });
    buffer.write('stdout', 'a\n');
    buffer.write('stderr', 'b\n');
    buffer.write('stderr', 'c\n');
    buffer.flush();
    expect(events).toEqual(['record 1 stdout "a\\n"', 'record 2 stderr "b\\n"', 'record 2 stderr "c\\n"']);
    expect(batches).toEqual([1, 2]);
  });

  it('forgets the prompt once a typed answer was taken', () => {
    const { buffer } = setup();
    buffer.write('stdout', 'Name? ');
    expect(buffer.pendingPrompt).toBe('Name? ');
    buffer.markInputConsumed();
    buffer.write('stdout', 'Age? ');
    expect(buffer.pendingPrompt).toBe('Age? ');
  });
});
