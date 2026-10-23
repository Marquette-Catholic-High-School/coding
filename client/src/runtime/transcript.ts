// Console transcript behind useCodeRunner. Output is appended in place (nothing is copied per chunk) and React state
// gets an immutable snapshot, at most once per animation frame. Every switch between streams (stdout/stderr lines
// in a loop) starts a segment, so once there are too many the oldest are merged into one plain block.

import type { OutputChunk } from './types';

/** Segments kept before the oldest half are merged (the console shows fewer than this anyway). */
export const MAX_TRANSCRIPT_SEGMENTS = 5000;

export class Transcript {
  /** Finished segments; never changed once a snapshot holds them. */
  private segments: OutputChunk[] = [];
  /** The segment output is still being added to (snapshots get a copy). */
  private open: OutputChunk | null = null;
  private cached: OutputChunk[] | null = null;

  constructor(private readonly maxSegments: number = MAX_TRANSCRIPT_SEGMENTS) {}

  append(chunk: OutputChunk): void {
    if (!chunk.text) return;
    this.cached = null;
    if (this.open && this.open.stream === chunk.stream) {
      this.open.text += chunk.text;
      return;
    }
    if (this.open) this.close(this.open);
    this.open = { stream: chunk.stream, text: chunk.text };
  }

  clear(): void {
    this.segments = [];
    this.open = null;
    this.cached = null;
  }

  /** The transcript as a new array whenever it changed since the last snapshot (the same array otherwise). */
  snapshot(): OutputChunk[] {
    this.cached ??= this.open ? [...this.segments, { ...this.open }] : [...this.segments];
    return this.cached;
  }

  private close(segment: OutputChunk): void {
    this.segments.push(segment);
    if (this.segments.length <= this.maxSegments) return;
    const cut = this.segments.length - Math.floor(this.maxSegments / 2);
    const merged = this.segments.slice(0, cut).map((s) => s.text).join('');
    this.segments = [{ stream: 'stdout', text: merged }, ...this.segments.slice(cut)];
  }
}
