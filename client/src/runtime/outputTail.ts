// Output the page has not received from a worker yet, mirrored into shared memory. Language runtimes often run
// synchronously and never yield, and a worker holds output back during a flood (output.ts), so a program busy in a
// long computation or stuck in an endless loop may never post the last lines it printed. The page reads them from
// here instead: while the program runs (every OUTPUT_TAIL_POLL_MS) and when it stops or times out a run, just before
// terminating the worker. Every write goes into both the worker's next message and the tail; the page remembers how
// much of each batch it already showed from the tail, so no output is shown twice.
//
// Layout: Int32 header [0] = lock (who is changing or copying the records), [1] = length of the records in UTF-16
// code units, [2] = the last output batch the page received, [3] = version (bumped whenever output is added); then
// Uint16 records in output order: batch (2 units), stream, text length (2 units), text. Writes of one batch to one
// stream share a record. The worker drops the records of batches the page has received, so the records always hold
// a gapless prefix of the output the page has not received yet. The tail has room for the whole output cap, so that
// prefix is all of it unless the output switches streams or batches tens of thousands of times; then the newest part
// is missing until the page catches up.

import { MAX_OUTPUT_CHARS } from './protocol';
import type { OutputChunk, OutputStream } from './types';

const LOCK = 0;
const LENGTH = 1;
const RECEIVED = 2;
const VERSION = 3;
const HEADER_BYTES = 16;
const FREE = 0;
const WORKER = 1;
const PAGE = 2;
/** The lock is only ever held to copy one write or to move the records, which takes a moment. */
const LOCK_WAIT_MS = 100;
const RECORD_HEADER = 5;
/** Room in UTF-16 code units: the whole output cap plus record headers. */
export const OUTPUT_TAIL_CAPACITY = MAX_OUTPUT_CHARS + 128 * 1024;
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

/** Takes the lock for `owner`; false if it stayed taken for LOCK_WAIT_MS. */
function lock(h: Int32Array, owner: number): boolean {
  if (Atomics.compareExchange(h, LOCK, FREE, owner) === FREE) return true;
  const deadline = performance.now() + LOCK_WAIT_MS;
  while (Atomics.compareExchange(h, LOCK, FREE, owner) !== FREE) {
    if (performance.now() > deadline) return false;
  }
  return true;
}

function unlock(h: Int32Array): void {
  Atomics.store(h, LOCK, FREE);
}

/** Page, before a run starts in the worker (the worker is idle): no records, nothing received. */
export function resetOutputTail(tail: SharedArrayBuffer): void {
  const h = header(tail);
  Atomics.store(h, LENGTH, 0);
  Atomics.store(h, RECEIVED, 0);
  Atomics.store(h, VERSION, 0);
  Atomics.store(h, LOCK, FREE);
}

function decode(units: Uint16Array): string {
  let text = '';
  for (let i = 0; i < units.length; i += 8192) {
    text += String.fromCharCode(...units.subarray(i, i + 8192));
  }
  return text;
}

function pushChunk(chunks: OutputChunk[], stream: OutputStream, text: string): void {
  if (!text) return;
  const last = chunks[chunks.length - 1];
  if (last && last.stream === stream) last.text += text;
  else chunks.push({ stream, text });
}

/** What the worker's output buffer reports to the tail. */
export interface OutputTailSink {
  /** `text` was added to output batch `batch` (not sent yet). */
  record(batch: number, stream: OutputStream, text: string): void;
}

/** Worker side of the tail. */
export class OutputTailWriter implements OutputTailSink {
  private readonly header: Int32Array;
  private readonly data: Uint16Array;
  private length = 0;
  /** Where each batch's records start, oldest first. */
  private readonly batches: { batch: number; start: number }[] = [];
  /** Start of the last record (-1: no records) and its stream. */
  private lastRecord = -1;
  private lastStream: OutputStream | null = null;
  /** The received batch the records were last checked against. */
  private checkedReceived = 0;
  /**
   * A write to this batch did not fit (0: none). Nothing is recorded until the page has received this batch, so the
   * records stay a gapless prefix of the output the page has not received.
   */
  private lostBatch = 0;

  constructor(tail: SharedArrayBuffer) {
    this.header = header(tail);
    this.data = records(tail);
  }

  record(batch: number, stream: OutputStream, text: string): void {
    if (!text) return;
    // This writer is the worker's only one and never runs twice at once, so a lock already held by WORKER is stale:
    // a stack overflow (a program recursing forever while printing) can strike between lock() and unlock(). Release
    // it, or every later write would wait LOCK_WAIT_MS for a lock nobody will free.
    Atomics.compareExchange(this.header, LOCK, WORKER, FREE);
    if (!lock(this.header, WORKER)) {
      this.lostBatch = batch;
      return;
    }
    try {
      this.add(batch, stream, text);
    } finally {
      unlock(this.header);
    }
  }

  private add(batch: number, stream: OutputStream, text: string): void {
    const received = Atomics.load(this.header, RECEIVED);
    if (this.lostBatch !== 0) {
      if (received < this.lostBatch) {
        this.lostBatch = batch;
        return;
      }
      // Every batch that lost a write has arrived: start over with this write.
      this.lostBatch = 0;
      this.dropReceived(received, true);
    }
    const extend = this.lastRecord >= 0 && this.lastStream === stream && this.batches[this.batches.length - 1]!.batch === batch;
    const size = extend ? text.length : RECORD_HEADER + text.length;
    const fits = this.length + size <= this.data.length;
    if (received !== this.checkedReceived || !fits) {
      this.checkedReceived = received;
      this.dropReceived(received, !fits);
    }
    if (this.length + size > this.data.length) {
      this.lostBatch = batch;
      return;
    }
    const data = this.data;
    let pos = this.length;
    if (extend) {
      // The last record belongs to this batch, which is never dropped before it is sent.
      const at = this.lastRecord;
      const total = data[at + 3]! + data[at + 4]! * 0x10000 + text.length;
      data[at + 3] = total & 0xffff;
      data[at + 4] = total >>> 16;
    } else {
      if (this.batches[this.batches.length - 1]?.batch !== batch) this.batches.push({ batch, start: pos });
      this.lastRecord = pos;
      this.lastStream = stream;
      data[pos++] = batch & 0xffff;
      data[pos++] = batch >>> 16;
      data[pos++] = STREAMS.indexOf(stream);
      data[pos++] = text.length & 0xffff;
      data[pos++] = text.length >>> 16;
    }
    for (let i = 0; i < text.length; i++) data[pos++] = text.charCodeAt(i);
    this.length = pos;
    Atomics.store(this.header, LENGTH, pos);
    Atomics.add(this.header, VERSION, 1);
  }

  /**
   * Drops the records of batches the page has received: when they are at least half of the records (so moving the
   * rest never costs more than what was written since), or when `force`d because a write does not fit.
   */
  private dropReceived(received: number, force: boolean): void {
    let kept = 0;
    while (kept < this.batches.length && this.batches[kept]!.batch <= received) kept++;
    if (kept === 0) return;
    const from = kept < this.batches.length ? this.batches[kept]!.start : this.length;
    if (!force && from * 2 < this.length) return;
    this.data.copyWithin(0, from, this.length);
    this.length -= from;
    this.batches.splice(0, kept);
    for (const entry of this.batches) entry.start -= from;
    this.lastRecord = this.lastRecord >= from ? this.lastRecord - from : -1;
    Atomics.store(this.header, LENGTH, this.length);
  }
}

/** Removes the first `count` characters of `chunks`. */
function dropFront(chunks: readonly OutputChunk[], count: number): OutputChunk[] {
  const rest: OutputChunk[] = [];
  for (const chunk of chunks) {
    if (count >= chunk.text.length) {
      count -= chunk.text.length;
      continue;
    }
    rest.push({ stream: chunk.stream, text: chunk.text.slice(count) });
    count = 0;
  }
  return rest;
}

/**
 * Page side of a run's tail. Every output message goes through `receive`, which acknowledges it to the worker and
 * leaves out what `read` already showed from the tail; `read` returns output that has not arrived (or not been
 * shown) yet. Together they show every piece of output exactly once, in order.
 */
export class OutputTailReader {
  private readonly header: Int32Array;
  private readonly data: Uint16Array;
  /** Output was shown up to here: every batch before `batch`, and the first `chars` characters of `batch`. */
  private batch = 1;
  private chars = 0;
  /** Version of the records at the last read. */
  private version = -1;

  constructor(tail: SharedArrayBuffer) {
    this.header = header(tail);
    this.data = records(tail);
  }

  /** Output batch `batch` arrived (batches arrive in order): returns the part of it not shown from the tail yet. */
  receive(batch: number, chunks: readonly OutputChunk[]): OutputChunk[] {
    Atomics.store(this.header, RECEIVED, batch);
    if (batch < this.batch) return [];
    const shown = batch === this.batch ? this.chars : 0;
    this.batch = batch + 1;
    this.chars = 0;
    return dropFront(chunks, shown);
  }

  /** Output the worker wrote that has not been shown yet. Safe while the worker is still writing. */
  read(): OutputChunk[] {
    if (!lock(this.header, PAGE)) return [];
    let copy: Uint16Array;
    try {
      const version = Atomics.load(this.header, VERSION);
      if (version === this.version) return [];
      this.version = version;
      // slice() copies into ordinary memory, so the worker cannot change what is parsed.
      copy = this.data.slice(0, Math.min(Atomics.load(this.header, LENGTH), this.data.length));
    } finally {
      unlock(this.header);
    }
    return this.parse(copy);
  }

  private parse(data: Uint16Array): OutputChunk[] {
    const chunks: OutputChunk[] = [];
    let pos = 0;
    let batch = -1;
    /** Characters of `batch` before the current record (a batch's records start with its first write). */
    let offset = 0;
    while (pos + RECORD_HEADER <= data.length) {
      const recordBatch = data[pos]! + data[pos + 1]! * 0x10000;
      const stream = STREAMS[data[pos + 2]!];
      const length = data[pos + 3]! + data[pos + 4]! * 0x10000;
      const start = pos + RECORD_HEADER;
      const end = start + length;
      if (!stream || end > data.length) break;
      if (recordBatch !== batch) {
        batch = recordBatch;
        offset = 0;
      }
      // The records are gapless: reaching a later batch means everything before it was shown.
      if (batch > this.batch) {
        this.batch = batch;
        this.chars = 0;
      }
      if (batch === this.batch && offset + length > this.chars) {
        const skip = Math.max(0, this.chars - offset);
        pushChunk(chunks, stream, decode(data.subarray(start + skip, end)));
        this.chars = offset + length;
      }
      offset += length;
      pos = end;
    }
    return chunks;
  }
}
