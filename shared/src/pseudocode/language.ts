// A PseudocodeConfig compiled into the lookup tables the lexer, parser and interpreter need.
import { normalizePseudocodeConfig } from './presets';
import {
  BUILTIN_INFO,
  KEYWORD_INFO,
  type PseudoBuiltin,
  type PseudoConstruct,
  type PseudoKeyword,
  type PseudocodeConfig,
} from './types';

export interface TrieNode {
  children: Map<string, TrieNode>;
  slot: PseudoKeyword | null;
}

export interface Language {
  readonly config: PseudocodeConfig;
  /** Keyword spellings as a trie over (normalised) words, for greedy longest-first matching. */
  readonly trie: TrieNode;
  /** Primary spelling of every keyword slot (used in messages). */
  readonly kw: Readonly<Record<PseudoKeyword, string>>;
  /** First word of each multi-word spelling → slots (for "END needs another word" errors). */
  readonly firstWords: ReadonlyMap<string, readonly PseudoKeyword[]>;
  /** Upper-cased spelling → spelling as configured (for "capital letters matter" hints). */
  readonly spellingsByUpper: ReadonlyMap<string, string>;
  /** Upper-cased first word → multi-word spellings starting with it (for "capital letters matter" hints on `End IF`). */
  readonly multiWordByFirstUpper: ReadonlyMap<string, readonly string[]>;
  readonly builtinByName: ReadonlyMap<string, PseudoBuiltin>;
  readonly assignOps: ReadonlySet<string>;
  /** First assignment operator, or null when only SET … TO is available. */
  readonly assign: string | null;
  /** "=" assigns at the start of a statement. */
  readonly equalsAssigns: boolean;
  /** "<-" is one token (an assignment operator) rather than "<" followed by "-". */
  readonly lexArrow: boolean;
  /** Comment prefixes, longest first. */
  readonly commentPrefixes: readonly string[];
  readonly bracesAllowed: boolean;
  readonly keywordBlocksAllowed: boolean;
  readonly concatPlus: boolean;
  readonly concatAmp: boolean;
  readonly base: 0 | 1;
  readonly trueText: string;
  readonly falseText: string;
  norm(word: string): string;
  constructOn(c: PseudoConstruct): boolean;
  keywordOn(slot: PseudoKeyword): boolean;
  builtinOn(id: PseudoBuiltin): boolean;
  builtinName(id: PseudoBuiltin): string;
  /** `x ← 5`, or `SET x TO 5` when there is no assignment operator. */
  assignExample(name: string, value: string): string;
}

/**
 * Whether a keyword can be used. Mostly the keyword's own construct, but some words are shared: RETURN and CALL work
 * in procedures as well as functions, END REPEAT closes both REPEAT forms, END FOR closes FOR and FOR EACH, and TO is
 * used by SET … TO and FOR … TO.
 */
export function keywordEnabled(slot: PseudoKeyword, on: Readonly<Record<PseudoConstruct, boolean>>): boolean {
  switch (slot) {
    case 'return':
    case 'call':
      return on.functions || on.procedures;
    case 'to':
      return on.variables || on.for;
    case 'repeat':
    case 'endRepeat':
      return on.repeatUntil || on.repeatTimes;
    case 'endFor':
      return on.for || on.forEach;
    case 'elseIf':
    case 'else':
      return on.else && on.if;
    default:
      return on[KEYWORD_INFO.find((k) => k.id === slot)!.construct];
  }
}

export function builtinEnabled(id: PseudoBuiltin, config: PseudocodeConfig): boolean {
  const info = BUILTIN_INFO.find((b) => b.id === id)!;
  return config.builtins[id].enabled && (info.requires === null || config.constructs[info.requires]);
}

function compile(config: PseudocodeConfig): Language {
  const caseSensitive = config.caseSensitive;
  const norm = caseSensitive ? (w: string) => w : (w: string) => w.toUpperCase();

  const trie: TrieNode = { children: new Map(), slot: null };
  const kw = {} as Record<PseudoKeyword, string>;
  const firstWords = new Map<string, PseudoKeyword[]>();
  const spellingsByUpper = new Map<string, string>();
  const multiWordByFirstUpper = new Map<string, string[]>();
  for (const info of KEYWORD_INFO) {
    const spellings = config.keywords[info.id];
    kw[info.id] = spellings[0] ?? info.defaults[0]!;
    for (const spelling of spellings) {
      const words = spelling.split(' ').filter(Boolean);
      if (words.length === 0) continue;
      let node = trie;
      for (const word of words) {
        const key = norm(word);
        let next = node.children.get(key);
        if (!next) {
          next = { children: new Map(), slot: null };
          node.children.set(key, next);
        }
        node = next;
      }
      if (node.slot === null) node.slot = info.id;
      if (words.length > 1) {
        const first = norm(words[0]!);
        const slots = firstWords.get(first) ?? [];
        if (!slots.includes(info.id)) slots.push(info.id);
        firstWords.set(first, slots);
        const upper = words[0]!.toUpperCase();
        const multi = multiWordByFirstUpper.get(upper) ?? [];
        if (!multi.includes(spelling)) multi.push(spelling);
        multiWordByFirstUpper.set(upper, multi);
      }
      if (!spellingsByUpper.has(spelling.toUpperCase())) spellingsByUpper.set(spelling.toUpperCase(), spelling);
    }
  }

  const builtinByName = new Map<string, PseudoBuiltin>();
  for (const b of BUILTIN_INFO) {
    const key = norm(config.builtins[b.id].name);
    if (!builtinByName.has(key)) builtinByName.set(key, b.id);
  }

  const assignOps = new Set(config.assignOperators);
  const assign = config.assignOperators[0] ?? null;
  const on = config.constructs;

  return {
    config,
    trie,
    kw,
    firstWords,
    spellingsByUpper,
    multiWordByFirstUpper,
    builtinByName,
    assignOps,
    assign,
    equalsAssigns: assignOps.has('='),
    lexArrow: assignOps.has('<-'),
    commentPrefixes: [...config.commentPrefixes].sort((a, b) => b.length - a.length),
    bracesAllowed: config.blockStyle !== 'keywords',
    keywordBlocksAllowed: config.blockStyle !== 'braces',
    concatPlus: config.concatOperators.includes('+'),
    concatAmp: config.concatOperators.includes('&'),
    base: config.listIndexBase,
    trueText: kw.true,
    falseText: kw.false,
    norm,
    constructOn: (c) => on[c],
    keywordOn: (slot) => keywordEnabled(slot, on),
    builtinOn: (id) => builtinEnabled(id, config),
    builtinName: (id) => config.builtins[id].name,
    assignExample: (name, value) => (assign ? `${name} ${assign} ${value}` : `${kw.set} ${name} ${kw.to} ${value}`),
  };
}

// Configs are small, so a JSON fingerprint is a cheap and mutation-proof cache key (checkPseudocode runs per keystroke).
const cache = new Map<string, Language>();
const CACHE_SIZE = 16;

/** The compiled form of any config (normalised first, so drafts and stored configs of any age work). */
export function getLanguage(config: PseudocodeConfig): Language {
  let key: string | null = null;
  try {
    key = JSON.stringify(config) ?? null;
  } catch {
    key = null;
  }
  if (key !== null) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const lang = compile(normalizePseudocodeConfig(config));
  if (key !== null) {
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, lang);
  }
  return lang;
}
