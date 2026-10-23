import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './output';
import { createOutputTail, OUTPUT_TAIL_CAPACITY, OutputTailReader, OutputTailWriter, resetOutputTail } from './outputTail';
import { MAX_OUTPUT_CHARS } from './protocol';
import type { OutputChunk, OutputStream } from './types';

/**
 * A worker-side output buffer mirrored into a tail, and the page's side of it. Messages the worker posts wait in
 * `inFlight` until `deliver` hands them to the page, as when the page lags behind a flood. Time only moves on
 * `nextWindow`, so with `burst` 1 every write after the first in a window is held back.
 */
function setup({ capacity = 1024, burst = 1 }: { capacity?: number; burst?: number } = {}) {
  const tail = createOutputTail(capacity);
  resetOutputTail(tail);
  const inFlight: { batch: number; chunks: OutputChunk[] }[] = [];
  const written: OutputChunk[] = [];
  const shown: OutputChunk[] = [];
  let time = 0;
  const buffer = new OutputBuffer({
    send: (chunks, batch) => inFlight.push({ batch, chunks: chunks.map((c) => ({ ...c })) }),
    tail: new OutputTailWriter(tail),
    burst,
    intervalMs: 30,
    now: () => time,
    schedule: () => 0,
    cancel: () => {},
  });
  const reader = new OutputTailReader(tail);
  return {
    tail,
    inFlight,
    reader,
    write(stream: OutputStream, text: string) {
      written.push({ stream, text });
      buffer.write(stream, text);
    },
    nextWindow() {
      time += 30;
    },
    /** The page receives the oldest `count` messages in flight (all by default). */
    deliver(count = inFlight.length) {
      for (const { batch, chunks } of inFlight.splice(0, count)) shown.push(...reader.receive(batch, chunks));
    },
    /** The page reads the tail (its poll while the program runs, or Stop/timeout before terminating the worker). */
    read() {
      const chunks = reader.read();
      shown.push(...chunks);
      return chunks;
    },
    shown: () => flatten(shown),
    written: () => flatten(written),
  };
}

/** Output as one string that keeps the stream of every character, so streams and order are both compared. */
function flatten(chunks: readonly OutputChunk[]): string {
  return chunks.map((c) => [...c.text].map((ch) => `${c.stream[0]}${ch}`).join('')).join('');
}

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('output tail', () => {
  it('holds the output a stuck worker could not send', () => {
    const t = setup();
    t.write('stdout', 'first\n');
    t.deliver();
    t.write('stdout', 'second\n');
    t.write('stderr', 'oops\n');
    t.write('stdout', 'third\n');
    expect(t.inFlight).toHaveLength(0);
    expect(t.read()).toEqual([
      { stream: 'stdout', text: 'second\n' },
      { stream: 'stderr', text: 'oops\n' },
      { stream: 'stdout', text: 'third\n' },
    ]);
    expect(t.shown()).toBe(t.written());
  });

  it('holds batches that were sent but have not arrived (their messages are lost with the worker)', () => {
    const t = setup();
    t.write('stdout', 'a\n');
    t.nextWindow();
    t.write('stdout', 'b\n');
    t.write('stdout', 'c\n');
    expect(t.inFlight.map((m) => m.batch)).toEqual([1, 2]);
    t.deliver(1);
    // Stop now: batch 2 never arrives, and 'c' was never sent.
    expect(t.read()).toEqual([{ stream: 'stdout', text: 'b\nc\n' }]);
    expect(t.shown()).toBe(t.written());
  });

  it('shows held output once: a batch that arrives after a read leaves out what the read showed', () => {
    const t = setup();
    t.write('stdout', '1\n');
    t.write('stdout', '2\n');
    t.write('stderr', '3\n');
    // The page polls while the program is busy: batch 1 is still in flight, '2' and '3' are held back.
    expect(t.read()).toEqual([
      { stream: 'stdout', text: '1\n2\n' },
      { stream: 'stderr', text: '3\n' },
    ]);
    expect(t.read()).toEqual([]);
    t.write('stderr', '4\n');
    t.nextWindow();
    t.write('stdout', '5\n');
    t.deliver();
    t.write('stdout', '6\n');
    expect(t.read()).toEqual([{ stream: 'stdout', text: '6\n' }]);
    expect(t.shown()).toBe(t.written());
  });

  it('keeps recording through a flood larger than the tail while the page lags, so Stop shows the last lines', () => {
    // The page always receives a batch only after the next one has started, so the worker never sees everything
    // it sent acknowledged. The tail must drop what arrived instead of filling up with it.
    const t = setup({ capacity: 400, burst: 20 });
    for (let i = 0; i < 5000; i++) {
      if (i % 50 === 0) t.nextWindow();
      t.write('stdout', `${i}\n`);
      if (t.inFlight.length > 1) t.deliver(t.inFlight.length - 1);
    }
    t.write('stdout', 'DONE\n');
    // The program hangs; the user presses Stop.
    t.read();
    expect(t.shown()).toBe(t.written());
    expect(t.shown().endsWith('s4s9s9s9s\nsDsOsNsEs\n')).toBe(true);
  });

  it('shows the whole output cap when the page received none of it', () => {
    const t = setup({ capacity: OUTPUT_TAIL_CAPACITY, burst: 20 });
    const line = `${'x'.repeat(99)}\n`;
    for (let i = 0; i < MAX_OUTPUT_CHARS / line.length; i++) {
      if (i % 1000 === 0) t.nextWindow();
      t.write(i % 2 === 0 ? 'stdout' : 'stderr', line);
    }
    t.read();
    expect(t.shown()).toBe(t.written());
  });

  it('stores many small writes of one batch to one stream in one record', () => {
    // Room for one record header and 1000 characters.
    const t = setup({ capacity: 5 + 1000 });
    t.write('stdout', 'go\n');
    t.deliver();
    for (let i = 0; i < 1000; i++) t.write('stdout', '.');
    t.read();
    expect(t.shown()).toBe(t.written());
  });

  it('keeps a gapless prefix while the output does not fit, and records again once the page caught up', () => {
    const t = setup({ capacity: 32 });
    t.write('stdout', 'kept\n');
    t.write('stdout', 'x'.repeat(40));
    t.write('stdout', 'after\n');
    expect(t.read()).toEqual([{ stream: 'stdout', text: 'kept\n' }]);
    // The batch that did not fit is sent and arrives; later output is recorded again.
    t.nextWindow();
    t.write('stdout', 'next\n');
    t.deliver();
    t.write('stdout', 'last\n');
    expect(t.read()).toEqual([{ stream: 'stdout', text: 'last\n' }]);
    expect(t.shown()).toBe(t.written());
  });

  it('keeps any text exactly, including surrogate pairs', () => {
    const t = setup();
    t.write('stdout', 'é 😀 中\n');
    t.write('stdout', '😀');
    expect(t.read()).toEqual([{ stream: 'stdout', text: 'é 😀 中\n😀' }]);
  });

  it('shows every piece of output exactly once, in order, whatever the timing', () => {
    const texts = ['a', 'bc\n', '😀\n', `${'long line '.repeat(20)}\n`, '', '\n', 'é'];
    const streams: OutputStream[] = ['stdout', 'stdout', 'stdout', 'stderr', 'stdin'];
    for (let seed = 1; seed <= 40; seed++) {
      const rand = random(seed);
      const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;
      // A tail with room for everything must show all of it; a small one a gapless prefix of it.
      for (const capacity of [100_000, 300]) {
        const t = setup({ capacity, burst: 1 + Math.floor(rand() * 4) });
        for (let step = 0; step < 300; step++) {
          const r = rand();
          if (r < 0.6) t.write(pick(streams), pick(texts));
          else if (r < 0.7) t.nextWindow();
          else if (r < 0.9) t.deliver(Math.floor(rand() * (t.inFlight.length + 1)));
          else t.read();
        }
        // Stop: the messages still in flight are lost with the worker; the tail has the rest.
        t.read();
        if (capacity === 100_000) expect(t.shown(), `seed ${seed}`).toBe(t.written());
        else expect(t.written().startsWith(t.shown()), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('is not read while the worker is changing it, and nothing is recorded while the page is reading it', () => {
    const t = setup();
    const lock = new Int32Array(t.tail, 0, 4);
    t.write('stdout', 'one\n');
    t.write('stdout', 'two\n');
    Atomics.store(lock, 0, 1); // the worker is in the middle of a write
    expect(t.read()).toEqual([]);
    Atomics.store(lock, 0, 0);
    expect(t.read()).toEqual([{ stream: 'stdout', text: 'one\ntwo\n' }]);
    Atomics.store(lock, 0, 2); // the page is copying the records
    t.write('stdout', 'three\n');
    Atomics.store(lock, 0, 0);
    t.write('stdout', 'four\n');
    // 'three' could not be recorded, so nothing after it is either (no gaps) until its batch arrived.
    expect(t.read()).toEqual([]);
    t.nextWindow();
    t.write('stdout', 'five\n');
    t.deliver();
    t.write('stdout', 'six\n');
    t.read();
    expect(t.shown()).toBe(t.written());
  });

  it('is empty after a reset for the next run', () => {
    const t = setup();
    t.write('stdout', 'old run\n');
    resetOutputTail(t.tail);
    expect(new OutputTailReader(t.tail).read()).toEqual([]);
  });
});

describe('output tail lock', () => {
  it('recovers a lock the worker left held (a stack overflow between lock and unlock) without stalling', () => {
    const tail = createOutputTail(1024);
    resetOutputTail(tail);
    const writer = new OutputTailWriter(tail);
    // Header slot 0 is the lock; 1 = held by the worker. Simulate a write interrupted before its unlock.
    Atomics.store(new Int32Array(tail, 0, 1), 0, 1);
    const started = performance.now();
    for (let i = 0; i < 20; i++) writer.record(1, 'stdout', `line ${i}\n`);
    // Each write would otherwise wait 100 ms for the stale lock.
    expect(performance.now() - started).toBeLessThan(500);
    expect(Atomics.load(new Int32Array(tail, 0, 1), 0)).toBe(0);
    const reader = new OutputTailReader(tail);
    expect(reader.read().map((c) => c.text).join('')).toContain('line 19');
  });
});
