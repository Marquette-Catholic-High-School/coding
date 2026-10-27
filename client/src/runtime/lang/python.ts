// Python runner (Pyodide, loaded from the CDN on first use). Each run gets a fresh globals dict and the builtins
// as they were before the first run; imported modules and files stay for later runs in the same worker (graders
// pass `freshWorker`). stdout/stderr are raw byte streams so prompts printed by input() (no newline) reach the
// console before the input request; stdin reads lines through the worker's input source (end of input ->
// EOFError, as in a real terminal), telling it the prompt input() printed (see `RunIO.readLine`). Once Pyodide has
// loaded, the worker's network APIs are blocked except for package downloads from the Pyodide CDN, and programs
// can't import the modules that lead to JavaScript.

import { PYODIDE_INDEX_URL } from '@codeclass/shared';
import type { RunError } from '../types';
import { describeError, failure, OK, type LangResult, type LanguageRunner, type RunIO } from './io';
import { blockNetwork, NETWORK_BLOCKED_MESSAGE } from './network';

// Minimal typings for the parts of Pyodide used here (Pyodide is loaded from the CDN, not installed).
interface PyCallable {
  (...args: unknown[]): unknown;
}

interface PyodideStreams {
  setStdout(options: { write: (buffer: Uint8Array) => number; isatty?: boolean }): void;
  setStderr(options: { write: (buffer: Uint8Array) => number; isatty?: boolean }): void;
  setStdin(options: { read: (buffer: Uint8Array) => number; isatty?: boolean }): void;
}

interface Pyodide extends PyodideStreams {
  runPython(code: string): unknown;
  globals: { get(name: string): unknown; set(name: string, value: unknown): void };
  loadPackagesFromImports(
    code: string,
    options?: { messageCallback?: (message: string) => void; errorCallback?: (message: string) => void },
  ): Promise<unknown>;
}

interface PyodideModule {
  loadPyodide(options: { indexURL: string; fullStdLib?: boolean }): Promise<Pyodide>;
}

const SOURCE_NAME = 'main.py';

// Runs student code with a fresh globals dict and reports problems as JSON (message, line, column, details).
// The helper's own frames are dropped from tracebacks, so they start at the student's code. input() is the built-in
// one wrapped to hand its prompt to readStdin (through `_codeclass_note_prompt`, set by loadRuntime) before it reads,
// so prompts can be told apart from output; readStdin can't ask Python itself, as input() releases the GIL while it
// waits. While a program runs, the modules that reach JavaScript (and through it the network) can't be imported:
// they are taken out of sys.modules and their packages, and a finder refuses them. This is a clear message rather
// than a wall (Python code can still find JavaScript objects); the worker's network APIs are blocked as well (see
// network.ts).
const HELPER = String.raw`
import builtins, importlib.abc, json, linecache, sys, traceback

_codeclass_blocked = ("js", "pyodide_js", "pyodide.code", "pyodide.ffi", "pyodide.http", "pyodide_http", "micropip")
_codeclass_builtin_input = builtins.input

def _codeclass_input(*args, **kwargs):
    # Only prompts str() can't run the program's own code for (input() runs it once already).
    prompt = args[0] if len(args) == 1 and not kwargs else ""
    _codeclass_note_prompt(str(prompt) if type(prompt) in (str, int, float, bool) else "")
    try:
        return _codeclass_builtin_input(*args, **kwargs)
    finally:
        _codeclass_note_prompt("")

_codeclass_input.__name__ = _codeclass_input.__qualname__ = "input"
_codeclass_input.__module__ = "builtins"
_codeclass_input.__doc__ = _codeclass_builtin_input.__doc__
builtins.input = _codeclass_input
_codeclass_builtins = dict(builtins.__dict__)

class _CodeclassBlocker(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname in _codeclass_blocked:
            message = ${JSON.stringify(NETWORK_BLOCKED_MESSAGE.replace(/\.$/, ''))} + ", so %r is not available." % fullname
            raise ModuleNotFoundError(message, name=fullname)
        return None

_codeclass_blocker = _CodeclassBlocker()

def _codeclass_hide_modules():
    hidden = []
    for name in _codeclass_blocked:
        module = sys.modules.pop(name, None)
        if module is not None:
            hidden.append((sys.modules, name, module))
        parent, _, child = name.rpartition(".")
        package = vars(sys.modules[parent]) if parent and parent in sys.modules else None
        if package is not None and child in package:
            hidden.append((package, child, package.pop(child)))
    sys.meta_path.insert(0, _codeclass_blocker)
    return hidden

def _codeclass_restore(hidden):
    while _codeclass_blocker in sys.meta_path:
        sys.meta_path.remove(_codeclass_blocker)
    for namespace, name, value in hidden:
        namespace[name] = value
    current = builtins.__dict__
    for name in [name for name in current if name not in _codeclass_builtins]:
        del current[name]
    for name, value in _codeclass_builtins.items():
        if current.get(name, _codeclass_blocker) is not value:
            current[name] = value

def _codeclass_without_input(tb):
    # The traceback without input()'s wrapper frames.
    while tb is not None and tb.tb_frame.f_code is _codeclass_input.__code__:
        tb = tb.tb_next
    entry = tb
    while entry is not None:
        while entry.tb_next is not None and entry.tb_next.tb_frame.f_code is _codeclass_input.__code__:
            entry.tb_next = entry.tb_next.tb_next
        entry = entry.tb_next
    return tb

def _codeclass_run(source):
    filename = "${SOURCE_NAME}"
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    # An earlier program may have replaced the standard streams.
    sys.stdin, sys.stdout, sys.stderr = sys.__stdin__, sys.__stdout__, sys.__stderr__
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(line_buffering=True)
        except Exception:
            pass
    scope = {"__name__": "__main__", "__file__": filename, "__builtins__": builtins}
    result = None
    hidden = _codeclass_hide_modules()
    try:
        try:
            exec(compile(source, filename, "exec", dont_inherit=True), scope)
        finally:
            # Before reporting, so a program that broke a builtin can't break the error report.
            _codeclass_restore(hidden)
    except SystemExit as exc:
        status = exc.code
        if status is None or status == 0:
            pass
        elif isinstance(status, int):
            result = {"message": "The program stopped with exit code %d." % status}
        else:
            result = {"message": str(status)}
    except BaseException as exc:
        seen = set()
        chained = exc
        while chained is not None and id(chained) not in seen:
            seen.add(id(chained))
            chained.__traceback__ = _codeclass_without_input(chained.__traceback__)
            chained = chained.__cause__ if chained.__cause__ is not None else chained.__context__
        tb = exc.__traceback__
        if tb is not None:
            tb = tb.tb_next
        # A refused import ends in the blocker's own frame, which is not the student's business.
        last = tb
        while last is not None and last.tb_next is not None:
            if last.tb_next.tb_next is None and last.tb_next.tb_frame.f_code is _CodeclassBlocker.find_spec.__code__:
                last.tb_next = None
            last = last.tb_next
        line = column = None
        if isinstance(exc, SyntaxError) and exc.filename == filename:
            line, column = exc.lineno, exc.offset
        else:
            for frame in traceback.extract_tb(tb):
                if frame.filename == filename:
                    line = frame.lineno
                    colno = getattr(frame, "colno", None)
                    column = colno + 1 if colno is not None else None
        result = {
            "message": traceback.format_exception_only(type(exc), exc)[-1].strip(),
            "details": "".join(traceback.format_exception(type(exc), exc, tb)).rstrip(),
            "line": line,
            "column": column,
        }
    finally:
        scope.clear()
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
        linecache.cache.pop(filename, None)
    return None if result is None else json.dumps(result)
`;

let pyodide: Pyodide | null = null;
let runHelper: PyCallable | null = null;
let loading: Promise<void> | null = null;

/** Where the current run's streams go (Pyodide's stream handlers are installed once). */
let activeIO: RunIO | null = null;
let pendingInput: Uint8Array | null = null;
let pendingOffset = 0;
const encoder = new TextEncoder();

function streamWriter(stream: 'stdout' | 'stderr') {
  const decoder = new TextDecoder();
  return (buffer: Uint8Array) => {
    const text = decoder.decode(buffer, { stream: true });
    if (text) activeIO?.write(stream, text);
    return buffer.length;
  };
}

/** The prompt of the input() call reading now ('' for other reads, such as sys.stdin.readline()). */
let inputPrompt = '';

function notePrompt(prompt: unknown): void {
  inputPrompt = typeof prompt === 'string' ? prompt : '';
}

function readStdin(buffer: Uint8Array): number {
  if (!pendingInput || pendingOffset >= pendingInput.length) {
    const line = activeIO?.readLine(inputPrompt) ?? null;
    if (line === null) return 0;
    pendingInput = encoder.encode(`${line}\n`);
    pendingOffset = 0;
  }
  const count = Math.min(buffer.length, pendingInput.length - pendingOffset);
  buffer.set(pendingInput.subarray(pendingOffset, pendingOffset + count));
  pendingOffset += count;
  return count;
}

async function loadRuntime(): Promise<void> {
  let module: PyodideModule;
  try {
    module = (await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)) as PyodideModule;
  } catch (err) {
    throw new Error("Couldn't download Python. Check your internet connection and try again.", { cause: err });
  }
  const py = await module.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  py.setStdout({ write: streamWriter('stdout'), isatty: false });
  py.setStderr({ write: streamWriter('stderr'), isatty: false });
  py.setStdin({ read: readStdin, isatty: false });
  py.globals.set('_codeclass_note_prompt', notePrompt);
  py.runPython(HELPER);
  runHelper = py.globals.get('_codeclass_run') as PyCallable;
  // Packages (prepare) still download from the Pyodide CDN; nothing else can be reached from here on.
  blockNetwork({ allowFetch: (url) => url.href.startsWith(PYODIDE_INDEX_URL) });
  pyodide = py;
}

function parseResult(json: unknown): RunError {
  try {
    const data = JSON.parse(String(json)) as { message?: unknown; details?: unknown; line?: unknown; column?: unknown };
    const error: RunError = { message: typeof data.message === 'string' && data.message ? data.message : 'Python reported an error.' };
    if (typeof data.details === 'string' && data.details) error.details = data.details;
    if (typeof data.line === 'number') error.line = data.line;
    if (typeof data.column === 'number') error.column = data.column;
    return error;
  } catch {
    return { message: String(json) };
  }
}

export const pythonRunner: LanguageRunner = {
  loaded: () => pyodide !== null,
  load: () => {
    loading ??= loadRuntime().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  },
  prepare: async (code, onDownload) => {
    if (!pyodide) return;
    try {
      // Fetches packages from the Pyodide distribution that the program imports (numpy, …); a no-op otherwise.
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: (message) => {
          if (message.startsWith('Loading ')) onDownload();
        },
        errorCallback: () => {},
      });
    } catch {
      // Unavailable packages surface as ModuleNotFoundError when the program runs.
    }
  },
  run: async (code, io): Promise<LangResult> => {
    if (!pyodide || !runHelper) await pythonRunner.load();
    activeIO = io;
    pendingInput = null;
    pendingOffset = 0;
    inputPrompt = '';
    try {
      const result = runHelper!(code);
      return typeof result === 'string' ? failure(parseResult(result)) : OK;
    } catch (err) {
      // The helper catches every Python exception, so this is Pyodide itself failing (e.g. out of memory).
      return failure({ message: `Python stopped unexpectedly: ${describeError(err)}` }, true);
    } finally {
      activeIO = null;
    }
  },
};
