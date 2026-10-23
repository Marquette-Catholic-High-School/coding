// Public API of the code runner (main thread). Programs run in module Web Workers (worker.ts): one warm worker per
// language kind is kept between runs; Stop and timeouts terminate the worker and the next run starts a fresh one.

import type { LanguageKind, TestCase, TestResult } from '@codeclass/shared';
import { createInputChannel, writeInputEof, writeInputLine } from './channel';
import {
  DEFAULT_TEST_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  TIMEOUT_MESSAGE,
  type InputMode,
  type MainToWorker,
  type WorkerToMain,
} from './protocol';
import { runTestsWith } from './testRunner';
import type { RunError, RunHandle, RunOptions, RunOutcome, RunOutcomeStatus, RunTarget, RunTestsOptions } from './types';

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
  channel: SharedArrayBuffer | null;
  /** Receives the worker's messages while a run owns the slot. */
  listener: ((message: WorkerToMain) => void) | null;
  /** Called if the worker dies while a run owns the slot. */
  onCrash: ((reason: string) => void) | null;
}

/** The warm worker for each kind (busy or idle). Extra workers for concurrent runs are discarded afterwards. */
const warm = new Map<LanguageKind, WorkerSlot>();

function spawn(kind: LanguageKind): WorkerSlot {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `codeclass-${kind}` });
  const slot: WorkerSlot = { worker, kind, busy: false, channel: null, listener: null, onCrash: null };
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

function acquire(kind: LanguageKind): WorkerSlot {
  const current = warm.get(kind);
  if (current && !current.busy) {
    current.busy = true;
    return current;
  }
  const slot = spawn(kind);
  if (!current) warm.set(kind, slot);
  slot.busy = true;
  return slot;
}

function release(slot: WorkerSlot): void {
  slot.busy = false;
  slot.listener = null;
  slot.onCrash = null;
  const current = warm.get(slot.kind);
  if (current === slot) return;
  if (!current) warm.set(slot.kind, slot);
  else slot.worker.terminate();
}

function discard(slot: WorkerSlot): void {
  slot.listener = null;
  slot.onCrash = null;
  slot.worker.terminate();
  if (warm.get(slot.kind) === slot) warm.delete(slot.kind);
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
  private waitingForInput = false;
  private readonly queuedInput: string[] = [];
  /** Running time before the current stretch (time spent loading or waiting for input does not count). */
  private elapsedMs = 0;
  private runningSince: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    target: RunTarget,
    code: string,
    private readonly options: RunOptions,
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
    };

    try {
      const slot = acquire(target.kind);
      this.slot = slot;
      slot.listener = (message) => this.onMessage(message);
      slot.onCrash = (reason) => {
        this.slot = null;
        this.finish('error', { message: `The code runner stopped unexpectedly (${reason}).` });
      };
      if (this.inputMode === 'channel') slot.channel ??= createInputChannel();
      const request: MainToWorker = {
        type: 'run',
        id: this.id,
        kind: target.kind,
        code,
        stdin: [...(options.stdin ?? [])],
        inputMode: this.inputMode,
        channel: this.inputMode === 'channel' ? slot.channel : null,
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
        for (const chunk of message.chunks) {
          if (chunk.stream === 'stdout' && this.stdout.length < MAX_OUTPUT_CHARS) {
            this.stdout += chunk.text.slice(0, MAX_OUTPUT_CHARS - this.stdout.length);
          }
          call(this.options.onOutput, chunk);
        }
        break;
      case 'input-request': {
        this.pauseClock();
        const queued = this.queuedInput.shift();
        if (queued !== undefined) {
          this.deliver(queued);
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
          if (message.recycle) discard(slot);
          else release(slot);
        }
        this.finish(message.status, message.error);
        break;
      }
    }
  }

  private provideInput(line: string): void {
    if (this.settled) return;
    if (!this.waitingForInput) {
      // Typed ahead: answer the next request straight away.
      this.queuedInput.push(line);
      return;
    }
    this.deliver(line);
    call(this.options.onPhase, 'running');
  }

  private deliver(line: string): void {
    this.waitingForInput = false;
    const slot = this.slot;
    if (!slot) return;
    if (this.inputMode === 'channel' && slot.channel) writeInputLine(slot.channel, line);
    else if (this.inputMode === 'replay') slot.worker.postMessage({ type: 'input', id: this.id, line } satisfies MainToWorker);
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
      // Still running (stop, timeout, startup failure): the worker may be stuck, so it is replaced.
      if (slot.channel) writeInputEof(slot.channel);
      discard(slot);
    }
    this.resolve({ status, error, stdout: this.stdout, durationMs: Math.round(this.elapsedMs) });
  }
}

/** Starts running `code`. Never throws; failures resolve `done` with status 'error'. */
export function startRun(target: RunTarget, code: string, options: RunOptions = {}): RunHandle {
  if (!isRunnable(target.kind)) {
    return settledHandle({ message: 'Web pages run in the preview next to the editor, not in the console.' });
  }
  if (typeof Worker === 'undefined') {
    return settledHandle({ message: "This browser can't run programs here (Web Workers are not available)." });
  }
  return new RunSession(target, code, options).handle;
}

/** Runs `code` once per test (non-interactive, test.input as stdin) and compares output. Never throws. */
export async function runTests(target: RunTarget, code: string, tests: TestCase[], options: RunTestsOptions): Promise<TestResult[]> {
  try {
    return await runTestsWith(startRun, target, code, tests, options);
  } catch {
    return tests.map((t) => ({ testId: t.id, passed: false, actualOutput: '', error: "Couldn't run the tests.", durationMs: 0 }));
  }
}

/** Warm up a runtime (e.g. download Pyodide) before the user presses Run. Safe to call repeatedly. */
export function preloadRuntime(target: RunTarget): void {
  if (!isRunnable(target.kind) || typeof Worker === 'undefined') return;
  try {
    let slot = warm.get(target.kind);
    if (!slot) {
      slot = spawn(target.kind);
      warm.set(target.kind, slot);
    }
    if (!slot.busy) slot.worker.postMessage({ type: 'preload', kind: target.kind } satisfies MainToWorker);
  } catch {
    // Preloading is best-effort; the next run reports any problem.
  }
}

export { useCodeRunner } from './useCodeRunner';
export type { CodeRunner, CodeRunnerState } from './useCodeRunner';
