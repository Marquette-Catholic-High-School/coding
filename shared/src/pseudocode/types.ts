// Types and metadata for teacher-configurable pseudocode languages.
//
// A pseudocode language is a fixed set of *constructs* (output, if, while, …) whose *keywords* the teacher
// can re-word (e.g. DISPLAY instead of OUTPUT) and whose availability the teacher can switch on as the class
// learns them ("words we've learned"). The engine (lexer/parser/interpreter in this folder) reads a
// `PseudocodeConfig` at run time, so one engine powers every pseudocode language on the platform.

/** Canonical keyword slots. Each slot holds one or more spellings chosen by the teacher. */
export type PseudoKeyword =
  | 'output'
  | 'input'
  | 'set'
  | 'to'
  | 'if'
  | 'then'
  | 'elseIf'
  | 'else'
  | 'endIf'
  | 'while'
  | 'do'
  | 'endWhile'
  | 'repeat'
  | 'until'
  | 'times'
  | 'endRepeat'
  | 'for'
  | 'from'
  | 'step'
  | 'endFor'
  | 'forEach'
  | 'in'
  | 'function'
  | 'endFunction'
  | 'return'
  | 'procedure'
  | 'endProcedure'
  | 'call'
  | 'and'
  | 'or'
  | 'not'
  | 'mod'
  | 'div'
  | 'true'
  | 'false';

/** Language features a teacher can switch on/off ("learned" or "not learned yet"). */
export type PseudoConstruct =
  | 'output'
  | 'input'
  | 'variables'
  | 'if'
  | 'else'
  | 'while'
  | 'repeatUntil'
  | 'repeatTimes'
  | 'for'
  | 'forEach'
  | 'logic'
  | 'modDiv'
  | 'lists'
  | 'functions'
  | 'procedures';

/** Built-in functions. Each can be renamed and switched on/off individually. */
export type PseudoBuiltin =
  | 'length'
  | 'append'
  | 'insert'
  | 'remove'
  | 'random'
  | 'round'
  | 'int'
  | 'str'
  | 'num'
  | 'upper'
  | 'lower'
  | 'substring'
  | 'abs'
  | 'sqrt';

export type BlockStyle = 'keywords' | 'braces' | 'both';

export interface PseudoBuiltinSetting {
  /** The word students type, e.g. "LENGTH" or "LEN". */
  name: string;
  enabled: boolean;
}

export interface PseudocodeConfig {
  version: 1;
  /** Preset this config started from (informational only). */
  presetId: string;
  /** When false (default) keywords and built-in names match regardless of case. Variable names are always case-sensitive. */
  caseSensitive: boolean;
  /**
   * Spellings for each keyword slot. The first entry is the primary spelling used in docs, autocomplete and
   * error messages; the rest are accepted aliases. Multi-word spellings ("END IF") are allowed; words are
   * separated by single spaces and match any run of spaces/tabs.
   */
  keywords: Record<PseudoKeyword, string[]>;
  constructs: Record<PseudoConstruct, boolean>;
  builtins: Record<PseudoBuiltin, PseudoBuiltinSetting>;
  /**
   * Operators accepted for `x ← 5` style assignment, e.g. ["←", "<-"] or ["="]. If "=" is included it only
   * means assignment at the start of a statement; inside expressions "=" always means "is equal to".
   * `SET x TO 5` (keywords set/to) is always accepted when the 'variables' construct is on.
   */
  assignOperators: string[];
  /** Line-comment prefixes, e.g. ["//"] or ["#"]. */
  commentPrefixes: string[];
  /** 'keywords' = END IF style, 'braces' = AP CSP `{ }` style, 'both' = either. */
  blockStyle: BlockStyle;
  /** Text placed between the values in `OUTPUT a, b` (usually " "). */
  outputSeparator: string;
  /** Whether each OUTPUT ends with a newline. AP CSP's DISPLAY uses false (values are followed by a space). */
  outputNewline: boolean;
  /** First list index: 1 (AP CSP, AQA) or 0. */
  listIndexBase: 0 | 1;
  /** Operators that join strings: "+" and/or "&". */
  concatOperators: Array<'+' | '&'>;
}

// ---------------------------------------------------------------------------
// Metadata (used by the language builder UI, the word bank, and the engine's error messages)
// ---------------------------------------------------------------------------

export interface KeywordInfo {
  id: PseudoKeyword;
  /** Construct this keyword belongs to (for toggling and grouping). */
  construct: PseudoConstruct;
  label: string;
  description: string;
  /** Default spelling(s) in the "Classroom" preset. */
  defaults: string[];
  /** Optional connector words (THEN, DO) may be omitted by students. */
  optional?: boolean;
}

export const KEYWORD_INFO: readonly KeywordInfo[] = [
  { id: 'output', construct: 'output', label: 'Output', description: 'Shows a value on the screen.', defaults: ['OUTPUT'] },
  { id: 'input', construct: 'input', label: 'Input', description: 'Reads a line typed by the user into a variable.', defaults: ['INPUT'] },
  { id: 'set', construct: 'variables', label: 'Set', description: 'Starts an assignment: SET x TO 5.', defaults: ['SET'] },
  { id: 'to', construct: 'variables', label: 'To', description: 'Used in SET … TO … and FOR … TO ….', defaults: ['TO'] },
  { id: 'if', construct: 'if', label: 'If', description: 'Runs code only when a condition is true.', defaults: ['IF'] },
  { id: 'then', construct: 'if', label: 'Then', description: 'Follows the IF condition (optional).', defaults: ['THEN'], optional: true },
  { id: 'elseIf', construct: 'else', label: 'Else if', description: 'Checks another condition when the IF was false.', defaults: ['ELSE IF'] },
  { id: 'else', construct: 'else', label: 'Else', description: 'Runs when no condition was true.', defaults: ['ELSE'] },
  { id: 'endIf', construct: 'if', label: 'End if', description: 'Closes an IF block.', defaults: ['END IF'] },
  { id: 'while', construct: 'while', label: 'While', description: 'Repeats while a condition is true.', defaults: ['WHILE'] },
  { id: 'do', construct: 'while', label: 'Do', description: 'Follows the WHILE condition (optional).', defaults: ['DO'], optional: true },
  { id: 'endWhile', construct: 'while', label: 'End while', description: 'Closes a WHILE loop.', defaults: ['END WHILE'] },
  { id: 'repeat', construct: 'repeatUntil', label: 'Repeat', description: 'Starts a REPEAT … UNTIL or REPEAT n TIMES loop.', defaults: ['REPEAT'] },
  { id: 'until', construct: 'repeatUntil', label: 'Until', description: 'Ends a REPEAT loop with a stopping condition.', defaults: ['UNTIL'] },
  { id: 'times', construct: 'repeatTimes', label: 'Times', description: 'REPEAT n TIMES runs the block n times.', defaults: ['TIMES'] },
  { id: 'endRepeat', construct: 'repeatTimes', label: 'End repeat', description: 'Closes a REPEAT n TIMES loop.', defaults: ['END REPEAT'] },
  { id: 'for', construct: 'for', label: 'For', description: 'Counts a variable from a start to an end value.', defaults: ['FOR'] },
  { id: 'from', construct: 'for', label: 'From', description: 'FOR i FROM 1 TO 10.', defaults: ['FROM'] },
  { id: 'step', construct: 'for', label: 'Step', description: 'Optional amount to count by.', defaults: ['STEP'] },
  { id: 'endFor', construct: 'for', label: 'End for', description: 'Closes a FOR or FOR EACH loop (a loop variable name may follow).', defaults: ['END FOR'] },
  { id: 'forEach', construct: 'forEach', label: 'For each', description: 'Visits every item in a list.', defaults: ['FOR EACH'] },
  { id: 'in', construct: 'forEach', label: 'In', description: 'FOR EACH item IN list.', defaults: ['IN'] },
  { id: 'function', construct: 'functions', label: 'Function', description: 'Defines a function that returns a value.', defaults: ['FUNCTION'] },
  { id: 'endFunction', construct: 'functions', label: 'End function', description: 'Closes a FUNCTION.', defaults: ['END FUNCTION'] },
  { id: 'return', construct: 'functions', label: 'Return', description: 'Sends a value back from a function.', defaults: ['RETURN'] },
  { id: 'procedure', construct: 'procedures', label: 'Procedure', description: 'Defines a procedure (no return value).', defaults: ['PROCEDURE'] },
  { id: 'endProcedure', construct: 'procedures', label: 'End procedure', description: 'Closes a PROCEDURE.', defaults: ['END PROCEDURE'] },
  { id: 'call', construct: 'procedures', label: 'Call', description: 'Runs a procedure (optional: name(args) also works).', defaults: ['CALL'], optional: true },
  { id: 'and', construct: 'logic', label: 'And', description: 'True when both sides are true.', defaults: ['AND'] },
  { id: 'or', construct: 'logic', label: 'Or', description: 'True when either side is true.', defaults: ['OR'] },
  { id: 'not', construct: 'logic', label: 'Not', description: 'Flips true and false.', defaults: ['NOT'] },
  { id: 'true', construct: 'logic', label: 'True', description: 'The value true.', defaults: ['TRUE'] },
  { id: 'false', construct: 'logic', label: 'False', description: 'The value false.', defaults: ['FALSE'] },
  { id: 'mod', construct: 'modDiv', label: 'Mod', description: 'Remainder after division: 7 MOD 2 is 1.', defaults: ['MOD'] },
  { id: 'div', construct: 'modDiv', label: 'Div', description: 'Whole-number division: 7 DIV 2 is 3.', defaults: ['DIV'] },
];

export interface ConstructInfo {
  id: PseudoConstruct;
  label: string;
  description: string;
  /** Short example in the default (Classroom) wording. The word bank re-renders examples with the teacher's words. */
  example: string;
}

export const CONSTRUCT_INFO: readonly ConstructInfo[] = [
  { id: 'output', label: 'Output', description: 'Show text and values on the screen.', example: 'OUTPUT "Hello, world!"' },
  { id: 'variables', label: 'Variables', description: 'Store values in named variables.', example: 'SET score TO 0\nscore ← score + 1' },
  { id: 'input', label: 'Input', description: 'Ask the user to type something.', example: 'INPUT name\nOUTPUT "Hi ", name' },
  { id: 'if', label: 'If', description: 'Make decisions.', example: 'IF age >= 13 THEN\n  OUTPUT "Teen"\nEND IF' },
  { id: 'else', label: 'Else / else if', description: 'Choose between several options.', example: 'IF x > 0 THEN\n  OUTPUT "positive"\nELSE IF x < 0 THEN\n  OUTPUT "negative"\nELSE\n  OUTPUT "zero"\nEND IF' },
  { id: 'logic', label: 'AND / OR / NOT', description: 'Combine conditions and use TRUE / FALSE.', example: 'IF x > 0 AND x < 10 THEN\n  OUTPUT "single digit"\nEND IF' },
  { id: 'modDiv', label: 'MOD / DIV', description: 'Remainder and whole-number division.', example: 'IF n MOD 2 = 0 THEN\n  OUTPUT "even"\nEND IF' },
  { id: 'while', label: 'While loops', description: 'Repeat while a condition is true.', example: 'WHILE count < 5 DO\n  count ← count + 1\nEND WHILE' },
  { id: 'repeatUntil', label: 'Repeat … until', description: 'Repeat until a condition becomes true.', example: 'REPEAT\n  INPUT guess\nUNTIL guess = 7' },
  { id: 'repeatTimes', label: 'Repeat n times', description: 'Repeat a block a fixed number of times.', example: 'REPEAT 3 TIMES\n  OUTPUT "Hip hip hooray!"\nEND REPEAT' },
  { id: 'for', label: 'For loops', description: 'Count from one number to another.', example: 'FOR i FROM 1 TO 10\n  OUTPUT i\nEND FOR' },
  { id: 'lists', label: 'Lists', description: 'Store many values in one variable.', example: 'SET pets TO ["cat", "dog"]\nOUTPUT pets[1]' },
  { id: 'forEach', label: 'For each', description: 'Visit every item in a list.', example: 'FOR EACH pet IN pets\n  OUTPUT pet\nEND FOR' },
  { id: 'procedures', label: 'Procedures', description: 'Name a block of code and run it later.', example: 'PROCEDURE greet(name)\n  OUTPUT "Hello ", name\nEND PROCEDURE\nCALL greet("Sam")' },
  { id: 'functions', label: 'Functions', description: 'Name a calculation that returns a value.', example: 'FUNCTION double(n)\n  RETURN n * 2\nEND FUNCTION\nOUTPUT double(4)' },
];

export interface BuiltinInfo {
  id: PseudoBuiltin;
  /** Construct that must also be enabled (e.g. list builtins need 'lists'), or null. */
  requires: PseudoConstruct | null;
  defaultName: string;
  /** Parameter names shown in the word bank, e.g. ["list", "value"]. */
  params: string[];
  description: string;
}

export const BUILTIN_INFO: readonly BuiltinInfo[] = [
  { id: 'length', requires: null, defaultName: 'LENGTH', params: ['listOrText'], description: 'Number of items in a list or characters in text.' },
  { id: 'append', requires: 'lists', defaultName: 'APPEND', params: ['list', 'value'], description: 'Adds a value to the end of a list.' },
  { id: 'insert', requires: 'lists', defaultName: 'INSERT', params: ['list', 'index', 'value'], description: 'Inserts a value at a position in a list.' },
  { id: 'remove', requires: 'lists', defaultName: 'REMOVE', params: ['list', 'index'], description: 'Removes the item at a position in a list.' },
  { id: 'random', requires: null, defaultName: 'RANDOM', params: ['low', 'high'], description: 'A random whole number from low to high (inclusive).' },
  { id: 'round', requires: null, defaultName: 'ROUND', params: ['number', 'places'], description: 'Rounds to a number of decimal places (default 0).' },
  { id: 'int', requires: null, defaultName: 'INT', params: ['number'], description: 'Drops the decimal part of a number.' },
  { id: 'str', requires: null, defaultName: 'STR', params: ['value'], description: 'Turns a value into text.' },
  { id: 'num', requires: null, defaultName: 'NUM', params: ['text'], description: 'Turns text into a number.' },
  { id: 'upper', requires: null, defaultName: 'UPPER', params: ['text'], description: 'Text in CAPITAL letters.' },
  { id: 'lower', requires: null, defaultName: 'LOWER', params: ['text'], description: 'Text in lowercase letters.' },
  { id: 'substring', requires: null, defaultName: 'SUBSTRING', params: ['text', 'start', 'length'], description: 'Part of some text (start uses the list index base).' },
  { id: 'abs', requires: null, defaultName: 'ABS', params: ['number'], description: 'Distance from zero.' },
  { id: 'sqrt', requires: null, defaultName: 'SQRT', params: ['number'], description: 'Square root.' },
];

// ---------------------------------------------------------------------------
// Engine API types
// ---------------------------------------------------------------------------

export interface PseudoIO {
  /** Called with output text (may be partial lines; includes "\n" when a line ends). */
  write(text: string): void;
  /** Return the next line of input (without "\n"), or null when no input is available (end of input). */
  readLine(prompt: string | null): string | null;
}

export interface PseudoRunOptions {
  /** Abort with a friendly "infinite loop?" error after this many steps. Default 5_000_000. */
  maxSteps?: number;
  /** Maximum call depth before a "too much recursion" error. Default 500. */
  maxCallDepth?: number;
  /** Seeded random for deterministic tests (returns [0, 1)). Default Math.random. */
  random?: () => number;
}

export interface PseudoDiagnostic {
  severity: 'error' | 'warning';
  /** Friendly, student-facing message, e.g. `You haven't learned "WHILE" yet.` */
  message: string;
  /** Optional extra hint, e.g. `Did you mean "OUTPUT"?` */
  hint?: string;
  /** 1-based line and column of the problem; column is 1 when unknown. */
  line: number;
  column: number;
  /** 1-based exclusive end column on the same line, when known. */
  endColumn?: number;
  /** 'syntax' (found before running) or 'runtime'. */
  phase: 'syntax' | 'runtime';
}

export interface PseudoRunResult {
  ok: boolean;
  error: PseudoDiagnostic | null;
  steps: number;
}

/** One entry of the student word bank / teacher preview. */
export interface VocabEntry {
  construct: PseudoConstruct;
  label: string;
  description: string;
  enabled: boolean;
  /** Primary spellings of the keywords this construct uses, in display order. */
  words: string[];
  /** Example rewritten with the teacher's words and block style. */
  example: string;
}

export interface VocabBuiltin {
  id: PseudoBuiltin;
  name: string;
  signature: string;
  description: string;
  enabled: boolean;
}

export interface PseudocodePreset {
  id: string;
  name: string;
  description: string;
  config: PseudocodeConfig;
  /** A sample program written in this preset's style. */
  sample: string;
}

/** Word lists for syntax highlighting and autocomplete. */
export interface HighlightWords {
  /** Every keyword spelling (multi-word spellings included as-is, e.g. "END IF"). */
  keywords: string[];
  /** Keyword spellings of disabled constructs (editor may underline/dim them). */
  lockedKeywords: string[];
  /** Enabled built-in function names. */
  builtins: string[];
  /** TRUE/FALSE spellings. */
  constants: string[];
  /** Word operators (AND, OR, NOT, MOD, DIV). */
  wordOperators: string[];
  /** Symbol operators including assignment operators. */
  symbolOperators: string[];
  commentPrefixes: string[];
  caseSensitive: boolean;
}
