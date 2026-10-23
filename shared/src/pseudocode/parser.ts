// Recursive-descent parser (tokens → Program) followed by a resolver pass that checks every call.
import type * as A from './ast';
import { article, closestMatch, plural, syntaxError, type Pos, type PseudoError } from './errors';
import type { Language } from './language';
import { tokenize, type Token } from './lexer';
import { BUILTIN_INFO, type PseudoBuiltin, type PseudoConstruct, type PseudoKeyword } from './types';
import { describeValue } from './values';

/** Keywords that end (or continue) a block. Statements stop in front of them. */
const CLOSERS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>([
  'elseIf', 'else', 'endIf', 'endWhile', 'endRepeat', 'until', 'endFor', 'endFunction', 'endProcedure',
]);
const END_OPENER: Partial<Record<PseudoKeyword, PseudoKeyword>> = {
  endIf: 'if', endWhile: 'while', endRepeat: 'repeat', endFor: 'for', endFunction: 'function', endProcedure: 'procedure',
};
/** Keywords that can start a line (used for "Did you mean …?" suggestions). */
const STATEMENT_SLOTS: readonly PseudoKeyword[] = [
  'output', 'input', 'set', 'if', 'elseIf', 'else', 'endIf', 'while', 'endWhile', 'repeat', 'until', 'endRepeat', 'for',
  'forEach', 'endFor', 'function', 'endFunction', 'return', 'procedure', 'endProcedure', 'call', 'declare', 'constant',
];
const COMPARISONS: ReadonlyMap<string, A.BinaryOp> = new Map<string, A.BinaryOp>([
  ['=', '='], ['==', '='], ['≠', '!='], ['!=', '!='], ['<>', '!='], ['<', '<'], ['>', '>'], ['<=', '<='], ['>=', '>='],
  ['≤', '<='], ['≥', '>='],
]);
/** Always-assignment symbols ("=" is assignment only when the teacher chose it, and only at the start of a line). */
const ARROWS: ReadonlySet<string> = new Set(['←', '<-', ':=']);
/**
 * Connector keywords. They only ever follow a name or a finished value (FOR i FROM …, REPEAT 3 TIMES, IF x THEN), and
 * SET / CALL only start a statement, so where a name is clearly meant (`step ← 2`, `PROCEDURE move(from, to)`) the
 * word is used as a name instead. This keeps words an exam board never uses (SET, FROM, CALL …) free for names.
 */
const CONNECTORS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>(['set', 'to', 'from', 'step', 'times', 'do', 'then', 'call', 'in']);
/**
 * DECLARE and CONSTANT (added after programs were first saved) are keywords only at the start of an instruction, where a
 * name follows (`CONSTANT PI ← 3.14`, `DECLARE x : INTEGER`). Everywhere else, and in `constant ← 9.81`, `declare[1] ← 2`
 * or `declare(5)`, they are ordinary names, so programs that already used these words as names keep working.
 */
const CONTEXTUAL: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>(['declare', 'constant']);
/** Keywords followed by the name of a variable they give a value to (for hints and for connector names). */
const NAMING_SLOTS: ReadonlySet<PseudoKeyword> = new Set<PseudoKeyword>(['set', 'for', 'forEach', 'input', 'declare', 'constant']);
/** Cambridge parameter passing words: `PROCEDURE Swap(BYREF a : INTEGER, b : INTEGER)` (BYREF lasts until BYVAL). */
const PASSING = /^(BYREF|BYVAL)$/i;

/** How many values each built-in accepts. RANDOM() with no values gives a decimal from 0 up to 1 (Cambridge style). */
export const BUILTIN_ARITY: Readonly<Record<PseudoBuiltin, readonly number[]>> = {
  length: [1], append: [2], insert: [3], remove: [2], random: [2, 0], round: [1, 2], int: [1], str: [1], num: [1],
  upper: [1], lower: [1], substring: [3], abs: [1], sqrt: [1],
};

/** Names students may know a built-in by from other languages or exam boards (for "it's called … here" hints). */
const BUILTIN_ALIASES: Readonly<Record<string, PseudoBuiltin>> = {
  LENGTH: 'length', LEN: 'length', SIZE: 'length',
  APPEND: 'append', ADD: 'append', PUSH: 'append',
  INSERT: 'insert',
  REMOVE: 'remove', DELETE: 'remove', POP: 'remove',
  RANDOM: 'random', RANDOM_INT: 'random', RANDINT: 'random', RAND: 'random',
  ROUND: 'round',
  INT: 'int', INTEGER: 'int', TRUNC: 'int',
  STR: 'str', STRING: 'str', TOSTRING: 'str', INT_TO_STRING: 'str', REAL_TO_STRING: 'str', NUM_TO_STR: 'str',
  NUM: 'num', NUMBER: 'num', FLOAT: 'num', STRING_TO_INT: 'num', STRING_TO_REAL: 'num', STR_TO_NUM: 'num',
  UPPER: 'upper', UCASE: 'upper', TO_UPPER: 'upper', UPPERCASE: 'upper',
  LOWER: 'lower', LCASE: 'lower', TO_LOWER: 'lower', LOWERCASE: 'lower',
  SUBSTRING: 'substring', SUBSTR: 'substring', MID: 'substring',
  ABS: 'abs', SQRT: 'sqrt', SQUAREROOT: 'sqrt',
};

type ForeignKind = 'output' | 'input' | 'declare' | 'next' | 'loop' | 'function' | 'case' | 'break' | 'elseIf';
/** Words from other languages and exam boards that students often type, with a targeted hint. */
const FOREIGN_WORDS: Readonly<Record<string, ForeignKind>> = {
  PRINT: 'output', PRINTLN: 'output', DISPLAY: 'output', WRITE: 'output', WRITELN: 'output', SAY: 'output',
  SHOW: 'output', ECHO: 'output', OUTPUT: 'output',
  READ: 'input', READLN: 'input', GET: 'input', ASK: 'input', INPUT: 'input', USERINPUT: 'input',
  DECLARE: 'declare', VAR: 'declare', LET: 'declare', DIM: 'declare', CONST: 'declare', CONSTANT: 'declare',
  NEXT: 'next', LOOP: 'loop', ENDLOOP: 'loop',
  DEF: 'function', FUNC: 'function', SUB: 'function', SUBROUTINE: 'function', METHOD: 'function', FUNCTION: 'function',
  PROCEDURE: 'function',
  CASE: 'case', SWITCH: 'case', SELECT: 'case', OTHERWISE: 'case', ENDCASE: 'case',
  BREAK: 'break', CONTINUE: 'break', EXIT: 'break',
  ELIF: 'elseIf', ELSEIF: 'elseIf', ELSIF: 'elseIf',
};

interface OpenBlock {
  /** The opening word as students know it, e.g. "IF". */
  name: string;
  pos: Pos;
  braces: boolean;
  /** Keyword closers accepted (keyword-style blocks). */
  closers: readonly PseudoKeyword[];
  /** "END IF", "UNTIL" or "}". */
  closerText: string;
  /** This block is the ELSE part of an IF (so ELSE / ELSE IF can't follow). */
  afterElse: boolean;
}

function posOf(p: Pos): Pos {
  return { line: p.line, col: p.col, endCol: p.endCol };
}

function span(a: Pos, b: Pos): Pos {
  return { line: a.line, col: a.col, endCol: b.line === a.line ? Math.max(a.endCol, b.endCol) : a.endCol };
}

/** The value a DECLAREd array starts with, from its type: "" for text, FALSE for BOOLEAN, otherwise 0. */
function typeDefault(type: string): number | string | boolean {
  const t = type.toUpperCase();
  if (t === 'STRING' || t === 'CHAR') return '';
  return t === 'BOOLEAN' ? false : 0;
}

function describe(t: Token): string {
  switch (t.kind) {
    case 'num':
      return `the number ${t.text}`;
    case 'str':
      return `the text ${t.text}`;
    case 'nl':
      return t.text === ';' ? '";"' : 'the end of the line';
    case 'eof':
      return 'the end of the program';
    default:
      return `"${t.text}"`;
  }
}

class Parser {
  private i = 0;
  private readonly stack: OpenBlock[] = [];
  private func: A.FuncDef | null = null;
  readonly functions = new Map<string, A.FuncDef>();
  /** Names given a value anywhere in the program (found before parsing, for hints). */
  readonly assigned = new Set<string>();
  readonly functionNames = new Set<string>();
  private readonly toks: Token[];
  private readonly lang: Language;
  private readonly k: Readonly<Record<PseudoKeyword, string>>;

  constructor(toks: Token[], lang: Language) {
    this.toks = toks;
    this.lang = lang;
    this.k = lang.kw;
    this.prescan();
  }

  parseProgram(): A.Program {
    const body = this.parseStatements(null);
    return { body, functions: this.functions };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------------------------------------------

  private prescan(): void {
    const t = this.toks;
    let lineStart = 0;
    for (let n = 0; n < t.length; n++) {
      const tok = t[n]!;
      const next = t[n + 1];
      if (tok.kind === 'nl') {
        lineStart = n + 1;
        continue;
      }
      const connector = this.connectorNameAt(n, lineStart);
      if (connector === 'variable') this.assigned.add(tok.text);
      else if (connector === 'function') this.functionNames.add(tok.text);
      if (tok.kind === 'word' || this.isContextualName(tok)) {
        if (next?.kind === 'op' && (ARROWS.has(next.text) || next.text === '=')) this.assigned.add(tok.text);
      }
      if (tok.kind === 'kw' && next !== undefined && (next.kind === 'word' || this.isContextualName(next))) {
        if (NAMING_SLOTS.has(tok.slot!)) this.assigned.add(next.text);
        if (tok.slot === 'function' || tok.slot === 'procedure') this.functionNames.add(next.text);
      }
      if (tok.kind === 'kw' && (tok.slot === 'function' || tok.slot === 'procedure')) this.prescanParameters(n + 2);
    }
  }

  /** Parameter names in a FUNCTION / PROCEDURE header starting at token `start` (just after the name). */
  private prescanParameters(start: number): void {
    const t = this.toks;
    let depth = 0;
    for (let j = start; j < t.length; j++) {
      const p = t[j]!;
      if (p.kind === 'nl' || p.kind === 'eof') break;
      if (p.kind === 'op' && (p.text === '(' || p.text === '[')) depth++;
      else if (p.kind === 'op' && (p.text === ')' || p.text === ']')) {
        if (--depth <= 0) break;
      } else if ((p.kind === 'word' || this.isContextualName(p)) && depth === 1 && !PASSING.test(p.text)) {
        let prev = t[j - 1]!;
        if (prev.kind === 'word' && PASSING.test(prev.text)) prev = t[j - 2]!;
        if (prev.kind === 'op' && (prev.text === '(' || prev.text === ',')) this.assigned.add(p.text);
      }
    }
  }

  /**
   * Whether the token at `n` is a connector keyword (TO, STEP, …) used as a name: before an assignment symbol, in a
   * bracketed name list, or where SET, FOR, FOR EACH, INPUT, DECLARE, FUNCTION or PROCEDURE expects a name.
   */
  private connectorNameAt(n: number, lineStart: number): 'variable' | 'function' | null {
    const t = this.toks;
    const tok = t[n]!;
    if (tok.kind !== 'kw' || !CONNECTORS.has(tok.slot!) || tok.text.includes(' ')) return null;
    const next = t[n + 1]!;
    const op = (x: Token | undefined, ...texts: string[]) => x !== undefined && x.kind === 'op' && texts.includes(x.text);
    const end = next.kind === 'nl' || next.kind === 'eof';
    if (next.kind === 'op' && (ARROWS.has(next.text) || next.text === '=')) return 'variable';
    let prev = n > lineStart ? t[n - 1] : undefined;
    if (prev?.kind === 'word' && PASSING.test(prev.text)) prev = t[n - 2];
    if (prev === undefined) return null;
    if (op(prev, '(', ',') && op(next, ',', ')', ':')) return 'variable';
    const first = t[lineStart]!;
    const listLine = first.kind === 'kw' && (first.slot === 'input' || first.slot === 'declare');
    if (listLine && op(prev, ',') && (end || op(next, ',', '[', ':'))) return 'variable';
    if (prev.kind !== 'kw') return null;
    switch (prev.slot) {
      case 'set':
        return this.isKw(next, 'to') || op(next, '[') ? 'variable' : null;
      case 'for':
        return this.isKw(next, 'from') || this.isKw(next, 'in') ? 'variable' : null;
      case 'forEach':
        return this.isKw(next, 'in') ? 'variable' : null;
      case 'input':
      case 'declare':
        return end || op(next, ',', '[', ':') ? 'variable' : null;
      case 'function':
      case 'procedure':
        return end || op(next, '(', '{') ? 'function' : null;
      default:
        return null;
    }
  }

  /** A connector keyword that this program uses as a name (see CONNECTORS). */
  private isConnectorName(t: Token): boolean {
    return t.kind === 'kw' && CONNECTORS.has(t.slot!) && (this.assigned.has(t.text) || this.functionNames.has(t.text));
  }

  /** DECLARE or CONSTANT (one word) as a name: anywhere but the start of an instruction (see CONTEXTUAL). */
  private isContextualName(t: Token): boolean {
    return t.kind === 'kw' && CONTEXTUAL.has(t.slot!) && !t.text.includes(' ');
  }

  /** A keyword token that this program uses as a name. */
  private isNameKeyword(t: Token): boolean {
    return this.isConnectorName(t) || this.isContextualName(t);
  }

  private isName(t: Token): boolean {
    return t.kind === 'word' || this.isNameKeyword(t);
  }

  /** Current token; a 'bad' token (lexer problem) is reported as soon as the parser reaches it. */
  private peek(): Token {
    const t = this.toks[this.i]!;
    if (t.kind === 'bad') throw syntaxError(t.message!, t, t.hint);
    return t;
  }

  /** Raw lookahead (never throws). */
  private at(offset: number): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.i++;
    return t;
  }

  private skipNewlines(): void {
    while (this.peek().kind === 'nl') this.i++;
  }

  /** Index of the next token that isn't a newline (without moving). */
  private afterNewlines(): number {
    let j = this.i;
    while (this.toks[j]!.kind === 'nl') j++;
    return j;
  }

  private isKw(t: Token, slot: PseudoKeyword): boolean {
    return t.kind === 'kw' && t.slot === slot;
  }

  private isOp(t: Token, text: string): boolean {
    return t.kind === 'op' && t.text === text;
  }

  private isCloser(t: Token): boolean {
    return (t.kind === 'kw' && CLOSERS.has(t.slot!)) || this.isOp(t, '}');
  }

  private atEnd(t: Token): boolean {
    return t.kind === 'nl' || t.kind === 'eof' || this.isCloser(t);
  }

  /** An assignment symbol at the start of a statement. */
  private isAssignOp(t: Token): boolean {
    return t.kind === 'op' && (ARROWS.has(t.text) || (t.text === '=' && this.lang.equalsAssigns));
  }

  private fail(pos: Pos, message: string, hint?: string): PseudoError {
    return syntaxError(message, pos, hint);
  }

  private an(word: string): string {
    return `${article(word)} ${word}`;
  }

  /** `OUTPUT x` or, in brace-style languages (AP CSP), `DISPLAY(x)`. */
  private outputExample(value: string): string {
    return this.lang.config.blockStyle === 'braces' ? `${this.k.output}(${value})` : `${this.k.output} ${value}`;
  }

  private forExample(): string {
    const k = this.k;
    return `${k.for} i ${k.from} 1 ${k.to} 10`;
  }

  /** "FUNCTION or PROCEDURE", or whichever of the two is switched on. */
  private subroutineWords(): string {
    const f = this.lang.constructOn('functions');
    const p = this.lang.constructOn('procedures');
    if (f && p) return `${this.an(this.k.function)} or ${this.k.procedure}`;
    return this.an(p ? this.k.procedure : this.k.function);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // "Not learned yet"
  // ---------------------------------------------------------------------------------------------------------------

  private requireConstruct(c: PseudoConstruct, pos: Pos, word: string, hint?: string): void {
    if (!this.lang.constructOn(c)) throw this.fail(pos, `You haven't learned "${word}" yet.`, hint ?? this.lockedHint(c));
  }

  private requireTopic(c: 'lists' | 'variables', pos: Pos): void {
    if (!this.lang.constructOn(c)) throw this.fail(pos, `You haven't learned about ${c} yet.`);
  }

  private requireKeyword(slot: PseudoKeyword, pos: Pos): void {
    if (!this.lang.keywordOn(slot)) throw this.fail(pos, `You haven't learned "${this.k[slot]}" yet.`);
  }

  /** Suggests a construct the class *has* learned that can do the same job. */
  private lockedHint(c: PseudoConstruct): string | undefined {
    const k = this.k;
    const on = (x: PseudoConstruct) => this.lang.constructOn(x);
    const loop = (word: string) => `Try ${this.an(word)} loop instead.`;
    switch (c) {
      case 'while':
        if (on('repeatUntil')) return `Try ${k.repeat} … ${k.until} instead.`;
        if (on('repeatTimes')) return `Try ${k.repeat} … ${k.times} instead.`;
        return on('for') ? loop(k.for) : undefined;
      case 'repeatUntil':
        return on('while') ? loop(k.while) : undefined;
      case 'repeatTimes':
        if (on('for')) return loop(k.for);
        return on('while') ? loop(k.while) : undefined;
      case 'for':
        if (on('repeatTimes')) return `Try ${k.repeat} … ${k.times} instead.`;
        return on('while') ? loop(k.while) : undefined;
      case 'forEach':
        return on('for') ? `Try ${this.an(k.for)} loop that counts through the positions instead.` : undefined;
      case 'else':
        return on('if') ? `Use another ${k.if} instead.` : undefined;
      case 'functions':
        return on('procedures') ? `Try ${this.an(k.procedure)} instead.` : undefined;
      case 'procedures':
        return on('functions') ? `Use ${k.function} instead — it doesn't have to give back a value.` : undefined;
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Statements and blocks
  // ---------------------------------------------------------------------------------------------------------------

  private parseStatements(block: OpenBlock | null): A.Stmt[] {
    const body: A.Stmt[] = [];
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (t.kind === 'eof') {
        if (block) throw this.unclosed(block);
        return body;
      }
      if (this.isCloser(t)) {
        if (block && this.accepts(block, t)) return body;
        throw this.strayCloser(block, t);
      }
      const s = this.parseStatement();
      if (Array.isArray(s)) body.push(...s);
      else if (s) body.push(s);
    }
  }

  private accepts(block: OpenBlock, t: Token): boolean {
    return block.braces ? this.isOp(t, '}') : t.kind === 'kw' && block.closers.includes(t.slot!);
  }

  private closerPhrase(block: OpenBlock): string {
    return block.braces ? 'a closing }' : this.an(block.closerText);
  }

  private unclosed(block: OpenBlock): PseudoError {
    if (block.braces) {
      return this.fail(block.pos, `This ${block.name} on line ${block.pos.line} needs a closing }.`, 'Every { needs a matching } to end its block.');
    }
    return this.fail(
      block.pos,
      `This ${block.name} on line ${block.pos.line} needs ${this.an(block.closerText)}.`,
      `Put ${block.closerText} after the last line that belongs to the ${block.name}.`,
    );
  }

  /** A closing word (or }) that the current block doesn't accept. */
  private strayCloser(block: OpenBlock | null, t: Token): PseudoError {
    const k = this.k;
    const text = t.kind === 'op' ? '}' : t.text;
    if (block) {
      for (let s = this.stack.length - 2; s >= 0; s--) {
        if (this.accepts(this.stack[s]!, t)) {
          return this.fail(t, `The ${block.name} on line ${block.pos.line} needs ${this.closerPhrase(block)} before this ${text}.`);
        }
      }
    }
    const stillOpen = block ? `The ${block.name} on line ${block.pos.line} is still open — it needs ${this.closerPhrase(block)} first.` : undefined;
    if (t.kind === 'op') {
      if (!this.lang.bracesAllowed) return this.fail(t, `This language doesn't use { } — blocks end with words like ${k.endIf}.`);
      if (block) return this.fail(t, `This } doesn't match the ${block.name} on line ${block.pos.line}.`, `Finish the ${block.name} with ${block.closerText} instead.`);
      return this.fail(t, `This } doesn't close anything.`, 'Check that every { has exactly one matching }.');
    }
    const slot = t.slot!;
    if (slot === 'else' || slot === 'elseIf') {
      if (block?.afterElse) return this.fail(t, `${text} can't come after ${k.else} — ${k.else} must be the last part of ${this.an(k.if)}.`);
      return this.fail(t, `This ${text} isn't part of ${this.an(k.if)}.`, stillOpen ?? `${k.else} has to be inside ${this.an(k.if)} … ${k.endIf} block.`);
    }
    if (slot === 'until') return this.fail(t, `This ${text} doesn't have ${this.an(k.repeat)} to go with it.`, stillOpen);
    if (!this.lang.keywordBlocksAllowed) return this.fail(t, `This language uses { } for blocks, so it doesn't need ${text}.`, 'Close the block with } instead.');
    if (block) return this.fail(t, `This ${text} doesn't match the ${block.name} on line ${block.pos.line}.`, `Did you mean ${block.closerText}?`);
    const opener = k[END_OPENER[slot]!];
    return this.fail(t, `This ${text} doesn't have ${this.an(opener)} to close.`);
  }

  /** Decides whether the block after a header uses { } or keywords, consuming the "{" if present. */
  private openBlock(opener: Token, name: string, closers: PseudoKeyword[], closerText: string, example: string): OpenBlock {
    const j = this.afterNewlines();
    const t = this.toks[j]!;
    if (this.isOp(t, '{')) {
      if (!this.lang.bracesAllowed) {
        throw this.fail(t, `This language ends blocks with ${closerText}, not { }.`, `Remove the { and finish the ${name} with ${closerText}.`);
      }
      this.i = j + 1;
      return { name, pos: posOf(opener), braces: true, closers: [], closerText: '}', afterElse: false };
    }
    if (!this.lang.keywordBlocksAllowed) {
      throw this.fail(opener, `Put { after this ${name} line to start its block.`, `In this language blocks look like this: ${example} { … }`);
    }
    return { name, pos: posOf(opener), braces: false, closers, closerText, afterElse: false };
  }

  private parseBody(block: OpenBlock): A.Stmt[] {
    this.stack.push(block);
    const body = this.parseStatements(block);
    this.stack.pop();
    if (block.braces) this.next();
    return body;
  }

  /** After a simple statement: end of line, end of program, or a closing word on the same line. */
  private endStatement(context?: 'output' | 'input'): void {
    const t = this.peek();
    if (t.kind === 'nl') {
      this.skipNewlines();
      return;
    }
    if (t.kind === 'eof' || this.isCloser(t)) return;
    let hint: string | undefined;
    if (t.kind === 'kw' && STATEMENT_SLOTS.includes(t.slot!)) hint = 'Start a new line for each instruction.';
    else if (context === 'output') hint = 'To show more than one thing, put commas between them.';
    else if (context === 'input') hint = 'To read more than one value, put commas between the names.';
    else if (t.kind === 'num' || t.kind === 'word' || t.kind === 'str') hint = 'Is an operator (like +) or a comma missing?';
    throw this.fail(t, `I wasn't expecting ${describe(t)} here.`, hint);
  }

  /**
   * THEN / DO are optional and may sit on the next line (Cambridge puts THEN on its own line). When the program also
   * uses the word as a name, `then ← 1`, `then[1] ← 2` and `do(i)` start the block's first instruction instead.
   */
  private optionalConnector(slot: 'then' | 'do'): void {
    const j = this.afterNewlines();
    const t = this.toks[j]!;
    if (!this.isKw(t, slot)) return;
    const after = this.toks[j + 1]!;
    if (this.isConnectorName(t) && (this.isAssignOp(after) || this.isOp(after, '[') || this.isOp(after, '('))) return;
    this.i = j + 1;
  }

  /**
   * Whether a keyword typed as one longer spelling ends in a spelling of `slot`: `REPEAT UNTIL` when the teacher listed
   * both REPEAT and REPEAT UNTIL for REPEAT, or `ELSE IF` listed for ELSE. The parser reads those like the two words.
   */
  private endsWithKeyword(t: Token, slot: PseudoKeyword): boolean {
    const words = t.text.split(' ');
    if (t.kind !== 'kw' || words.length < 2) return false;
    const norm = this.lang.norm;
    const spells = (s: PseudoKeyword, part: string[]) =>
      this.lang.config.keywords[s].some((spelling) => {
        const w = spelling.split(' ');
        return w.length === part.length && w.every((x, n) => norm(x) === norm(part[n]!));
      });
    for (let cut = 1; cut < words.length; cut++) {
      if (spells(t.slot!, words.slice(0, cut)) && spells(slot, words.slice(cut))) return true;
    }
    return false;
  }

  /** "at the start of a line", or "here" when something comes before the token on its line. */
  private where(t: Token): string {
    const prev = this.toks[this.i - 1];
    return prev === undefined || prev.kind === 'nl' || prev.line !== t.line ? 'at the start of a line' : 'here';
  }

  private parseStatement(): A.Stmt | A.Stmt[] | null {
    const t = this.peek();
    if (t.kind === 'kw') return this.keywordStatement(t);
    if (t.kind === 'word') return this.wordStatement(t);
    if (t.kind === 'num' || t.kind === 'str') throw this.valueWithoutInstruction(t);
    if (this.isOp(t, '{')) {
      if (!this.lang.bracesAllowed) throw this.fail(t, `This language doesn't use { } — blocks end with words like ${this.k.endIf}.`);
      throw this.fail(t, `This { isn't attached to anything.`, `A { goes at the end of a line that starts a block, like ${this.k.if} (x > 1) {`);
    }
    if (ARROWS.has(t.text) || t.text === '=') {
      throw this.fail(t, `I expected a variable name before "${t.text}".`, `For example: ${this.lang.assignExample('score', '0')}`);
    }
    if (t.text === '(' || t.text === '[' || t.text === '-') throw this.valueWithoutInstruction(t);
    throw this.fail(t, `I wasn't expecting ${describe(t)} ${this.where(t)}.`);
  }

  private valueWithoutInstruction(t: Token): PseudoError {
    const literal = t.kind === 'num' || t.kind === 'str';
    return this.fail(
      t,
      'This line has a value but no instruction.',
      literal ? `Did you mean ${this.outputExample(t.text)}?` : `To show it, start the line with ${this.k.output}.`,
    );
  }

  private reservedName(t: Token): PseudoError {
    return this.fail(t, `"${t.text}" is a special word in this language, so it can't be used as a name.`, 'Choose a different name.');
  }

  private keywordStatement(t: Token): A.Stmt | A.Stmt[] | null {
    const after = this.at(1);
    if (t.slot === 'forEach') this.eachAsLoopVariable(t, after, this.at(2));
    if (this.isNameKeyword(t) && (this.isAssignOp(after) || this.isOp(after, '=') || this.isOp(after, '[') || this.isOp(after, '('))) {
      return this.wordStatement(t);
    }
    // `constant` alone on a line in a program that uses it as a variable: say so, rather than asking for a name.
    if (this.isContextualName(t) && !this.isName(after) && (this.assigned.has(t.text) || this.functionNames.has(t.text))) {
      return this.wordStatement(t);
    }
    if (this.isAssignOp(after) || this.isOp(after, '=')) throw this.reservedName(t);
    switch (t.slot) {
      case 'output':
        return this.outputStatement();
      case 'input':
        return this.inputStatement();
      case 'set':
        return this.setStatement();
      case 'if':
        return this.ifStatement();
      case 'while':
        return this.whileStatement();
      case 'repeat':
        return this.repeatStatement();
      case 'for':
        return this.forStatement();
      case 'forEach':
        return this.forEachStatement();
      case 'function':
      case 'procedure':
        this.functionDefinition();
        return null;
      case 'return':
        return this.returnStatement();
      case 'call':
        return this.callStatement();
      case 'declare':
        return this.declareStatement();
      case 'constant':
        return this.constantStatement();
      default:
        break;
    }
    if (t.slot === 'not' || t.slot === 'true' || t.slot === 'false') throw this.valueWithoutInstruction(t);
    throw this.fail(t, `I wasn't expecting "${t.text}" ${this.where(t)}.`, this.misplacedConnectorHint(t) ?? this.connectorHint(t.slot!));
  }

  /** THEN / DO after the header of a block that doesn't use it: `FOR i FROM 1 TO 3 DO`, `WHILE x THEN`. */
  private misplacedConnectorHint(t: Token): string | undefined {
    const k = this.k;
    const top = this.stack[this.stack.length - 1];
    if (!top || top.pos.line !== t.line || (t.slot !== 'do' && t.slot !== 'then')) return undefined;
    if (top.name === (t.slot === 'do' ? k.while : k.if)) return undefined;
    if (t.slot === 'do' && top.name === k.if && this.lang.keywordOn('then')) return `Use ${k.then} after ${this.an(k.if)} condition instead.`;
    if (t.slot === 'then' && top.name === k.while && this.lang.keywordOn('do')) return `Use ${k.do} after ${this.an(k.while)} condition instead.`;
    return `${top.name} lines don't use ${t.text} — remove it.`;
  }

  private connectorHint(slot: PseudoKeyword): string | undefined {
    const k = this.k;
    switch (slot) {
      case 'then':
        return `${k.then} goes at the end of ${this.an(k.if)} line, after the condition.`;
      case 'do':
        return `${k.do} goes at the end of ${this.an(k.while)} line.`;
      case 'to':
        return `${k.to} is used in lines like ${k.set} x ${k.to} 5 and ${this.forExample()}.`;
      case 'from':
      case 'step':
        return `${k[slot]} is used in ${this.an(k.for)} line, like ${this.forExample()} ${k.step} 2.`;
      case 'in':
        return `${k.in} is used like this: ${k.forEach} item ${k.in} list`;
      case 'times':
        return `${k.times} is used like this: ${k.repeat} 3 ${k.times}`;
      default:
        return undefined;
    }
  }

  private outputStatement(): A.OutputStmt {
    const t = this.next();
    this.requireConstruct('output', t, this.k.output);
    let values: A.Expr[] = [];
    if (!this.atEnd(this.peek())) {
      if (this.isOp(this.peek(), '(') && this.bracketsHoldWholeList()) {
        values = this.parseArgs();
      } else {
        values.push(this.parseExpr());
        while (this.isOp(this.peek(), ',')) {
          this.next();
          values.push(this.parseExpr());
        }
      }
    }
    this.endStatement('output');
    return { k: 'output', ...posOf(t), values };
  }

  /** True for `DISPLAY(a, b)`: brackets with a top-level comma that run to the end of the statement. */
  private bracketsHoldWholeList(): boolean {
    let depth = 0;
    let comma = false;
    for (let j = this.i; j < this.toks.length; j++) {
      const t = this.toks[j]!;
      if (t.kind === 'eof' || t.kind === 'bad') return false;
      if (t.kind !== 'op') continue;
      if (t.text === '(' || t.text === '[') depth++;
      else if (t.text === ')' || t.text === ']') {
        if (--depth === 0) return comma && this.atEnd(this.toks[j + 1]!);
      } else if (t.text === ',' && depth === 1) comma = true;
    }
    return false;
  }

  private inputStatement(): A.InputStmt {
    const t = this.next();
    const k = this.k;
    this.requireConstruct('input', t, k.input);
    if (this.isOp(this.peek(), '(')) {
      // INPUT(name) reads into name; INPUT() or INPUT("Press enter") just waits for a line.
      const a = this.at(1);
      if (this.isName(a) && this.isOp(this.at(2), ')') && this.atEnd(this.at(3))) {
        this.i += 3;
        this.endStatement('input');
        return { k: 'inputStmt', ...posOf(t), prompt: null, targets: [{ k: 'var', ...posOf(a), name: a.text }] };
      }
      const prompt = this.bracketedPrompt();
      this.endStatement('input');
      return { k: 'inputStmt', ...posOf(t), prompt, targets: [] };
    }
    let prompt: A.Expr | null = null;
    if (this.peek().kind === 'str') {
      prompt = this.parseExpr();
      if (this.isOp(this.peek(), ',')) this.next();
    }
    if (this.atEnd(this.peek())) {
      const example = `${k.input} name${this.lang.assign ? ` or name ${this.lang.assign} ${k.input}` : ''}`;
      throw this.fail(t, prompt ? `${k.input} needs a variable to store the answer in.` : `${k.input} needs a variable name after it.`, `For example: ${example}`);
    }
    const targets = [this.parseTarget()];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      targets.push(this.parseTarget());
    }
    this.endStatement('input');
    return { k: 'inputStmt', ...posOf(t), prompt, targets };
  }

  /** `( [prompt] )` after INPUT; returns the prompt expression or null. */
  private bracketedPrompt(): A.Expr | null {
    const open = this.next();
    this.skipNewlines();
    let prompt: A.Expr | null = null;
    if (!this.isOp(this.peek(), ')')) {
      prompt = this.parseExpr();
      this.skipNewlines();
    }
    const close = this.peek();
    if (!this.isOp(close, ')')) throw this.unclosedBracket(open, close);
    this.next();
    return prompt;
  }

  private parseTarget(): A.Target {
    const t = this.peek();
    if (t.kind === 'kw' && !this.isNameKeyword(t)) throw this.reservedName(t);
    if (!this.isName(t)) throw this.fail(t, `I expected a variable name here, but found ${describe(t)}.`);
    this.next();
    let target: A.Target = { k: 'var', ...posOf(t), name: t.text };
    while (this.isOp(this.peek(), '[')) target = this.indexSuffix(target);
    return target;
  }

  /** `[i]`, or `[r, c]` for `[r][c]` (Cambridge 2-D arrays). */
  private indexSuffix(target: A.Expr): A.IndexExpr {
    const open = this.next();
    this.requireTopic('lists', open);
    const indexes = [this.parseExpr()];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      indexes.push(this.parseExpr());
    }
    const close = this.peek();
    if (!this.isOp(close, ']')) throw this.unclosedBracket(open, close);
    this.next();
    let e = target;
    for (const index of indexes) e = { k: 'index', ...span(target, close), target: e, index };
    return e as A.IndexExpr;
  }

  private setStatement(): A.AssignStmt {
    const t = this.next();
    const k = this.k;
    this.requireConstruct('variables', t, k.set);
    const target = this.parseTarget();
    const to = this.peek();
    if (!this.isKw(to, 'to')) throw this.fail(to, `${k.set} needs ${k.to} after the variable name.`, `For example: ${k.set} score ${k.to} 0`);
    this.next();
    const value = this.parseExpr();
    this.endStatement();
    return { k: 'assign', ...posOf(t), target, value };
  }

  private ifStatement(): A.IfStmt {
    const ifTok = this.next();
    const k = this.k;
    this.requireConstruct('if', ifTok, k.if);
    const branches: A.IfStmt['branches'] = [];
    let elseBody: A.Stmt[] | null = null;
    const cond = this.parseExpr();
    this.optionalConnector('then');
    const first = this.openBlock(ifTok, k.if, ['elseIf', 'else', 'endIf'], k.endIf, `${k.if} (x > 1)`);
    branches.push({ cond, body: this.parseBody(first) });
    for (;;) {
      const j = first.braces ? this.afterNewlines() : this.i;
      const t = this.toks[j]!;
      const after = this.toks[j + 1]!;
      const joined = this.isKw(t, 'else') && this.endsWithKeyword(t, 'if');
      const elseIf = this.isKw(t, 'elseIf') || joined || (this.isKw(t, 'else') && this.isKw(after, 'if') && after.line === t.line);
      if (!elseIf && !this.isKw(t, 'else')) break;
      this.i = j;
      const word = this.next();
      if (elseIf && word.slot === 'else' && !joined) this.next();
      this.requireConstruct('else', word, elseIf ? k.elseIf : k.else);
      if (elseIf) {
        const c = this.parseExpr();
        this.optionalConnector('then');
        const block = this.branchBlock(first, ['elseIf', 'else', 'endIf'], false);
        branches.push({ cond: c, body: this.parseBody(block) });
        continue;
      }
      elseBody = this.parseBody(this.branchBlock(first, ['endIf'], true));
      break;
    }
    if (!first.braces) this.next(); // END IF
    this.endStatement();
    return { k: 'if', ...posOf(ifTok), branches, elseBody };
  }

  /** Block for an ELSE IF / ELSE part, in the same style as the IF's first block. */
  private branchBlock(first: OpenBlock, closers: PseudoKeyword[], afterElse: boolean): OpenBlock {
    const k = this.k;
    const j = this.afterNewlines();
    const brace = this.isOp(this.toks[j]!, '{');
    if (first.braces) {
      if (!brace) throw this.fail(this.toks[j]!, `Put { after ${k.else} to start its block.`, `For example: } ${k.else} { … }`);
      this.i = j + 1;
      return { ...first, afterElse };
    }
    if (brace) {
      if (!this.lang.bracesAllowed) throw this.fail(this.toks[j]!, `This language ends blocks with ${k.endIf}, not { }.`);
      throw this.fail(this.toks[j]!, `This ${k.if} uses ${k.endIf}, so its other parts can't use { }.`, 'Use the same style for every part of an IF.');
    }
    return { ...first, closers, afterElse };
  }

  private whileStatement(): A.WhileStmt {
    const t = this.next();
    const k = this.k;
    this.requireConstruct('while', t, k.while);
    const cond = this.parseExpr();
    this.optionalConnector('do');
    const block = this.openBlock(t, k.while, ['endWhile'], k.endWhile, `${k.while} (count < 5)`);
    const body = this.parseBody(block);
    if (!block.braces) this.next();
    this.endStatement();
    return { k: 'while', ...posOf(t), cond, body };
  }

  private repeatStatement(): A.Stmt {
    const t = this.next();
    const k = this.k;
    const next = this.peek();
    const joined = this.endsWithKeyword(t, 'until');
    if (joined || this.isKw(next, 'until')) {
      // REPEAT UNTIL cond … END REPEAT: checks before each pass (AP CSP).
      this.requireConstruct('repeatUntil', t, `${k.repeat} ${k.until}`);
      if (!joined) this.next();
      const cond = this.parseExpr();
      const block = this.openBlock(t, k.repeat, ['endRepeat'], k.endRepeat, `${k.repeat} ${k.until} (count = 5)`);
      const body = this.parseBody(block);
      if (!block.braces) this.next();
      this.endStatement();
      return { k: 'repeatUntilFirst', ...posOf(t), cond, body };
    }
    if (next.kind === 'nl' || next.kind === 'eof' || this.isOp(next, '{')) {
      // REPEAT … UNTIL cond: checks after each pass.
      this.requireConstruct('repeatUntil', t, `${k.repeat} … ${k.until}`);
      const block = this.openBlock(t, k.repeat, ['until'], k.until, k.repeat);
      const body = this.parseBody(block);
      if (block.braces) {
        const j = this.afterNewlines();
        if (!this.isKw(this.toks[j]!, 'until')) {
          throw this.fail(t, `This ${k.repeat} on line ${t.line} needs ${k.until} and a condition after its }.`, `For example: } ${k.until} count = 5`);
        }
        this.i = j;
      }
      this.next(); // UNTIL
      const cond = this.parseExpr();
      this.endStatement();
      return { k: 'repeatUntil', ...posOf(t), body, cond };
    }
    this.requireConstruct('repeatTimes', t, `${k.repeat} … ${k.times}`);
    const count = this.parseExpr();
    if (!this.isKw(this.peek(), 'times')) {
      throw this.fail(this.peek(), `${k.repeat} needs ${k.times} after the number.`, `For example: ${k.repeat} 3 ${k.times}`);
    }
    this.next();
    const block = this.openBlock(t, k.repeat, ['endRepeat'], k.endRepeat, `${k.repeat} 3 ${k.times}`);
    const body = this.parseBody(block);
    if (!block.braces) this.next();
    this.endStatement();
    return { k: 'repeatTimes', ...posOf(t), count, body };
  }

  private expectName(message: string): Token {
    const t = this.peek();
    if (this.isName(t)) return this.next();
    if (t.kind === 'kw') throw this.reservedName(t);
    throw this.fail(t, message);
  }

  private forStatement(): A.Stmt {
    const t = this.next();
    const k = this.k;
    const name = this.expectName(`${k.for} needs a variable name next, for example: ${this.forExample()}`);
    const next = this.peek();
    if (this.isKw(next, 'in')) {
      // FOR item IN list (AQA style) is a FOR EACH loop.
      this.requireConstruct('forEach', t, k.forEach);
      this.next();
      return this.finishForEach(t, name);
    }
    this.requireConstruct('for', t, k.for);
    if (this.isKw(next, 'from') || (next.kind === 'op' && (ARROWS.has(next.text) || next.text === '='))) this.next();
    else throw this.fail(next, `${k.for} needs ${k.from} after the variable name.`, `For example: ${this.forExample()}`);
    const from = this.parseExpr();
    if (!this.isKw(this.peek(), 'to')) throw this.fail(this.peek(), `${k.for} needs ${k.to} before the end value.`, `For example: ${this.forExample()}`);
    this.next();
    const to = this.parseExpr();
    let step: A.Expr | null = null;
    if (this.isKw(this.peek(), 'step')) {
      this.next();
      step = this.parseExpr();
    }
    const block = this.openBlock(t, k.for, ['endFor'], k.endFor, this.forExample());
    const body = this.parseBody(block);
    if (!block.braces) {
      this.next();
      this.loopNameAfterEnd(name.text);
    }
    this.endStatement();
    return { k: 'for', ...posOf(t), name: name.text, from, to, step, body };
  }

  private forEachStatement(): A.ForEachStmt {
    const t = this.next();
    const k = this.k;
    this.requireConstruct('forEach', t, k.forEach);
    const name = this.expectName(`${k.forEach} needs a variable name next, for example: ${k.forEach} item ${k.in} list`);
    if (!this.isKw(this.peek(), 'in')) {
      throw this.fail(this.peek(), `${k.forEach} needs ${k.in} after the variable name.`, `For example: ${k.forEach} item ${k.in} list`);
    }
    this.next();
    return this.finishForEach(t, name);
  }

  /**
   * `FOR each FROM 1 TO 3`: "FOR each" was read as FOR EACH, so the counting loop has lost its variable. (Not
   * `FOR EACH from IN list`, where FROM is the name of the loop variable.)
   */
  private eachAsLoopVariable(t: Token, next: Token, afterNext: Token): void {
    const words = t.text.split(' ');
    const counting =
      (this.isKw(next, 'from') && !this.isKw(afterNext, 'in')) || (next.kind === 'op' && (ARROWS.has(next.text) || next.text === '='));
    if (words.length < 2 || !counting) return;
    throw this.fail(
      t,
      `"${t.text}" is read as ${this.k.forEach}, so "${words[words.length - 1]}" can't be the name of the loop variable.`,
      `Choose a different name, for example: ${this.forExample()}`,
    );
  }

  private finishForEach(t: Token, name: Token): A.ForEachStmt {
    const k = this.k;
    const list = this.parseExpr();
    const opener = t.slot === 'forEach' ? k.forEach : k.for;
    const block = this.openBlock(t, opener, ['endFor'], k.endFor, `${k.forEach} item ${k.in} list`);
    const body = this.parseBody(block);
    if (!block.braces) {
      this.next();
      this.loopNameAfterEnd(name.text);
    }
    this.endStatement();
    return { k: 'forEach', ...posOf(t), name: name.text, list, body };
  }

  /** `END FOR i` / `NEXT i`: the optional name must be the loop variable. */
  private loopNameAfterEnd(name: string): void {
    const t = this.peek();
    if ((t.kind !== 'word' && !(t.kind === 'kw' && t.text === name)) || t.line !== this.toks[this.i - 1]!.line) return;
    this.next();
    if (t.text !== name) {
      throw this.fail(t, `This ${this.k.endFor} names "${t.text}", but the loop variable is "${name}".`, `Write ${this.k.endFor} ${name}`);
    }
  }

  private functionDefinition(): void {
    const t = this.next();
    const k = this.k;
    const isProcedure = t.slot === 'procedure';
    const word = isProcedure ? k.procedure : k.function;
    this.requireConstruct(isProcedure ? 'procedures' : 'functions', t, word);
    const outer = this.stack[this.stack.length - 1];
    if (outer) {
      throw this.fail(t, `You can't make ${this.an(word)} inside another block.`, `Move it outside the ${outer.name} that starts on line ${outer.pos.line}.`);
    }
    const name = this.expectName(`${word} needs a name next, for example: ${word} greet(name)`);
    const existing = this.functions.get(name.text);
    if (existing) {
      const kind = existing.isProcedure ? k.procedure : k.function;
      throw this.fail(name, `There's already ${this.an(kind)} called "${name.text}" (on line ${existing.line}).`, 'Give each one a different name.');
    }
    const params: string[] = [];
    const byRef: boolean[] = [];
    let ref = false;
    if (this.isOp(this.peek(), '(')) {
      const open = this.next();
      this.skipNewlines();
      if (!this.isOp(this.peek(), ')')) {
        for (;;) {
          const passing = this.peek();
          if (passing.kind === 'word' && PASSING.test(passing.text) && (this.at(1).kind === 'word' || this.at(1).kind === 'kw')) {
            ref = passing.text.toUpperCase() === 'BYREF';
            this.next();
          }
          const p = this.expectName('I expected the name of a parameter here.');
          if (params.includes(p.text)) throw this.fail(p, `"${p.text}" is used twice in the brackets.`, 'Give each parameter a different name.');
          params.push(p.text);
          byRef.push(ref);
          this.skipTypeAnnotation();
          this.skipNewlines();
          const sep = this.peek();
          if (this.isOp(sep, ',')) {
            this.next();
            this.skipNewlines();
            continue;
          }
          if (this.isOp(sep, ')')) break;
          if (sep.kind === 'word') throw this.fail(sep, 'Put a comma between the names in the brackets.');
          throw this.unclosedBracket(open, sep);
        }
      }
      this.next(); // )
    }
    this.skipReturnType();
    const def: A.FuncDef = { ...posOf(name), name: name.text, params, byRef, body: [], isProcedure, returnsValue: false };
    this.functions.set(name.text, def);
    const block = this.openBlock(t, word, [isProcedure ? 'endProcedure' : 'endFunction'], isProcedure ? k.endProcedure : k.endFunction, `${word} greet(name)`);
    const saved = this.func;
    this.func = def;
    def.body = this.parseBody(block);
    this.func = saved;
    if (!block.braces) this.next();
    this.endStatement();
  }

  /** Tolerates `name : INTEGER` (and `ARRAY[1:10] OF INTEGER`) after a parameter. */
  private skipTypeAnnotation(): void {
    if (!this.isOp(this.peek(), ':')) return;
    this.next();
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.kind === 'nl' || t.kind === 'eof') return;
      if (depth === 0 && (this.isOp(t, ',') || this.isOp(t, ')'))) return;
      if (this.isOp(t, '[') || this.isOp(t, '(')) depth++;
      else if (this.isOp(t, ']') || this.isOp(t, ')')) depth--;
      this.next();
    }
  }

  /** Tolerates `RETURNS INTEGER` (Cambridge) or `: INTEGER` after the parameter list. */
  private skipReturnType(): void {
    const t = this.peek();
    if (!(t.kind === 'word' && t.text.toUpperCase() === 'RETURNS') && !this.isOp(t, ':')) return;
    this.next();
    for (;;) {
      const u = this.peek();
      if (u.kind === 'word' || u.kind === 'num' || this.isOp(u, '[') || this.isOp(u, ']') || this.isOp(u, ':')) this.next();
      else return;
    }
  }

  private returnStatement(): A.ReturnStmt {
    const t = this.next();
    const k = this.k;
    this.requireKeyword('return', t);
    if (!this.func) throw this.fail(t, `${k.return} can only be used inside ${this.subroutineWords()}.`);
    const value = this.atEnd(this.peek()) ? null : this.parseExpr();
    if (value) this.func.returnsValue = true;
    this.endStatement();
    return { k: 'return', ...posOf(t), value };
  }

  /**
   * `DECLARE total : INTEGER` names a variable (nothing to run). `DECLARE marks : ARRAY[1:5] OF INTEGER` stores a list
   * of 5 zeros ("" for STRING / CHAR, FALSE for BOOLEAN); `ARRAY[1:3, 1:4]` makes a list of 3 lists of 4.
   */
  private declareStatement(): A.AssignStmt[] | null {
    const t = this.next();
    const k = this.k;
    this.requireKeyword('declare', t);
    const example = `${k.declare} total : INTEGER`;
    const names = [this.expectName(`${k.declare} needs a variable name next, for example: ${example}`)];
    while (this.isOp(this.peek(), ',')) {
      this.next();
      names.push(this.expectName(`I expected another variable name after the comma, for example: ${k.declare} a, b : INTEGER`));
    }
    let list: A.NewArrayExpr | null = null;
    const colon = this.peek();
    if (this.isOp(colon, ':')) {
      this.next();
      list = this.declaredType();
    } else if (colon.kind === 'op' && (ARROWS.has(colon.text) || colon.text === '=')) {
      throw this.fail(
        colon,
        `${k.declare} only names a variable — give it a value on its own line.`,
        `For example: ${example}, then ${this.lang.assignExample('total', '0')}`,
      );
    }
    this.endStatement();
    if (!list) return null;
    const value = list;
    return names.map((name) => ({ k: 'assign', ...posOf(t), target: { k: 'var', ...posOf(name), name: name.text }, value }));
  }

  /** The type after the colon of a DECLARE: null for a plain type (INTEGER, STRING …), or the list an ARRAY makes. */
  private declaredType(): A.NewArrayExpr | null {
    const k = this.k;
    const example = `${k.declare} marks : ARRAY[1:5] OF INTEGER`;
    const type = this.peek();
    if (type.kind !== 'word') throw this.fail(type, 'Put a type after the colon, like INTEGER or STRING.', `For example: ${k.declare} total : INTEGER`);
    this.next();
    if (type.text.toUpperCase() !== 'ARRAY') return null;
    const open = this.peek();
    if (!this.isOp(open, '[')) throw this.fail(open, 'ARRAY needs its first and last positions in [ ].', `For example: ${example}`);
    this.next();
    this.requireTopic('lists', open);
    const bounds: A.NewArrayExpr['bounds'] = [];
    for (;;) {
      const low = this.parseExpr();
      if (!this.isOp(this.peek(), ':')) throw this.fail(this.peek(), 'Put a colon between the first and last positions, like ARRAY[1:5].');
      this.next();
      bounds.push({ low, high: this.parseExpr() });
      if (!this.isOp(this.peek(), ',')) break;
      this.next();
    }
    const close = this.peek();
    if (!this.isOp(close, ']')) throw this.unclosedBracket(open, close);
    this.next();
    let fill: number | string | boolean = 0;
    const of = this.peek();
    if (of.kind === 'word' && of.text.toUpperCase() === 'OF') {
      this.next();
      const item = this.peek();
      if (item.kind !== 'word') throw this.fail(item, 'Put the type of the items after OF.', `For example: ${example}`);
      this.next();
      fill = typeDefault(item.text);
    }
    return { k: 'newArray', ...span(type, this.toks[this.i - 1]!), bounds, fill };
  }

  /** `CONSTANT PI ← 3.14` or `CONSTANT PI = 3.14`: an ordinary assignment. */
  private constantStatement(): A.AssignStmt {
    const t = this.next();
    const k = this.k;
    this.requireKeyword('constant', t);
    const example = `${k.constant} PI ${this.lang.assign ?? '='} 3.14`;
    const name = this.expectName(`${k.constant} needs a name next, for example: ${example}`);
    const op = this.peek();
    if (!this.isOp(op, '=') && !(op.kind === 'op' && this.lang.assignOps.has(op.text))) {
      if (op.kind === 'op' && ARROWS.has(op.text)) throw this.fail(op, `This language doesn't use "${op.text}" to store values.`, `Write ${example}`);
      throw this.fail(op, `${k.constant} needs ${this.lang.assign ?? '='} and a value after the name.`, `For example: ${example}`);
    }
    this.next();
    const value = this.parseExpr();
    this.endStatement();
    return { k: 'assign', ...posOf(t), target: { k: 'var', ...posOf(name), name: name.text }, value };
  }

  private callStatement(): A.CallStmt {
    const t = this.next();
    const k = this.k;
    this.requireKeyword('call', t);
    const name = this.peek();
    if (!this.isName(name)) {
      throw this.fail(name, `${k.call} needs the name of ${this.subroutineWords()} next.`, `For example: ${k.call} greet("Sam")`);
    }
    this.next();
    const args = this.isOp(this.peek(), '(') ? this.parseArgs() : [];
    const call = this.makeCall(name, args, this.toks[this.i - 1]!);
    this.endStatement();
    return { k: 'call', ...posOf(t), call };
  }

  /** A line starting with a name: assignment, a call, or a mistake. */
  private wordStatement(t: Token): A.Stmt {
    const after = this.at(1);
    if (this.isAssignOp(after) || this.isOp(after, '[') || this.isOp(after, '(')) {
      const target = this.parsePostfix();
      const op = this.peek();
      if (this.isAssignOp(op)) {
        if (target.k !== 'var' && target.k !== 'index') {
          throw this.fail(op, "You can't store a value in a function call.", 'Put a variable name on the left.');
        }
        this.requireTopic('variables', op);
        if (!this.lang.assignOps.has(op.text)) {
          throw this.fail(op, `This language doesn't use "${op.text}" to store values.`, `Write ${this.lang.assignExample(t.text, '…')}`);
        }
        this.next();
        const value = this.parseExpr();
        this.endStatement();
        return { k: 'assign', ...posOf(t), target, value };
      }
      if (target.k === 'call') {
        this.endStatement();
        return { k: 'call', ...posOf(t), call: target };
      }
      if (this.isOp(op, '=') || this.isOp(op, '==')) throw this.assignWithEquals(op, t.text);
      throw this.fail(t, `This line uses "${t.text}" but doesn't do anything with it.`, `To show it, write ${this.outputExample(t.text)}.`);
    }
    throw this.unknownStatementWord(t, after);
  }

  private assignWithEquals(op: Token, name: string): PseudoError {
    return this.fail(
      op,
      `To store a value in a variable, write ${this.lang.assignExample(name, '…')}`,
      op.text === '=' ? 'In this language "=" checks whether two things are equal.' : undefined,
    );
  }

  private unknownStatementWord(t: Token, after: Token): PseudoError {
    const word = t.text;
    const k = this.k;
    if (this.isOp(after, '=') || this.isOp(after, '==')) return this.assignWithEquals(after, word);
    const arrowAfter = this.at(2);
    if (this.isOp(after, '<') && this.isOp(arrowAfter, '-') && arrowAfter.col === after.endCol && arrowAfter.line === after.line) {
      return this.fail(after, `This language doesn't use "<-" to store values.`, `Write ${this.lang.assignExample(word, '…')}`);
    }
    if (this.functionNames.has(word)) return this.fail(t, `To use "${word}", put brackets after its name: ${word}(…)`);
    if (this.assigned.has(word)) {
      return this.fail(
        t,
        `This line uses "${word}" but doesn't do anything with it.`,
        `To change it, write ${this.lang.assignExample(word, '…')} — to show it, write ${this.outputExample(word)}.`,
      );
    }
    const caseSensitive = this.lang.config.caseSensitive;
    const capitals = (spelling: string) => `Did you mean "${spelling}"? Capital letters matter in this language.`;
    const firsts = this.lang.firstWords.get(this.lang.norm(word));
    if (firsts) {
      // `END If` in a case-sensitive language: the second word only differs in capitals.
      const typed = `${word} ${after.text}`;
      const pair = caseSensitive && this.nextWordOnLine(t, after) ? this.lang.spellingsByUpper.get(typed.toUpperCase()) : undefined;
      if (pair) return this.fail(span(t, after), `I don't know the words "${typed}".`, capitals(pair));
      let suggestion = k[firsts[0]!];
      const top = this.stack[this.stack.length - 1];
      if (top && !top.braces && this.lang.norm(top.closerText.split(' ')[0]!) === this.lang.norm(word)) suggestion = top.closerText;
      return this.fail(t, `"${word}" needs another word after it.`, `Did you mean "${suggestion}"?`);
    }
    const message = `I don't know the word "${word}".`;
    if (caseSensitive) {
      const spelling = this.sameButForCase(t, after);
      if (spelling) return this.fail(t, message, capitals(spelling));
    }
    const foreign = this.foreignHint(word);
    if (foreign) return this.fail(t, message, foreign);
    const suggestion = this.suggestStatementWord(word);
    return this.fail(t, message, suggestion ? `Did you mean "${suggestion}"?` : undefined);
  }

  private nextWordOnLine(t: Token, after: Token): boolean {
    return (after.kind === 'word' || after.kind === 'kw') && after.line === t.line;
  }

  /** Case-sensitive languages: the keyword meant by a word in the wrong capitals (`Else`, `End IF`, `end if`). */
  private sameButForCase(t: Token, after: Token): string | undefined {
    const upper = t.text.toUpperCase();
    const byUpper = this.lang.spellingsByUpper;
    const nextWord = this.nextWordOnLine(t, after) ? after.text.split(' ')[0]!.toUpperCase() : null;
    const pair = nextWord ? byUpper.get(`${upper} ${nextWord}`) : undefined;
    if (pair) return pair;
    const single = byUpper.get(upper);
    if (single) return single;
    const multi = this.lang.multiWordByFirstUpper.get(upper);
    if (!multi) return undefined;
    const top = this.stack[this.stack.length - 1];
    return multi.find((s) => top !== undefined && !top.braces && s === top.closerText) ?? multi[0];
  }

  private foreignHint(word: string): string | undefined {
    const kind = FOREIGN_WORDS[word.toUpperCase()];
    if (!kind) return undefined;
    const k = this.k;
    const on = (c: PseudoConstruct) => this.lang.constructOn(c);
    switch (kind) {
      case 'output':
        return `To show something on the screen, use ${k.output}.`;
      case 'input':
        return `To ask the user to type something, use ${k.input}.`;
      case 'declare': {
        // `DIM marks : ARRAY[1:3] OF INTEGER` / `VAR marks : ARRAY …`: a list needs its starting items.
        const name = this.at(1);
        const type = this.at(3);
        if (name.kind === 'word' && this.isOp(this.at(2), ':') && type.kind === 'word' && type.text.toUpperCase() === 'ARRAY') {
          return `To make a list, give it its starting items, like ${this.lang.assignExample(name.text, '[0, 0, 0]')}`;
        }
        return `You don't need to declare variables here — just give them a value, like ${this.lang.assignExample('total', '0')}`;
      }
      case 'next':
        return `Finish ${this.an(k.for)} loop with ${k.endFor}.`;
      case 'loop': {
        const loops = [on('while') && k.while, (on('repeatUntil') || on('repeatTimes')) && k.repeat, on('for') && k.for].filter(Boolean);
        return loops.length > 0 ? `For a loop, use ${loops.join(' or ')}.` : undefined;
      }
      case 'function':
        if (on('functions')) return `To make a function, use ${k.function}.`;
        return on('procedures') ? `To make a procedure, use ${k.procedure}.` : undefined;
      case 'case':
        return on('else') ? `This language doesn't have ${word} — use ${k.if} and ${k.elseIf} instead.` : undefined;
      case 'break':
        return `This language doesn't have ${word} — change the loop's condition so that it stops instead.`;
      case 'elseIf':
        return on('else') ? `Use ${k.elseIf} instead.` : undefined;
    }
  }

  private suggestStatementWord(word: string): string | null {
    const candidates: string[] = [];
    for (const slot of STATEMENT_SLOTS) {
      if (this.lang.keywordOn(slot)) candidates.push(...this.lang.config.keywords[slot]);
    }
    candidates.push(...this.functionNames);
    for (const b of BUILTIN_INFO) if (this.lang.builtinOn(b.id)) candidates.push(this.lang.builtinName(b.id));
    candidates.push(...this.assigned);
    return closestMatch(word, candidates);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Expressions (lowest precedence first)
  // ---------------------------------------------------------------------------------------------------------------

  private parseExpr(): A.Expr {
    return this.parseOr();
  }

  private binary(op: A.BinaryOp, opTok: Token, left: A.Expr, right: A.Expr): A.BinaryExpr {
    return { k: 'bin', ...span(left, right), op, opText: opTok.text, opPos: posOf(opTok), left, right };
  }

  private parseOr(): A.Expr {
    let left = this.parseAnd();
    while (this.isKw(this.peek(), 'or')) {
      const op = this.next();
      this.requireConstruct('logic', op, this.k.or);
      left = this.logicBinary('or', op, left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): A.Expr {
    let left = this.parseNot();
    while (this.isKw(this.peek(), 'and')) {
      const op = this.next();
      this.requireConstruct('logic', op, this.k.and, this.lang.constructOn('if') ? `Put one ${this.k.if} inside another instead.` : undefined);
      left = this.logicBinary('and', op, left, this.parseNot());
    }
    return left;
  }

  /** AND / OR, rejecting operands that can never be TRUE/FALSE (catches `x = 1 OR 2` before it runs). */
  private logicBinary(op: 'and' | 'or', opTok: Token, left: A.Expr, right: A.Expr): A.BinaryExpr {
    this.checkLogicOperand(left, opTok.text, 'left');
    this.checkLogicOperand(right, opTok.text, 'right');
    return this.binary(op, opTok, left, right);
  }

  private checkLogicOperand(e: A.Expr, opText: string, side: 'left' | 'right' | null): void {
    if (e.k !== 'num' && e.k !== 'str' && e.k !== 'list') return;
    const words = { trueText: this.lang.trueText, falseText: this.lang.falseText };
    const what = e.k === 'list' ? 'a list' : describeValue(e.value, words);
    const where = side ? ` on each side, but the ${side} side is` : ', but got';
    throw this.fail(
      e,
      `${opText} needs ${words.trueText} or ${words.falseText}${where} ${what}.`,
      side === 'right' && e.k !== 'list' ? `Write each comparison in full, like x = 1 ${opText} x = 2.` : undefined,
    );
  }

  private parseNot(): A.Expr {
    const t = this.peek();
    if (!this.isKw(t, 'not')) return this.parseComparison();
    this.next();
    this.requireConstruct('logic', t, this.k.not);
    const operand = this.parseNot();
    this.checkLogicOperand(operand, t.text, null);
    return { k: 'not', ...span(t, operand), operand, opText: t.text };
  }

  private parseComparison(): A.Expr {
    const left = this.parseConcat();
    let t = this.peek();
    if (t.kind !== 'op') return left;
    if (t.text === '<-') {
      // Inside a condition "x<-1" means "x < -1".
      this.splitArrow();
      t = this.peek();
    }
    const op = COMPARISONS.get(t.text);
    if (!op) {
      if (t.text === '←' || t.text === ':=') {
        throw this.fail(t, `"${t.text}" stores a value, so it can't be used here.`, 'To check whether two things are equal, use =.');
      }
      return left;
    }
    this.next();
    const right = this.parseConcat();
    const after = this.peek();
    if (after.kind === 'op' && (COMPARISONS.has(after.text) || after.text === '<-')) {
      throw this.fail(after, "You can't check two comparisons in a row like this.", `Check one thing at a time and join them with ${this.k.and}, like 1 < x ${this.k.and} x < 5.`);
    }
    return this.binary(op, t, left, right);
  }

  private splitArrow(): void {
    const t = this.toks[this.i]!;
    this.toks.splice(this.i, 1, { ...t, text: '<', endCol: t.col + 1 }, { ...t, text: '-', col: t.col + 1, endCol: t.col + 2 });
  }

  private parseConcat(): A.Expr {
    let left = this.parseAdditive();
    while (this.isOp(this.peek(), '&')) {
      const op = this.next();
      if (!this.lang.concatAmp) throw this.fail(op, 'In this language, text is joined with + instead of &.');
      left = this.binary('&', op, left, this.parseAdditive());
    }
    return left;
  }

  private parseAdditive(): A.Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (!this.isOp(t, '+') && !this.isOp(t, '-')) return left;
      this.next();
      left = this.binary(t.text as '+' | '-', t, left, this.parseMultiplicative());
    }
  }

  private parseMultiplicative(): A.Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      let op: A.BinaryOp;
      if (this.isOp(t, '*')) op = '*';
      else if (this.isOp(t, '/')) op = '/';
      else if (this.isKw(t, 'div')) op = 'div';
      else if (this.isKw(t, 'mod')) op = 'mod';
      else return left;
      this.next();
      if (op === 'div' || op === 'mod') this.requireConstruct('modDiv', t, this.k[op]);
      left = this.binary(op, t, left, this.parseUnary());
    }
  }

  private parseUnary(): A.Expr {
    const t = this.peek();
    if (this.isOp(t, '-')) {
      this.next();
      const operand = this.parseUnary();
      return { k: 'neg', ...span(t, operand), operand, opText: '-' };
    }
    if (this.isOp(t, '+')) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): A.Expr {
    const base = this.parsePostfix();
    if (!this.isOp(this.peek(), '^')) return base;
    const op = this.next();
    return this.binary('^', op, base, this.parseUnary());
  }

  private parsePostfix(): A.Expr {
    let e = this.parsePrimary();
    while (this.isOp(this.peek(), '[')) e = this.indexSuffix(e);
    return e;
  }

  private parsePrimary(): A.Expr {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.next();
        return { k: 'num', ...posOf(t), value: t.value as number };
      case 'str':
        this.next();
        return { k: 'str', ...posOf(t), value: t.value as string };
      case 'kw':
        if (!this.isNameKeyword(t)) return this.keywordValue(t);
        return this.nameValue(t);
      case 'word':
        return this.nameValue(t);
      case 'op':
        if (t.text === '(') {
          this.next();
          const inner = this.parseExpr();
          const close = this.peek();
          if (!this.isOp(close, ')')) throw this.unclosedBracket(t, close);
          this.next();
          return inner;
        }
        if (t.text === '[') return this.listLiteral();
        break;
      default:
        break;
    }
    throw this.expectedValue(t);
  }

  /** A variable, or a call when brackets follow the name. */
  private nameValue(t: Token): A.Expr {
    this.next();
    if (this.isOp(this.peek(), '(')) {
      const args = this.parseArgs();
      return this.makeCall(t, args, this.toks[this.i - 1]!);
    }
    return { k: 'var', ...posOf(t), name: t.text };
  }

  private keywordValue(t: Token): A.Expr {
    const k = this.k;
    switch (t.slot) {
      case 'true':
      case 'false':
        this.next();
        this.requireConstruct('logic', t, k[t.slot]);
        return { k: 'bool', ...posOf(t), value: t.slot === 'true' };
      case 'input': {
        this.next();
        this.requireConstruct('input', t, k.input);
        if (!this.isOp(this.peek(), '(')) return { k: 'input', ...posOf(t), prompt: null };
        const prompt = this.bracketedPrompt();
        return { k: 'input', ...span(t, this.toks[this.i - 1]!), prompt };
      }
      case 'not': {
        this.next();
        this.requireConstruct('logic', t, k.not);
        const operand = this.parseUnary();
        return { k: 'not', ...span(t, operand), operand, opText: t.text };
      }
      case 'mod':
      case 'div':
        if (this.isOp(this.at(1), '(')) {
          // Cambridge style MOD(10, 3) / DIV(10, 3).
          this.next();
          this.requireConstruct('modDiv', t, k[t.slot]);
          const args = this.parseArgs();
          if (args.length !== 2) throw this.fail(t, `${t.text} needs 2 values in its brackets, like ${t.text}(7, 2).`);
          return this.binary(t.slot, t, args[0]!, args[1]!);
        }
        break;
      default:
        break;
    }
    throw this.expectedValue(t);
  }

  private listLiteral(): A.ListLit {
    const open = this.next();
    this.requireTopic('lists', open);
    const items: A.Expr[] = [];
    this.skipNewlines();
    if (!this.isOp(this.peek(), ']')) {
      for (;;) {
        items.push(this.parseExpr());
        this.skipNewlines();
        const t = this.peek();
        if (this.isOp(t, ',')) {
          this.next();
          this.skipNewlines();
          if (this.isOp(this.peek(), ']')) break;
          continue;
        }
        if (this.isOp(t, ']')) break;
        throw this.unclosedBracket(open, t);
      }
    }
    const close = this.next();
    return { k: 'list', ...span(open, close), items };
  }

  /** `( a, b, … )` — the current token is the "(". */
  private parseArgs(): A.Expr[] {
    const open = this.next();
    const args: A.Expr[] = [];
    this.skipNewlines();
    if (this.isOp(this.peek(), ')')) {
      this.next();
      return args;
    }
    for (;;) {
      args.push(this.parseExpr());
      this.skipNewlines();
      const t = this.peek();
      if (this.isOp(t, ',')) {
        this.next();
        this.skipNewlines();
        continue;
      }
      if (this.isOp(t, ')')) {
        this.next();
        return args;
      }
      throw this.unclosedBracket(open, t);
    }
  }

  private makeCall(name: Token, args: A.Expr[], end: Token): A.CallExpr {
    return { k: 'call', ...span(name, end), name: name.text, args, fn: null, builtin: null };
  }

  private unclosedBracket(open: Token, found: Token): PseudoError {
    const closer = open.text === '[' ? ']' : ')';
    if (found.kind === 'nl' || found.kind === 'eof' || found.line !== open.line || this.isCloser(found) || found.kind === 'kw') {
      return this.fail(open, `This ${open.text} needs a closing ${closer}.`);
    }
    return this.fail(found, `I wasn't expecting ${describe(found)} here.`, `Put commas between values, and check that this ${open.text} has a closing ${closer}.`);
  }

  private expectedValue(t: Token): PseudoError {
    const prev = this.i > 0 ? this.toks[this.i - 1]! : null;
    const after = prev && prev.kind !== 'nl' ? ` after "${prev.text}"` : '';
    if (t.kind === 'nl' || t.kind === 'eof') return this.fail(t, `I expected a value${after}.`);
    const connector = t.kind === 'kw' && !STATEMENT_SLOTS.includes(t.slot!) && !CLOSERS.has(t.slot!);
    return this.fail(
      t,
      `I expected a value${after}, but found ${describe(t)}.`,
      connector ? `"${t.text}" is a special word in this language — if it's meant to be a variable, choose a different name.` : undefined,
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolver: link calls to functions/built-ins and check them before the program runs
// ---------------------------------------------------------------------------------------------------------------------

function resolveProgram(program: A.Program, lang: Language, assigned: ReadonlySet<string>): void {
  const k = lang.kw;
  const errors: PseudoError[] = [];
  const fail = (pos: Pos, message: string, hint?: string) => errors.push(syntaxError(message, pos, hint));

  const unknownFunction = (call: A.CallExpr) => {
    const name = call.name;
    if (assigned.has(name)) {
      fail(call, `"${name}" is a variable, not a function.`, lang.constructOn('lists') ? `To get an item from a list, use square brackets: ${name}[${lang.base}]` : undefined);
      return;
    }
    const alias = BUILTIN_ALIASES[name.toUpperCase()];
    if (alias !== undefined && lang.builtinOn(alias)) {
      fail(call, `I don't know a function called "${name}".`, `In this language it's called ${lang.builtinName(alias)}.`);
      return;
    }
    const candidates = [...program.functions.keys()];
    for (const b of BUILTIN_INFO) if (lang.builtinOn(b.id)) candidates.push(lang.builtinName(b.id));
    const suggestion = closestMatch(name, candidates);
    const canDefine = lang.constructOn('functions') || lang.constructOn('procedures');
    fail(
      call,
      `I don't know a function called "${name}".`,
      suggestion ? `Did you mean "${suggestion}"?` : canDefine ? `Check the spelling, or make it with ${lang.constructOn('functions') ? k.function : k.procedure} ${name}(…).` : undefined,
    );
  };

  const visitCall = (call: A.CallExpr, valueNeeded: boolean) => {
    for (const a of call.args) visitExpr(a);
    const fn = program.functions.get(call.name);
    if (fn) {
      call.fn = fn;
      const n = call.args.length;
      if (n !== fn.params.length) {
        fail(
          call,
          fn.params.length === 0
            ? `"${fn.name}" doesn't take any values in its brackets, but you gave ${n}.`
            : `"${fn.name}" needs ${plural(fn.params.length, 'value', 'values')} in its brackets, but you gave ${n}.`,
          `It was made on line ${fn.line} as ${fn.name}(${fn.params.join(', ')}).`,
        );
      } else if (valueNeeded && !fn.returnsValue) {
        if (fn.isProcedure) {
          fail(
            call,
            `"${fn.name}" is ${article(k.procedure)} ${k.procedure}, so it doesn't give back a value to use here.`,
            lang.constructOn('functions')
              ? `If you need a value, make it ${article(k.function)} ${k.function} that uses ${k.return}.`
              : `If you need a value, use ${k.return} inside it.`,
          );
        } else {
          fail(call, `"${fn.name}" never uses ${k.return} to give back a value, so there's nothing to use here.`, `Add ${k.return} followed by a value inside ${fn.name}.`);
        }
      }
      return;
    }
    const id = lang.builtinByName.get(lang.norm(call.name));
    if (id) {
      const name = lang.builtinName(id);
      if (!lang.builtinOn(id)) {
        fail(call, `You haven't learned "${name}" yet.`);
        return;
      }
      call.builtin = id;
      const info = BUILTIN_INFO.find((b) => b.id === id)!;
      const counts = BUILTIN_ARITY[id];
      if (!counts.includes(call.args.length)) {
        const needed = id === 'round' ? '1 or 2 values' : plural(info.params.length, 'value', 'values');
        fail(call, `${name} needs ${needed} in its brackets, but you gave ${call.args.length}.`, `Use it like this: ${name}(${info.params.join(', ')})`);
      } else if (valueNeeded && (id === 'append' || id === 'insert')) {
        fail(call, `${name} changes the list but doesn't give back a value.`, `Use it on a line of its own, like ${name}(${info.params.join(', ')}).`);
      }
      return;
    }
    unknownFunction(call);
  };

  const visitExpr = (e: A.Expr): void => {
    switch (e.k) {
      case 'bin':
        visitExpr(e.left);
        visitExpr(e.right);
        break;
      case 'neg':
      case 'not':
        visitExpr(e.operand);
        break;
      case 'list':
        for (const item of e.items) visitExpr(item);
        break;
      case 'index':
        visitExpr(e.target);
        visitExpr(e.index);
        break;
      case 'input':
        if (e.prompt) visitExpr(e.prompt);
        break;
      case 'call':
        visitCall(e, true);
        break;
      case 'newArray':
        for (const b of e.bounds) {
          visitExpr(b.low);
          visitExpr(b.high);
        }
        break;
      default:
        break;
    }
  };

  const visitBody = (body: A.Stmt[]): void => {
    for (const s of body) visitStmt(s);
  };

  const visitStmt = (s: A.Stmt): void => {
    switch (s.k) {
      case 'output':
        for (const v of s.values) visitExpr(v);
        break;
      case 'inputStmt':
        if (s.prompt) visitExpr(s.prompt);
        for (const t of s.targets) visitExpr(t);
        break;
      case 'assign':
        visitExpr(s.target);
        visitExpr(s.value);
        break;
      case 'if':
        for (const b of s.branches) {
          visitExpr(b.cond);
          visitBody(b.body);
        }
        if (s.elseBody) visitBody(s.elseBody);
        break;
      case 'while':
      case 'repeatUntil':
      case 'repeatUntilFirst':
        visitExpr(s.cond);
        visitBody(s.body);
        break;
      case 'repeatTimes':
        visitExpr(s.count);
        visitBody(s.body);
        break;
      case 'for':
        visitExpr(s.from);
        visitExpr(s.to);
        if (s.step) visitExpr(s.step);
        visitBody(s.body);
        break;
      case 'forEach':
        visitExpr(s.list);
        visitBody(s.body);
        break;
      case 'return':
        if (s.value) visitExpr(s.value);
        break;
      case 'call':
        visitCall(s.call, false);
        break;
    }
  };

  visitBody(program.body);
  for (const fn of program.functions.values()) visitBody(fn.body);
  if (errors.length > 0) {
    errors.sort((a, b) => a.pos.line - b.pos.line || a.pos.col - b.pos.col);
    throw errors[0]!;
  }
}

/** Tokenizes, parses and resolves a program. Throws a PseudoError for the first problem in the source. */
export function parseProgram(source: string, lang: Language): A.Program {
  const parser = new Parser(tokenize(source, lang), lang);
  const program = parser.parseProgram();
  resolveProgram(program, lang, parser.assigned);
  return program;
}
