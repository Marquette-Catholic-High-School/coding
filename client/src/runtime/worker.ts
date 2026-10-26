// Code-runner worker. One worker serves one language kind and may be reused between runs (index.ts terminates it on
// Stop/timeout, and after every JavaScript/TypeScript run). Language runtimes are imported on first use, so
// Pyodide, sql.js and wasmoon load only when needed.

import type { LanguageKind } from '@codeclass/shared';
import { readInputLine, resetInputChannel } from './channel';
import { describeError, failure, type LangResult, type LanguageRunner, type RunIO } from './lang/io';
import type { ReplayState } from './lang/pseudocode';
import { OutputBuffer } from './output';
import { OutputTailWriter } from './outputTail';
import type { MainToWorker, RunRequest, WorkerToMain } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerToMain): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<MainToWorker>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;

function post(message: WorkerToMain): void {
  scope.postMessage(message);
}

const LANGUAGE_NAMES: Record<LanguageKind, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  lua: 'Lua',
  sql: 'SQL',
  pseudocode: 'pseudocode',
  web: 'web page',
};

function importRunner(kind: LanguageKind): Promise<LanguageRunner> {
  switch (kind) {
    case 'javascript':
      return import('./lang/javascript').then((m) => m.javascriptRunner);
    case 'typescript':
      return import('./lang/typescript').then((m) => m.typescriptRunner);
    case 'python':
      return import('./lang/python').then((m) => m.pythonRunner);
    case 'lua':
      return import('./lang/lua').then((m) => m.luaRunner);
    case 'sql':
      return import('./lang/sql').then((m) => m.sqlRunner);
    case 'pseudocode':
      return import('./lang/pseudocode').then((m) => m.pseudocodeRunner);
    case 'web':
      return Promise.reject(new Error('Web pages run in the preview next to the editor, not in the console.'));
  }
}

const modules = new Map<LanguageKind, Promise<LanguageRunner>>();

/** The kind's runner with its runtime loaded; `onLoading` fires first if anything has to be downloaded. */
async function getRunner(kind: LanguageKind, onLoading: () => void): Promise<LanguageRunner> {
  let module = modules.get(kind);
  if (!module) {
    // JavaScript and pseudocode need no runtime download, so they skip the "loading" notice.
    if (kind !== 'javascript' && kind !== 'pseudocode') onLoading();
    module = importRunner(kind).catch((err: unknown) => {
      modules.delete(kind);
      if (kind === 'web') throw err;
      throw new Error(`Couldn't load the ${LANGUAGE_NAMES[kind]} runner. Reload the page and try again.`, { cause: err });
    });
    modules.set(kind, module);
  }
  const runner = await module;
  if (!runner.loaded()) {
    onLoading();
    await runner.load();
  }
  return runner;
}

/** Pseudocode run waiting for typed input in 'replay' mode. */
let pendingReplay: { id: number; state: ReplayState; out: OutputBuffer; attempt: () => void } | null = null;

function finish(id: number, out: OutputBuffer, result: LangResult, readInput: boolean): void {
  out.flush();
  post({ type: 'done', id, status: result.status, error: result.error, readInput, recycle: result.recycle === true });
}

async function handleRun(request: RunRequest): Promise<void> {
  const { id } = request;
  pendingReplay = null;
  const out = new OutputBuffer({
    send: (chunks, batch) => post({ type: 'output', id, batch, chunks }),
    tail: request.tail ? new OutputTailWriter(request.tail) : null,
  });
  const stdin = [...request.stdin];
  const channel = request.inputMode === 'channel' ? request.channel : null;
  // Once the user ends the input, every later read gets end-of-file too (as with a closed pipe).
  let inputEnded = false;
  let readInput = false;
  const io: RunIO = {
    write: (stream, text) => out.write(stream, text),
    readLine: () => {
      readInput = true;
      const given = stdin.shift();
      if (given !== undefined) {
        out.echoInput(given);
        return given;
      }
      if (!channel || inputEnded) return null;
      out.flush();
      resetInputChannel(channel);
      post({ type: 'input-request', id, prompt: out.pendingPrompt || null });
      const line = readInputLine(channel);
      // The page echoes the answer itself, so the prompt must not carry over into the next request.
      out.markInputConsumed();
      if (line === null) inputEnded = true;
      return line;
    },
    pendingPrompt: () => out.pendingPrompt,
    flush: () => out.flush(),
  };

  let loadingSent = false;
  const onLoading = () => {
    if (loadingSent) return;
    loadingSent = true;
    post({ type: 'phase', id, phase: 'loading' });
  };

  let runner: LanguageRunner;
  try {
    runner = await getRunner(request.kind, onLoading);
    await runner.prepare?.(request.code, onLoading);
  } catch (err) {
    finish(id, out, failure({ message: describeError(err) }), false);
    return;
  }

  post({ type: 'phase', id, phase: 'running' });

  if (request.kind === 'pseudocode' && request.inputMode === 'replay') {
    const { runReplayAttempt } = await import('./lang/pseudocode');
    const state: ReplayState = {
      code: request.code,
      config: request.pseudocode,
      stdin: request.stdin,
      typed: [],
      ended: false,
      seed: (Math.random() * 2 ** 32) >>> 0,
      shown: 0,
    };
    const attempt = () => {
      const result = runReplayAttempt(state, { write: (stream, text) => out.write(stream, text) });
      if (result) {
        pendingReplay = null;
        finish(id, out, result, state.readInput === true);
        return;
      }
      out.flush();
      pendingReplay = { id, state, out, attempt };
      post({ type: 'input-request', id, prompt: out.pendingPrompt || null });
    };
    attempt();
    return;
  }

  let result: LangResult;
  try {
    result = await runner.run(request.code, io, { pseudocode: request.pseudocode });
  } catch (err) {
    result = failure({ message: `The ${LANGUAGE_NAMES[request.kind]} runner stopped unexpectedly: ${describeError(err)}` }, true);
  }
  finish(id, out, result, readInput);
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'run':
      void handleRun(message);
      break;
    case 'preload':
      getRunner(message.kind, () => {}).catch(() => {
        // Best effort: the next run reports the problem.
      });
      break;
    case 'input': {
      const replay = pendingReplay;
      if (!replay || replay.id !== message.id) return;
      if (message.line === null) replay.state.ended = true;
      else replay.state.typed.push(message.line);
      replay.out.markInputConsumed();
      replay.attempt();
      break;
    }
  }
});
