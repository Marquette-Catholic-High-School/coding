// JavaScript runner. Student code runs in this worker as the body of an async function whose parameters shadow
// console, input(), prompt(), timers and the worker globals a program must not touch. Top-level await works, and
// a run lasts until the program's timers have finished (the main thread's timeout or Stop ends programs that never
// finish, e.g. an uncleared setInterval). Programs share the worker's realm, so they can change built-ins and leave
// callbacks behind: every run reports `recycle` and the worker is replaced before the next program. Network APIs
// are blocked before the program starts (see network.ts).

import type { RunError } from '../types';
import { errorHeadline, formatConsoleTable, formatLogArgs, inspect, type InspectOptions } from './inspect';
import { failure, OK, type LangResult, type LanguageRunner, type RunIO } from './io';
import { blockNetwork, networkBlocked } from './network';
import {
  engineSyntaxLocation,
  formatStackFrame,
  heuristicSyntaxLocation,
  parseStackFrames,
  SOURCE_NAME,
  sucraseErrorLocation,
  type SourceLocation,
} from './jsErrors';

const SHIM_NAMES = [
  'console',
  'input',
  'prompt',
  'alert',
  'process',
  'require',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'fetch',
  // Worker globals that would break the runner if a program called or replaced them.
  'postMessage',
  'close',
  'importScripts',
  'onmessage',
  'onerror',
] as const;
type ShimName = (typeof SHIM_NAMES)[number];

type Program = (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => Program;

// Browser timer ids are numbers (Node's typings, also in scope, would say otherwise).
type TimerFn = (handler: () => void, ms: number) => number;
const realSetTimeout = globalThis.setTimeout.bind(globalThis) as unknown as TimerFn;
const realSetInterval = globalThis.setInterval.bind(globalThis) as unknown as TimerFn;
const realClearTimeout = globalThis.clearTimeout.bind(globalThis) as (id: number) => void;
const realClearInterval = globalThis.clearInterval.bind(globalThis) as (id: number) => void;

type Stream = 'stdout' | 'stderr';
type Callback = (...args: unknown[]) => unknown;

/** Thrown by process.exit(); ends the run without an error when the code is 0. */
class ExitSignal {
  constructor(readonly code: number) {}
}

/**
 * Function body for a program. The extra block lets programs declare names such as `input` or `prompt` with
 * let/const, which would clash with the shim parameters at the top level of the function.
 */
function wrapProgram(code: string): string {
  return `{\n${code}\n}\n//# sourceURL=${SOURCE_NAME}`;
}

let lineOffset: number | null = null;

/**
 * Lines before the program's first line: the Function constructor's header ("async function anonymous(…\n) {\n",
 * 2 lines per spec) plus the opening of the block.
 */
function wrapperLineOffset(): number {
  if (lineOffset === null) {
    lineOffset = 3;
    try {
      const probe = new Function(...SHIM_NAMES, wrapProgram('return new Error().stack;')) as () => unknown;
      const stack = probe();
      const frame = typeof stack === 'string' ? parseStackFrames(stack, 0, Number.MAX_SAFE_INTEGER)[0] : undefined;
      if (frame) lineOffset = frame.line - 1;
    } catch {
      // Keep the default.
    }
  }
  return lineOffset;
}

function isErrorLike(value: unknown): value is { name?: unknown; message?: unknown; stack?: unknown } {
  return value instanceof Error || (typeof value === 'object' && value !== null && 'message' in value && 'stack' in value);
}

function lineCountOf(code: string): number {
  return code.split('\n').length;
}

function toRunError(err: unknown, lineCount: number): RunError {
  if (!isErrorLike(err)) return { message: `Uncaught ${inspect(err)}` };
  const message = errorHeadline(err);
  const frames = typeof err.stack === 'string' ? parseStackFrames(err.stack, wrapperLineOffset(), lineCount) : [];
  const top = frames[0];
  const error: RunError = { message };
  if (top) {
    error.line = top.line;
    error.column = top.column;
    error.details = [message, ...frames.map(formatStackFrame)].join('\n');
  }
  return error;
}

async function syntaxError(err: unknown, code: string): Promise<RunError> {
  const message = isErrorLike(err) ? errorHeadline(err) : String(err);
  const lineCount = lineCountOf(code);
  let location: SourceLocation | null = engineSyntaxLocation(err, wrapperLineOffset(), lineCount);
  if (!location) {
    try {
      // Sucrase's parser reports where most syntax errors are; it is only downloaded when one happens.
      const { transform } = await import('sucrase');
      transform(code, { transforms: [], disableESTransforms: true });
    } catch (parseError) {
      location = sucraseErrorLocation(parseError);
    }
  }
  location ??= heuristicSyntaxLocation(message, code);
  return { message, ...location };
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${ms.toFixed(3)}ms`;
}

function createConsole(write: (stream: Stream, text: string) => void) {
  let indent = '';
  const counts = new Map<string, number>();
  const started = new Map<string, number>();
  const print = (stream: Stream, text: string) => write(stream, `${indent ? text.replace(/^/gm, indent) : text}\n`);
  const log = (...args: unknown[]) => print('stdout', formatLogArgs(args));
  const warn = (...args: unknown[]) => print('stderr', formatLogArgs(args));
  const label = (value: unknown) => (value === undefined ? 'default' : String(value));
  const elapsed = (name: unknown, method: string, end: boolean, extra: unknown[]) => {
    const key = label(name);
    const start = started.get(key);
    if (start === undefined) {
      print('stderr', `Warning: No such label '${key}' for console.${method}()`);
      return;
    }
    if (end) started.delete(key);
    print('stdout', [`${key}: ${formatMs(performance.now() - start)}`, ...(extra.length ? [formatLogArgs(extra)] : [])].join(' '));
  };
  const group = (...args: unknown[]) => {
    if (args.length) log(...args);
    indent += '  ';
  };
  return {
    log,
    info: log,
    debug: log,
    warn,
    error: warn,
    trace: (...args: unknown[]) => print('stderr', `Trace${args.length ? `: ${formatLogArgs(args)}` : ''}`),
    dir: (value: unknown, options?: InspectOptions) => print('stdout', inspect(value, options)),
    table: (data: unknown, columns?: unknown) =>
      print('stdout', formatConsoleTable(data, Array.isArray(columns) ? columns : undefined) ?? formatLogArgs([data])),
    assert: (condition: unknown, ...args: unknown[]) => {
      if (!condition) print('stderr', `Assertion failed${args.length ? `: ${formatLogArgs(args)}` : ''}`);
    },
    count: (name?: unknown) => {
      const key = label(name);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      print('stdout', `${key}: ${n}`);
    },
    countReset: (name?: unknown) => {
      counts.delete(label(name));
    },
    time: (name?: unknown) => {
      started.set(label(name), performance.now());
    },
    timeLog: (name?: unknown, ...extra: unknown[]) => elapsed(name, 'timeLog', false, extra),
    timeEnd: (name?: unknown) => elapsed(name, 'timeEnd', true, []),
    group,
    groupCollapsed: group,
    groupEnd: () => {
      indent = indent.slice(2);
    },
    clear: () => {},
  };
}

/** One run: tracks timers so the run ends when the program has nothing left to do. */
class Session {
  private active = true;
  private readonly timers = new Set<number>();
  private failure: { error: unknown } | null = null;
  private exitCode: number | null = null;
  private stuck = false;
  private wake: (() => void) | null = null;

  constructor(private readonly io: RunIO) {}

  async run(program: Program, lineCount: number): Promise<LangResult> {
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      this.fail(event.reason);
    };
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      this.fail(event.error ?? new Error(event.message));
    };
    addEventListener('unhandledrejection', onRejection);
    addEventListener('error', onError);
    let mainSettled = false;
    try {
      const shims = this.shims();
      program(...SHIM_NAMES.map((name) => shims[name])).then(
        () => {
          mainSettled = true;
          this.notify();
        },
        (error: unknown) => {
          mainSettled = true;
          this.fail(error);
        },
      );
      await this.settle(() => mainSettled);
    } finally {
      this.active = false;
      for (const id of this.timers) {
        realClearTimeout(id);
        realClearInterval(id);
      }
      this.timers.clear();
      removeEventListener('unhandledrejection', onRejection);
      removeEventListener('error', onError);
    }
    if (this.exitCode !== null) {
      return this.exitCode === 0 ? OK : failure({ message: `The program stopped with exit code ${this.exitCode}.` });
    }
    if (this.failure) return failure(toRunError(this.failure.error, lineCount));
    if (this.stuck) {
      return failure({
        message: 'The program is waiting for something that never happens (an await that never finishes).',
      });
    }
    return OK;
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private fail(error: unknown): void {
    if (!this.active || this.failure || this.exitCode !== null) return;
    if (error instanceof ExitSignal) this.exitCode = error.code;
    else this.failure = { error };
    this.notify();
  }

  private get finished(): boolean {
    return this.failure !== null || this.exitCode !== null;
  }

  private async settle(mainSettled: () => boolean): Promise<void> {
    const macrotask = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));
    for (;;) {
      if (this.finished) return;
      if (this.timers.size > 0) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      // Nothing scheduled: let pending promise callbacks run (they may start new timers), then look again.
      await macrotask();
      if (this.finished || this.timers.size > 0) continue;
      if (!mainSettled()) this.stuck = true;
      return;
    }
  }

  private invoke(callback: Callback, args: unknown[]): void {
    if (!this.active) return;
    try {
      const result = callback(...args);
      if (result instanceof Promise) result.catch((error: unknown) => this.fail(error));
    } catch (error) {
      this.fail(error);
    }
  }

  private setTimer(repeat: boolean, callback: unknown, delay: unknown, args: unknown[]): number {
    if (typeof callback !== 'function') {
      throw new TypeError(`${repeat ? 'setInterval' : 'setTimeout'} needs a function to call`);
    }
    const ms = Math.max(0, Number(delay) || 0);
    if (repeat) {
      const id = realSetInterval(() => this.invoke(callback as Callback, args), ms);
      this.timers.add(id);
      return id;
    }
    const id = realSetTimeout(() => {
      this.timers.delete(id);
      this.invoke(callback as Callback, args);
      this.notify();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private clearTimer(id: unknown): void {
    const handle = id as number;
    if (!this.timers.delete(handle)) return;
    realClearTimeout(handle);
    realClearInterval(handle);
    this.notify();
  }

  private shims(): Record<ShimName, unknown> {
    const write = (stream: Stream, text: string) => {
      if (this.active) this.io.write(stream, text);
    };
    const readLine = () => (this.active ? this.io.readLine() : null);
    const ask = (message: unknown) => {
      if (message !== undefined && message !== null) write('stdout', String(message));
      return readLine();
    };
    const later = (callback: Callback, ...args: unknown[]) => this.setTimer(false, callback, 0, args);

    const process = {
      stdout: { write: (text: unknown) => (write('stdout', String(text)), true) },
      stderr: { write: (text: unknown) => (write('stderr', String(text)), true) },
      exit: (code?: unknown) => {
        throw new ExitSignal(Math.trunc(Number(code ?? 0)) || 0);
      },
      argv: ['node', SOURCE_NAME],
      env: {},
      platform: 'browser',
    };

    // Minimal `readline` so programs written for Node (rl.question, rl.on('line'), for await … of rl) work.
    const createInterface = (promises: boolean) => () => {
      const lineHandlers: Callback[] = [];
      const closeHandlers: Callback[] = [];
      let closed = false;
      let pumping = false;
      let promptText = '> ';
      const close = () => {
        if (closed) return;
        closed = true;
        for (const handler of closeHandlers) this.invoke(handler, []);
      };
      const pump = () => {
        if (pumping || closed) return;
        pumping = true;
        const next = () => {
          if (closed) return;
          const line = readLine();
          if (line === null) {
            close();
            return;
          }
          for (const handler of lineHandlers) this.invoke(handler, [line]);
          if (!closed) later(next);
        };
        later(next);
      };
      const rl = {
        question: (query: unknown, ...rest: unknown[]) => {
          const answer = ask(query);
          if (promises) {
            if (answer === null) {
              close();
              return Promise.reject(new Error('No more input (end of file).'));
            }
            return Promise.resolve(answer);
          }
          const callback = rest.find((r): r is Callback => typeof r === 'function');
          if (answer === null) close();
          else if (callback) later(callback, answer);
          return undefined;
        },
        on: (event: unknown, handler: unknown) => {
          if (typeof handler === 'function') {
            if (event === 'line') {
              lineHandlers.push(handler as Callback);
              pump();
            } else if (event === 'close') {
              closeHandlers.push(handler as Callback);
            }
          }
          return rl;
        },
        once: (event: unknown, handler: unknown) => rl.on(event, handler),
        setPrompt: (text: unknown) => {
          promptText = String(text);
        },
        prompt: () => write('stdout', promptText),
        write: (text: unknown) => write('stdout', String(text)),
        pause: () => rl,
        resume: () => rl,
        close,
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (closed) return;
            const line = readLine();
            if (line === null) {
              close();
              return;
            }
            yield line;
          }
        },
      };
      return rl;
    };

    const promptSync = (message?: unknown, defaultValue?: unknown) => {
      const line = ask(message);
      if (line === '' && defaultValue !== undefined) return String(defaultValue);
      return line;
    };

    const require = (name: unknown) => {
      const id = String(name).replace(/^node:/, '');
      switch (id) {
        case 'prompt-sync':
          return () => promptSync;
        case 'readline':
          return { createInterface: createInterface(false) };
        case 'readline/promises':
          return { createInterface: createInterface(true) };
        case 'util':
          return { inspect: (value: unknown, options?: InspectOptions) => inspect(value, options), format: (...args: unknown[]) => formatLogArgs(args) };
        default:
          throw new Error(`Cannot find module '${id}'. Only prompt-sync, readline and util are available here.`);
      }
    };

    return {
      console: createConsole(write),
      input: (message?: unknown) => ask(message) ?? '',
      prompt: (message?: unknown, defaultValue?: unknown) => {
        const line = ask(message);
        return line === '' && defaultValue !== undefined ? String(defaultValue) : line;
      },
      alert: (message?: unknown) => write('stdout', `${message === undefined ? '' : String(message)}\n`),
      process,
      require,
      setTimeout: (callback: unknown, delay?: unknown, ...args: unknown[]) => this.setTimer(false, callback, delay, args),
      setInterval: (callback: unknown, delay?: unknown, ...args: unknown[]) => this.setTimer(true, callback, delay, args),
      clearTimeout: (id: unknown) => this.clearTimer(id),
      clearInterval: (id: unknown) => this.clearTimer(id),
      fetch: networkBlocked,
      postMessage: undefined,
      close: undefined,
      importScripts: undefined,
      onmessage: undefined,
      onerror: undefined,
    };
  }
}

/**
 * Runs JavaScript. `lineSource` is the code line numbers should refer to (the TypeScript source when `code` was
 * produced by stripping types — sucrase keeps lines in place). The result always asks for a new worker.
 */
export async function runJavaScript(code: string, io: RunIO, lineSource: string = code): Promise<LangResult> {
  let program: Program;
  try {
    program = new AsyncFunction(...SHIM_NAMES, wrapProgram(code));
  } catch (err) {
    return { ...failure(await syntaxError(err, code)), recycle: true };
  }
  blockNetwork();
  const result = await new Session(io).run(program, lineCountOf(lineSource));
  return { ...result, recycle: true };
}

export const javascriptRunner: LanguageRunner = {
  loaded: () => true,
  load: async () => {},
  run: (code, io) => runJavaScript(code, io),
};
