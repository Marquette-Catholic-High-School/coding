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

/** Thrown when a list holds lists inside lists too many levels deep to turn into text (the JavaScript stack ran out). */
export class ValueTooDeepError extends Error {
  constructor() {
    super('A list is nested too deeply to show.');
    this.name = 'ValueTooDeepError';
  }
}

/** Text as the student sees it from OUTPUT: strings raw, lists like [1, 2, "a"], booleans in the teacher's words. */
export function formatValue(v: Value, words: BoolWords): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? words.trueText : words.falseText;
  try {
    return formatList(v, words, new Set());
  } catch (e) {
    if (e instanceof RangeError && /stack|recursion/i.test(e.message)) throw new ValueTooDeepError();
    throw e;
  }
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

/**
 * `=` as students expect it: like `valuesEqual`, but a number also equals text that looks like that number ("1" = 1),
 * because INPUT turns typed numbers into numbers. Items inside lists still compare strictly.
 */
export function looselyEqual(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'string') return numberEqualsText(a, b);
  if (typeof a === 'string' && typeof b === 'number') return numberEqualsText(b, a);
  return valuesEqual(a, b);
}

function numberEqualsText(n: number, text: string): boolean {
  const parsed = parseNumericText(text);
  return parsed !== null && numbersEqual(n, parsed);
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
const SURROGATE = /[\uD800-\uDFFF]/;

/**
 * The characters of some text, where an emoji (or any character outside the Basic Multilingual Plane) counts as one.
 * Plain text is returned as it is (strings index like arrays), so the common case allocates nothing.
 */
export function textChars(text: string): string | string[] {
  return SURROGATE.test(text) ? Array.from(text) : text;
}

/** Text this short is measured directly: cheaper than a cache lookup. */
const SHORT_TEXT = 32;
/** Texts remembered by a TextIndex (most recently used first). */
const TEXT_INDEX_SIZE = 8;

/** The characters of a text: `chars[0]` … `chars[length - 1]` (an array may hold more, shared with a longer text). */
export interface TextView {
  readonly chars: string | readonly string[];
  /** Number of characters (an emoji counts as one). */
  readonly length: number;
}

interface TextInfo {
  text: string;
  length: number;
  /** The text itself when it has no surrogate code units, else its characters; null until first needed. */
  chars: string | string[] | null;
  /** Whether the text holds any surrogate code unit (so it must be split with Array.from to index it). */
  surrogates: boolean;
  /** Whether it starts with the second half of a surrogate pair, or ends with the first half (for joining). */
  startsLow: boolean;
  endsHigh: boolean;
}

function describeText(text: string): TextInfo {
  const chars = textChars(text);
  const surrogates = typeof chars !== 'string';
  return {
    text,
    length: chars.length,
    chars,
    surrogates,
    startsLow: surrogates && isLowSurrogate(text.charCodeAt(0)),
    endsHigh: surrogates && isHighSurrogate(text.charCodeAt(text.length - 1)),
  };
}

/**
 * Characters and lengths of the texts a program is working with. Finding the characters means reading the whole text,
 * so `FOR i FROM 1 TO LENGTH(s) … s[i] …` would take time proportional to the square of the length. This remembers the
 * answer for the last few texts (found by comparing strings, which is instant for the same string), and works out
 * `a + b` from what it knows about `a` and `b`, so text built up a character at a time isn't re-read either (an emoji
 * text's character list grows in place). One per run, so nothing outlives the program.
 */
export class TextIndex {
  private readonly recent: TextInfo[] = [];

  /** The characters of `text`, as `textChars` would give them. */
  view(text: string): TextView {
    if (text.length <= SHORT_TEXT) {
      const chars = textChars(text);
      return { chars, length: chars.length };
    }
    const info = this.find(text) ?? this.remember(describeText(text));
    if (info.chars === null) info.chars = textChars(text);
    return info as TextView;
  }

  /** How many characters `text` has (an emoji counts as one). */
  length(text: string): number {
    if (text.length <= SHORT_TEXT) return textChars(text).length;
    return (this.find(text) ?? this.remember(describeText(text))).length;
  }

  /**
   * `a + b`, remembering what is known about it when a long `a` or `b` is already remembered (and the other is too, or
   * is short). Text nobody has measured or indexed yet isn't tracked, so plain joining stays as cheap as before.
   */
  join(a: string, b: string): string {
    const text = a + b;
    const longA = a.length > SHORT_TEXT;
    const longB = b.length > SHORT_TEXT;
    if (!longA && !longB) return text;
    const foundA = longA ? this.find(a) : null;
    if (longA && !foundA) return text;
    const foundB = longB ? this.find(b) : null;
    if (longB && !foundB) return text;
    const left = foundA ?? describeText(a);
    const right = foundB ?? describeText(b);
    // A pair split across the join (a ends with the first half of an emoji, b starts with the second) is one character.
    const pair = left.endsHigh && right.startsLow;
    const surrogates = left.surrogates || right.surrogates;
    let chars: string | string[] | null = surrogates ? null : text;
    const list = left.chars;
    if (surrogates && !pair && Array.isArray(list) && list.length === left.length && right.chars !== null) {
      // Nothing has been added after `a` yet, so its character list can grow to become this text's.
      const add = right.chars;
      for (let n = 0; n < right.length; n++) list.push(add[n]!);
      chars = list;
    }
    this.remember({
      text,
      length: left.length + right.length - (pair ? 1 : 0),
      chars,
      surrogates,
      startsLow: a.length > 0 ? left.startsLow : right.startsLow,
      endsHigh: b.length > 0 ? right.endsHigh : left.endsHigh,
    });
    return text;
  }

  private find(text: string): TextInfo | null {
    const recent = this.recent;
    for (let n = 0; n < recent.length; n++) {
      const info = recent[n]!;
      if (info.text !== text) continue;
      if (n > 0) {
        recent.splice(n, 1);
        recent.unshift(info);
      }
      return info;
    }
    return null;
  }

  private remember(info: TextInfo): TextInfo {
    this.recent.unshift(info);
    if (this.recent.length > TEXT_INDEX_SIZE) this.recent.pop();
    return info;
  }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Number for numeric-looking text ("42", " -3.5 "), otherwise null. */
export function parseNumericText(text: string): number | null {
  return NUMERIC.test(text) ? Number(text.trim()) : null;
}
