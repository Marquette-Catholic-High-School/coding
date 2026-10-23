// Small pure helpers shared by the IDE panels (kept free of React/CSS so they're easy to unit-test).

import { findPack, LANGUAGE_KIND_LABELS, type LanguageKind, type TestCase, type TestResult } from '@codeclass/shared';
import type { OutputChunk } from '../runtime';

/** "0.24 s" under 10 seconds, "12.3 s" above. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
}

/** A run of console output from one stream, keyed by the index of its first chunk (stable while output grows). */
export interface ConsoleSegment extends OutputChunk {
  key: number;
}

/**
 * The last `max` segments of a transcript (consecutive chunks of one stream merged). Only looks at the end of
 * `output`, so it stays cheap when a program prints thousands of alternating stdout/stderr lines. `hidden` is true
 * when earlier output was left out.
 */
export function tailSegments(output: readonly OutputChunk[], max: number): { segments: ConsoleSegment[]; hidden: boolean } {
  const runs: { stream: OutputChunk['stream']; parts: string[]; key: number }[] = [];
  let i = output.length - 1;
  for (; i >= 0; i--) {
    const chunk = output[i]!;
    if (!chunk.text) continue;
    const run = runs[runs.length - 1];
    if (run && run.stream === chunk.stream) {
      run.parts.push(chunk.text);
      run.key = i;
      continue;
    }
    if (runs.length === max) break;
    runs.push({ stream: chunk.stream, parts: [chunk.text], key: i });
  }
  const segments = runs.reverse().map((r) => ({ stream: r.stream, text: r.parts.reverse().join(''), key: r.key }));
  return { segments, hidden: i >= 0 };
}

/** What a key press in the console's input line does: Enter sends the line, Ctrl+D (as in a terminal) ends input. */
export function consoleInputKey(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}): 'submit' | 'end' | null {
  if (e.isComposing) return null;
  if (e.key === 'Enter') return 'submit';
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') return 'end';
  return null;
}

/** Color of the Tests tab badge: red once a test failed, teal when all passed, otherwise gray (not run or stopped). */
export function testsBadgeColor(summary: { passed: number; total: number; ran: number } | null): 'red' | 'teal' | 'gray' {
  if (!summary) return 'gray';
  if (summary.passed < summary.ran) return 'red';
  return summary.ran === summary.total ? 'teal' : 'gray';
}

/**
 * One step of fitting a row on one line (see useFitLevel). Steps to a more compact level while the row overflows,
 * and back to a wider level once there is room for the width that level needed (`natural[level]`).
 */
export function nextFitLevel(
  level: number,
  maxLevel: number,
  available: number,
  needed: number,
  natural: readonly (number | undefined)[],
): number {
  if (level < maxLevel && needed > available + 1) return level + 1;
  const wider = level > 0 ? natural[level - 1] : undefined;
  if (wider != null && wider <= available + 1) return level - 1;
  return level;
}

/** "Starting Python… the first run downloads about 10 MB" (size taken from the language catalog). */
export function loadingMessage(kind: LanguageKind): string {
  const label = LANGUAGE_KIND_LABELS[kind];
  const size = /([\d.]+\s*[KMG]B)/.exec(findPack(kind)?.downloadSize ?? '')?.[1];
  return size ? `Starting ${label}… the first run downloads about ${size}` : `Starting ${label}…`;
}

export function testName(test: TestCase, index: number): string {
  return test.name.trim() || `Test ${index + 1}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Passed/total over `tests`, counting only results that belong to them; null when none of them has run. */
export function summarizeTests(
  tests: readonly TestCase[],
  results: readonly TestResult[] | null | undefined,
): { passed: number; total: number; ran: number } | null {
  if (!results || tests.length === 0) return null;
  const byId = new Map(results.map((r) => [r.testId, r]));
  let passed = 0;
  let ran = 0;
  for (const t of tests) {
    const r = byId.get(t.id);
    if (!r) continue;
    ran++;
    if (r.passed) passed++;
  }
  return ran === 0 ? null : { passed, total: tests.length, ran };
}
