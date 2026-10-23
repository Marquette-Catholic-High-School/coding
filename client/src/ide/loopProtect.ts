// Loop protection for the web preview's inline scripts: every `while (…)`, `do … while (…)` and `for (…; …; …)`
// condition gets a call to the preview's time-budget guard, so a loop that never ends throws instead of freezing the
// page (and, in browsers that run the sandboxed frame on the app's thread, the whole IDE). Uses a small tokenizer, not
// a full parser: when the script can't be tokenized cleanly (half-typed code) it is returned unchanged, since a script
// with a syntax error never runs anyway. Insertions add no line breaks, so line numbers in errors stay the same.

/** Name of the guard function the preview's capture script defines on `window`. */
export const LOOP_GUARD = '__ccLoop';

/**
 * The expression added to a loop condition on page line `line`. It checks that the guard exists first, so a loop
 * that ends up somewhere the capture script didn't run (say, a nested frame) works as written instead of throwing a
 * ReferenceError.
 */
export function loopGuardCall(line: number): string {
  return `(typeof ${LOOP_GUARD}!=='function'||${LOOP_GUARD}(${line}))`;
}

interface Token {
  /**
   * 'name' (identifier/keyword), 'punct' (one character) or 'atom' (string, template, number, regex). A template
   * piece that ends with `${` is an atom with the value '${'.
   */
  type: 'name' | 'punct' | 'atom';
  value: string;
  start: number;
  /** 0-based line within the script. */
  line: number;
  /** On ')': it closes the head of an if/while/for/with statement, so a '/' after it starts a regular expression. */
  closesHead?: boolean;
}

/** Words after which a `/` starts a regular expression rather than a division (`of` only inside `for (…)`). */
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
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

/** Statement keywords whose `( … )` head is followed by a statement, so `if (x) /re/.test(s)` is a regex. */
const STATEMENT_HEADS = new Set(['if', 'while', 'for', 'with']);

const NAME_START = /[A-Za-z_$\u0080-￿]/;
const NAME_PART = /[\w$\u0080-￿]/;
const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;

const isPunct = (t: Token | undefined, value: string) => t?.type === 'punct' && t.value === value;

/** Tokenizes `src`; null when it ends inside a string, comment, template or regex, or brackets don't balance. */
function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  // Open brackets; '${' marks a template substitution, whose closing '}' resumes the template text. A '(' remembers
  // the statement keyword it follows (`if (`, `for (` …).
  const stack: { open: string; head?: string }[] = [];
  let line = 0;
  let i = 0;
  // Only whitespace and comments so far on this line: a `-->` here starts a comment (legacy HTML-like comments).
  let lineStart = true;
  const n = src.length;

  const push = (token: Token) => {
    tokens.push(token);
    lineStart = false;
  };

  /** Whether the token at `k` is a property name (`obj.if`, `obj?.of`) rather than a keyword. */
  const isProperty = (k: number) => isPunct(tokens[k - 1], '.');

  const regexAllowed = () => {
    const last = tokens.length - 1;
    const prev = tokens[last];
    if (!prev) return true;
    if (prev.type === 'atom') return prev.value === '${';
    if (prev.type === 'name') {
      if (isProperty(last)) return false;
      if (prev.value === 'of') return stack[stack.length - 1]?.head === 'for';
      return REGEX_AFTER_WORD.has(prev.value);
    }
    if (prev.value === ')') return prev.closesHead === true;
    if (prev.value === ']') return false;
    if (prev.value === '+' || prev.value === '-') {
      // A run of adjacent '+' reads as '++' pairs then a lone '+': after `i++` comes a division, after `a + ` (or
      // `a+++`) a regex.
      let run = 1;
      for (let k = last - 1; k >= 0 && isPunct(tokens[k], prev.value) && tokens[k]!.start === tokens[k + 1]!.start - 1; k--) run++;
      return run % 2 === 1;
    }
    return true;
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
        push({ type: 'atom', value: '`', start, line });
        return true;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        stack.push({ open: '${' });
        push({ type: 'atom', value: '${', start, line });
        return true;
      }
      i++;
    }
    return false;
  };

  const skipLine = () => {
    while (i < n && src[i] !== '\n') i++;
  };

  while (i < n) {
    const c = src[i]!;
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') {
      i++;
      continue;
    }
    const start = i;
    // `//`, and the legacy `<!--` anywhere and `-->` at the start of a line, comment out the rest of the line.
    if ((c === '/' && src[i + 1] === '/') || (c === '<' && src.startsWith('!--', i + 1)) || (c === '-' && lineStart && src.startsWith('-->', i))) {
      skipLine();
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return null;
      for (let k = i; k < end; k++) {
        if (src[k] === '\n') {
          line++;
          lineStart = true;
        }
      }
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
      push({ type: 'atom', value: c, start, line });
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
      push({ type: 'atom', value: '/', start, line });
      continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      i += m ? m[0].length : 1;
      push({ type: 'atom', value: '0', start, line });
      continue;
    }
    if (NAME_START.test(c) || c === '#') {
      i++;
      while (i < n && NAME_PART.test(src[i]!)) i++;
      push({ type: 'name', value: src.slice(start, i), start, line });
      continue;
    }
    let closesHead = false;
    if (c === '(') {
      const last = tokens.length - 1;
      const prev = tokens[last];
      let head: string | undefined;
      if (prev?.type === 'name' && !isProperty(last)) {
        if (STATEMENT_HEADS.has(prev.value)) head = prev.value;
        else if (prev.value === 'await' && tokens[last - 1]?.value === 'for') head = 'for'; // for await (…)
      }
      stack.push({ open: c, head });
    } else if (c === '[' || c === '{') stack.push({ open: c });
    else if (c === ')' || c === ']' || c === '}') {
      const open = stack.pop();
      if (c === '}' && open?.open === '${') {
        i++;
        if (!scanTemplate(start)) return null;
        continue;
      }
      if (open?.open !== (c === ')' ? '(' : c === ']' ? '[' : '{')) return null;
      closesHead = c === ')' && open.head !== undefined;
    }
    push(closesHead ? { type: 'punct', value: c, start, line, closesHead } : { type: 'punct', value: c, start, line });
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

/** What an open bracket is: a class body or object literal holds methods (`while(x) {…}` there is a method). */
type Scope = '(' | '[' | 'block' | 'class' | 'object';

/** Words after which a `{` starts an object literal (an expression), not a block. */
const OBJECT_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'extends']);

/** Whether the `{` at `k` starts an object literal; when unsure it says block, so loops inside stay guarded. */
function opensObject(tokens: Token[], k: number, enclosing: Scope | undefined): boolean {
  const prev = tokens[k - 1];
  if (!prev) return false;
  if (prev.type === 'atom') return prev.value === '${';
  if (prev.type === 'name') return !isPunct(tokens[k - 2], '.') && OBJECT_AFTER_WORD.has(prev.value);
  switch (prev.value) {
    case ')':
    case ']':
    case '}':
    case ';':
    case '{':
      return false;
    case ':': // `case 1: {` and `label: {` are blocks; `{ a: {` and `(c ? a : {` are objects
      return enclosing !== undefined && enclosing !== 'block';
    case '>': // arrow function body
      return !(isPunct(tokens[k - 2], '=') && tokens[k - 2]!.start === prev.start - 1);
    default:
      return true;
  }
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
  const guard = (t: Token) => loopGuardCall(firstLine + t.line);
  const scopes: Scope[] = [];
  // Depth at which the next '{' opens a class body (after `class Name extends Base`), or -1.
  let classAt = -1;

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type === 'punct') {
      if (t.value === '(' || t.value === '[') scopes.push(t.value);
      else if (t.value === '{') {
        const enclosing = scopes[scopes.length - 1];
        scopes.push(classAt === scopes.length ? 'class' : opensObject(tokens, k, enclosing) ? 'object' : 'block');
        if (classAt === scopes.length - 1) classAt = -1;
      } else if (t.value === ')' || t.value === ']' || t.value === '}') {
        scopes.pop();
        if (classAt > scopes.length) classAt = -1;
      }
      continue;
    }
    if (t.type !== 'name') continue;
    const prev = tokens[k - 1];
    if (isPunct(prev, '.')) continue; // obj.while, obj.class
    const next = tokens[k + 1];
    if (t.value === 'class') {
      // `class A {`, `class extends B {`, `class {` — not `{ class: 1 }` or a method called `class`.
      if (next?.type === 'name' || isPunct(next, '{')) classAt = scopes.length;
      continue;
    }
    if (t.value !== 'while' && t.value !== 'for') continue;
    const scope = scopes[scopes.length - 1];
    if (scope === 'class' || scope === 'object') continue; // a method called `while`/`for`
    if (!isPunct(next, '(')) continue; // `for await (…)`, `{ while: 1 }`
    const closeIndex = matchingClose(tokens, k + 1);
    const close = tokens[closeIndex]!;
    if (closeIndex === k + 2) continue; // `while ()` is not a loop (e.g. a method called `while`)

    if (t.value === 'while') {
      inserts.push({ at: next!.start + 1, text: `${guard(t)}&&(` }, { at: close.start, text: ')' });
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
