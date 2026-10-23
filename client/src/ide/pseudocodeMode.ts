// Pseudocode editor support generated from the teacher's configuration: highlighting (multi-word and locked
// keywords), indentation, linting with the engine's checker, and keyword/built-in/variable autocomplete.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { StreamLanguage, syntaxTree, type StreamParser, type StringStream } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  BUILTIN_INFO,
  buildBuiltinVocabulary,
  checkPseudocode,
  highlightWords,
  type HighlightWords,
  type PseudoKeyword,
  type PseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { lockedKeywordTag } from './editorTheme';

const WORD_START = /[\p{L}_]/u;
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*/u;
const DEFAULT_SYMBOLS = ['<-', '←', '<=', '>=', '<>', '!=', '==', '≠', '≤', '≥', '=', '<', '>', '+', '-', '*', '/', '^', '&', '%'];

/** Keyword slots that start an indented block / end one (ELSE does both). */
const OPENERS: PseudoKeyword[] = ['if', 'elseIf', 'else', 'while', 'repeat', 'for', 'forEach', 'function', 'procedure'];
const CLOSERS: PseudoKeyword[] = ['elseIf', 'else', 'endIf', 'endWhile', 'until', 'endRepeat', 'endFor', 'endFunction', 'endProcedure'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "end   if" → "end if" (and lower-cased unless the language is case-sensitive). */
function normalizePhrase(phrase: string, caseSensitive: boolean): string {
  const collapsed = phrase.trim().split(/\s+/).join(' ');
  return caseSensitive ? collapsed : collapsed.toLowerCase();
}

/** Regex source matching any of `phrases` (longest first), words separated by spaces/tabs, ending at a word boundary. */
function phraseAlternation(phrases: readonly string[]): string | null {
  const unique = [...new Set(phrases.map((p) => p.trim().split(/\s+/).join(' ')).filter(Boolean))];
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  return unique
    .map((p) => {
      const body = p.split(' ').map(escapeRegExp).join('[ \\t]+');
      return /[\p{L}\p{N}_]$/u.test(p) ? `${body}(?![\\p{L}\\p{N}_])` : body;
    })
    .join('|');
}

type WordClass = 'locked' | 'constant' | 'operator' | 'keyword' | 'builtin';

export interface PseudocodeState {
  /** Indentation of the last non-blank line. */
  indent: number;
  /** Whether the last non-blank line opened a block. */
  opened: boolean;
  /** True until the first token of the current line has been read. */
  atLineStart: boolean;
}

export interface PseudocodeModeOptions {
  words: HighlightWords;
  /** Spelling → keyword slot, used for indentation. Optional (no smart indentation without it). */
  keywords?: Partial<Record<PseudoKeyword, string[]>>;
}

/** The CodeMirror stream parser for one pseudocode configuration. Exported for tests. */
export function createPseudocodeParser({ words, keywords }: PseudocodeModeOptions): StreamParser<PseudocodeState> {
  const cs = words.caseSensitive;
  const flags = cs ? 'u' : 'iu';
  const classes = new Map<string, WordClass>();
  const add = (list: readonly string[], cls: WordClass) => {
    for (const w of list) {
      const key = normalizePhrase(w, cs);
      if (key && !classes.has(key)) classes.set(key, cls);
    }
  };
  // Earlier lists win: a locked spelling stays locked even if it also appears in `keywords`.
  add(words.lockedKeywords, 'locked');
  add(words.constants, 'constant');
  add(words.wordOperators, 'operator');
  add(words.keywords, 'keyword');
  add(words.builtins, 'builtin');

  const phraseSource = phraseAlternation([...words.lockedKeywords, ...words.constants, ...words.wordOperators, ...words.keywords]);
  const phraseRe = phraseSource ? new RegExp(`^(?:${phraseSource})`, flags) : null;

  const symbols = [...new Set([...words.symbolOperators, ...DEFAULT_SYMBOLS])].sort((a, b) => b.length - a.length);
  const comments = [...words.commentPrefixes].filter(Boolean).sort((a, b) => b.length - a.length);

  const slotOf = new Map<string, PseudoKeyword>();
  for (const [slot, spellings] of Object.entries(keywords ?? {}) as Array<[PseudoKeyword, string[] | undefined]>) {
    for (const s of spellings ?? []) slotOf.set(normalizePhrase(s, cs), slot);
  }
  const openers = new Set(OPENERS);
  const closerSource = phraseAlternation(CLOSERS.flatMap((slot) => keywords?.[slot] ?? []));
  const closerRe = new RegExp(`^\\s*(?:${closerSource ? `${closerSource}|` : ''}\\})`, flags);

  function readString(stream: StringStream, quote: string): string {
    const close = quote === '“' ? '”' : quote;
    let escaped = false;
    for (;;) {
      const ch = stream.next();
      if (ch == null) break;
      if (ch === close && !escaped) break;
      escaped = !escaped && ch === '\\';
    }
    return 'string';
  }

  function tokenBase(stream: StringStream, state: PseudocodeState): string | null {
    const first = state.atLineStart;
    state.atLineStart = false;

    for (const prefix of comments) {
      if (stream.match(prefix)) {
        stream.skipToEnd();
        return 'comment';
      }
    }

    const ch = stream.peek() ?? '';
    if (ch === '"' || ch === "'" || ch === '“') {
      stream.next();
      return readString(stream, ch);
    }
    if (/\d/.test(ch)) {
      stream.match(/^\d+(?:\.\d+)?/);
      return 'number';
    }

    if (WORD_START.test(ch)) {
      if (phraseRe) {
        const m = stream.match(phraseRe);
        if (m && typeof m !== 'boolean') {
          const key = normalizePhrase(m[0], cs);
          if (first && openers.has(slotOf.get(key) as PseudoKeyword)) state.opened = true;
          switch (classes.get(key)) {
            case 'locked':
              return 'lockedKeyword';
            case 'constant':
              return 'bool';
            case 'operator':
              return 'operatorKeyword';
            default:
              return 'keyword';
          }
        }
      }
      const m = stream.match(IDENTIFIER);
      const word = m && typeof m !== 'boolean' ? m[0] : (stream.next() ?? '');
      if (classes.get(normalizePhrase(word, cs)) === 'builtin') return 'variableName.function.standard';
      return stream.match(/^\s*\(/, false) ? 'variableName.function' : 'variableName';
    }

    for (const sym of symbols) {
      if (stream.match(sym)) return 'operator';
    }

    stream.next();
    switch (ch) {
      case '(':
      case ')':
        return 'paren';
      case '[':
      case ']':
        return 'squareBracket';
      case '{':
        state.opened = true;
        return 'brace';
      case '}':
        return 'brace';
      case ',':
        return 'separator';
      case ':':
      case '.':
      case ';':
        return 'punctuation';
      default:
        return null;
    }
  }

  return {
    name: 'pseudocode',
    startState: () => ({ indent: 0, opened: false, atLineStart: true }),
    token(stream, state) {
      if (stream.sol()) {
        state.atLineStart = true;
        // A new non-blank line resets the block-opening flag.
        if (!/^\s*$/.test(stream.string)) {
          state.indent = stream.indentation();
          state.opened = false;
        }
      }
      if (stream.eatSpace()) return null;
      return tokenBase(stream, state);
    },
    indent(state, textAfter, context) {
      let indent = state.indent + (state.opened ? context.unit : 0);
      if (closerRe.test(textAfter)) indent -= context.unit;
      return Math.max(0, indent);
    },
    tokenTable: { lockedKeyword: lockedKeywordTag },
    languageData: {
      commentTokens: words.commentPrefixes[0] ? { line: words.commentPrefixes[0] } : undefined,
      closeBrackets: { brackets: ['(', '[', '{', '"'] },
      indentOnInput: new RegExp(`^\\s*(?:${closerSource ? `${closerSource}|` : ''}\\})$`, flags),
    },
  };
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/** Where a multi-word keyword the user is half-way through starts in `before` (e.g. "END I" for "END IF"). */
export function multiWordStart(before: string, phrase: string, caseSensitive: boolean): number | null {
  const parts = phrase.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const partial = /[\p{L}\p{N}_]*$/u.exec(before)?.[0] ?? '';
  const head = before.slice(0, before.length - partial.length);
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
  for (let k = parts.length - 1; k >= 1; k--) {
    if (!norm(parts[k]!).startsWith(norm(partial))) continue;
    const lead = parts.slice(0, k).map(escapeRegExp).join('[ \\t]+');
    const m = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${lead}[ \\t]+)$`, caseSensitive ? 'u' : 'iu').exec(head);
    if (m) return head.length - m[1]!.length;
  }
  return null;
}

/** Identifiers used in the program (outside strings and comments), for variable completion. */
function documentIdentifiers(state: EditorState, commentPrefixes: readonly string[], skipFrom: number): Set<string> {
  const found = new Set<string>();
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 50_000));
  let offset = 0;
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    for (const prefix of commentPrefixes) {
      const i = prefix ? line.indexOf(prefix) : -1;
      if (i >= 0) line = line.slice(0, i);
    }
    line = line.replace(/"[^"]*"?|'[^']*'?|“[^”]*”?/g, (s) => ' '.repeat(s.length));
    for (const m of line.matchAll(/[\p{L}_][\p{L}\p{N}_]*/gu)) {
      // Skip the word being typed.
      if (offset + (m.index ?? 0) + m[0].length === skipFrom) continue;
      found.add(m[0]);
    }
    offset += rawLine.length + 1;
  }
  return found;
}

/** Keyword, built-in and variable completions (locked keywords are never suggested). Exported for tests. */
export function pseudocodeCompletionSource(config: PseudocodeConfig, words: HighlightWords): CompletionSource {
  const cs = words.caseSensitive;
  const locked = new Set(words.lockedKeywords.map((w) => normalizePhrase(w, cs)));
  const reserved = new Set(
    [...words.keywords, ...words.lockedKeywords, ...words.constants, ...words.wordOperators, ...words.builtins].flatMap((w) =>
      w.split(/\s+/).map((part) => normalizePhrase(part, cs)),
    ),
  );

  const usable = (w: string) => !locked.has(normalizePhrase(w, cs));
  const keywordWords = [...new Set([...words.keywords, ...words.wordOperators].filter(usable))];
  const constantWords = [...new Set(words.constants.filter(usable))];

  const builtinOptions: Completion[] = (() => {
    let vocab: ReturnType<typeof buildBuiltinVocabulary> = [];
    try {
      vocab = buildBuiltinVocabulary(config).filter((b) => b.enabled);
    } catch {
      vocab = [];
    }
    if (vocab.length === 0) return words.builtins.map((name) => ({ label: name, type: 'function' }));
    return vocab.map((b) => {
      const params = BUILTIN_INFO.find((info) => info.id === b.id)?.params ?? [];
      const template = `${b.name}(${params.map((p) => `\${${p}}`).join(', ')})`;
      return snippetCompletion(template, { label: b.name, type: 'function', detail: `(${params.join(', ')})`, info: b.description });
    });
  })();

  return (ctx: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (/string|comment/i.test(node.type.name)) return null;

    const word = ctx.matchBefore(/[\p{L}_][\p{L}\p{N}_]*/u);
    if (!word && !ctx.explicit) return null;
    const from = word ? word.from : ctx.pos;

    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const options: Completion[] = [];

    for (const kw of keywordWords) {
      const start = kw.includes(' ') ? multiWordStart(before, kw, cs) : null;
      if (start == null) {
        options.push({ label: kw, type: 'keyword' });
        continue;
      }
      const phraseFrom = line.from + start;
      options.push({
        label: kw,
        type: 'keyword',
        apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
          view.dispatch({ changes: { from: phraseFrom, to, insert: kw }, selection: { anchor: phraseFrom + kw.length } });
        },
      });
    }
    for (const c of constantWords) options.push({ label: c, type: 'constant' });
    options.push(...builtinOptions);

    for (const id of documentIdentifiers(ctx.state, words.commentPrefixes, word ? word.to : -1)) {
      if (!reserved.has(normalizePhrase(id, cs))) options.push({ label: id, type: 'variable', boost: -1 });
    }

    return { from, options };
  };
}

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

function pseudocodeLinter(config: PseudocodeConfig): Extension {
  return linter(
    (view): Diagnostic[] => {
      const doc = view.state.doc;
      let problems: ReturnType<typeof checkPseudocode>;
      try {
        problems = checkPseudocode(doc.toString(), config);
      } catch {
        return [];
      }
      return problems.map((p) => {
        const line = doc.line(Math.min(Math.max(1, p.line), doc.lines));
        const from = Math.min(line.from + Math.max(0, p.column - 1), line.to);
        let to = p.endColumn != null ? Math.min(line.from + Math.max(0, p.endColumn - 1), line.to) : from;
        if (to <= from) {
          const rest = line.text.slice(from - line.from);
          const len = /^[\p{L}\p{N}_]+/u.exec(rest)?.[0].length ?? (rest.length > 0 ? 1 : 0);
          to = from + len;
        }
        return {
          from,
          to,
          severity: p.severity,
          message: p.hint ? `${p.message} ${p.hint}` : p.message,
        };
      });
    },
    { delay: 450 },
  );
}

/** Everything the editor needs for one pseudocode language. */
export function pseudocodeSupport(config: PseudocodeConfig): Extension {
  const words = highlightWords(config);
  const language = StreamLanguage.define(createPseudocodeParser({ words, keywords: config.keywords }));
  return [
    language,
    language.data.of({ autocomplete: pseudocodeCompletionSource(config, words) }),
    pseudocodeLinter(config),
    lintGutter(),
  ];
}
