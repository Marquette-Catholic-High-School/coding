// STUB — replaced by the real word-bank helpers.
import type { HighlightWords, PseudoConstruct, PseudocodeConfig, VocabBuiltin, VocabEntry } from './types';

/** Word bank entries for every construct (enabled and locked), in teaching order. */
export function buildVocabulary(_config: PseudocodeConfig): VocabEntry[] {
  return [];
}

/** Word bank entries for built-in functions. */
export function buildBuiltinVocabulary(_config: PseudocodeConfig): VocabBuiltin[] {
  return [];
}

/** Word lists for editor syntax highlighting / autocomplete. */
export function highlightWords(config: PseudocodeConfig): HighlightWords {
  return {
    keywords: [], lockedKeywords: [], builtins: [], constants: [], wordOperators: [], symbolOperators: [],
    commentPrefixes: config.commentPrefixes, caseSensitive: config.caseSensitive,
  };
}

/** Rewrites one of the CONSTRUCT_INFO examples (written in Classroom wording) using this config's words and block style. */
export function renderExample(_construct: PseudoConstruct, _config: PseudocodeConfig): string {
  return '';
}

/** Default starter code for a new pseudocode file in this language (uses only enabled constructs). */
export function starterProgram(_config: PseudocodeConfig): string {
  return '';
}
