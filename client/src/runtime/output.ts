// Worker-side output buffer: merges writes into chunks, sends them at most every ~30 ms, enforces the output
// cap and remembers the unfinished stdout line (the prompt shown before an input request).
//
// Language runtimes often run synchronously and never yield to the event loop, so flushing is checked on every
// write (leading edge) as well as by a timer for code that does yield (async JavaScript).

import { MAX_OUTPUT_CHARS, OUTPUT_FLUSH_MS, OUTPUT_LIMIT_MESSAGE } from './protocol';
import type { OutputChunk, OutputStream } from './types';

export interface OutputBufferOptions {
  send: (chunks: OutputChunk[]) => void;
  intervalMs?: number;
  maxChars?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const MAX_PROMPT_CHARS = 500;
// Captured at load so a JavaScript program that replaces the global timers cannot break output delivery.
const defaultSchedule = globalThis.setTimeout.bind(globalThis);
const defaultCancel = globalThis.clearTimeout.bind(globalThis);

export class OutputBuffer {
  private chunks: OutputChunk[] = [];
  private total = 0;
  private capped = false;
  private lastFlush = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private partialLine = '';
  private endsWithNewline = true;
  private readonly send: (chunks: OutputChunk[]) => void;
  private readonly intervalMs: number;
  private readonly maxChars: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(options: OutputBufferOptions) {
    this.send = options.send;
    this.intervalMs = options.intervalMs ?? OUTPUT_FLUSH_MS;
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
    if (this.now() - this.lastFlush >= this.intervalMs) this.flush();
    else if (this.timer === null) this.timer = this.schedule(() => this.flush(), this.intervalMs);
  }

  /** Echo of a line the program read from pre-supplied input. */
  echoInput(line: string): void {
    this.write('stdin', `${line}\n`);
  }

  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.lastFlush = this.now();
    if (this.chunks.length === 0) return;
    const chunks = this.chunks;
    this.chunks = [];
    this.send(chunks);
  }

  private append(stream: OutputStream, text: string): void {
    if (stream !== 'system') this.total += text.length;
    const last = this.chunks[this.chunks.length - 1];
    if (last && last.stream === stream) last.text += text;
    else this.chunks.push({ stream, text });
    this.endsWithNewline = text.endsWith('\n');
    if (stream === 'stdout') {
      const newline = text.lastIndexOf('\n');
      this.partialLine = newline >= 0 ? text.slice(newline + 1) : this.partialLine + text;
      if (this.partialLine.length > MAX_PROMPT_CHARS) this.partialLine = this.partialLine.slice(-MAX_PROMPT_CHARS);
    } else if (stream === 'stdin') {
      this.partialLine = '';
    }
  }
}
