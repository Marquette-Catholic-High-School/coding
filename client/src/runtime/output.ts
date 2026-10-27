// Worker-side output buffer: merges writes into chunks and sends them to the main thread, enforces the output cap,
// remembers the unfinished stdout line (the prompt shown before an input request) and finds each read's prompt in
// stdout.
//
// Language runtimes often run synchronously and never yield to the event loop, so a batching timer may never fire.
// Writes are therefore sent straight away until `burst` messages went out within one interval; only a flood of
// output is held back, and it goes out with the next write after the interval (or from the timer, for code that
// yields). Every write is also mirrored into the output tail (outputTail.ts), which the page reads while a program
// is busy and when it stops one, so output held back by a program that never yields again still shows.

import { MAX_OUTPUT_CHARS, OUTPUT_BURST, OUTPUT_FLUSH_MS, OUTPUT_LIMIT_MESSAGE } from './protocol';
import type { OutputTailSink } from './outputTail';
import type { OutputChunk, OutputStream } from './types';

export interface OutputBufferOptions {
  /** Posts one batch; `batch` counts the batches from 1. */
  send: (chunks: OutputChunk[], batch: number) => void;
  /** Mirror of the output the page has not received yet (see outputTail.ts). */
  tail?: OutputTailSink | null;
  intervalMs?: number;
  /** Batches sent straight away within one interval before writes are held back. */
  burst?: number;
  maxChars?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const MAX_PROMPT_CHARS = 500;
/** stdout kept since the last read to check that it ends with the read's prompt; a longer prompt stays in the output. */
const MAX_PROMPT_MATCH = 2_000;
// Captured at load so a JavaScript program that replaces the global timers cannot break output delivery.
const defaultSchedule = globalThis.setTimeout.bind(globalThis);
const defaultCancel = globalThis.clearTimeout.bind(globalThis);

export class OutputBuffer {
  private chunks: OutputChunk[] = [];
  private total = 0;
  private capped = false;
  private batch = 1;
  private windowStart = Number.NEGATIVE_INFINITY;
  private sentInWindow = 0;
  private timer: unknown = null;
  private partialLine = '';
  /** stdout characters written so far, and where the current line starts among them (see `takePrompt`). */
  private stdoutChars = 0;
  private lineStart = 0;
  /** The program read input since the current stdout line started. */
  private readOnLine = false;
  /** The end of the stdout written since the last read (at most MAX_PROMPT_MATCH characters). */
  private sinceRead = '';
  private endsWithNewline = true;
  private readonly send: (chunks: OutputChunk[], batch: number) => void;
  private readonly tail: OutputTailSink | null;
  private readonly intervalMs: number;
  private readonly burst: number;
  private readonly maxChars: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(options: OutputBufferOptions) {
    this.send = options.send;
    this.tail = options.tail ?? null;
    this.intervalMs = options.intervalMs ?? OUTPUT_FLUSH_MS;
    this.burst = options.burst ?? OUTPUT_BURST;
    this.maxChars = options.maxChars ?? MAX_OUTPUT_CHARS;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((fn, ms) => defaultSchedule(fn, ms));
    this.cancel = options.cancel ?? ((handle) => defaultCancel(handle as Parameters<typeof clearTimeout>[0]));
  }

  /** True once the cap was hit; later writes are dropped. */
  get limitReached(): boolean {
    return this.capped;
  }

  /** Text printed to stdout since the last newline (what a program shows just before asking for input). */
  get pendingPrompt(): string {
    return this.partialLine;
  }

  write(stream: OutputStream, text: string): void {
    if (!text || this.capped) return;
    const room = this.maxChars - this.total;
    if (text.length > room) {
      if (room > 0) this.append(stream, text.slice(0, room));
      this.capped = true;
      this.append('system', `${this.endsWithNewline ? '' : '\n'}${OUTPUT_LIMIT_MESSAGE}\n`);
      this.flush();
      return;
    }
    this.append(stream, text);
    const now = this.now();
    if (now - this.windowStart >= this.intervalMs) {
      this.windowStart = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow < this.burst) this.flush();
    else if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.windowStart + this.intervalMs - now);
  }

  /** Echo of a line the program read from pre-supplied input. */
  echoInput(line: string): void {
    this.write('stdin', `${line}\n`);
  }

  /** The program got an answer typed in the console (echoed by the page) or end of input: the prompt is used up. */
  markInputConsumed(): void {
    this.partialLine = '';
  }

  /**
   * The program reads (or tries to read) a line of input: returns where that read's prompt is in stdout, or null if
   * it has none. `prompt` is the text the input call printed itself (see `RunIO.readLine`), which stdout must end
   * with. Without it, the prompt is the unfinished stdout line (uncapped, unlike `pendingPrompt`) — unless input was
   * read on that line already: text printed between two reads on one line, like "2 4 " from a loop that reads a
   * number and prints its double with io.write(n * 2, " "), is the program's output.
   */
  takePrompt(prompt?: string): { start: number; end: number } | null {
    const sinceRead = this.sinceRead;
    const readOnLine = this.readOnLine;
    this.sinceRead = '';
    this.readOnLine = true;
    const end = this.stdoutChars;
    if (prompt !== undefined) return prompt !== '' && sinceRead.endsWith(prompt) ? { start: end - prompt.length, end } : null;
    return !readOnLine && end > this.lineStart ? { start: this.lineStart, end } : null;
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.chunks.length === 0) return;
    const chunks = this.chunks;
    this.chunks = [];
    const batch = this.batch++;
    this.sentInWindow++;
    this.send(chunks, batch);
  }

  private append(stream: OutputStream, text: string): void {
    if (stream !== 'system') this.total += text.length;
    const last = this.chunks[this.chunks.length - 1];
    if (last && last.stream === stream) last.text += text;
    else this.chunks.push({ stream, text });
    this.tail?.record(this.batch, stream, text);
    this.endsWithNewline = text.endsWith('\n');
    if (stream === 'stdout') {
      const newline = text.lastIndexOf('\n');
      this.stdoutChars += text.length;
      if (newline >= 0) {
        this.lineStart = this.stdoutChars - (text.length - newline - 1);
        this.readOnLine = false;
      }
      const sinceRead = this.sinceRead + text;
      this.sinceRead = sinceRead.length > MAX_PROMPT_MATCH ? sinceRead.slice(-MAX_PROMPT_MATCH) : sinceRead;
      this.partialLine = newline >= 0 ? text.slice(newline + 1) : this.partialLine + text;
      if (this.partialLine.length > MAX_PROMPT_CHARS) this.partialLine = this.partialLine.slice(-MAX_PROMPT_CHARS);
    } else if (stream === 'stdin') {
      this.partialLine = '';
    }
  }
}
