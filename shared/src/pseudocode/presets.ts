// Built-in pseudocode presets plus config normalisation and validation.
import {
  BUILTIN_INFO,
  KEYWORD_INFO,
  type BlockStyle,
  type PseudoBuiltin,
  type PseudoBuiltinSetting,
  type PseudoConstruct,
  type PseudoKeyword,
  type PseudocodeConfig,
  type PseudocodePreset,
} from './types';

export const DEFAULT_PRESET_ID = 'classroom';

/** Operators a teacher may choose for `x ← 5` style assignment. */
export const ASSIGN_OPERATORS: readonly string[] = ['←', '<-', '=', ':='];

const CONSTRUCTS: readonly PseudoConstruct[] = [
  'output', 'input', 'variables', 'if', 'else', 'while', 'repeatUntil', 'repeatTimes', 'for', 'forEach', 'logic',
  'modDiv', 'lists', 'functions', 'procedures',
];

const SPELLING = /^[A-Za-z_][A-Za-z0-9_]*(?: [A-Za-z_][A-Za-z0-9_]*)*$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * The symbols a teacher may choose to start comments. The lexer looks for comments before operators, so any other symbol
 * risks swallowing code written without spaces (`!` starts `!=`, `((` starts `((1 + 2) * 3)`, `*(` is in `2*(1+2)`), and
 * `'` starts text. With `--`, subtracting a negative number needs a space (`5 - -2`, since `5--2` is `5` and a comment);
 * with `;`, a semicolon no longer separates two instructions on one line.
 */
export const COMMENT_PREFIXES: readonly string[] = ['//', '#', '--', '%', ';'];
/** Keyword slots whose words may also be names (the parser's connector words, DECLARE and CONSTANT). */
const NAME_LIKE_SLOTS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>([
  'set', 'to', 'from', 'step', 'times', 'do', 'then', 'call', 'in', 'declare', 'constant',
]);
/** Keyword slots that start a value, so they can follow IF, WHILE, OUTPUT, RETURN … (`IF NOT done`). */
const VALUE_SLOTS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>(['true', 'false', 'not', 'input', 'mod', 'div']);
/** Keyword slots that end or continue a block; several may share a line (`END IF END WHILE`). */
const CLOSER_SLOTS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>([
  'elseIf', 'else', 'endIf', 'endWhile', 'endRepeat', 'until', 'endFor', 'endFunction', 'endProcedure',
]);
const MAX_SPELLINGS = 8;
const MAX_WORD_LENGTH = 40;

function keywords(overrides: Partial<Record<PseudoKeyword, string[]>> = {}): Record<PseudoKeyword, string[]> {
  const out = {} as Record<PseudoKeyword, string[]>;
  for (const k of KEYWORD_INFO) out[k.id] = [...(overrides[k.id] ?? k.defaults)];
  return out;
}

function constructs(enabled: readonly PseudoConstruct[] | 'all'): Record<PseudoConstruct, boolean> {
  const out = {} as Record<PseudoConstruct, boolean>;
  for (const c of CONSTRUCTS) out[c] = enabled === 'all' || enabled.includes(c);
  return out;
}

/** `enabled` lists the built-ins that are switched on (all when 'all'); `names` renames some. */
function builtins(
  enabled: readonly PseudoBuiltin[] | 'all',
  names: Partial<Record<PseudoBuiltin, string>> = {},
): Record<PseudoBuiltin, PseudoBuiltinSetting> {
  const out = {} as Record<PseudoBuiltin, PseudoBuiltinSetting>;
  for (const b of BUILTIN_INFO) {
    out[b.id] = { name: names[b.id] ?? b.defaultName, enabled: enabled === 'all' || enabled.includes(b.id) };
  }
  return out;
}

function classroomConfig(): PseudocodeConfig {
  return {
    version: 1,
    presetId: 'classroom',
    caseSensitive: false,
    keywords: keywords(),
    constructs: constructs('all'),
    builtins: builtins('all'),
    assignOperators: ['←', '<-'],
    commentPrefixes: ['//'],
    blockStyle: 'keywords',
    outputSeparator: ' ',
    outputNewline: true,
    listIndexBase: 1,
    concatOperators: ['+', '&'],
  };
}

function starterConfig(): PseudocodeConfig {
  return {
    ...classroomConfig(),
    presetId: 'starter',
    constructs: constructs(['output', 'input', 'variables']),
    builtins: builtins([]),
  };
}

function apCspConfig(): PseudocodeConfig {
  return {
    version: 1,
    presetId: 'ap-csp',
    caseSensitive: false,
    keywords: keywords({ output: ['DISPLAY'], true: ['true'], false: ['false'] }),
    constructs: constructs([
      'output', 'input', 'variables', 'if', 'else', 'repeatUntil', 'repeatTimes', 'forEach', 'logic', 'modDiv', 'lists',
      'procedures',
    ]),
    builtins: builtins(['length', 'append', 'insert', 'remove', 'random']),
    assignOperators: ['←', '<-'],
    commentPrefixes: ['//'],
    blockStyle: 'braces',
    outputSeparator: ' ',
    outputNewline: false,
    listIndexBase: 1,
    concatOperators: ['+'],
  };
}

function cambridgeConfig(): PseudocodeConfig {
  return {
    version: 1,
    presetId: 'cambridge',
    caseSensitive: false,
    keywords: keywords({
      endIf: ['ENDIF'],
      endWhile: ['ENDWHILE'],
      endRepeat: ['ENDREPEAT'],
      endFor: ['NEXT'],
      endFunction: ['ENDFUNCTION'],
      endProcedure: ['ENDPROCEDURE'],
    }),
    constructs: constructs([
      'output', 'input', 'variables', 'if', 'else', 'while', 'repeatUntil', 'for', 'logic', 'modDiv', 'lists', 'functions',
      'procedures',
    ]),
    builtins: builtins(['length', 'random', 'round', 'int', 'str', 'num', 'upper', 'lower', 'substring'], {
      upper: 'UCASE',
      lower: 'LCASE',
      str: 'NUM_TO_STR',
      num: 'STR_TO_NUM',
    }),
    assignOperators: ['←', '<-'],
    commentPrefixes: ['//'],
    blockStyle: 'keywords',
    outputSeparator: '',
    outputNewline: true,
    listIndexBase: 1,
    concatOperators: ['&'],
  };
}

function aqaConfig(): PseudocodeConfig {
  return {
    version: 1,
    presetId: 'aqa',
    caseSensitive: false,
    keywords: keywords({
      input: ['USERINPUT'],
      endIf: ['ENDIF'],
      endWhile: ['ENDWHILE'],
      endRepeat: ['ENDREPEAT'],
      endFor: ['ENDFOR'],
      function: ['SUBROUTINE'],
      endFunction: ['ENDSUBROUTINE'],
      endProcedure: ['ENDPROCEDURE'],
      true: ['True'],
      false: ['False'],
      constant: ['constant'],
    }),
    constructs: constructs([
      'output', 'input', 'variables', 'if', 'else', 'while', 'repeatUntil', 'for', 'forEach', 'logic', 'modDiv', 'lists',
      'functions',
    ]),
    builtins: builtins(['length', 'random', 'str', 'num'], {
      length: 'LEN',
      random: 'RANDOM_INT',
      str: 'INT_TO_STRING',
      num: 'STRING_TO_INT',
    }),
    assignOperators: ['←', '<-'],
    commentPrefixes: ['#'],
    blockStyle: 'keywords',
    outputSeparator: ' ',
    outputNewline: true,
    listIndexBase: 0,
    concatOperators: ['+'],
  };
}

const CLASSROOM_SAMPLE = `// Classroom pseudocode: loops, lists and a function
FUNCTION square(n)
  RETURN n * n
END FUNCTION

SET total TO 0
FOR i FROM 1 TO 5
  total ← total + square(i)
END FOR
OUTPUT "The first 5 square numbers add up to", total

SET pets TO ["cat", "dog", "rabbit"]
FOR EACH pet IN pets
  IF LENGTH(pet) = 3 THEN
    OUTPUT pet, "has 3 letters"
  ELSE
    OUTPUT pet, "has", LENGTH(pet), "letters"
  END IF
END FOR

SET countdown TO 3
WHILE countdown > 0 DO
  OUTPUT countdown
  countdown ← countdown - 1
END WHILE
OUTPUT "Lift off!"`;

const STARTER_SAMPLE = `// My first program
OUTPUT "Hello! What is your name?"
INPUT name
OUTPUT "Nice to meet you,", name
SET age TO 11
age ← age + 1
OUTPUT "Next year you will be", age`;

const AP_CSP_SAMPLE = `// Average of a list of test scores
PROCEDURE average(numbers)
{
  total ← 0
  FOR EACH n IN numbers
  {
    total ← total + n
  }
  RETURN(total / LENGTH(numbers))
}

scores ← [85, 92, 78]
APPEND(scores, 95)
result ← average(scores)
IF(result ≥ 80)
{
  DISPLAY("Great work!")
}
ELSE
{
  DISPLAY("Keep practising!")
}
DISPLAY(result)

count ← 0
REPEAT UNTIL(count = 3)
{
  count ← count + 1
}
REPEAT 2 TIMES
{
  DISPLAY(count)
}`;

const CAMBRIDGE_SAMPLE = `// Sum of the even square numbers up to 10
FUNCTION Square(Number : INTEGER) RETURNS INTEGER
    RETURN Number * Number
ENDFUNCTION

PROCEDURE ShowStars(Count : INTEGER)
    Stars ← ""
    FOR Index ← 1 TO Count
        Stars ← Stars & "*"
    NEXT Index
    OUTPUT Stars
ENDPROCEDURE

Total ← 0
FOR Counter ← 1 TO 10
    IF Counter MOD 2 = 0
      THEN
        Total ← Total + Square(Counter)
    ENDIF
NEXT Counter
OUTPUT "Total: ", Total

IF Total > 200
  THEN
    OUTPUT "That is more than 200"
  ELSE
    OUTPUT "That is 200 or less"
ENDIF
CALL ShowStars(5)`;

const AQA_SAMPLE = `# Add up the marks in an array
SUBROUTINE total(marks)
   sum ← 0
   FOR mark IN marks
      sum ← sum + mark
   ENDFOR
   RETURN sum
ENDSUBROUTINE

scores ← [12, 18, 15]
OUTPUT 'First score: ' + INT_TO_STRING(scores[0])
result ← total(scores)
IF result ≥ 40 THEN
   OUTPUT 'Pass'
ELSE
   OUTPUT 'Try again'
ENDIF

count ← 3
WHILE count > 0
   OUTPUT count
   count ← count - 1
ENDWHILE
OUTPUT result`;

export const PSEUDOCODE_PRESETS: PseudocodePreset[] = [
  {
    id: 'classroom',
    name: 'Classroom',
    description:
      'Plain-English pseudocode with everything switched on: OUTPUT, INPUT, SET … TO and ←, IF / ELSE IF / ELSE, WHILE, ' +
      'REPEAT … UNTIL, REPEAT n TIMES, FOR, FOR EACH, lists, functions and procedures. Lists start at 1.',
    config: classroomConfig(),
    sample: CLASSROOM_SAMPLE,
  },
  {
    id: 'starter',
    name: 'Starter',
    description:
      'For the very first lessons: OUTPUT, INPUT and variables only. Switch on IF, loops and the rest as your class ' +
      "learns them — students who use a word too early are told they haven't learned it yet.",
    config: starterConfig(),
    sample: STARTER_SAMPLE,
  },
  {
    id: 'ap-csp',
    name: 'AP CSP',
    description:
      'Matches the College Board AP Computer Science Principles exam reference sheet: DISPLAY, INPUT(), ←, { } blocks, ' +
      'IF / ELSE, REPEAT n TIMES, REPEAT UNTIL, FOR EACH, PROCEDURE with RETURN, RANDOM(a, b) and lists that start at 1 ' +
      'with APPEND, INSERT, REMOVE and LENGTH.',
    config: apCspConfig(),
    sample: AP_CSP_SAMPLE,
  },
  {
    id: 'cambridge',
    name: 'Cambridge IGCSE / A Level',
    description:
      'Cambridge IGCSE (0478) and AS & A Level (9618) style: DECLARE (ARRAY[1:n] OF … makes a list), CONSTANT, ' +
      'OUTPUT and INPUT, ←, IF … THEN … ELSE … ENDIF, WHILE … DO … ENDWHILE, REPEAT … UNTIL, ' +
      'FOR … ← … TO … STEP … NEXT, PROCEDURE … ENDPROCEDURE with CALL and BYREF / BYVAL, ' +
      'FUNCTION … RETURNS … ENDFUNCTION, MOD and DIV, LENGTH, UCASE, LCASE, SUBSTRING and & to join strings.',
    config: cambridgeConfig(),
    sample: CAMBRIDGE_SAMPLE,
  },
  {
    id: 'aqa',
    name: 'AQA GCSE',
    description:
      'AQA GCSE Computer Science (8525) pseudo-code: OUTPUT, USERINPUT, ←, constant, IF … THEN … ELSE IF … ENDIF, ' +
      'WHILE … ENDWHILE, REPEAT … UNTIL, FOR … ← … TO … ENDFOR, FOR … IN, SUBROUTINE … ENDSUBROUTINE, LEN, ' +
      'RANDOM_INT, # comments and arrays that start at 0.',
    config: aqaConfig(),
    sample: AQA_SAMPLE,
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A fresh, deep-copied config for the given preset (falls back to the default preset). */
export function createPseudocodeConfig(presetId: string = DEFAULT_PRESET_ID): PseudocodeConfig {
  const preset = PSEUDOCODE_PRESETS.find((p) => p.id === presetId) ?? PSEUDOCODE_PRESETS[0]!;
  return clone(preset.config);
}

// ---------------------------------------------------------------------------------------------------------------
// Normalisation: make any stored/draft value safe for the engine
// ---------------------------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Trims and collapses runs of spaces; null when the result isn't a valid spelling. */
function cleanSpelling(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.length > 0 && s.length <= MAX_WORD_LENGTH && SPELLING.test(s) ? s : null;
}

function commentPrefixProblem(prefix: string): string | null {
  if (prefix.length === 0) return "Comment symbols can't be empty.";
  if (COMMENT_PREFIXES.includes(prefix)) return null;
  const choices = `${COMMENT_PREFIXES.slice(0, -1).join(', ')} or ${COMMENT_PREFIXES[COMMENT_PREFIXES.length - 1]}`;
  return `"${prefix}" can't start comments — choose from ${choices}.`;
}

/**
 * Whether `short` followed by the keyword `next` (a spelling of `nextSlot`) can be written as two separate keywords in a
 * working program. If it can, a longer spelling `short next` of the same keyword would change what that code means.
 */
function keywordsCanFollow(shortSlot: PseudoKeyword, nextSlot: PseudoKeyword): boolean {
  // ELSE IF and REPEAT UNTIL: the parser reads a longer spelling that ends in IF / UNTIL the same way.
  if ((shortSlot === 'else' && nextSlot === 'if') || (shortSlot === 'repeat' && nextSlot === 'until')) return false;
  if (VALUE_SLOTS.has(nextSlot)) return true;
  // An instruction may follow THEN, DO and ELSE on the same line; a closing word may follow another one.
  if (shortSlot === 'then' || shortSlot === 'do' || shortSlot === 'else') return true;
  return CLOSER_SLOTS.has(shortSlot) && CLOSER_SLOTS.has(nextSlot);
}

/**
 * Turns anything (a stored config, an older version, a half-edited draft, garbage) into a complete, valid-shaped
 * config: deep-merges with the Classroom defaults, drops unknown keys and repairs empty or invalid entries.
 */
export function normalizePseudocodeConfig(raw: unknown): PseudocodeConfig {
  const base = classroomConfig();
  if (!isRecord(raw)) return base;

  const caseSensitive = typeof raw.caseSensitive === 'boolean' ? raw.caseSensitive : base.caseSensitive;

  const rawKeywords = isRecord(raw.keywords) ? raw.keywords : {};
  const kw = {} as Record<PseudoKeyword, string[]>;
  for (const info of KEYWORD_INFO) {
    const value = rawKeywords[info.id];
    const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const seen = new Set<string>();
    const spellings: string[] = [];
    for (const item of list) {
      const s = cleanSpelling(item);
      if (!s) continue;
      const key = caseSensitive ? s : s.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      spellings.push(s);
      if (spellings.length === MAX_SPELLINGS) break;
    }
    kw[info.id] = spellings.length > 0 ? spellings : [...base.keywords[info.id]];
  }

  const rawConstructs = isRecord(raw.constructs) ? raw.constructs : {};
  const cons = {} as Record<PseudoConstruct, boolean>;
  for (const c of CONSTRUCTS) {
    const v = rawConstructs[c];
    cons[c] = typeof v === 'boolean' ? v : base.constructs[c];
  }

  const rawBuiltins = isRecord(raw.builtins) ? raw.builtins : {};
  const blt = {} as Record<PseudoBuiltin, PseudoBuiltinSetting>;
  for (const b of BUILTIN_INFO) {
    const v = rawBuiltins[b.id];
    const setting = isRecord(v) ? v : {};
    const name = typeof setting.name === 'string' ? setting.name.trim() : '';
    blt[b.id] = {
      name: IDENTIFIER.test(name) && name.length <= MAX_WORD_LENGTH ? name : b.defaultName,
      enabled: typeof setting.enabled === 'boolean' ? setting.enabled : base.builtins[b.id].enabled,
    };
  }

  const assignOperators = Array.isArray(raw.assignOperators)
    ? [...new Set(raw.assignOperators.map((o) => (typeof o === 'string' ? o.trim() : '')).filter((o) => ASSIGN_OPERATORS.includes(o)))]
    : [...base.assignOperators];

  const commentPrefixes = Array.isArray(raw.commentPrefixes)
    ? [
        ...new Set(
          raw.commentPrefixes
            .map((p) => (typeof p === 'string' ? p.trim() : ''))
            .filter((p) => commentPrefixProblem(p) === null && !assignOperators.includes(p)),
        ),
      ].slice(0, 4)
    : [];

  const blockStyles: BlockStyle[] = ['keywords', 'braces', 'both'];
  const concat = Array.isArray(raw.concatOperators)
    ? [...new Set(raw.concatOperators.filter((o): o is '+' | '&' => o === '+' || o === '&'))]
    : [];

  return {
    version: 1,
    presetId: typeof raw.presetId === 'string' && raw.presetId.trim() ? raw.presetId.trim().slice(0, 60) : base.presetId,
    caseSensitive,
    keywords: kw,
    constructs: cons,
    builtins: blt,
    assignOperators,
    commentPrefixes: commentPrefixes.length > 0 ? commentPrefixes : [...base.commentPrefixes],
    blockStyle: blockStyles.includes(raw.blockStyle as BlockStyle) ? (raw.blockStyle as BlockStyle) : base.blockStyle,
    outputSeparator: typeof raw.outputSeparator === 'string' ? raw.outputSeparator.slice(0, 4) : base.outputSeparator,
    outputNewline: typeof raw.outputNewline === 'boolean' ? raw.outputNewline : base.outputNewline,
    listIndexBase: raw.listIndexBase === 0 || raw.listIndexBase === 1 ? raw.listIndexBase : base.listIndexBase,
    concatOperators: concat.length > 0 ? concat : [...base.concatOperators],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation: problems a teacher must fix before saving
// ---------------------------------------------------------------------------------------------------------------

/** Semantic validation (e.g. two keyword slots using the same word). Returns human-readable problems; empty = valid. */
export function validatePseudocodeConfig(config: PseudocodeConfig): string[] {
  const problems: string[] = [];
  const add = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  const cfg: Record<string, unknown> = isRecord(config) ? (config as unknown as Record<string, unknown>) : {};
  const caseSensitive = cfg.caseSensitive === true;
  const key = (s: string) => (caseSensitive ? s : s.toUpperCase());

  if (cfg.caseSensitive !== undefined && typeof cfg.caseSensitive !== 'boolean') add('Case sensitivity must be on or off.');

  // Keyword spellings
  const rawKeywords = isRecord(cfg.keywords) ? cfg.keywords : {};
  const spellingsOf = (slot: PseudoKeyword): string[] => {
    const list = rawKeywords[slot];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && SPELLING.test(item)) : [];
  };
  const singleWordSlots = new Map<string, PseudoKeyword>(); // one-word spelling key → its keyword
  for (const info of KEYWORD_INFO) {
    for (const s of spellingsOf(info.id)) if (!s.includes(' ') && !singleWordSlots.has(key(s))) singleWordSlots.set(key(s), info.id);
  }
  const owners = new Map<string, string>(); // spelling key → keyword label
  for (const info of KEYWORD_INFO) {
    const list = rawKeywords[info.id];
    if (!Array.isArray(list) || list.length === 0) {
      add(`"${info.label}" needs at least one spelling.`);
      continue;
    }
    if (list.length > MAX_SPELLINGS) add(`"${info.label}" can have at most ${MAX_SPELLINGS} spellings.`);
    const valid = spellingsOf(info.id);
    for (const short of valid) {
      for (const long of valid) {
        // The lexer joins words greedily, so `short next` is always read as the longer spelling. That's harmless when
        // `next` is a keyword that can't follow `short` anyway (END / END IF), but not when it could be a name or a
        // keyword that changes the meaning (IF / IF NOT would drop the NOT).
        if (!key(long).startsWith(`${key(short)} `)) continue;
        const next = long.split(' ')[short.split(' ').length]!;
        const nextSlot = singleWordSlots.get(key(next));
        if (nextSlot === undefined || NAME_LIKE_SLOTS.has(nextSlot)) {
          add(
            `"${long}" and "${short}" are both spellings of "${info.label}", so ${short} followed by a name called ` +
              `${next} would be read as ${long}. Keep just one of them.`,
          );
        } else if (keywordsCanFollow(info.id, nextSlot)) {
          add(
            `"${long}" and "${short}" are both spellings of "${info.label}", so ${short} followed by ${next} would be ` +
              `read as ${long}. Keep just one of them.`,
          );
        }
      }
    }
    for (const item of list) {
      if (typeof item !== 'string' || !SPELLING.test(item)) {
        add(
          `"${String(item)}" (${info.label}) isn't a valid spelling — use letters, digits and _ only, start with a ` +
            'letter, and put a single space between words.',
        );
        continue;
      }
      if (item.length > MAX_WORD_LENGTH) add(`"${item}" (${info.label}) is too long — keep it under ${MAX_WORD_LENGTH} characters.`);
      const owner = owners.get(key(item));
      if (owner === undefined) owners.set(key(item), info.label);
      else if (owner !== info.label) add(`"${item}" is used for both "${owner}" and "${info.label}" — each word can only mean one thing.`);
    }
  }

  // Built-in names
  const rawBuiltins = isRecord(cfg.builtins) ? cfg.builtins : {};
  const builtinOwners = new Map<string, string>();
  for (const b of BUILTIN_INFO) {
    const setting = rawBuiltins[b.id];
    const name = isRecord(setting) ? setting.name : undefined;
    if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
      add(`The ${b.defaultName} built-in needs a one-word name (letters, digits and _), like ${b.defaultName}.`);
      continue;
    }
    if (name.length > MAX_WORD_LENGTH) add(`The built-in name "${name}" is too long.`);
    if (isRecord(setting) && setting.enabled !== undefined && typeof setting.enabled !== 'boolean') {
      add(`The ${b.defaultName} built-in must be switched on or off.`);
    }
    const kwOwner = owners.get(key(name));
    if (kwOwner !== undefined) add(`"${name}" is used for both the "${kwOwner}" keyword and the ${b.defaultName} built-in.`);
    const other = builtinOwners.get(key(name));
    if (other !== undefined) add(`Two built-ins (${other} and ${b.defaultName}) are both called "${name}".`);
    else builtinOwners.set(key(name), b.defaultName);
  }

  // Constructs
  const rawConstructs = isRecord(cfg.constructs) ? cfg.constructs : {};
  if (rawConstructs.output !== true) add('Output must stay switched on — students need it to see what their program does.');

  // Operators and symbols
  const assignOps = Array.isArray(cfg.assignOperators) ? cfg.assignOperators : null;
  if (!assignOps) add('Choose which symbols store values (or none, to use SET … TO only).');
  else {
    for (const op of assignOps) {
      if (typeof op !== 'string' || !ASSIGN_OPERATORS.includes(op)) {
        add(`"${String(op)}" can't be used to store values — choose from ${ASSIGN_OPERATORS.join(', ')}.`);
      }
    }
  }

  const prefixes = Array.isArray(cfg.commentPrefixes) ? cfg.commentPrefixes : [];
  if (prefixes.length === 0) add('Add at least one comment symbol, such as //.');
  if (prefixes.length > 4) add('Use at most 4 comment symbols.');
  for (const p of prefixes) {
    if (typeof p !== 'string') {
      add('Comment symbols must be text.');
      continue;
    }
    const problem = commentPrefixProblem(p.trim());
    if (problem) add(problem);
    else if (assignOps?.includes(p.trim())) add(`"${p}" can't be both a comment symbol and a way to store values.`);
  }

  if (!['keywords', 'braces', 'both'].includes(cfg.blockStyle as string)) add('Block style must be keywords, braces or both.');
  if (typeof cfg.outputSeparator !== 'string') add('The output separator must be text (it can be empty).');
  else if (cfg.outputSeparator.length > 4) add('The output separator can be at most 4 characters long.');
  if (typeof cfg.outputNewline !== 'boolean') add('Choose whether each output ends with a new line.');
  if (cfg.listIndexBase !== 0 && cfg.listIndexBase !== 1) add('Lists must start at position 0 or 1.');
  const concat = Array.isArray(cfg.concatOperators) ? cfg.concatOperators : [];
  if (concat.length === 0) add('Choose at least one way to join text (+ or &).');
  for (const op of concat) if (op !== '+' && op !== '&') add(`"${String(op)}" can't join text — use + or &.`);

  return problems;
}
