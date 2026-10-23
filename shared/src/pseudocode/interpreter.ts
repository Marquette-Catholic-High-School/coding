// Tree-walking interpreter. Synchronous, allocation-light and environment-agnostic (Web Worker, Node, browser).
import type * as A from './ast';
import { article, closestMatch, formatCount, plural, runtimeError, type Pos, type PseudoError } from './errors';
import type { Language } from './language';
import { BUILTIN_INFO, type PseudoBuiltin, type PseudoIO } from './types';
import {
  cleanNumber,
  describeValue,
  formatNumber,
  formatValue,
  numbersEqual,
  parseNumericText,
  typeLabel,
  valuesEqual,
  type BoolWords,
  type Value,
} from './values';

export interface InterpreterLimits {
  maxSteps: number;
  maxCallDepth: number;
  random: () => number;
}

const ARITHMETIC_VERBS: Partial<Record<A.BinaryOp, string>> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
};

export class Interpreter {
  /** Statements and loop passes executed so far. */
  steps = 0;
  /** Innermost call being run (where a JavaScript stack overflow is reported). */
  currentCall: A.CallExpr | null = null;
  private depth = 0;
  private readonly globals = new Map<string, Value>();
  private locals: Map<string, Value>;
  private returnValue: Value | undefined = undefined;
  /** Loops currently running, innermost last (the step-limit error points at the innermost one). */
  private readonly loops: Pos[] = [];
  private readonly program: A.Program;
  private readonly lang: Language;
  private readonly io: PseudoIO;
  private readonly limits: InterpreterLimits;
  private readonly words: BoolWords;
  private readonly separator: string;
  private readonly lineEnd: string;

  constructor(program: A.Program, lang: Language, io: PseudoIO, limits: InterpreterLimits) {
    this.program = program;
    this.lang = lang;
    this.io = io;
    this.limits = limits;
    this.locals = this.globals;
    this.words = { trueText: lang.trueText, falseText: lang.falseText };
    this.separator = lang.config.outputSeparator;
    this.lineEnd = lang.config.outputNewline ? '\n' : lang.config.outputSeparator;
  }

  run(): void {
    this.execBlock(this.program.body);
  }

  /** The error for running out of JavaScript stack (very deep recursion). */
  recursionError(): PseudoError {
    const at: Pos = this.currentCall ?? { line: 1, col: 1, endCol: 1 };
    return this.tooDeep(at);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Statements
  // -----------------------------------------------------------------------------------------------------------------

  /** Runs statements; true when a RETURN finished the current function. */
  private execBlock(body: A.Stmt[]): boolean {
    for (let i = 0; i < body.length; i++) if (this.exec(body[i]!)) return true;
    return false;
  }

  private tick(pos: Pos): void {
    if (++this.steps > this.limits.maxSteps) throw this.tooManySteps(pos);
  }

  private exec(s: A.Stmt): boolean {
    this.tick(s);
    switch (s.k) {
      case 'assign': {
        let value = this.eval(s.value);
        // Assigning a list copies it (AP CSP: "aList ← bList assigns a copy"); new lists are used as they are.
        if (Array.isArray(value) && (s.value.k === 'var' || s.value.k === 'index')) value = value.slice();
        this.store(s.target, value);
        return false;
      }
      case 'output': {
        const values = s.values;
        let text = '';
        for (let i = 0; i < values.length; i++) {
          if (i > 0) text += this.separator;
          text += formatValue(this.eval(values[i]!), this.words);
        }
        this.io.write(text + this.lineEnd);
        return false;
      }
      case 'call':
        this.call(s.call);
        return false;
      case 'if': {
        const branches = s.branches;
        for (let i = 0; i < branches.length; i++) {
          const b = branches[i]!;
          if (this.condition(b.cond, this.lang.kw.if)) return this.execBlock(b.body);
        }
        return s.elseBody ? this.execBlock(s.elseBody) : false;
      }
      case 'while':
        this.loops.push(s);
        for (;;) {
          if (!this.condition(s.cond, this.lang.kw.while)) break;
          if (this.execBlock(s.body)) return this.leaveLoop(true);
          this.tick(s);
        }
        return this.leaveLoop(false);
      case 'repeatUntil':
        this.loops.push(s);
        for (;;) {
          if (this.execBlock(s.body)) return this.leaveLoop(true);
          if (this.condition(s.cond, this.lang.kw.until)) break;
          this.tick(s);
        }
        return this.leaveLoop(false);
      case 'repeatUntilFirst':
        this.loops.push(s);
        for (;;) {
          if (this.condition(s.cond, this.lang.kw.until)) break;
          if (this.execBlock(s.body)) return this.leaveLoop(true);
          this.tick(s);
        }
        return this.leaveLoop(false);
      case 'repeatTimes':
        return this.execRepeatTimes(s);
      case 'for':
        return this.execFor(s);
      case 'forEach':
        return this.execForEach(s);
      case 'return':
        this.returnValue = s.value ? this.eval(s.value) : undefined;
        return true;
      case 'inputStmt': {
        const prompt = s.prompt ? formatValue(this.eval(s.prompt), this.words) : null;
        if (s.targets.length === 0) {
          this.readInput(prompt, s);
          return false;
        }
        for (let i = 0; i < s.targets.length; i++) {
          const target = s.targets[i]!;
          this.store(target, this.readInput(i === 0 ? prompt : null, target));
        }
        return false;
      }
    }
  }

  private leaveLoop(returned: boolean): boolean {
    this.loops.pop();
    return returned;
  }

  private execRepeatTimes(s: A.RepeatTimesStmt): boolean {
    const k = this.lang.kw;
    const raw = this.eval(s.count);
    if (typeof raw !== 'number') {
      throw runtimeError(`${k.repeat} needs a number of times, but got ${describeValue(raw, this.words)}.`, s.count);
    }
    const count = cleanNumber(raw);
    if (!Number.isInteger(count)) throw runtimeError(`${k.repeat} needs a whole number of times, but got ${formatNumber(count)}.`, s.count);
    this.loops.push(s);
    for (let n = 0; n < count; n++) {
      if (n > 0) this.tick(s);
      if (this.execBlock(s.body)) return this.leaveLoop(true);
    }
    return this.leaveLoop(false);
  }

  private execFor(s: A.ForStmt): boolean {
    const k = this.lang.kw;
    const from = this.forNumber(s.from, 'start');
    const to = cleanNumber(this.forNumber(s.to, 'end'));
    const step = s.step ? this.forNumber(s.step, k.step) : 1;
    if (step === 0) throw runtimeError(`${k.step} can't be 0 — the loop would never finish.`, s.step ?? s);
    const exact = Number.isInteger(from) && Number.isInteger(step);
    this.loops.push(s);
    for (let n = 0; ; n++) {
      const value = exact ? from + n * step : cleanNumber(from + n * step);
      if (step > 0 ? value > to : value < to) break;
      if (n > 0) this.tick(s);
      this.setVar(s.name, value);
      if (this.execBlock(s.body)) return this.leaveLoop(true);
    }
    return this.leaveLoop(false);
  }

  private forNumber(e: A.Expr, what: string): number {
    const v = this.eval(e);
    if (typeof v !== 'number') {
      throw runtimeError(`${this.lang.kw.for} needs numbers, but the ${what} value is ${describeValue(v, this.words)}.`, e);
    }
    return v;
  }

  private execForEach(s: A.ForEachStmt): boolean {
    const collection = this.eval(s.list);
    let items: readonly Value[];
    if (Array.isArray(collection)) items = collection.slice();
    else if (typeof collection === 'string') items = collection.split('');
    else {
      throw runtimeError(
        `${this.lang.kw.forEach} needs a list (or some text) to go through, but got ${describeValue(collection, this.words)}.`,
        s.list,
      );
    }
    this.loops.push(s);
    for (let n = 0; n < items.length; n++) {
      if (n > 0) this.tick(s);
      this.setVar(s.name, items[n]!);
      if (this.execBlock(s.body)) return this.leaveLoop(true);
    }
    return this.leaveLoop(false);
  }

  private condition(e: A.Expr, word: string): boolean {
    const v = this.eval(e);
    if (typeof v === 'boolean') return v;
    const w = this.words;
    throw runtimeError(
      `The ${word} condition must be ${w.trueText} or ${w.falseText}, but here it's ${describeValue(v, w)}.`,
      e,
      'Use a comparison, like x > 5.',
    );
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Variables and storage
  // -----------------------------------------------------------------------------------------------------------------

  /** Updates an existing local, else an existing global, else creates a local. */
  private setVar(name: string, value: Value): void {
    const locals = this.locals;
    if (locals !== this.globals && !locals.has(name) && this.globals.has(name)) this.globals.set(name, value);
    else locals.set(name, value);
  }

  private getVar(e: A.VarRef): Value {
    let v = this.locals.get(e.name);
    if (v === undefined && this.locals !== this.globals) v = this.globals.get(e.name);
    if (v === undefined) throw this.unknownVariable(e);
    return v;
  }

  private unknownVariable(e: A.VarRef): PseudoError {
    const name = e.name;
    const k = this.lang.kw;
    const fn = this.program.functions.get(name);
    if (fn) {
      return runtimeError(
        `"${name}" is ${article(fn.isProcedure ? k.procedure : k.function)} ${fn.isProcedure ? k.procedure : k.function}, not a variable.`,
        e,
        `To use it, put brackets after its name: ${name}(${fn.params.join(', ')})`,
      );
    }
    const builtin = this.lang.builtinByName.get(this.lang.norm(name));
    if (builtin && this.lang.builtinOn(builtin)) {
      const info = BUILTIN_INFO.find((b) => b.id === builtin)!;
      return runtimeError(`${name} is a built-in function, not a variable.`, e, `Use it with brackets, like ${name}(${info.params.join(', ')}).`);
    }
    const known = [...this.locals.keys()];
    if (this.locals !== this.globals) known.push(...this.globals.keys());
    const suggestion = closestMatch(name, known);
    let hint: string;
    if (suggestion && suggestion.toLowerCase() === name.toLowerCase()) hint = `Did you mean "${suggestion}"? Capital letters matter in variable names.`;
    else if (suggestion) hint = `Did you mean "${suggestion}"?`;
    else hint = `Give it a value before this line runs, for example: ${this.lang.assignExample(name, '0')}`;
    return runtimeError(`I don't know a variable called "${name}".`, e, hint);
  }

  private store(target: A.Target, value: Value): void {
    if (target.k === 'var') {
      this.setVar(target.name, value);
      return;
    }
    const container = this.eval(target.target);
    const index = this.eval(target.index);
    if (Array.isArray(container)) {
      container[this.position(index, container.length, target.index, false)] = value;
      return;
    }
    if (typeof container === 'string') {
      throw runtimeError("You can't change part of some text using [ ].", target, 'Text can be read with [ ] but not changed — build new text instead.');
    }
    throw runtimeError(`You can only use [ ] on a list or text, but this is ${describeValue(container, this.words)}.`, target.target);
  }

  /** Checks a list/text position and turns it into a 0-based index. */
  private position(index: Value, length: number, at: Pos, text: boolean): number {
    const base = this.lang.base;
    const what = text ? 'Text positions' : 'List positions';
    if (typeof index !== 'number') throw runtimeError(`${what} must be numbers, but this is ${describeValue(index, this.words)}.`, at);
    const n = cleanNumber(index);
    if (!Number.isInteger(n)) throw runtimeError(`${what} must be whole numbers, but this is ${formatNumber(n)}.`, at);
    const i = n - base;
    if (i >= 0 && i < length) return i;
    const range = length === 1 ? `position ${base}` : `positions ${base} to ${base + length - 1}`;
    const message = text
      ? length === 0
        ? `Position ${n} doesn't exist — the text is empty.`
        : `Position ${n} doesn't exist — the text has ${plural(length, 'character', 'characters')} (${range}).`
      : length === 0
        ? `List position ${n} doesn't exist — the list is empty.`
        : `List position ${n} doesn't exist — the list has ${plural(length, 'item', 'items')} (${range}).`;
    let hint: string | undefined;
    if (base === 1 && n === 0) hint = 'In this language the first position is 1, not 0.';
    else if (base === 0 && n === length && length > 0) hint = `In this language the first position is 0, so the last one is ${length - 1}.`;
    throw runtimeError(message, at, hint);
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Expressions
  // -----------------------------------------------------------------------------------------------------------------

  private eval(e: A.Expr): Value {
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.value;
      case 'var':
        return this.getVar(e);
      case 'bin':
        return this.evalBinary(e);
      case 'neg': {
        const v = this.eval(e.operand);
        if (typeof v !== 'number') throw this.operandError(`make ${typeLabel(v, this.words)} negative`, v, e);
        return -v;
      }
      case 'not': {
        const v = this.eval(e.operand);
        if (typeof v !== 'boolean') throw this.logicError(e.opText, v, e.operand, null);
        return !v;
      }
      case 'list': {
        const items = e.items;
        const out = new Array<Value>(items.length);
        for (let i = 0; i < items.length; i++) out[i] = this.eval(items[i]!);
        return out;
      }
      case 'index': {
        const container = this.eval(e.target);
        const index = this.eval(e.index);
        if (Array.isArray(container)) return container[this.position(index, container.length, e.index, false)]!;
        if (typeof container === 'string') return container[this.position(index, container.length, e.index, true)]!;
        throw runtimeError(`You can only use [ ] on a list or text, but this is ${describeValue(container, this.words)}.`, e.target);
      }
      case 'call': {
        const result = this.call(e);
        if (result === undefined) throw this.noValue(e);
        return result;
      }
      case 'input':
        return this.readInput(e.prompt ? formatValue(this.eval(e.prompt), this.words) : null, e);
    }
  }

  private evalBinary(e: A.BinaryExpr): Value {
    const op = e.op;
    if (op === 'and' || op === 'or') {
      const left = this.eval(e.left);
      if (typeof left !== 'boolean') throw this.logicError(e.opText, left, e.left, 'left');
      if (op === 'and' ? !left : left) return left;
      const right = this.eval(e.right);
      if (typeof right !== 'boolean') throw this.logicError(e.opText, right, e.right, 'right');
      return right;
    }
    const l = this.eval(e.left);
    const r = this.eval(e.right);
    if (typeof l === 'number' && typeof r === 'number') {
      switch (op) {
        case '+':
          return this.checked(l + r, e);
        case '-':
          return this.checked(l - r, e);
        case '*':
          return this.checked(l * r, e);
        case '/':
          if (r === 0) throw this.divideByZero(e);
          return this.checked(l / r, e);
        case '^':
          return this.checked(l ** r, e);
        case 'div':
          if (r === 0) throw this.divideByZero(e);
          return Math.floor(cleanNumber(l / r));
        case 'mod':
          if (r === 0) throw this.divideByZero(e);
          return cleanNumber(l - r * Math.floor(cleanNumber(l / r)));
        case '=':
          return numbersEqual(l, r);
        case '!=':
          return !numbersEqual(l, r);
        case '<':
          return l < r && !numbersEqual(l, r);
        case '>':
          return l > r && !numbersEqual(l, r);
        case '<=':
          return l <= r || numbersEqual(l, r);
        case '>=':
          return l >= r || numbersEqual(l, r);
        case '&':
          return formatNumber(l) + formatNumber(r);
      }
    }
    return this.evalMixed(e, l, r);
  }

  /** Binary operators where at least one side isn't a number. */
  private evalMixed(e: A.BinaryExpr, l: Value, r: Value): Value {
    switch (e.op) {
      case '=':
        return valuesEqual(l, r);
      case '!=':
        return !valuesEqual(l, r);
      case '&':
        return formatValue(l, this.words) + formatValue(r, this.words);
      case '+':
        if (typeof l === 'string' || typeof r === 'string') {
          if (this.lang.concatPlus) return formatValue(l, this.words) + formatValue(r, this.words);
          throw runtimeError("You can't add text.", e.opPos, this.lang.concatAmp ? 'To join text, use & — for example "Hi " & name.' : undefined);
        }
        if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
        break;
      case '<':
      case '>':
      case '<=':
      case '>=':
        if (typeof l === 'string' && typeof r === 'string') {
          if (e.op === '<') return l < r;
          if (e.op === '>') return l > r;
          return e.op === '<=' ? l <= r : l >= r;
        }
        throw runtimeError(
          `You can't compare ${typeLabel(l, this.words)} with ${typeLabel(r, this.words)} using "${e.opText}".`,
          e.opPos,
          this.numericTextHint(typeof l === 'string' ? l : r),
        );
      default:
        break;
    }
    const bad = typeof l !== 'number' ? l : r;
    const verb = ARITHMETIC_VERBS[e.op];
    const label = typeof bad === 'string' ? 'text' : Array.isArray(bad) ? 'lists' : `${this.words.trueText}/${this.words.falseText} values`;
    if (verb) throw this.operandError(`${verb} ${label}`, bad, e.opPos, e.op === '+');
    throw this.operandError(`use "${e.opText}" with ${label}`, bad, e.opPos);
  }

  private operandError(what: string, bad: Value, at: Pos, adding = false): PseudoError {
    let hint = this.numericTextHint(bad);
    if (!hint && adding && Array.isArray(bad) && this.lang.builtinOn('append')) {
      hint = `To add an item to a list, use ${this.lang.builtinName('append')}(list, item).`;
    }
    return runtimeError(`You can't ${what}.`, at, hint);
  }

  /** For text that looks like a number: suggest converting it. */
  private numericTextHint(v: Value): string | undefined {
    if (typeof v !== 'string' || parseNumericText(v) === null || !this.lang.builtinOn('num')) return undefined;
    return `"${v}" is text. Turn it into a number first with ${this.lang.builtinName('num')}("${v}").`;
  }

  private logicError(opText: string, v: Value, at: Pos, side: 'left' | 'right' | null): PseudoError {
    const w = this.words;
    const where = side ? ` on each side, but the ${side} side is` : ', but got';
    const hint =
      side === 'right' && (typeof v === 'number' || typeof v === 'string')
        ? `Write each comparison in full, like x = 1 ${opText} x = 2.`
        : undefined;
    return runtimeError(`${opText} needs ${w.trueText} or ${w.falseText}${where} ${describeValue(v, w)}.`, at, hint);
  }

  private checked(n: number, e: A.BinaryExpr): number {
    if (n - n === 0) return n;
    if (Number.isNaN(n)) throw runtimeError("That calculation doesn't have a real-number answer.", e.opPos);
    throw runtimeError('That number is too big for the computer to work with.', e.opPos);
  }

  private divideByZero(e: A.BinaryExpr): PseudoError {
    return runtimeError("You can't divide by zero.", e.opPos, 'Check the value on the right-hand side.');
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Calls
  // -----------------------------------------------------------------------------------------------------------------

  /** Runs a call; undefined when it gives back no value. */
  private call(e: A.CallExpr): Value | undefined {
    const n = e.args.length;
    const args = new Array<Value>(n);
    for (let i = 0; i < n; i++) args[i] = this.eval(e.args[i]!);
    if (e.fn) return this.callFunction(e.fn, args, e);
    return this.callBuiltin(e.builtin!, args, e);
  }

  private callFunction(fn: A.FuncDef, args: Value[], e: A.CallExpr): Value | undefined {
    if (this.depth >= this.limits.maxCallDepth) throw this.tooDeep(e);
    const scope = new Map<string, Value>();
    for (let i = 0; i < fn.params.length; i++) scope.set(fn.params[i]!, args[i]!);
    const savedLocals = this.locals;
    const savedCall = this.currentCall;
    this.locals = scope;
    this.currentCall = e;
    this.depth++;
    this.returnValue = undefined;
    const returned = this.execBlock(fn.body);
    const result = returned ? this.returnValue : undefined;
    this.returnValue = undefined;
    this.depth--;
    this.currentCall = savedCall;
    this.locals = savedLocals;
    return result;
  }

  private noValue(e: A.CallExpr): PseudoError {
    const k = this.lang.kw;
    if (e.fn?.isProcedure) {
      return runtimeError(`"${e.name}" is ${article(k.procedure)} ${k.procedure}, so it doesn't give back a value to use here.`, e);
    }
    if (e.fn) {
      return runtimeError(`"${e.name}" finished without giving back a value.`, e, `Make sure every way through ${e.name} ends with ${k.return} and a value.`);
    }
    return runtimeError(`${e.name} doesn't give back a value.`, e);
  }

  private tooDeep(at: Pos): PseudoError {
    const k = this.lang.kw;
    return runtimeError(
      `Your program called functions inside each other too many times (more than ${formatCount(this.limits.maxCallDepth)} deep).`,
      at,
      `If a function calls itself, make sure it has a stopping case — ${this.lang.constructOn('if') ? `${article(k.if)} ${k.if} that lets it` : 'a way to'} finish without calling itself again.`,
    );
  }

  private tooManySteps(pos: Pos): PseudoError {
    const at = this.loops.length > 0 ? this.loops[this.loops.length - 1]! : pos;
    return runtimeError(
      `Your program took too many steps (more than ${formatCount(this.limits.maxSteps)}). Is there a loop that never ends?`,
      at,
      'Check that something inside the loop changes, so the loop can stop.',
    );
  }

  private readInput(prompt: string | null, at: Pos): Value {
    if (prompt) this.io.write(prompt);
    const line = this.io.readLine(prompt);
    if (line === null || line === undefined) {
      throw runtimeError(
        "Your program asked for input, but there wasn't any left.",
        at,
        `Each ${this.lang.kw.input} reads one line, so the program needs a line of input for every ${this.lang.kw.input}.`,
      );
    }
    const text = String(line).replace(/\r$/, '');
    return parseNumericText(text) ?? text;
  }

  // -----------------------------------------------------------------------------------------------------------------
  // Built-in functions
  // -----------------------------------------------------------------------------------------------------------------

  private callBuiltin(id: PseudoBuiltin, args: Value[], e: A.CallExpr): Value | undefined {
    const name = this.lang.builtinName(id);
    const base = this.lang.base;
    switch (id) {
      case 'length': {
        const v = args[0]!;
        if (Array.isArray(v) || typeof v === 'string') return v.length;
        throw runtimeError(`${name} needs a list or some text, but got ${describeValue(v, this.words)}.`, e.args[0]!);
      }
      case 'append':
        this.listArg(args[0]!, name, e).push(args[1]!);
        return undefined;
      case 'insert': {
        const list = this.listArg(args[0]!, name, e);
        const at = this.wholeNumber(args[1]!, name, 'position', e.args[1]!);
        const i = at - base;
        if (i < 0 || i > list.length) {
          throw runtimeError(
            `You can't insert at position ${at} — use a position from ${base} to ${base + list.length}.`,
            e.args[1]!,
          );
        }
        list.splice(i, 0, args[2]!);
        return undefined;
      }
      case 'remove': {
        const list = this.listArg(args[0]!, name, e);
        const i = this.position(args[1]!, list.length, e.args[1]!, false);
        return list.splice(i, 1)[0];
      }
      case 'random': {
        if (args.length === 0) return this.random();
        const low = this.wholeNumber(args[0]!, name, 'first value', e.args[0]!);
        const high = this.wholeNumber(args[1]!, name, 'second value', e.args[1]!);
        if (low > high) throw runtimeError(`${name} needs the smaller number first, like ${name}(${high}, ${low}).`, e);
        return low + Math.floor(this.random() * (high - low + 1));
      }
      case 'round': {
        const n = this.numberArg(args[0]!, name, e.args[0]!);
        const places = args.length > 1 ? this.wholeNumber(args[1]!, name, 'number of decimal places', e.args[1]!) : 0;
        return roundTo(n, places);
      }
      case 'int': {
        const v = args[0]!;
        const n = typeof v === 'string' ? parseNumericText(v) : null;
        return Math.trunc(cleanNumber(n ?? this.numberArg(v, name, e.args[0]!))) || 0;
      }
      case 'str':
        return formatValue(args[0]!, this.words);
      case 'num': {
        const v = args[0]!;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const n = parseNumericText(v);
          if (n !== null) return n;
          throw runtimeError(`${name} can't turn "${v}" into a number.`, e.args[0]!);
        }
        throw runtimeError(`${name} needs some text, but got ${describeValue(v, this.words)}.`, e.args[0]!);
      }
      case 'upper':
      case 'lower': {
        const text = this.textArg(args[0]!, name, e.args[0]!);
        return id === 'upper' ? text.toUpperCase() : text.toLowerCase();
      }
      case 'substring': {
        const text = this.textArg(args[0]!, name, e.args[0]!);
        const start = this.wholeNumber(args[1]!, name, 'start position', e.args[1]!);
        const length = this.wholeNumber(args[2]!, name, 'length', e.args[2]!);
        const i = start - base;
        if (i < 0 || i > text.length) {
          const range = text.length === 0 ? 'the text is empty' : `the text has ${plural(text.length, 'character', 'characters')} (positions ${base} to ${base + text.length - 1})`;
          throw runtimeError(`${name} can't start at position ${start} — ${range}.`, e.args[1]!);
        }
        if (length < 0) throw runtimeError(`${name} needs a length of 0 or more.`, e.args[2]!);
        return text.slice(i, i + length);
      }
      case 'abs':
        return Math.abs(this.numberArg(args[0]!, name, e.args[0]!));
      case 'sqrt': {
        const n = this.numberArg(args[0]!, name, e.args[0]!);
        if (n < 0) throw runtimeError("You can't find the square root of a negative number.", e.args[0]!);
        return Math.sqrt(n);
      }
    }
  }

  private random(): number {
    const r = Number(this.limits.random());
    if (Number.isFinite(r) && r >= 0 && r < 1) return r;
    return Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.9999999999999999) : 0;
  }

  private listArg(v: Value, name: string, e: A.CallExpr): Value[] {
    if (Array.isArray(v)) return v;
    throw runtimeError(`${name} needs a list first, but got ${describeValue(v, this.words)}.`, e.args[0]!);
  }

  private textArg(v: Value, name: string, at: Pos): string {
    if (typeof v === 'string') return v;
    throw runtimeError(`${name} needs some text, but got ${describeValue(v, this.words)}.`, at);
  }

  private numberArg(v: Value, name: string, at: Pos): number {
    if (typeof v === 'number') return v;
    throw runtimeError(`${name} needs a number, but got ${describeValue(v, this.words)}.`, at, this.numericTextHint(v));
  }

  private wholeNumber(v: Value, name: string, what: string, at: Pos): number {
    const n = cleanNumber(this.numberArg(v, name, at));
    if (!Number.isInteger(n)) throw runtimeError(`The ${what} for ${name} must be a whole number, but it's ${formatNumber(n)}.`, at);
    return n;
  }
}

/** Rounds half away from zero (2.5 → 3, 1.005 → 1.01 at 2 places), as students expect. */
function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  const r = Math.round(cleanNumber(Math.abs(n) * factor)) / factor;
  const result = cleanNumber(n < 0 ? -r : r);
  return result === 0 ? 0 : result;
}
