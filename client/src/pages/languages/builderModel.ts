// Draft model for the pseudocode language builder: what the teacher is editing, how it compares to the saved
// language, and the problems that must be fixed before it can be saved.

import type { Language } from '@codeclass/shared';
import {
  BUILTIN_INFO,
  createPseudocodeConfig,
  DEFAULT_PRESET_ID,
  KEYWORD_INFO,
  PSEUDOCODE_PRESETS,
  starterProgram,
  validatePseudocodeConfig,
  type PseudoKeyword,
  type PseudocodeConfig,
  type PseudocodePreset,
} from '@codeclass/shared/pseudocode';

/** Limits mirrored from `pseudocodeConfigSchema` / `updateLanguageSchema` so problems show before saving. */
export const LIMITS = {
  nameLength: 60,
  descriptionLength: 500,
  starterCodeLength: 20000,
  wordLength: 40,
  spellingsPerKeyword: 8,
  symbolLength: 4,
  commentPrefixes: 4,
  assignOperators: 6,
} as const;

export interface LanguageDraft {
  name: string;
  description: string;
  enabled: boolean;
  starterCode: string;
  pseudocode: PseudocodeConfig;
}

export function toDraft(language: Language): LanguageDraft {
  return {
    name: language.name,
    description: language.description,
    enabled: language.enabled,
    starterCode: language.starterCode,
    pseudocode: language.pseudocode ?? createPseudocodeConfig(),
  };
}

/** Structural comparison (drafts are plain JSON). */
export function sameDraft(a: LanguageDraft, b: LanguageDraft): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function findPreset(id: string): PseudocodePreset | undefined {
  return PSEUDOCODE_PRESETS.find((p) => p.id === id);
}

export function presetOrDefault(id: string): PseudocodePreset {
  return findPreset(id) ?? findPreset(DEFAULT_PRESET_ID) ?? PSEUDOCODE_PRESETS[0]!;
}

/** The primary (first) spelling of a keyword, falling back to the Classroom default. */
export function primaryWord(config: PseudocodeConfig, keyword: PseudoKeyword): string {
  return config.keywords[keyword]?.[0] ?? KEYWORD_INFO.find((k) => k.id === keyword)?.defaults[0] ?? keyword.toUpperCase();
}

/** Trims spellings, collapses inner whitespace and drops duplicates (respecting case sensitivity). */
export function cleanWords(values: string[], caseSensitive: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const word = raw.trim().replace(/\s+/g, ' ');
    if (!word) continue;
    const key = caseSensitive ? word : word.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** A program to try the language with: the generated starter program, else the preset's sample. */
export function sampleProgram(config: PseudocodeConfig): string {
  return starterProgram(config) || presetOrDefault(config.presetId).sample;
}

/** Everything that blocks saving: shape limits (checked here) plus the engine's semantic validation. */
export function draftProblems(draft: LanguageDraft): string[] {
  const settings: string[] = [];
  const problems: string[] = [];
  const c = draft.pseudocode;

  if (!draft.name.trim()) settings.push('Give the language a name (Settings tab).');
  else if (draft.name.trim().length > LIMITS.nameLength) settings.push(`The name can be at most ${LIMITS.nameLength} characters.`);
  if (draft.description.trim().length > LIMITS.descriptionLength) {
    settings.push(`The description can be at most ${LIMITS.descriptionLength} characters.`);
  }
  if (draft.starterCode.length > LIMITS.starterCodeLength) settings.push('The starter code is too long.');

  for (const k of KEYWORD_INFO) {
    const words = c.keywords[k.id] ?? [];
    if (words.length === 0) problems.push(`"${k.label}" needs at least one word.`);
    if (words.length > LIMITS.spellingsPerKeyword) {
      problems.push(`"${k.label}" can have at most ${LIMITS.spellingsPerKeyword} spellings.`);
    }
    for (const w of words) {
      if (w.length > LIMITS.wordLength) problems.push(`"${w.slice(0, 20)}…" is too long for a keyword.`);
    }
  }
  for (const b of BUILTIN_INFO) {
    const name = c.builtins[b.id]?.name.trim() ?? '';
    if (!name) problems.push(`The built-in ${b.defaultName} needs a name (Built-ins tab).`);
    else if (name.length > LIMITS.wordLength) problems.push(`The name for ${b.defaultName} is too long.`);
  }
  if (c.commentPrefixes.length === 0) problems.push('Add at least one comment symbol, such as // (Rules tab).');
  if (c.commentPrefixes.length > LIMITS.commentPrefixes) {
    problems.push(`Use at most ${LIMITS.commentPrefixes} comment symbols.`);
  }
  for (const p of c.commentPrefixes) {
    if (p.length > LIMITS.symbolLength) problems.push(`The comment symbol "${p}" is too long (${LIMITS.symbolLength} characters at most).`);
  }
  if (c.assignOperators.length > LIMITS.assignOperators) problems.push(`Use at most ${LIMITS.assignOperators} assignment symbols.`);
  if (c.outputSeparator.length > LIMITS.symbolLength) {
    problems.push(`The text between output values can be at most ${LIMITS.symbolLength} characters.`);
  }
  if (c.concatOperators.length === 0) problems.push('Choose at least one way to join text, + or & (Rules tab).');

  // The engine's semantic checks assume a well-formed config; skip them until the shape problems are fixed.
  if (problems.length === 0) {
    try {
      problems.push(...validatePseudocodeConfig(c));
    } catch {
      problems.push('These settings could not be checked. Try undoing your last change.');
    }
  }
  return [...new Set([...settings, ...problems])];
}
