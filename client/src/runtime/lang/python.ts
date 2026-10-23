// Python runner (Pyodide, loaded from the CDN on first use). Each run gets a fresh globals dict; stdout/stderr are
// raw byte streams so prompts printed by input() (no newline) reach the console before the input request; stdin
// reads lines through the worker's input source (end of input -> EOFError, as in a real terminal).

import { PYODIDE_INDEX_URL } from '@codeclass/shared';
import type { RunError } from '../types';
import { describeError, failure, OK, type LangResult, type LanguageRunner, type RunIO } from './io';

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
  globals: { get(name: string): unknown };
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
// The helper's own frame is dropped from tracebacks, so they start at the student's code.
const HELPER = String.raw`
import builtins, json, linecache, sys, traceback

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
    try:
        exec(compile(source, filename, "exec", dont_inherit=True), scope)
    except SystemExit as exc:
        status = exc.code
        if status is None or status == 0:
            pass
        elif isinstance(status, int):
            result = {"message": "The program stopped with exit code %d." % status}
        else:
            result = {"message": str(status)}
    except BaseException as exc:
        tb = exc.__traceback__
        if tb is not None:
            tb = tb.tb_next
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

function readStdin(buffer: Uint8Array): number {
  if (!pendingInput || pendingOffset >= pendingInput.length) {
    const line = activeIO?.readLine() ?? null;
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
  py.runPython(HELPER);
  runHelper = py.globals.get('_codeclass_run') as PyCallable;
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
