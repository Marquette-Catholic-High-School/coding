// Runtime values and how they print.

/** Numbers, text, TRUE/FALSE and lists (plain arrays, shared by reference like in most languages). */
export type Value = number | string | boolean | Value[];

export interface BoolWords {
  trueText: string;
  falseText: string;
}

/** Removes binary floating-point noise: 0.1 + 0.2 → 0.3. Integers are returned unchanged (fast path). */
export function cleanNumber(n: number): number {
  return Number.isInteger(n) || !Number.isFinite(n) ? n : Number(n.toPrecision(15));
}

export function formatNumber(n: number): string {
  const c = cleanNumber(n);
  return c === 0 ? '0' : String(c);
}

/** Text as the student sees it from OUTPUT: strings raw, lists like [1, 2, "a"], booleans in the teacher's words. */
export function formatValue(v: Value, words: BoolWords): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? words.trueText : words.falseText;
  return formatList(v, words, new Set());
}

function formatList(list: Value[], words: BoolWords, seen: Set<Value[]>): string {
  if (seen.has(list)) return '[…]';
  seen.add(list);
  const parts = new Array<string>(list.length);
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    parts[i] = typeof item === 'string' ? `"${item}"` : Array.isArray(item) ? formatList(item, words, seen) : formatValue(item, words);
  }
  seen.delete(list);
  return `[${parts.join(', ')}]`;
}

export function numbersEqual(a: number, b: number): boolean {
  return a === b || cleanNumber(a) === cleanNumber(b);
}

/** `=` semantics: numbers compare without float noise, lists compare item by item, different types are never equal. */
export function valuesEqual(a: Value, b: Value, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return numbersEqual(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length || depth > 200) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i]!, b[i]!, depth + 1)) return false;
    return true;
  }
  return false;
}

/** Short type label: "a number", "text", "a list", "TRUE/FALSE". */
export function typeLabel(v: Value, words: BoolWords): string {
  if (typeof v === 'number') return 'a number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return `${words.trueText}/${words.falseText}`;
  return 'a list';
}

/** A value described in a sentence: `the number 5`, `the text "hi"`, `a list`, `TRUE`. */
export function describeValue(v: Value, words: BoolWords): string {
  if (typeof v === 'number') return `the number ${formatNumber(v)}`;
  if (typeof v === 'string') return `the text "${v.length > 30 ? `${v.slice(0, 30)}…` : v}"`;
  if (typeof v === 'boolean') return v ? words.trueText : words.falseText;
  return v.length === 0 ? 'an empty list' : 'a list';
}

const NUMERIC = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/;

/** Number for numeric-looking text ("42", " -3.5 "), otherwise null. */
export function parseNumericText(text: string): number | null {
  return NUMERIC.test(text) ? Number(text.trim()) : null;
}
