// STUB — replaced by real presets.
import { BUILTIN_INFO, KEYWORD_INFO, type PseudoBuiltin, type PseudoKeyword, type PseudocodeConfig, type PseudocodePreset } from './types';

export const DEFAULT_PRESET_ID = 'classroom';

function classroom(): PseudocodeConfig {
  return {
    version: 1,
    presetId: 'classroom',
    caseSensitive: false,
    keywords: Object.fromEntries(KEYWORD_INFO.map((k) => [k.id, [...k.defaults]])) as Record<PseudoKeyword, string[]>,
    constructs: {
      output: true, input: true, variables: true, if: true, else: true, while: true, repeatUntil: true,
      repeatTimes: true, for: true, forEach: true, logic: true, modDiv: true, lists: true, functions: true, procedures: true,
    },
    builtins: Object.fromEntries(BUILTIN_INFO.map((b) => [b.id, { name: b.defaultName, enabled: true }])) as Record<
      PseudoBuiltin,
      { name: string; enabled: boolean }
    >,
    assignOperators: ['←', '<-'],
    commentPrefixes: ['//'],
    blockStyle: 'keywords',
    outputSeparator: ' ',
    outputNewline: true,
    listIndexBase: 1,
    concatOperators: ['+', '&'],
  };
}

export const PSEUDOCODE_PRESETS: PseudocodePreset[] = [
  { id: 'classroom', name: 'Classroom', description: 'Plain-English pseudocode.', config: classroom(), sample: 'OUTPUT "Hello, world!"' },
];

/** A fresh, deep-copied config for the given preset (falls back to the default preset). */
export function createPseudocodeConfig(presetId: string = DEFAULT_PRESET_ID): PseudocodeConfig {
  const preset = PSEUDOCODE_PRESETS.find((p) => p.id === presetId) ?? PSEUDOCODE_PRESETS[0]!;
  return JSON.parse(JSON.stringify(preset.config)) as PseudocodeConfig;
}

/** Fills missing fields of a stored/older config with defaults so the engine can always run it. */
export function normalizePseudocodeConfig(raw: unknown): PseudocodeConfig {
  return { ...classroom(), ...(raw as Partial<PseudocodeConfig>) };
}

/** Semantic validation (e.g. two keyword slots using the same word). Returns human-readable problems; empty = valid. */
export function validatePseudocodeConfig(_config: PseudocodeConfig): string[] {
  return [];
}
