// Word bank, editor word lists, rendered examples and starter code for any pseudocode config.
import { getLanguage, type Language } from './language';
import {
  BUILTIN_INFO,
  CONSTRUCT_INFO,
  KEYWORD_INFO,
  type HighlightWords,
  type PseudoConstruct,
  type PseudoKeyword,
  type PseudocodeConfig,
  type VocabBuiltin,
  type VocabEntry,
} from './types';

const INDENT = '  ';

/** How examples are written for a config: the teacher's words plus the layout conventions of their preset. */
interface Style {
  k: Readonly<Record<PseudoKeyword, string>>;
  /** `IF (x) { … }` blocks and `DISPLAY(x)` / `INPUT()` / `RETURN(x)` calls (AP CSP look). */
  braces: boolean;
  assign: string | null;
  /** Write `x ← 0` rather than `SET x TO 0` for a first assignment. */
  arrowFirst: boolean;
  /** `FOR i ← 1 TO 10` (exam boards) rather than `FOR i FROM 1 TO 10`. */
  forArrow: boolean;
  /** Cambridge layout: THEN / ELSE indented on their own lines. */
  thenOnOwnLine: boolean;
  useDo: boolean;
  /** How INPUT is written: statement (`INPUT name`), bare expression (`name ← USERINPUT`) or call (`name ← INPUT()`). */
  input: 'statement' | 'bare' | 'call';
  /** AQA: `FOR item IN list`. */
  forIn: boolean;
  /** `NEXT i`: the loop closer repeats the variable name. */
  closerNamesVariable: boolean;
  base: 0 | 1;
  separator: string;
  on: (c: PseudoConstruct) => boolean;
}

function styleFor(lang: Language): Style {
  const cfg = lang.config;
  const exam = cfg.presetId === 'cambridge' || cfg.presetId === 'aqa';
  const braces = cfg.blockStyle === 'braces';
  return {
    k: lang.kw,
    braces,
    assign: lang.assign,
    arrowFirst: lang.assign !== null && (exam || braces || cfg.presetId === 'ap-csp'),
    forArrow: lang.assign !== null && exam,
    thenOnOwnLine: cfg.presetId === 'cambridge',
    useDo: cfg.presetId !== 'aqa',
    input: lang.assign === null ? 'statement' : braces ? 'call' : cfg.presetId === 'aqa' ? 'bare' : 'statement',
    forIn: cfg.presetId === 'aqa',
    closerNamesVariable: lang.kw.endFor.toUpperCase() === 'NEXT',
    base: cfg.listIndexBase,
    separator: cfg.outputSeparator,
    on: (c) => lang.constructOn(c),
  };
}

function indent(text: string, levels = 1): string {
  const pad = INDENT.repeat(levels);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

function block(st: Style, header: string, body: string, closer: string): string {
  return st.braces ? `${header} {\n${indent(body)}\n}` : `${header}\n${indent(body)}\n${closer}`;
}

function output(st: Style, ...values: string[]): string {
  if (st.braces) return values.map((v) => `${st.k.output}(${v})`).join('\n');
  return `${st.k.output} ${values.join(', ')}`;
}

/** `OUTPUT "Hi", name` — with the space inside the text when the separator is empty (Cambridge). */
function outputGreeting(st: Style, greeting: string, name: string): string {
  return output(st, st.separator ? `"${greeting}"` : `"${greeting} "`, name);
}

function assign(st: Style, name: string, value: string, first: boolean): string {
  if (st.assign && (st.arrowFirst || !first)) return `${name} ${st.assign} ${value}`;
  return `${st.k.set} ${name} ${st.k.to} ${value}`;
}

function readInto(st: Style, name: string): string {
  if (st.input === 'call') return `${name} ${st.assign} ${st.k.input}()`;
  if (st.input === 'bare') return `${name} ${st.assign} ${st.k.input}`;
  return `${st.k.input} ${name}`;
}

function renderIf(st: Style, branches: Array<{ cond: string; body: string }>, elseBody: string | null): string {
  const k = st.k;
  const [first, ...rest] = branches;
  if (!first) return '';
  if (st.braces) {
    let s = `${k.if} (${first.cond}) {\n${indent(first.body)}\n}`;
    for (const b of rest) s += ` ${k.elseIf} (${b.cond}) {\n${indent(b.body)}\n}`;
    if (elseBody !== null) s += ` ${k.else} {\n${indent(elseBody)}\n}`;
    return s;
  }
  if (st.thenOnOwnLine) {
    // Cambridge has no ELSE IF: further conditions nest inside the ELSE.
    const elsePart = rest.length > 0 ? renderIf(st, rest, elseBody) : elseBody;
    let s = `${k.if} ${first.cond}\n${INDENT}${k.then}\n${indent(first.body, 2)}`;
    if (elsePart !== null) s += `\n${INDENT}${k.else}\n${indent(elsePart, 2)}`;
    return `${s}\n${k.endIf}`;
  }
  let s = `${k.if} ${first.cond} ${k.then}\n${indent(first.body)}`;
  for (const b of rest) s += `\n${k.elseIf} ${b.cond} ${k.then}\n${indent(b.body)}`;
  if (elseBody !== null) s += `\n${k.else}\n${indent(elseBody)}`;
  return `${s}\n${k.endIf}`;
}

function example(construct: PseudoConstruct, st: Style): string {
  const k = st.k;
  switch (construct) {
    case 'output':
      return output(st, '"Hello, world!"');
    case 'variables':
      return `${assign(st, 'score', '0', true)}\n${assign(st, 'score', 'score + 1', false)}`;
    case 'input':
      return `${readInto(st, 'name')}\n${outputGreeting(st, 'Hi', 'name')}`;
    case 'if':
      return renderIf(st, [{ cond: 'age >= 13', body: output(st, '"Teen"') }], null);
    case 'else':
      return renderIf(
        st,
        [
          { cond: 'x > 0', body: output(st, '"positive"') },
          { cond: 'x < 0', body: output(st, '"negative"') },
        ],
        output(st, '"zero"'),
      );
    case 'logic':
      if (!st.on('if')) return output(st, `x > 0 ${k.and} x < 10`);
      return renderIf(st, [{ cond: `x > 0 ${k.and} x < 10`, body: output(st, '"single digit"') }], null);
    case 'modDiv':
      if (!st.on('if')) return output(st, `7 ${k.mod} 2`, `7 ${k.div} 2`);
      return renderIf(st, [{ cond: `n ${k.mod} 2 = 0`, body: output(st, '"even"') }], null);
    case 'while': {
      const header = st.braces ? `${k.while} (count < 5)` : `${k.while} count < 5${st.useDo ? ` ${k.do}` : ''}`;
      return block(st, header, assign(st, 'count', 'count + 1', false), k.endWhile);
    }
    case 'repeatUntil':
      if (st.braces) return block(st, `${k.repeat} ${k.until} (count = 5)`, assign(st, 'count', 'count + 1', false), k.endRepeat);
      if (st.on('input')) return `${k.repeat}\n${indent(readInto(st, 'guess'))}\n${k.until} guess = 7`;
      return `${k.repeat}\n${indent(assign(st, 'count', 'count + 1', false))}\n${k.until} count = 5`;
    case 'repeatTimes':
      return block(st, `${k.repeat} 3 ${k.times}`, output(st, '"Hip hip hooray!"'), k.endRepeat);
    case 'for': {
      const header = `${k.for} i ${st.forArrow ? st.assign : k.from} 1 ${k.to} 10`;
      return block(st, header, output(st, 'i'), st.closerNamesVariable ? `${k.endFor} i` : k.endFor);
    }
    case 'lists':
      return `${assign(st, 'pets', '["cat", "dog"]', true)}\n${output(st, `pets[${st.base}]`)}`;
    case 'forEach': {
      const header = `${st.forIn ? k.for : k.forEach} pet ${k.in} pets`;
      return block(st, header, output(st, 'pet'), st.closerNamesVariable ? `${k.endFor} pet` : k.endFor);
    }
    case 'procedures': {
      const definition = block(st, `${k.procedure} greet(name)`, outputGreeting(st, 'Hello', 'name'), k.endProcedure);
      return `${definition}\n${st.braces ? 'greet("Sam")' : `${k.call} greet("Sam")`}`;
    }
    case 'functions': {
      const body = st.braces ? `${k.return}(n * 2)` : `${k.return} n * 2`;
      return `${block(st, `${k.function} double(n)`, body, k.endFunction)}\n${output(st, 'double(4)')}`;
    }
  }
}

function constructWords(construct: PseudoConstruct, lang: Language, st: Style): string[] {
  const k = st.k;
  const ends = !st.braces;
  let words: Array<string | false | null>;
  switch (construct) {
    case 'output':
      words = [k.output];
      break;
    case 'input':
      words = [k.input];
      break;
    case 'variables':
      words = st.arrowFirst ? [st.assign] : [k.set, k.to, st.assign];
      break;
    case 'if':
      words = [k.if, !st.braces && k.then, ends && k.endIf];
      break;
    case 'else':
      words = [k.elseIf, k.else];
      break;
    case 'logic':
      words = [k.and, k.or, k.not, k.true, k.false];
      break;
    case 'modDiv':
      words = [k.mod, k.div];
      break;
    case 'while':
      words = [k.while, !st.braces && st.useDo && k.do, ends && k.endWhile];
      break;
    case 'repeatUntil':
      words = [k.repeat, k.until];
      break;
    case 'repeatTimes':
      words = [k.repeat, k.times, ends && k.endRepeat];
      break;
    case 'for':
      words = [k.for, !st.forArrow && k.from, k.to, k.step, ends && k.endFor];
      break;
    case 'lists':
      words = [];
      break;
    case 'forEach':
      words = [st.forIn ? k.for : k.forEach, k.in, ends && k.endFor];
      break;
    case 'procedures':
      words = [k.procedure, ends && k.endProcedure, !st.braces && k.call, !lang.constructOn('functions') && k.return];
      break;
    case 'functions':
      words = [k.function, k.return, ends && k.endFunction];
      break;
  }
  return words.filter((w): w is string => typeof w === 'string' && w.length > 0);
}

/** Word bank entries for every construct (enabled and locked), in teaching order. */
export function buildVocabulary(config: PseudocodeConfig): VocabEntry[] {
  const lang = getLanguage(config);
  const st = styleFor(lang);
  return CONSTRUCT_INFO.map((info) => ({
    construct: info.id,
    label: info.label,
    description: info.description,
    enabled: lang.constructOn(info.id),
    words: constructWords(info.id, lang, st),
    example: example(info.id, st),
  }));
}

/** Word bank entries for built-in functions. */
export function buildBuiltinVocabulary(config: PseudocodeConfig): VocabBuiltin[] {
  const lang = getLanguage(config);
  return BUILTIN_INFO.map((b) => {
    const name = lang.builtinName(b.id);
    return { id: b.id, name, signature: `${name}(${b.params.join(', ')})`, description: b.description, enabled: lang.builtinOn(b.id) };
  });
}

/** Longest first (most words, then most characters), so editors can match multi-word keywords before their parts. */
function longestFirst(words: Iterable<string>): string[] {
  return [...new Set(words)].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length || a.localeCompare(b));
}

/**
 * Word lists for editor syntax highlighting / autocomplete. `keywords` holds every keyword spelling (TRUE/FALSE and
 * the word operators included); `constants` and `wordOperators` are subsets for more specific styling.
 */
export function highlightWords(config: PseudocodeConfig): HighlightWords {
  const lang = getLanguage(config);
  const cfg = lang.config;
  const all: string[] = [];
  const locked: string[] = [];
  for (const info of KEYWORD_INFO) {
    for (const spelling of cfg.keywords[info.id]) {
      all.push(spelling);
      if (!lang.keywordOn(info.id)) locked.push(spelling);
    }
  }
  const spellings = (...slots: PseudoKeyword[]) => slots.flatMap((s) => cfg.keywords[s]);
  const symbols = ['+', '-', '*', '/', '^', '=', '==', '≠', '!=', '<>', '<', '>', '<=', '>=', '≤', '≥', ...cfg.assignOperators];
  if (lang.concatAmp) symbols.push('&');
  return {
    keywords: longestFirst(all),
    lockedKeywords: longestFirst(locked),
    builtins: longestFirst(BUILTIN_INFO.filter((b) => lang.builtinOn(b.id)).map((b) => lang.builtinName(b.id))),
    constants: longestFirst(spellings('true', 'false')),
    wordOperators: longestFirst(spellings('and', 'or', 'not', 'mod', 'div')),
    symbolOperators: longestFirst(symbols),
    commentPrefixes: longestFirst(cfg.commentPrefixes),
    caseSensitive: cfg.caseSensitive,
  };
}

/** Rewrites one of the CONSTRUCT_INFO examples (written in Classroom wording) using this config's words and block style. */
export function renderExample(construct: PseudoConstruct, config: PseudocodeConfig): string {
  return example(construct, styleFor(getLanguage(config)));
}

/** Default starter code for a new pseudocode file in this language (uses only enabled constructs). */
export function starterProgram(config: PseudocodeConfig): string {
  const lang = getLanguage(config);
  const comment = `${lang.config.commentPrefixes[0]} Write your program below`;
  if (!lang.constructOn('output')) return `${comment}\n`;
  return `${comment}\n${output(styleFor(lang), '"Hello, world!"')}\n`;
}
