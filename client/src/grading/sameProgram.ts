// "Same program as your solution": whether a student's code is the teacher's solution typed differently. Programs
// are compared as syntax trees, not text — pseudocode with the engine's own parser, the pack languages with the
// Lezer parsers the IDE highlights with (Lua with a small tokenizer) — so spacing, indentation, blank lines and
// comments don't count, while everything that can change what the program does (names, numbers, operators, nesting,
// statement order, the text inside quotes) does. Only text a program prints as it is — a string that is an argument
// of print(), console.log(), OUTPUT and the like, or an input prompt — follows the assignment's compare mode, as its
// output would; every other string (a comparison, a dictionary key, a split() separator, SQL) counts exactly as
// typed. A web page's text counts as a browser shows it, whatever the compare mode. The parsers load on first use
// (the IDE's chunks already have them), so pages that only show a badge don't carry them.
import type { javascriptLanguage } from '@codemirror/lang-javascript';
import type { CompareMode, LanguageKind } from '@codeclass/shared';
import type { PseudocodeConfig } from '@codeclass/shared/pseudocode';

type Tree = ReturnType<typeof javascriptLanguage.parser.parse>;
type SyntaxNode = Tree['topNode'];
/** Printed text as the compare mode sees it (`normalizeLiteral` with backslash escapes kept). */
type Literal = (text: string) => string;
const asTyped: Literal = (text) => text;

/** What decides how a program is read: the language kind, and for pseudocode the language's configuration. */
export interface SameProgramTarget {
  kind: LanguageKind;
  pseudocode?: PseudocodeConfig | null;
}

// ---- Syntax trees (Lezer) --------------------------------------------------------------------------------------

interface TreeRules {
  /** Strings (a leaf, or the text between a template's / f-string's parts): kept as typed unless `printed`. */
  strings: ReadonlySet<string>;
  /** Text kept exactly as typed (regular expressions, format specs, quoted names). */
  exact: ReadonlySet<string>;
  /** Code inside a string (`${…}`, an f-string's `{…}`), compared as code again. */
  code: ReadonlySet<string>;
  /** 'a' and "a" are the same string (not in SQL, where "a" is a name). */
  sameQuotes: boolean;
  /** A string whose text is printed as it is, so it follows the compare mode. */
  printed?: (node: SyntaxNode, src: string) => boolean;
  /** A leaf's item, when the default (`Name:text`) doesn't fit; null leaves it out. */
  leaf?: (name: string, text: string, node: SyntaxNode) => string | null | undefined;
  /** Nodes left out with everything in them. */
  drop?: (node: SyntaxNode) => boolean;
  /** Code the parser takes although the language refuses it (a syntax error the tree doesn't show). */
  invalid?: (node: SyntaxNode, src: string) => boolean;
}

const COMMENT = /Comment/;
const QUOTED = /^([A-Za-z]*)("""|'''|["'`])([\s\S]*)\2$/;

/** A quoted literal with its text as `literal` gives it (and "…" quotes when the quote style can't matter). */
function quotedLiteral(text: string, literal: Literal, sameQuotes: boolean): string {
  const m = QUOTED.exec(text);
  if (!m) return literal(text);
  const [, prefix, quote, body] = m as unknown as [string, string, string, string];
  const q = sameQuotes && (quote === '"' || quote === "'") && !/["'\\\n]/.test(body) ? '"' : quote;
  return `${prefix}${q}${literal(body)}${q}`;
}

/**
 * The tree as a list of items: `(Name … )` around each node's children, `Name:text` for each leaf, and each token
 * the grammar doesn't name (keywords, punctuation) on its own, so whitespace between tokens is gone but nothing
 * glues together. Comments are left out. Null when the tree has a syntax error.
 */
function fingerprintTree(tree: Tree, src: string, rules: TreeRules, literal: Literal): string | null {
  const out: string[] = [];
  let broken = false;
  // 'string': text kept as typed; 'printed': text in compare-mode form.
  const visit = (node: SyntaxNode, context: 'code' | 'string' | 'printed' | 'exact') => {
    const name = node.type.name;
    if (node.type.isError || rules.invalid?.(node, src)) broken = true;
    if (broken || COMMENT.test(name) || rules.drop?.(node)) return;
    const ctx = rules.code.has(name)
      ? 'code'
      : rules.exact.has(name)
        ? 'exact'
        : rules.strings.has(name) && context === 'code'
          ? rules.printed?.(node, src)
            ? 'printed'
            : 'string'
          : context;
    const text = ctx === 'printed' ? literal : asTyped;
    let child = node.firstChild;
    if (!child) {
      const source = src.slice(node.from, node.to);
      const item = rules.leaf?.(name, source, node);
      if (item === undefined) {
        // A whole string is one leaf; a part of one (an escape) is kept as typed.
        const whole = rules.strings.has(name) && (ctx === 'string' || ctx === 'printed');
        out.push(`${name}:${whole ? quotedLiteral(source, text, rules.sameQuotes) : source}`);
      } else if (item !== null) {
        out.push(item);
      }
      return;
    }
    out.push(`(${name}`);
    let pos = node.from;
    const gap = (to: number) => {
      const between = src.slice(pos, to);
      if (ctx === 'code') {
        for (const piece of between.split(/\s+/)) if (piece) out.push(`'${piece}`);
      } else {
        const value = text(between);
        if (value) out.push(`"${value}`);
      }
    };
    for (; child; child = child.nextSibling) {
      gap(child.from);
      visit(child, ctx);
      pos = child.to;
    }
    gap(node.to);
    out.push(')');
  };
  visit(tree.topNode, 'code');
  return broken ? null : out.join('\u0001');
}

/**
 * A `;` that ends a JavaScript statement: the statement is the same with or without it (where statements end is
 * part of the tree's shape, so a missing `;` that changes the meaning still shows). Kept inside `for ( ; ; )` and in
 * CSS.
 */
function statementSemicolon(node: SyntaxNode): boolean {
  if (node.type.name !== ';' || node.parent?.type.name === 'ForSpec') return false;
  for (let n = node.parent; n; n = n.parent) {
    if (n.type.name === 'Script') return true;
    if (n.type.name === 'StyleSheet') return false;
  }
  return false;
}

/**
 * Whether a string is printed as it is: an argument of a call that prints its arguments (`output` matches the
 * callee, spaces removed) — on its own, in brackets, or joined to others with `+`. Not when it's used any other way
 * (`print("a b".split())`, `print(x == "yes")`).
 */
function printedArgument(node: SyntaxNode, src: string, output: RegExp): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    switch (parent.type.name) {
      case 'ParenthesizedExpression':
        continue;
      case 'BinaryExpression': {
        const op = parent.getChild('ArithOp');
        if (!op || src.slice(op.from, op.to) !== '+') return false;
        continue;
      }
      case 'ArgList': {
        const callee = parent.parent?.type.name === 'CallExpression' ? parent.parent.firstChild : null;
        return !!callee && callee !== parent && output.test(src.slice(callee.from, callee.to).replace(/\s+/g, ''));
      }
      default:
        return false;
    }
  }
  return false;
}

// What prints its arguments (and the input calls whose prompt it prints). console.log's first argument can hold
// %-directives ("%s"), where spacing and capitals matter, so a string with a % is kept as typed.
const JS_OUTPUT = /^(?:console\.(?:log|info|debug)|process\.stdout\.write|alert|prompt|input|[\w$]+\.question)$/;
const PYTHON_OUTPUT = /^(?:print|input|sys\.stdout\.write)$/;

/** `=>` on a line of its own: JavaScript allows no line break before it, but the parser takes one. */
function arrowAfterLineBreak(node: SyntaxNode, src: string): boolean {
  return node.type.name === 'Arrow' && !!node.prevSibling && /[\n\u2028\u2029]/.test(src.slice(node.prevSibling.to, node.from));
}

const JS_RULES: TreeRules = {
  strings: new Set(['String', 'TemplateString']),
  exact: new Set(['RegExp']),
  code: new Set(['Interpolation']),
  sameQuotes: true,
  printed: (node, src) => printedArgument(node, src, JS_OUTPUT) && !src.slice(node.from, node.to).includes('%'),
  drop: statementSemicolon,
  invalid: arrowAfterLineBreak,
};

const PYTHON_RULES: TreeRules = {
  strings: new Set(['String', 'FormatString']),
  exact: new Set(['FormatSpec', 'FormatConversion']),
  code: new Set(['FormatReplacement']),
  sameQuotes: true,
  printed: (node, src) => printedArgument(node, src, PYTHON_OUTPUT),
};

/**
 * Whether Python accepts the program's indentation. The parser takes some indentation Python refuses, without an
 * error: a line indented for no reason ("unexpected indent"), a dedent to a column no enclosing block uses
 * ("unindent does not match any outer indentation level"), a block header (a line ending in ":") with no indented
 * block after it, and tabs and spaces mixed so that the indentation depends on the tab width (TabError). This
 * follows CPython's tokenizer over logical lines: strings, brackets and a backslash at the end of a line join lines,
 * and blank and comment-only lines don't count. Also false for a string in single quotes left open at a line end.
 */
export function pythonIndentationValid(src: string): boolean {
  // Columns with a tab as up to 8 spaces (`col`) and as 1 (`alt`): Python wants both to agree on every comparison.
  const levels = [{ col: 0, alt: 0 }];
  let quote = '';
  let brackets = 0;
  let continued = false;
  let header = false;
  // The last character of code on the current logical line.
  let last = '';
  for (const line of src.split('\n')) {
    let i = 0;
    if (!quote && brackets === 0 && !continued) {
      let col = 0;
      let alt = 0;
      for (; i < line.length; i++) {
        const ch = line[i];
        if (ch === ' ') {
          col++;
          alt++;
        } else if (ch === '\t') {
          col += 8 - (col % 8);
          alt++;
        } else if (ch === '\f') {
          col = alt = 0;
        } else {
          break;
        }
      }
      if (i === line.length || line[i] === '#') continue;
      const top = levels[levels.length - 1]!;
      if (col > top.col) {
        if (!header || alt <= top.alt) return false;
        levels.push({ col, alt });
      } else {
        if (header) return false;
        while (col < levels[levels.length - 1]!.col) levels.pop();
        const level = levels[levels.length - 1]!;
        if (col !== level.col || alt !== level.alt) return false;
      }
      last = '';
    }
    continued = false;
    let openAtEnd = false;
    for (; i < line.length; i++) {
      const ch = line[i]!;
      if (quote) {
        if (ch === '\\') {
          openAtEnd = i === line.length - 1;
          i++;
        } else if (line.startsWith(quote, i)) {
          i += quote.length - 1;
          quote = '';
          last = ch;
        }
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch;
        i += quote.length - 1;
        continue;
      }
      if (ch === '\\' && i === line.length - 1) {
        continued = true;
        break;
      }
      if ('([{'.includes(ch)) brackets++;
      else if (')]}'.includes(ch)) brackets = Math.max(0, brackets - 1);
      if (ch !== ' ' && ch !== '\t' && ch !== '\f') last = ch;
    }
    if (quote.length === 1 && !openAtEnd) return false;
    if (!quote && brackets === 0 && !continued) header = last === ':';
  }
  return !header;
}

/** The last `;` of the script: SQL runs the last statement the same with or without it. */
function finalSemicolon(node: SyntaxNode): boolean {
  if (node.type.name !== ';' || node.nextSibling || node.parent?.type.name !== 'Statement') return false;
  for (let n = node.parent.nextSibling; n; n = n.nextSibling) if (n.type.name === 'Statement') return false;
  return true;
}

const SQL_RULES: TreeRules = {
  strings: new Set(['String']),
  exact: new Set(['QuotedIdentifier']),
  code: new Set(),
  sameQuotes: false,
  // Keywords and type names are case-insensitive. Names are kept as typed: a column's header prints as typed.
  leaf: (name, text) => (name === 'Keyword' || name === 'Type' || name === 'Builtin' ? `${name}:${text.toUpperCase()}` : undefined),
  drop: finalSemicolon,
};

/** Inside <pre> or <textarea>, where the browser shows spaces and line breaks as typed. */
function keepsSpaces(node: SyntaxNode, src: string): boolean {
  if (node.type.name === 'TextareaText') return true;
  for (let n = node.parent; n; n = n.parent) {
    if (n.type.name !== 'Element') continue;
    const tag = n.firstChild?.getChild('TagName');
    if (tag && /^(pre|textarea)$/i.test(src.slice(tag.from, tag.to))) return true;
  }
  return false;
}

/**
 * Elements a browser shows on lines of their own, or doesn't show (and <br>, which ends a line): spaces and line
 * breaks next to them, or at the start or end of what's in them, don't show.
 */
const BLOCK_TAGS = new Set(
  (
    'html head body title meta link style script base noscript template address article aside blockquote details ' +
    'dialog summary dd div dl dt fieldset legend figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li ' +
    'main nav ol ul p pre section table caption colgroup col thead tbody tfoot tr td th option optgroup select br'
  ).split(' '),
);

function tagName(element: SyntaxNode, src: string): string {
  const tag = element.firstChild?.getChild('TagName');
  return tag ? src.slice(tag.from, tag.to).toLowerCase() : '';
}

/** Whether spaces at this side of a text node don't show: next to a block element, or at the edge of one. */
function atBlockEdge(node: SyntaxNode, src: string, side: 'before' | 'after'): boolean {
  const step = (n: SyntaxNode) => (side === 'before' ? n.prevSibling : n.nextSibling);
  let next = step(node);
  // Comments and the doctype don't show at all.
  while (next && /^(Comment|DoctypeDecl|ProcessingInst)$/.test(next.type.name)) next = step(next);
  if (!next || next.type.name === 'OpenTag' || next.type.name === 'CloseTag') {
    const parent = node.parent;
    return parent?.type.name !== 'Element' || BLOCK_TAGS.has(tagName(parent, src));
  }
  return next.type.name === 'Element' && BLOCK_TAGS.has(tagName(next, src));
}

/**
 * A text node as the browser shows it: runs of spaces and line breaks as one space (as typed in <pre> and
 * <textarea>, or anywhere when `asTypedSpaces`), none where they meet a block element. Null when nothing shows.
 */
function shownText(node: SyntaxNode, src: string, asTypedSpaces: boolean): string | null {
  const text = src.slice(node.from, node.to);
  if (asTypedSpaces || keepsSpaces(node, src)) return text;
  let shown = text.replace(/[ \t\n\f\r]+/g, ' ');
  if (shown.startsWith(' ') && atBlockEdge(node, src, 'before')) shown = shown.slice(1);
  if (shown.endsWith(' ') && atBlockEdge(node, src, 'after')) shown = shown.slice(0, -1);
  return shown === '' ? null : shown;
}

/**
 * The page's text counts as it shows, whatever the compare mode: the mode is for program output, and web pages have
 * none (no tests). On a page whose CSS sets `white-space` (spaces may show as typed anywhere), text counts as typed.
 * The JavaScript in <script> and the CSS in <style> are parsed too, their strings kept as typed.
 */
function htmlRules(src: string): TreeRules {
  const asTypedSpaces = /white-space\s*:/i.test(src);
  return {
    strings: new Set([...JS_RULES.strings, 'StringLiteral']),
    exact: new Set([...JS_RULES.exact, 'ScriptText', 'StyleText']),
    code: JS_RULES.code,
    sameQuotes: true,
    drop: statementSemicolon,
    invalid: arrowAfterLineBreak,
    leaf: (name, text, node) => {
      if (name === 'Text' || name === 'TextareaText') {
        const shown = shownText(node, src, asTypedSpaces);
        return shown === null ? null : `Text:${shown}`;
      }
      if (name === 'TagName' || name === 'AttributeName') return `${name}:${text.toLowerCase()}`;
      if (name === 'AttributeValue' || name === 'UnquotedAttributeValue') return `AttributeValue:${text.replace(/^(['"])([\s\S]*)\1$/, '$2')}`;
      if (name === 'DoctypeDecl') return `${name}:${text.toLowerCase().replace(/\s+/g, ' ')}`;
      return undefined;
    },
  };
}

/** The Lezer parser for a kind (loaded on first use), or null when the kind has none. */
async function treeParser(kind: LanguageKind): Promise<{ parse(input: string): Tree } | null> {
  switch (kind) {
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascriptLanguage.parser;
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).typescriptLanguage.parser;
    case 'python':
      return (await import('@codemirror/lang-python')).pythonLanguage.parser;
    case 'web':
      // lang-html's parser also parses <script> as JavaScript and <style> as CSS.
      return (await import('@codemirror/lang-html')).htmlLanguage.parser;
    case 'sql':
      return (await import('@codemirror/lang-sql')).SQLite.language.parser;
    default:
      return null;
  }
}

// ---- Lua ---------------------------------------------------------------------------------------------------------

// CodeMirror's Lua mode is a highlighter whose names swallow "-" and "." (x-1 is one name), so Lua gets an exact
// tokenizer instead. Groups: 1 long comment level, 2 long string level, 3 quoted string.
const LUA_TOKEN =
  /\s+|--\[(=*)\[|--[^\n]*|\[(=*)\[|("(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*')|0[xX][\da-fA-F]*(?:\.[\da-fA-F]*)?(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\.\.\.|\.\.|==|~=|<=|>=|<<|>>|\/\/|::|[-+*/%^#&~|<>=(){}[\];:,.]/y;

/** A Lua token: its text, or for a string its quoted text (`quoted`) or a long string's contents (`long`). */
interface LuaToken {
  text: string;
  quoted?: string;
  long?: string;
}

const LUA_KEYWORDS = new Set(
  'and break do else elseif end for function goto if in local not or repeat return then until while'.split(' '),
);

/**
 * The strings Lua prints as they are (by index): arguments of print() and io.write() made only of strings, names and
 * `..`, as in `print("Total: " .. total)` — not `print("a" == x)` or `print(#"a b")` — and `print "text"`.
 */
function luaPrinted(tokens: LuaToken[]): Set<number> {
  const printed = new Set<number>();
  const text = (i: number) => tokens[i]?.text;
  const output = (i: number) =>
    (text(i) === 'print' && text(i - 1) !== '.' && text(i - 1) !== ':') || (text(i) === 'write' && text(i - 1) === '.' && text(i - 2) === 'io');
  const isString = (t: LuaToken) => t.quoted !== undefined || t.long !== undefined;
  // One frame per open bracket: whether it holds an output call's arguments, and the current argument's strings.
  const frames: Array<{ output: boolean; strings: number[]; plain: boolean }> = [];
  const endArgument = (frame: { output: boolean; strings: number[]; plain: boolean }) => {
    if (frame.output && frame.plain) for (const i of frame.strings) printed.add(i);
    frame.strings = [];
    frame.plain = true;
  };
  tokens.forEach((token, i) => {
    const frame = frames[frames.length - 1];
    if (token.text === '(' || token.text === '{' || token.text === '[') {
      frames.push({ output: token.text === '(' && output(i - 1), strings: [], plain: true });
    } else if (token.text === ')' || token.text === '}' || token.text === ']') {
      if (frame) endArgument(frame);
      frames.pop();
    } else if (isString(token) && output(i - 1)) {
      printed.add(i);
    } else if (frame) {
      if (token.text === ',' || token.text === ';') endArgument(frame);
      else if (isString(token)) frame.strings.push(i);
      // Anything but a name, a number, `.`/`:` (a field or method) or `..` makes the argument more than text.
      else if (!(/^[A-Za-z_\d]/.test(token.text) && !LUA_KEYWORDS.has(token.text)) && !/^(\.|:|\.\.)$/.test(token.text)) frame.plain = false;
    }
  });
  return printed;
}

/**
 * Lua as a list of tokens without whitespace and comments; null on an unfinished string or comment, or a character
 * Lua doesn't use. A `;` before a name or the end is left out (it can't change where a statement ends there).
 */
function luaFingerprint(src: string, literal: Literal): string | null {
  const tokens: LuaToken[] = [];
  for (let i = 0; i < src.length; ) {
    LUA_TOKEN.lastIndex = i;
    const m = LUA_TOKEN.exec(src);
    if (!m) return null;
    let end = LUA_TOKEN.lastIndex;
    const level = m[1] ?? m[2];
    if (level !== undefined) {
      const close = src.indexOf(`]${level}]`, end);
      if (close < 0) return null;
      if (m[2] !== undefined) tokens.push({ text: m[0], long: src.slice(end, close) });
      end = close + level.length + 2;
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], quoted: m[3] });
    } else if (!/^\s|^--/.test(m[0])) {
      tokens.push({ text: m[0] });
    }
    i = end;
  }
  const printed = luaPrinted(tokens);
  const items = tokens.map((token, i) => {
    const text = printed.has(i) ? literal : asTyped;
    if (token.long !== undefined) return `[[${text(token.long)}]]`;
    return token.quoted !== undefined ? quotedLiteral(token.quoted, text, true) : token.text;
  });
  return items.filter((t, i) => t !== ';' || (i + 1 < items.length && !/^[A-Za-z_]/.test(items[i + 1]!))).join('\u0001');
}

// ---- Text (when neither program parses) --------------------------------------------------------------------------

interface Lexis {
  /** Comments and literals (each regex is sticky and matches the whole thing, or up to the end if it never closes). */
  spans: Array<{ re: RegExp; literal: boolean }>;
  /** Indentation counts (Python). */
  keepIndent: boolean;
  /** Whitespace next to a bracket or between a name and an operator can go (not in HTML, where it shows). */
  tight: boolean;
  sameQuotes: boolean;
}

const lineString = (q: string) => ({ re: new RegExp(`${q}(?:[^${q}\\\\\\n]|\\\\[\\s\\S])*${q}?`, 'y'), literal: true });
const lineComment = (prefix: string) => ({ re: new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[^\\n]*`, 'y'), literal: false });
const C_COMMENTS = [{ re: /\/\*[\s\S]*?(?:\*\/|$)/y, literal: false }, lineComment('//')];
const TEMPLATE = { re: /`(?:[^`\\]|\\[\s\S])*`?/y, literal: true };

function lexis(target: SameProgramTarget): Lexis {
  const base = { keepIndent: false, tight: true, sameQuotes: true };
  switch (target.kind) {
    case 'python':
      return {
        ...base,
        keepIndent: true,
        spans: [
          lineComment('#'),
          { re: /"""(?:\\[\s\S]|(?!""")[^\\])*(?:""")?/y, literal: true },
          { re: /'''(?:\\[\s\S]|(?!''')[^\\])*(?:''')?/y, literal: true },
          lineString('"'),
          lineString("'"),
        ],
      };
    case 'lua':
      return {
        ...base,
        spans: [
          { re: /--\[(=*)\[[\s\S]*?(?:\]\1\]|$)/y, literal: false },
          lineComment('--'),
          { re: /\[(=*)\[[\s\S]*?(?:\]\1\]|$)/y, literal: true },
          lineString('"'),
          lineString("'"),
        ],
      };
    case 'sql':
      return {
        ...base,
        sameQuotes: false,
        spans: [lineComment('--'), C_COMMENTS[0]!, { re: /'[^']*'?/y, literal: true }, { re: /"[^"]*"?/y, literal: true }, { re: /`[^`]*`?/y, literal: true }],
      };
    case 'web':
      return { ...base, tight: false, spans: [{ re: /<!--[\s\S]*?(?:-->|$)/y, literal: false }, lineString('"'), lineString("'"), TEMPLATE] };
    case 'pseudocode':
      return {
        ...base,
        spans: [
          ...(target.pseudocode?.commentPrefixes ?? []).filter((p) => p !== '').map(lineComment),
          { re: /["“][^"”\n]*["”]?/y, literal: true },
          { re: /['‘][^'’\n]*['’]?/y, literal: true },
        ],
      };
    default:
      return { ...base, spans: [...C_COMMENTS, lineString('"'), lineString("'"), TEMPLATE] };
  }
}

const SPACE = /[^\S\n]|​/;
const WORD = /[\p{L}\p{N}_$]/u;
/** Brackets and separators: never part of a longer operator, so whitespace next to them can't matter. */
const SEPARATOR = /[()[\]{},;]/;

/**
 * The code with whitespace removed only where it can't matter: blank lines, spaces at line ends, indentation
 * (except in Python), runs of spaces (one is kept between two names or two operators, so `a - -b` stays apart from
 * `a--b`), and in HTML only runs of spaces. Comments and the text inside quotes are kept as typed (whether that text
 * is printed can't be told without parsing); line breaks are kept.
 */
function textForm(src: string, rules: Lexis): string {
  const lines: string[] = [];
  let line = '';
  let indent = '';
  let gap = false;
  let last: 'word' | 'op' | 'sep' | null = null;
  const token = (text: string, cls: 'word' | 'op' | 'sep') => {
    if (line && gap && (!rules.tight || (cls === last && cls !== 'sep'))) line += ' ';
    line += text;
    gap = false;
    last = cls;
  };
  for (let i = 0; i < src.length; ) {
    const ch = src[i]!;
    if (ch === '\n') {
      if (line) lines.push(indent + line);
      line = indent = '';
      gap = false;
      i++;
      continue;
    }
    if (SPACE.test(ch)) {
      if (line) gap = true;
      else if (rules.keepIndent) indent += ch;
      i++;
      continue;
    }
    const span = rules.spans.find(({ re }) => ((re.lastIndex = i), re.test(src)));
    if (span) {
      const text = src.slice(i, span.re.lastIndex);
      token(span.literal ? quotedLiteral(text, asTyped, rules.sameQuotes) : text, 'word');
      i += text.length;
      continue;
    }
    if (WORD.test(ch)) {
      let j = i + 1;
      while (j < src.length && WORD.test(src[j]!)) j++;
      token(src.slice(i, j), 'word');
      i = j;
      continue;
    }
    token(ch, SEPARATOR.test(ch) ? 'sep' : 'op');
    i++;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

function sameText(target: SameProgramTarget, code: string, solution: string): boolean {
  const a = code.replace(/\r\n?/g, '\n');
  const b = solution.replace(/\r\n?/g, '\n');
  // Spaces and line breaks show as typed inside <pre> and <textarea>.
  if (target.kind === 'web' && /<(pre|textarea)\b/i.test(a + b)) return a.trim() === b.trim();
  const rules = lexis(target);
  return textForm(a, rules) === textForm(b, rules);
}

// ---- Public API --------------------------------------------------------------------------------------------------

/**
 * A canonical form of the program (see the top of this file) under the compare mode: equal strings mean the same
 * program. Null when it doesn't parse, or when there's nothing to parse it with (pseudocode without its config).
 */
export async function programFingerprint(target: SameProgramTarget, code: string, compareMode: CompareMode): Promise<string | null> {
  // Only the "same program" part of the pseudocode engine: its barrel would bring the interpreter into the page.
  const pseudocode = await import('@codeclass/shared/pseudocode/fingerprint');
  const literal: Literal = (text) => pseudocode.normalizeLiteral(text, compareMode, true);
  const src = code.replace(/\r\n?/g, '\n');
  if (target.kind === 'pseudocode') return target.pseudocode ? pseudocode.pseudocodeFingerprint(src, target.pseudocode, compareMode) : null;
  if (target.kind === 'lua') return luaFingerprint(src, literal);
  if (target.kind === 'python' && !pythonIndentationValid(src)) return null;
  const parser = await treeParser(target.kind);
  if (!parser) return null;
  const rules = target.kind === 'web' ? htmlRules(src) : target.kind === 'python' ? PYTHON_RULES : target.kind === 'sql' ? SQL_RULES : JS_RULES;
  return fingerprintTree(parser.parse(src), src, rules, literal);
}

/**
 * Whether `code` is the same program as the teacher's `solution` (see the top of this file). When one of them
 * doesn't parse and the other does, they aren't (one has a syntax error). When neither parses, their text is
 * compared with whitespace removed only where it can't matter — never inside quotes (that text counts as typed),
 * never Python's indentation — and blank lines dropped. A blank solution matches nothing. Never rejects.
 */
export async function sameProgram(
  target: SameProgramTarget,
  code: string,
  solution: string | null | undefined,
  compareMode: CompareMode,
): Promise<boolean> {
  if (solution == null || solution.trim() === '') return false;
  let a: string | null = null;
  let b: string | null = null;
  try {
    [a, b] = await Promise.all([programFingerprint(target, code, compareMode), programFingerprint(target, solution, compareMode)]);
  } catch {
    // A parser that didn't load: compare the text.
  }
  if (a !== null && b !== null) return a === b;
  if (a !== null || b !== null) return false;
  return sameText(target, code, solution);
}
