// Output a worker has buffered but not sent yet, mirrored into shared memory. A synchronous program stuck in a loop
// never yields, so its worker cannot post what it buffered; when the main thread stops or times out such a run it
// reads the tail here before terminating the worker, so the last lines printed before the hang still show.
//
// Layout: Int32 [0] = generation (bumped whenever the records start over at the front), [1] = length of the records
// in UTF-16 code units, [2] = the last output batch the main thread received, [3] unused; then Uint16 records:
// batch (2 units), stream, text length (2 units), text. Within a generation the worker only appends, and it starts
// over once the main thread has received every batch it sent, so the records always cover the output the main
// thread has not received yet (unless they fill the tail; then the newest part is missing).

import type { OutputChunk, OutputStream } from './types';

const HEADER_BYTES = 16;
const GENERATION = 0;
const LENGTH = 1;
const RECEIVED = 2;
const RECORD_HEADER = 5;
/** Room for unsent output in UTF-16 code units (output is sent at least every ~30 ms while a program yields). */
export const OUTPUT_TAIL_CAPACITY = 128 * 1024;
const STREAMS: readonly OutputStream[] = ['stdout', 'stderr', 'stdin', 'system'];

export function createOutputTail(capacity: number = OUTPUT_TAIL_CAPACITY): SharedArrayBuffer {
  return new SharedArrayBuffer(HEADER_BYTES + capacity * 2);
}

function header(tail: SharedArrayBuffer): Int32Array {
  return new Int32Array(tail, 0, HEADER_BYTES / 4);
}

function records(tail: SharedArrayBuffer): Uint16Array {
  return new Uint16Array(tail, HEADER_BYTES);
}

/** Main thread, before a run starts in the worker: no records, nothing received. */
export function resetOutputTail(tail: SharedArrayBuffer): void {
  const h = header(tail);
  Atomics.store(h, LENGTH, 0);
  Atomics.store(h, RECEIVED, 0);
  Atomics.add(h, GENERATION, 1);
}

/** Main thread: output batches up to `batch` have arrived, so the worker may drop them. */
export function acknowledgeOutput(tail: SharedArrayBuffer, batch: number): void {
  Atomics.store(header(tail), RECEIVED, batch);
}

function decode(units: Uint16Array): string {
  let text = '';
  for (let i = 0; i < units.length; i += 8192) {
    text += String.fromCharCode(...units.subarray(i, i + 8192));
  }
  return text;
}

function parseRecords(data: Uint16Array, received: number): OutputChunk[] {
  const chunks: OutputChunk[] = [];
  let pos = 0;
  while (pos + RECORD_HEADER <= data.length) {
    const batch = data[pos]! + data[pos + 1]! * 0x10000;
    const stream = STREAMS[data[pos + 2]!];
    const start = pos + RECORD_HEADER;
    const end = start + data[pos + 3]! + data[pos + 4]! * 0x10000;
    if (!stream || end > data.length) break;
    if (batch > received && end > start) {
      const text = decode(data.subarray(start, end));
      const last = chunks[chunks.length - 1];
      if (last && last.stream === stream) last.text += text;
      else chunks.push({ stream, text });
    }
    pos = end;
  }
  return chunks;
}

/**
 * Main thread: the output of batches after `received`, merged by stream. Safe while the worker is still running;
 * returns nothing if the records keep changing under the reader.
 */
export function readOutputTail(tail: SharedArrayBuffer, received: number): OutputChunk[] {
  const h = header(tail);
  const data = records(tail);
  for (let attempt = 0; attempt < 10; attempt++) {
    const generation = Atomics.load(h, GENERATION);
    const length = Math.min(Atomics.load(h, LENGTH), data.length);
    // slice() copies into ordinary memory, so the worker cannot change what is parsed.
    const copy = data.slice(0, length);
    if (Atomics.load(h, GENERATION) === generation) return parseRecords(copy, received);
  }
  return [];
}

/** What the worker's output buffer reports to the tail. */
export interface OutputTailSink {
  /** `text` was added to output batch `batch` (not sent yet). */
  record(batch: number, stream: OutputStream, text: string): void;
  /** Output batch `batch` was posted to the main thread. */
  sent(batch: number): void;
}

/** Worker side of the tail. */
export class OutputTailWriter implements OutputTailSink {
  private readonly header: Int32Array;
  private readonly data: Uint16Array;
  private length = 0;
  private sentBatch = 0;
  private currentBatch = 0;
  private full = false;

  constructor(tail: SharedArrayBuffer) {
    this.header = header(tail);
    this.data = records(tail);
  }

  record(batch: number, stream: OutputStream, text: string): void {
    if (batch !== this.currentBatch) {
      this.currentBatch = batch;
      // Every earlier batch has been sent: start over once the main thread has received all of them.
      if (this.length > 0 && Atomics.load(this.header, RECEIVED) >= this.sentBatch) this.clear();
    }
    if (this.full) return;
    const size = RECORD_HEADER + text.length;
    if (this.length + size > this.data.length) {
      // Keep what fits so the records stay a gapless prefix of the unsent output.
      this.full = true;
      return;
    }
    const data = this.data;
    let pos = this.length;
    data[pos++] = batch & 0xffff;
    data[pos++] = batch >>> 16;
    data[pos++] = STREAMS.indexOf(stream);
    data[pos++] = text.length & 0xffff;
    data[pos++] = text.length >>> 16;
    for (let i = 0; i < text.length; i++) data[pos++] = text.charCodeAt(i);
    this.length = pos;
    Atomics.store(this.header, LENGTH, pos);
  }

  sent(batch: number): void {
    this.sentBatch = batch;
  }

  private clear(): void {
    this.length = 0;
    this.full = false;
    // Length first: a reader that sees the old generation then reads an empty tail, never half-overwritten records.
    Atomics.store(this.header, LENGTH, 0);
    Atomics.add(this.header, GENERATION, 1);
  }
}
