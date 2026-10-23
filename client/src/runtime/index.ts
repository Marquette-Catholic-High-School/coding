// Public API of the code runner (main thread). Programs run in module Web Workers (worker.ts): one warm worker per
// language kind is kept between runs; Stop and timeouts terminate the worker and the next run starts a fresh one.
// JavaScript and TypeScript programs share their realm with the worker, so their worker is replaced after every
// run; `freshWorker` gives Python runs (autograding) a worker of their own as well.

import type { LanguageKind, TestCase, TestResult } from '@codeclass/shared';
import { createInputChannel, writeInputEof, writeInputLine } from './channel';
import { acknowledgeOutput, createOutputTail, readOutputTail, resetOutputTail } from './outputTail';
import {
  DEFAULT_TEST_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  TIMEOUT_MESSAGE,
  type InputMode,
  type MainToWorker,
  type WorkerToMain,
} from './protocol';
import { runTestsWith } from './testRunner';
import type { OutputChunk, RunError, RunHandle, RunOptions, RunOutcome, RunOutcomeStatus, RunTarget, RunTestsOptions } from './types';

export type * from './types';

/** Whether a kind can run in the console runner ('web' renders in <WebPreview> instead). */
export function isRunnable(kind: RunTarget['kind']): boolean {
  return kind !== 'web';
}

/** True when the page is cross-origin isolated, so programs can pause for typed input. */
export function interactiveInputSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

/**
 * Whether programs of this kind can ask for typed input while running. Pseudocode always can (without
 * cross-origin isolation it is re-run with the typed lines); other kinds need `interactiveInputSupported()`.
 */
export function interactiveInputSupportedFor(kind: LanguageKind): boolean {
  return kind === 'pseudocode' || interactiveInputSupported();
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

interface WorkerSlot {
  worker: Worker;
  kind: LanguageKind;
  busy: boolean;
  /** Terminated: never handed out again. */
  dead: boolean;
  channel: SharedArrayBuffer | null;
  /** Output the worker has not sent yet (see outputTail.ts); null without cross-origin isolation. */
  tail: SharedArrayBuffer | null;
  /** Receives the worker's messages while a run owns the slot. */
  listener: ((message: WorkerToMain) => void) | null;
  /** Called if the worker dies while a run owns the slot. */
  onCrash: ((reason: string) => void) | null;
}

/** Where runs get their workers from. */
interface WorkerPool {
  acquire(kind: LanguageKind): WorkerSlot;
  /** The run finished normally; the worker may serve another run. */
  release(slot: WorkerSlot): void;
  /** The run's worker was discarded because it must not be reused. */
  recycled(kind: LanguageKind): void;
}

/** The warm worker for each kind (busy or idle). Extra workers for concurrent runs are discarded afterwards. */
const warm = new Map<LanguageKind, WorkerSlot>();

function spawn(kind: LanguageKind): WorkerSlot {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `codeclass-${kind}` });
  const slot: WorkerSlot = { worker, kind, busy: false, dead: false, channel: null, tail: null, listener: null, onCrash: null };
  worker.addEventListener('message', (event: MessageEvent<WorkerToMain>) => slot.listener?.(event.data));
  const crash = (reason: string) => {
    const onCrash = slot.onCrash;
    discard(slot);
    onCrash?.(reason);
  };
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    crash(event.message || 'the worker failed to start');
  });
  worker.addEventListener('messageerror', () => crash('a message could not be read'));
  return slot;
}

function discard(slot: WorkerSlot): void {
  slot.dead = true;
  slot.listener = null;
  slot.onCrash = null;
  slot.worker.terminate();
  if (warm.get(slot.kind) === slot) warm.delete(slot.kind);
}

function idle(slot: WorkerSlot): void {
  slot.busy = false;
  slot.listener = null;
  slot.onCrash = null;
}

/** Spawns the warm worker for `kind` and starts loading its runtime. */
function warmUp(kind: LanguageKind): WorkerSlot {
  const slot = spawn(kind);
  warm.set(kind, slot);
  slot.worker.postMessage({ type: 'preload', kind } satisfies MainToWorker);
  return slot;
}

/** The shared pool: one warm worker per kind, kept between runs. */
const sharedPool: WorkerPool = {
  acquire(kind) {
    const current = warm.get(kind);
    if (current && !current.busy) {
      current.busy = true;
      return current;
    }
    const slot = spawn(kind);
    if (!current) warm.set(kind, slot);
    slot.busy = true;
    return slot;
  },
  release(slot) {
    idle(slot);
    const current = warm.get(slot.kind);
    if (current === slot) return;
    if (!current) warm.set(slot.kind, slot);
    else discard(slot);
  },
  recycled(kind) {
    // The next run (JavaScript and TypeScript: every next run) should not wait for a worker to start.
    if (!warm.has(kind)) warmUp(kind);
  },
};

/**
 * Workers of their own, terminated by `close()`. With `reuse`, runs one after another share one worker (a batch of
 * tests for the same code); otherwise every run gets a new worker that is discarded when it ends.
 */
function privatePool(reuse: boolean): WorkerPool & { close(): void } {
  let current: WorkerSlot | null = null;
  return {
    acquire(kind) {
      if (reuse && current && !current.dead && !current.busy && current.kind === kind) {
        current.busy = true;
        return current;
      }
      const slot = spawn(kind);
      slot.busy = true;
      if (reuse && (!current || current.dead)) current = slot;
      return slot;
    },
    release(slot) {
      if (slot === current) idle(slot);
      else discard(slot);
    },
    recycled() {},
    close() {
      if (current) discard(current);
      current = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

let nextRunId = 1;

function call<A extends unknown[]>(callback: ((...args: A) => void) | undefined, ...args: A): void {
  try {
    callback?.(...args);
  } catch (err) {
    // A failing UI callback must not break the run bookkeeping.
    console.error(err);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function settledHandle(error: RunError): RunHandle {
  return {
    done: Promise.resolve({ status: 'error', error, stdout: '', durationMs: 0 }),
    stop() {},
    provideInput() {},
    endInput() {},
  };
}

class RunSession {
  readonly handle: RunHandle;
  private readonly id = nextRunId++;
  private readonly inputMode: InputMode;
  private readonly timeoutMs: number | null;
  private slot: WorkerSlot | null = null;
  private resolve!: (outcome: RunOutcome) => void;
  private settled = false;
  private stdout = '';
  /** The last output batch received (the worker's output tail holds the ones after it). */
  private receivedBatch = 0;
  private waitingForInput = false;
  /** Lines typed ahead of the program's requests; null is the end of input. */
  private readonly queuedInput: (string | null)[] = [];
  /** End of input was requested: no more typed lines are taken, and every read after the queued ones gets EOF. */
  private inputEnding = false;
  private inputEnded = false;
  /** Running time before the current stretch (time spent loading or waiting for input does not count). */
  private elapsedMs = 0;
  private runningSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    target: RunTarget,
    code: string,
    private readonly options: RunOptions,
    private readonly pool: WorkerPool,
  ) {
    const interactive = options.interactive === true;
    this.timeoutMs = options.timeoutMs ?? (interactive ? null : DEFAULT_TEST_TIMEOUT_MS);
    this.inputMode = !interactive
      ? 'none'
      : interactiveInputSupported()
        ? 'channel'
        : target.kind === 'pseudocode'
          ? 'replay'
          : 'none';
    const done = new Promise<RunOutcome>((resolve) => {
      this.resolve = resolve;
    });
    this.handle = {
      done,
      stop: () => this.finish('stopped', null),
      provideInput: (line) => this.provideInput(line),
      endInput: () => this.endInput(),
    };

    try {
      const slot = pool.acquire(target.kind);
      this.slot = slot;
      slot.listener = (message) => this.onMessage(message);
      slot.onCrash = (reason) => {
        this.slot = null;
        this.finish('error', { message: `The code runner stopped unexpectedly (${reason}).` });
      };
      if (this.inputMode === 'channel') slot.channel ??= createInputChannel();
      if (interactiveInputSupported()) {
        slot.tail ??= createOutputTail();
        // The slot is idle, so the worker is not writing to its tail now.
        resetOutputTail(slot.tail);
      }
      const request: MainToWorker = {
        type: 'run',
        id: this.id,
        kind: target.kind,
        code,
        stdin: [...(options.stdin ?? [])],
        inputMode: this.inputMode,
        channel: this.inputMode === 'channel' ? slot.channel : null,
        tail: slot.tail,
        pseudocode: target.pseudocode ?? null,
      };
      slot.worker.postMessage(request);
    } catch (err) {
      this.finish('error', { message: `Couldn't start the code runner: ${describe(err)}` });
    }
  }

  private onMessage(message: WorkerToMain): void {
    if (message.id !== this.id || this.settled) return;
    switch (message.type) {
      case 'phase':
        if (message.phase === 'running') this.resumeClock();
        call(this.options.onPhase, message.phase);
        break;
      case 'output':
        this.receivedBatch = message.batch;
        if (this.slot?.tail) acknowledgeOutput(this.slot.tail, message.batch);
        this.emit(message.chunks);
        break;
      case 'input-request': {
        this.pauseClock();
        if (this.queuedInput.length > 0) {
          this.deliver(this.queuedInput.shift()!);
          break;
        }
        if (this.inputEnded) {
          this.deliver(null);
          break;
        }
        this.waitingForInput = true;
        call(this.options.onPhase, 'waiting-input');
        call(this.options.onInputRequest, message.prompt);
        break;
      }
      case 'done': {
        const slot = this.slot;
        this.slot = null;
        if (slot) {
          if (message.recycle) {
            discard(slot);
            this.pool.recycled(slot.kind);
          } else {
            this.pool.release(slot);
          }
        }
        this.finish(message.status, message.error);
        break;
      }
    }
  }

  private emit(chunks: readonly OutputChunk[]): void {
    for (const chunk of chunks) {
      if (chunk.stream === 'stdout' && this.stdout.length < MAX_OUTPUT_CHARS) {
        this.stdout += chunk.text.slice(0, MAX_OUTPUT_CHARS - this.stdout.length);
      }
      call(this.options.onOutput, chunk);
    }
  }

  private provideInput(line: string): void {
    this.answer(line);
  }

  private endInput(): void {
    if (this.inputEnding) return;
    this.answer(null);
  }

  /** A typed line, or null for end of input. */
  private answer(line: string | null): void {
    if (this.settled || this.inputEnding) return;
    if (line === null) this.inputEnding = true;
    if (!this.waitingForInput) {
      // Typed ahead: answer the next request straight away.
      this.queuedInput.push(line);
      return;
    }
    this.deliver(line);
    call(this.options.onPhase, 'running');
  }

  private deliver(line: string | null): void {
    this.waitingForInput = false;
    if (line === null) this.inputEnded = true;
    const slot = this.slot;
    if (!slot) return;
    if (this.inputMode === 'channel' && slot.channel) {
      if (line === null) writeInputEof(slot.channel);
      else writeInputLine(slot.channel, line);
    } else if (this.inputMode === 'replay') {
      slot.worker.postMessage({ type: 'input', id: this.id, line } satisfies MainToWorker);
    }
    this.resumeClock();
  }

  private resumeClock(): void {
    if (this.settled || this.runningSince !== null) return;
    this.runningSince = performance.now();
    if (this.timeoutMs !== null) {
      const remaining = Math.max(0, this.timeoutMs - this.elapsedMs);
      this.timer = setTimeout(() => this.finish('timeout', { message: TIMEOUT_MESSAGE }), remaining);
    }
  }

  private pauseClock(): void {
    if (this.runningSince !== null) {
      this.elapsedMs += performance.now() - this.runningSince;
      this.runningSince = null;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private finish(status: RunOutcomeStatus, error: RunError | null): void {
    if (this.settled) return;
    this.pauseClock();
    this.settled = true;
    this.waitingForInput = false;
    const slot = this.slot;
    this.slot = null;
    if (slot) {
      // Still running (stop, timeout, startup failure): the worker may be stuck, so it is replaced. Output it could
      // not send (a program that never yields) is still in its tail.
      if (slot.tail) this.emit(readOutputTail(slot.tail, this.receivedBatch));
      if (slot.channel) writeInputEof(slot.channel);
      discard(slot);
    }
    this.resolve({ status, error, stdout: this.stdout, durationMs: Math.round(this.elapsedMs) });
  }
}

function startRunIn(pool: WorkerPool, target: RunTarget, code: string, options: RunOptions): RunHandle {
  if (!isRunnable(target.kind)) {
    return settledHandle({ message: 'Web pages run in the preview next to the editor, not in the console.' });
  }
  if (typeof Worker === 'undefined') {
    return settledHandle({ message: "This browser can't run programs here (Web Workers are not available)." });
  }
  return new RunSession(target, code, options, pool).handle;
}

/** Starts running `code`. Never throws; failures resolve `done` with status 'error'. */
export function startRun(target: RunTarget, code: string, options: RunOptions = {}): RunHandle {
  return startRunIn(options.freshWorker ? privatePool(false) : sharedPool, target, code, options);
}

/** Runs `code` once per test (non-interactive, test.input as stdin) and compares output. Never throws. */
export async function runTests(target: RunTarget, code: string, tests: TestCase[], options: RunTestsOptions): Promise<TestResult[]> {
  // Python keeps imported modules and files between runs in one worker; other kinds start clean on every run.
  const own = options.freshWorker && target.kind === 'python' ? privatePool(true) : null;
  const pool = own ?? sharedPool;
  try {
    return await runTestsWith((t, c, o) => startRunIn(pool, t, c, o ?? {}), target, code, tests, options);
  } catch {
    return tests.map((t) => ({ testId: t.id, passed: false, actualOutput: '', error: "Couldn't run the tests.", durationMs: 0 }));
  } finally {
    own?.close();
  }
}

/** Warm up a runtime (e.g. download Pyodide) before the user presses Run. Safe to call repeatedly. */
export function preloadRuntime(target: RunTarget): void {
  if (!isRunnable(target.kind) || typeof Worker === 'undefined') return;
  try {
    const slot = warm.get(target.kind);
    if (!slot) warmUp(target.kind);
    else if (!slot.busy) slot.worker.postMessage({ type: 'preload', kind: target.kind } satisfies MainToWorker);
  } catch {
    // Preloading is best-effort; the next run reports any problem.
  }
}

export { useCodeRunner } from './useCodeRunner';
export type { CodeRunner, CodeRunnerOptions, CodeRunnerState } from './useCodeRunner';
