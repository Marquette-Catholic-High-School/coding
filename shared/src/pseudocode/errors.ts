// Error type and wording helpers shared by the lexer, parser and interpreter.
import type { PseudoDiagnostic } from './types';

/** A source position: 1-based line and column, plus a 1-based exclusive end column on the same line. */
export interface Pos {
  line: number;
  col: number;
  endCol: number;
}

/** A student-facing problem with a location. Converted to a `PseudoDiagnostic` at the API boundary. */
export class PseudoError extends Error {
  readonly phase: 'syntax' | 'runtime';
  readonly pos: Pos;
  readonly hint: string | undefined;

  constructor(phase: 'syntax' | 'runtime', message: string, pos: Pos, hint?: string) {
    super(message);
    this.name = 'PseudoError';
    this.phase = phase;
    this.pos = { line: pos.line, col: pos.col, endCol: pos.endCol };
    this.hint = hint;
  }

  toDiagnostic(): PseudoDiagnostic {
    const line = Math.max(1, this.pos.line);
    const column = Math.max(1, this.pos.col);
    const d: PseudoDiagnostic = { severity: 'error', message: this.message, line, column, phase: this.phase };
    if (this.hint) d.hint = this.hint;
    if (this.pos.endCol > column) d.endColumn = this.pos.endCol;
    return d;
  }
}

export function syntaxError(message: string, pos: Pos, hint?: string): PseudoError {
  return new PseudoError('syntax', message, pos, hint);
}

export function runtimeError(message: string, pos: Pos, hint?: string): PseudoError {
  return new PseudoError('runtime', message, pos, hint);
}

/** Case-insensitive optimal-string-alignment distance (insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let before = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur[j] = v;
    }
    [before, prev, cur] = [prev, cur, before];
  }
  return prev[m]!;
}

/** How many edits still count as "probably a typo" for a word of this length. */
function typoLimit(length: number): number {
  if (length <= 2) return 0;
  if (length <= 4) return 1;
  if (length <= 7) return 2;
  return 3;
}

/**
 * The candidate closest to `word` (case-insensitive, spaces ignored so "ENDIF" matches "END IF"), or null when
 * nothing is close enough. Earlier candidates win ties, so pass the most likely kinds of word first.
 */
export function closestMatch(word: string, candidates: Iterable<string>): string | null {
  const compact = word.replace(/\s+/g, '');
  const limit = typoLimit(compact.length);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (candidate === word) continue;
    const other = candidate.replace(/\s+/g, '');
    if (Math.abs(other.length - compact.length) > limit) continue;
    const d = editDistance(compact, other);
    if (d <= limit && d < bestDistance) {
      best = candidate;
      bestDistance = d;
      if (d === 0) break;
    }
  }
  return best;
}

/** "a" or "an" for a keyword or word ("an END IF", "a WHILE"). */
export function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** 5000000 → "5,000,000" (locale-independent, so messages are identical everywhere). */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
