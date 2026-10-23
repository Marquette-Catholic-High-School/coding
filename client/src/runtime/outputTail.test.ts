import { describe, expect, it } from 'vitest';
import { OutputBuffer } from './output';
import { acknowledgeOutput, createOutputTail, OutputTailWriter, readOutputTail, resetOutputTail } from './outputTail';
import type { OutputChunk } from './types';

/** A worker-side buffer that never gets to send on its own (burst 1, no timers), mirrored into a tail. */
function setup(capacity = 1024) {
  const tail = createOutputTail(capacity);
  resetOutputTail(tail);
  const sent: { batch: number; chunks: OutputChunk[] }[] = [];
  let time = 0;
  const buffer = new OutputBuffer({
    send: (chunks, batch) => sent.push({ batch, chunks }),
    tail: new OutputTailWriter(tail),
    burst: 1,
    now: () => time,
    schedule: () => 0,
    cancel: () => {},
  });
  return {
    tail,
    sent,
    buffer,
    nextInterval: () => {
      time += 1000;
    },
  };
}

describe('output tail', () => {
  it('holds the output a stuck worker could not send', () => {
    const { tail, sent, buffer } = setup();
    buffer.write('stdout', 'first\n');
    expect(sent).toHaveLength(1);
    acknowledgeOutput(tail, 1);
    buffer.write('stdout', 'second\n');
    buffer.write('stderr', 'oops\n');
    buffer.write('stdout', 'third\n');
    // The main thread received batch 1 only.
    expect(readOutputTail(tail, 1)).toEqual([
      { stream: 'stdout', text: 'second\n' },
      { stream: 'stderr', text: 'oops\n' },
      { stream: 'stdout', text: 'third\n' },
    ]);
  });

  it('keeps batches that were sent but not received yet, and drops them once acknowledged', () => {
    const { tail, sent, buffer, nextInterval } = setup();
    buffer.write('stdout', 'a\n');
    nextInterval();
    buffer.write('stdout', 'b\n');
    expect(sent.map((s) => s.batch)).toEqual([1, 2]);
    // Nothing acknowledged: a Stop now must still show both (their messages are dropped with the worker).
    expect(readOutputTail(tail, 0)).toEqual([{ stream: 'stdout', text: 'a\nb\n' }]);
    // Batch 1 arrived meanwhile: only batch 2 is missing.
    expect(readOutputTail(tail, 1)).toEqual([{ stream: 'stdout', text: 'b\n' }]);
    acknowledgeOutput(tail, 2);
    nextInterval();
    buffer.write('stdout', 'c\n');
    buffer.write('stdout', 'd\n');
    // Batches 1 and 2 are gone; 'c' went out as batch 3 (still in flight), 'd' is held back.
    expect(readOutputTail(tail, 2)).toEqual([{ stream: 'stdout', text: 'c\nd\n' }]);
    expect(readOutputTail(tail, 3)).toEqual([{ stream: 'stdout', text: 'd\n' }]);
  });

  it('starts over at the front once everything sent was received, so it never fills up in a long run', () => {
    const { tail, buffer, sent, nextInterval } = setup(64);
    for (let i = 0; i < 200; i++) {
      nextInterval();
      buffer.write('stdout', `line ${i}\n`);
      acknowledgeOutput(tail, sent[sent.length - 1]!.batch);
    }
    buffer.write('stdout', 'held\n');
    expect(readOutputTail(tail, sent[sent.length - 1]!.batch)).toEqual([{ stream: 'stdout', text: 'held\n' }]);
  });

  it('keeps a gapless prefix when the output does not fit', () => {
    const { tail, buffer } = setup(32);
    buffer.write('stdout', 'kept\n');
    buffer.write('stdout', 'x'.repeat(40));
    buffer.write('stdout', 'after\n');
    expect(readOutputTail(tail, 0)).toEqual([{ stream: 'stdout', text: 'kept\n' }]);
  });

  it('keeps any text exactly, including surrogate pairs', () => {
    const { tail, buffer } = setup();
    buffer.write('stdout', 'é 😀 中\n');
    expect(readOutputTail(tail, 0)).toEqual([{ stream: 'stdout', text: 'é 😀 中\n' }]);
  });

  it('is empty after a reset for the next run', () => {
    const { tail, buffer } = setup();
    buffer.write('stdout', 'old run\n');
    resetOutputTail(tail);
    expect(readOutputTail(tail, 0)).toEqual([]);
  });
});
