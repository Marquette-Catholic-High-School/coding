// Small pure helpers shared by the IDE panels (kept free of React/CSS so they're easy to unit-test).

import { findPack, LANGUAGE_KIND_LABELS, type LanguageKind, type TestCase, type TestResult } from '@codeclass/shared';
import type { OutputChunk } from '../runtime';

/** "0.24 s" under 10 seconds, "12.3 s" above. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
}

/** Joins consecutive chunks of the same stream so the transcript renders as few spans as possible. */
export function mergeChunks(output: readonly OutputChunk[]): OutputChunk[] {
  const merged: OutputChunk[] = [];
  for (const chunk of output) {
    if (!chunk.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.stream === chunk.stream) last.text += chunk.text;
    else merged.push({ stream: chunk.stream, text: chunk.text });
  }
  return merged;
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
