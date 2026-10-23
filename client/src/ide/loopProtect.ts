// Loop protection for the web preview's inline scripts: every `while (…)`, `do … while (…)` and `for (…; …; …)`
// condition gets a call to the preview's time-budget guard, so a loop that never ends throws instead of freezing the
// page (and, in browsers that run the sandboxed frame on the app's thread, the whole IDE). Uses a small tokenizer, not
// a full parser: when the script can't be tokenized cleanly (half-typed code) it is returned unchanged, since a script
// with a syntax error never runs anyway. Insertions add no line breaks, so line numbers in errors stay the same.

/** Name of the guard function the preview's capture script defines on `window`. */
export const LOOP_GUARD = '__ccLoop';

interface Token {
  /** 'name' (identifier/keyword), 'punct' (one character) or 'atom' (string, template, number, regex). */
  type: 'name' | 'punct' | 'atom';
  value: string;
  start: number;
  /** 0-based line within the script. */
  line: number;
}

/** Words after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const NAME_START = /[A-Za-z_$\u0080-￿]/;
const NAME_PART = /[\w$\u0080-￿]/;
const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;

/** Tokenizes `src`; null when it ends inside a string, comment, template or regex, or brackets don't balance. */
function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  // Open brackets; '${' marks a template substitution, whose closing '}' resumes the template text.
  const stack: string[] = [];
  let line = 0;
  let i = 0;
  const n = src.length;

  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === 'atom') return false;
    if (prev.type === 'name') return REGEX_AFTER_WORD.has(prev.value);
    return prev.value !== ')' && prev.value !== ']';
  };

  /** Scans template text from `i` (just after '`' or a substitution's '}'); false if it never ends. */
  const scanTemplate = (start: number): boolean => {
    while (i < n) {
      const c = src[i]!;
      if (c === '\\') {
        if (src[i + 1] === '\n') line++;
        i += 2;
        continue;
      }
      if (c === '\n') line++;
      if (c === '`') {
        i++;
        tokens.push({ type: 'atom', value: '`', start, line });
        return true;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        stack.push('${');
        tokens.push({ type: 'atom', value: '`', start, line });
        return true;
      }
      i++;
    }
    return false;
  };

  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') {
      i++;
      continue;
    }
    const start = i;
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return null;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\n') return null;
        if (src[i] === '\\') {
          if (src[i + 1] === '\n') line++;
          i++;
        }
        i++;
      }
      if (i >= n) return null;
      i++;
      tokens.push({ type: 'atom', value: c, start, line });
      continue;
    }
    if (c === '`') {
      i++;
      if (!scanTemplate(start)) return null;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let k = i + 1;
      let inClass = false;
      for (; k < n; k++) {
        const ch = src[k]!;
        if (ch === '\n') return null;
        if (ch === '\\') k++;
        else if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
      }
      if (k >= n) return null;
      i = k + 1;
      while (i < n && NAME_PART.test(src[i]!)) i++;
      tokens.push({ type: 'atom', value: '/', start, line });
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      i += m ? m[0].length : 1;
      tokens.push({ type: 'atom', value: '0', start, line });
      continue;
    }
    if (NAME_START.test(c) || c === '#') {
      i++;
      while (i < n && NAME_PART.test(src[i]!)) i++;
      tokens.push({ type: 'name', value: src.slice(start, i), start, line });
      continue;
    }
    if (c === '(' || c === '[' || c === '{') stack.push(c);
    else if (c === ')' || c === ']' || c === '}') {
      const open = stack.pop();
      if (c === '}' && open === '${') {
        i++;
        if (!scanTemplate(start)) return null;
        continue;
      }
      if (open !== (c === ')' ? '(' : c === ']' ? '[' : '{')) return null;
    }
    tokens.push({ type: 'punct', value: c, start, line });
    i++;
  }
  return stack.length === 0 ? tokens : null;
}

/** Index of the token closing the bracket at `open`. Tokenizing guarantees it exists. */
function matchingClose(tokens: Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type !== 'punct') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return tokens.length - 1;
}

/**
 * Adds the loop guard to every loop condition in a script. `firstLine` is the 1-based line of the script's first
 * character in the page, so the guard can say which line the loop is on.
 */
export function protectLoops(src: string, firstLine = 1): string {
  if (!/\b(?:while|for)\b/.test(src)) return src;
  const tokens = tokenize(src);
  if (!tokens) return src;
  const inserts: { at: number; text: string }[] = [];
  const guard = (t: Token) => `${LOOP_GUARD}(${firstLine + t.line})`;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type !== 'name' || (t.value !== 'while' && t.value !== 'for')) continue;
    const prev = tokens[k - 1];
    if (prev?.type === 'punct' && prev.value === '.') continue; // obj.while
    const open = tokens[k + 1];
    if (open?.type !== 'punct' || open.value !== '(') continue; // `for await (…)`, `{ while: 1 }`
    const closeIndex = matchingClose(tokens, k + 1);
    const close = tokens[closeIndex]!;
    if (closeIndex === k + 2) continue; // `while ()` is not a loop (e.g. a method called `while`)

    if (t.value === 'while') {
      inserts.push({ at: open.start + 1, text: `${guard(t)}&&(` }, { at: close.start, text: ')' });
      continue;
    }
    // for (init; condition; update): guard the condition. for…in / for…of have no condition and always end.
    const semis: Token[] = [];
    let depth = 0;
    for (let j = k + 2; j < closeIndex; j++) {
      const h = tokens[j]!;
      if (h.type !== 'punct') continue;
      if (h.value === '(' || h.value === '[' || h.value === '{') depth++;
      else if (h.value === ')' || h.value === ']' || h.value === '}') depth--;
      else if (h.value === ';' && depth === 0) semis.push(h);
    }
    if (semis.length !== 2) continue;
    const [first, second] = semis as [Token, Token];
    if (src.slice(first.start + 1, second.start).trim() === '') {
      inserts.push({ at: first.start + 1, text: guard(t) });
    } else {
      inserts.push({ at: first.start + 1, text: `${guard(t)}&&(` }, { at: second.start, text: ')' });
    }
  }
  if (inserts.length === 0) return src;

  inserts.sort((a, b) => a.at - b.at);
  let out = '';
  let last = 0;
  for (const { at, text } of inserts) {
    out += src.slice(last, at) + text;
    last = at;
  }
  return out + src.slice(last);
}
