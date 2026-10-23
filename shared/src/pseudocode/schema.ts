import { z } from 'zod';
import type { PseudocodeConfig } from './types';

const word = z.string().trim().min(1).max(40);

const keywordSlot = z.array(word).min(1).max(8);

/** Validates the *shape* of a PseudocodeConfig. Semantic checks (clashing words, etc.) live in `validatePseudocodeConfig`. */
export const pseudocodeConfigSchema = z.object({
  version: z.literal(1),
  presetId: z.string().max(60),
  caseSensitive: z.boolean(),
  keywords: z.object({
    output: keywordSlot, input: keywordSlot, set: keywordSlot, to: keywordSlot,
    if: keywordSlot, then: keywordSlot, elseIf: keywordSlot, else: keywordSlot, endIf: keywordSlot,
    while: keywordSlot, do: keywordSlot, endWhile: keywordSlot,
    repeat: keywordSlot, until: keywordSlot, times: keywordSlot, endRepeat: keywordSlot,
    for: keywordSlot, from: keywordSlot, step: keywordSlot, endFor: keywordSlot, forEach: keywordSlot, in: keywordSlot,
    function: keywordSlot, endFunction: keywordSlot, return: keywordSlot,
    procedure: keywordSlot, endProcedure: keywordSlot, call: keywordSlot,
    and: keywordSlot, or: keywordSlot, not: keywordSlot, mod: keywordSlot, div: keywordSlot,
    true: keywordSlot, false: keywordSlot,
  }),
  constructs: z.object({
    output: z.boolean(), input: z.boolean(), variables: z.boolean(), if: z.boolean(), else: z.boolean(),
    while: z.boolean(), repeatUntil: z.boolean(), repeatTimes: z.boolean(), for: z.boolean(), forEach: z.boolean(),
    logic: z.boolean(), modDiv: z.boolean(), lists: z.boolean(), functions: z.boolean(), procedures: z.boolean(),
  }),
  builtins: z.object({
    length: z.object({ name: word, enabled: z.boolean() }),
    append: z.object({ name: word, enabled: z.boolean() }),
    insert: z.object({ name: word, enabled: z.boolean() }),
    remove: z.object({ name: word, enabled: z.boolean() }),
    random: z.object({ name: word, enabled: z.boolean() }),
    round: z.object({ name: word, enabled: z.boolean() }),
    int: z.object({ name: word, enabled: z.boolean() }),
    str: z.object({ name: word, enabled: z.boolean() }),
    num: z.object({ name: word, enabled: z.boolean() }),
    upper: z.object({ name: word, enabled: z.boolean() }),
    lower: z.object({ name: word, enabled: z.boolean() }),
    substring: z.object({ name: word, enabled: z.boolean() }),
    abs: z.object({ name: word, enabled: z.boolean() }),
    sqrt: z.object({ name: word, enabled: z.boolean() }),
  }),
  assignOperators: z.array(z.string().trim().min(1).max(4)).max(6),
  commentPrefixes: z.array(z.string().trim().min(1).max(4)).min(1).max(4),
  blockStyle: z.enum(['keywords', 'braces', 'both']),
  outputSeparator: z.string().max(4),
  outputNewline: z.boolean(),
  listIndexBase: z.union([z.literal(0), z.literal(1)]),
  concatOperators: z.array(z.enum(['+', '&'])).min(1).max(2),
}) satisfies z.ZodType<PseudocodeConfig>;
