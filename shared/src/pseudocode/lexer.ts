// Tokenizer: source text → tokens, with (possibly multi-word) keywords matched greedily longest-first.
import type { Pos } from './errors';
import type { Language } from './language';
import type { PseudoKeyword } from './types';

export type TokenKind = 'word' | 'kw' | 'num' | 'str' | 'op' | 'nl' | 'eof' | 'bad';

export interface Token extends Pos {
  kind: TokenKind;
  /** Source text. Keywords: their words as typed, joined by single spaces. Strings: including the quotes. */
  text: string;
  /** Keyword slot (kind 'kw'). */
  slot: PseudoKeyword | null;
  /** Number value (kind 'num') or string contents (kind 'str'). */
  value: number | string | null;
  /** Problem description for kind 'bad' (reported when the parser reaches the token). */
  message?: string;
  hint?: string;
}

const TWO_CHAR_OPS = new Set(['<=', '>=', '==', '!=', '<>', ':=']);
const ONE_CHAR_OPS = new Set([
  '+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '←', '≠', '≤', '≥',
]);
/** Opening quote → characters that close it. Curly quotes are accepted because students paste from documents. */
const QUOTES: Record<string, string> = { '"': '"”', '“': '”"', "'": "'’", '‘': "’'" };

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || (ch > '\u007f' && /\p{L}/u.test(ch));
}

function isIdentChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return isIdentStart(ch) || isDigit(ch) || (ch > '\u007f' && /\p{N}/u.test(ch));
}

export function tokenize(src: string, lang: Language): Token[] {
  const raw: Token[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const push = (kind: TokenKind, text: string, start: number, end: number, value: number | string | null = null) => {
    raw.push({ kind, text, slot: null, value, line, col: start - lineStart + 1, endCol: end - lineStart + 1 });
  };
  const bad = (start: number, end: number, message: string, hint?: string) => {
    raw.push({ kind: 'bad', text: src.slice(start, end), slot: null, value: null, line, col: start - lineStart + 1, endCol: end - lineStart + 1, message, hint });
  };

  outer: while (i < n) {
    const ch = src[i]!;
    if (ch === '\n') {
      push('nl', '\n', i, i + 1);
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ' || ch === '﻿') {
      i++;
      continue;
    }
    for (const prefix of lang.commentPrefixes) {
      if (src.startsWith(prefix, i)) {
        while (i < n && src[i] !== '\n') i++;
        continue outer;
      }
    }
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1]))) {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === '.' && isDigit(src[j + 1])) {
        j++;
        while (isDigit(src[j])) j++;
      }
      if (isIdentChar(src[j])) {
        let k = j;
        while (isIdentChar(src[k])) k++;
        const text = src.slice(i, k);
        bad(i, k, `"${text}" isn't a number or a name — names can't start with a digit.`, `To multiply, put * in between, like 2 * x.`);
        i = k;
        continue;
      }
      const text = src.slice(i, j);
      push('num', text, i, j, Number(text));
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (isIdentChar(src[j])) j++;
      push('word', src.slice(i, j), i, j);
      i = j;
      continue;
    }
    const closers = QUOTES[ch];
    if (closers !== undefined) {
      let j = i + 1;
      while (j < n && src[j] !== '\n' && !closers.includes(src[j]!)) j++;
      if (j >= n || src[j] === '\n') {
        bad(i, j, `This text is missing its closing quote mark (${closers[0]}).`, `Text must start and end with a quote mark, like "Hello".`);
        i = j;
        continue;
      }
      push('str', src.slice(i, j + 1), i, j + 1, src.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (ch === ';') {
      push('nl', ';', i, i + 1);
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two) || (two === '<-' && lang.lexArrow)) {
      push('op', two, i, i + 2);
      i += 2;
      continue;
    }
    if (two === '&&' || two === '||') {
      const word = two === '&&' ? lang.kw.and : lang.kw.or;
      bad(i, i + 2, `"${two}" isn't used in this language.`, `Use ${word} instead.`);
      i += 2;
      continue;
    }
    if (two === '**') {
      bad(i, i + 2, `"**" isn't used in this language.`, 'For powers, use ^ — for example 2 ^ 3.');
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(ch)) {
      push('op', ch, i, i + 1);
      i++;
      continue;
    }
    if (ch === '%') {
      bad(i, i + 1, `"%" isn't used in this language.`, `For the remainder after dividing, use ${lang.kw.mod} — for example 7 ${lang.kw.mod} 2.`);
      i++;
      continue;
    }
    if (ch === '!') {
      bad(i, i + 1, `"!" isn't used in this language.`, `Use ${lang.kw.not} instead.`);
      i++;
      continue;
    }
    const symbol = String.fromCodePoint(src.codePointAt(i)!);
    bad(i, i + symbol.length, `I don't recognise the symbol "${symbol}".`);
    i += symbol.length;
  }
  raw.push({ kind: 'eof', text: '', slot: null, value: null, line, col: n - lineStart + 1, endCol: n - lineStart + 1 });
  return mergeKeywords(raw, lang);
}

/** Replaces runs of word tokens that spell a keyword (on one line) with a single 'kw' token, longest match first. */
function mergeKeywords(raw: Token[], lang: Language): Token[] {
  const out: Token[] = [];
  for (let r = 0; r < raw.length; r++) {
    const t = raw[r]!;
    if (t.kind !== 'word') {
      out.push(t);
      continue;
    }
    let node = lang.trie.children.get(lang.norm(t.text));
    if (!node) {
      out.push(t);
      continue;
    }
    let end = node.slot ? r : -1;
    let slot = node.slot;
    for (let j = r + 1; j < raw.length; j++) {
      const next = raw[j]!;
      if (next.kind !== 'word' || next.line !== t.line) break;
      const child: typeof node | undefined = node.children.get(lang.norm(next.text));
      if (!child) break;
      node = child;
      if (node.slot) {
        end = j;
        slot = node.slot;
      }
    }
    if (end < 0) {
      out.push(t);
      continue;
    }
    const words = raw.slice(r, end + 1).map((w) => w.text);
    out.push({ kind: 'kw', text: words.join(' '), slot, value: null, line: t.line, col: t.col, endCol: raw[end]!.endCol });
    r = end;
  }
  return out;
}
