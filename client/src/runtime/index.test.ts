import type { TestCase } from '@codeclass/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_EOF, CHANNEL_IDLE, CHANNEL_LINE, readInputLine, resetInputChannel } from './channel';
import { OutputBuffer } from './output';
import { OutputTailWriter } from './outputTail';
import type { MainToWorker, RunRequest, WorkerToMain } from './protocol';
import type { OutputChunk } from './types';

/** Stands in for the code-runner worker: records what the page sends and replies on demand. */
class FakeWorker {
  static all: FakeWorker[] = [];
  readonly messages: MainToWorker[] = [];
  terminated = false;
  private readonly listeners: ((event: { data: WorkerToMain }) => void)[] = [];
  private readonly errorListeners: ((event: { message: string; preventDefault(): void }) => void)[] = [];

  constructor(_url: URL, readonly options: { name?: string }) {
    FakeWorker.all.push(this);
  }

  postMessage(message: MainToWorker): void {
    this.messages.push(message);
  }

  addEventListener(type: string, listener: (event: { data: WorkerToMain }) => void): void {
    if (type === 'message') this.listeners.push(listener);
    if (type === 'error') this.errorListeners.push(listener as unknown as (typeof this.errorListeners)[number]);
  }

  /** The worker dies (an uncaught error in it, or running out of memory). */
  crash(message: string): void {
    for (const listener of this.errorListeners) listener({ message, preventDefault() {} });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: WorkerToMain): void {
    for (const listener of this.listeners) listener({ data });
  }

  runs(): RunRequest[] {
    return this.messages.filter((m): m is RunRequest => m.type === 'run');
  }

  lastRun(): RunRequest {
    const runs = this.runs();
    return runs[runs.length - 1]!;
  }

  finish(recycle = false): void {
    this.emit({ type: 'done', id: this.lastRun().id, status: 'ok', error: null, recycle });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const text = (chunks: readonly OutputChunk[]) => chunks.map((c) => c.text).join('');

async function load(isolated: boolean) {
  vi.resetModules();
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('crossOriginIsolated', isolated);
  return import('./index');
}

function test(id: string): TestCase {
  return { id, name: id, input: '', expectedOutput: '', hidden: false, points: 1 };
}

beforeEach(() => {
  FakeWorker.all = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker reuse', () => {
  it('never runs two JavaScript programs in one worker, and warms up the next worker', async () => {
    const rt = await load(true);
    const first = rt.startRun({ kind: 'javascript' }, 'Array.prototype.sum = 1');
    const a = FakeWorker.all[0]!;
    a.finish(true);
    await first.done;
    expect(a.terminated).toBe(true);
    const b = FakeWorker.all[1]!;
    expect(b.messages).toEqual([{ type: 'preload', kind: 'javascript' }]);
    const second = rt.startRun({ kind: 'javascript' }, 'console.log(1)');
    expect(FakeWorker.all).toHaveLength(2);
    expect(b.lastRun().code).toBe('console.log(1)');
    b.finish(true);
    await second.done;
  });

  it('keeps the warm Python worker for ordinary runs', async () => {
    const rt = await load(true);
    const run = rt.startRun({ kind: 'python' }, 'print(1)');
    const warm = FakeWorker.all[0]!;
    warm.finish();
    await run.done;
    expect(warm.terminated).toBe(false);
    const again = rt.startRun({ kind: 'python' }, 'print(2)');
    expect(warm.runs()).toHaveLength(2);
    warm.finish();
    await again.done;
  });

  it('gives a graded Python batch a worker of its own and discards it afterwards', async () => {
    const rt = await load(true);
    const warmRun = rt.startRun({ kind: 'python' }, 'print(1)');
    const warm = FakeWorker.all[0]!;
    warm.finish();
    await warmRun.done;

    const results = rt.runTests({ kind: 'python' }, 'print(input())', [test('a'), test('b')], { compareMode: 'trim', freshWorker: true });
    for (let i = 1; i <= 2; i++) {
      await vi.waitFor(() => expect(FakeWorker.all[1]?.runs()).toHaveLength(i));
      FakeWorker.all[1]!.finish();
    }
    expect(await results).toHaveLength(2);
    const own = FakeWorker.all[1]!;
    expect(own.terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    expect(warm.runs()).toHaveLength(1);
    expect(warm.terminated).toBe(false);
  });

  it('discards a fresh worker after a single run', async () => {
    const rt = await load(true);
    const run = rt.startRun({ kind: 'python' }, 'print(1)', { freshWorker: true });
    const own = FakeWorker.all[0]!;
    own.finish();
    await run.done;
    expect(own.terminated).toBe(true);
    rt.startRun({ kind: 'python' }, 'print(2)');
    expect(FakeWorker.all).toHaveLength(2);
  });
});

describe('end of input', () => {
  it('answers the waiting read with end-of-file, and every read after it', async () => {
    const rt = await load(true);
    const prompts: (string | null)[] = [];
    const handle = rt.startRun({ kind: 'python' }, 'import sys\nprint(sys.stdin.read())', {
      interactive: true,
      onInputRequest: (prompt) => prompts.push(prompt),
    });
    const worker = FakeWorker.all[0]!;
    const { id, channel } = worker.lastRun();
    const state = new Int32Array(channel!, 0, 1);
    resetInputChannel(channel!);
    worker.emit({ type: 'input-request', id, prompt: null });
    expect(prompts).toEqual([null]);
    handle.endInput();
    expect(Atomics.load(state, 0)).toBe(CHANNEL_EOF);
    expect(readInputLine(channel!)).toBeNull();
    // A later read is answered at once, without asking the user again; typed lines are ignored now.
    handle.provideInput('late');
    worker.emit({ type: 'input-request', id, prompt: null });
    expect(prompts).toEqual([null]);
    expect(Atomics.load(state, 0)).toBe(CHANNEL_EOF);
    worker.finish();
    expect((await handle.done).status).toBe('ok');
  });

  it('delivers lines typed ahead first', async () => {
    const rt = await load(true);
    const handle = rt.startRun({ kind: 'python' }, 'code', { interactive: true });
    const worker = FakeWorker.all[0]!;
    const { id, channel } = worker.lastRun();
    const state = new Int32Array(channel!, 0, 1);
    handle.provideInput('3');
    handle.endInput();
    resetInputChannel(channel!);
    worker.emit({ type: 'input-request', id, prompt: null });
    expect(Atomics.load(state, 0)).toBe(CHANNEL_LINE);
    expect(readInputLine(channel!)).toBe('3');
    expect(Atomics.load(state, 0)).toBe(CHANNEL_IDLE);
    worker.emit({ type: 'input-request', id, prompt: null });
    expect(readInputLine(channel!)).toBeNull();
    handle.stop();
  });

  it('tells a pseudocode replay run that the input ended', async () => {
    const rt = await load(false);
    const handle = rt.startRun({ kind: 'pseudocode' }, 'code', { interactive: true });
    const worker = FakeWorker.all[0]!;
    const { id, inputMode } = worker.lastRun();
    expect(inputMode).toBe('replay');
    worker.emit({ type: 'input-request', id, prompt: 'Name? ' });
    handle.endInput();
    expect(worker.messages[worker.messages.length - 1]).toEqual({ type: 'input', id, line: null });
    handle.stop();
  });
});

describe('output a stuck program could not send', () => {
  /** What worker.ts does: an output buffer posting to the page, mirrored into the run's tail. */
  function workerOutput(worker: FakeWorker) {
    const { id, tail } = worker.lastRun();
    return new OutputBuffer({
      send: (chunks, batch) => worker.emit({ type: 'output', id, batch, chunks }),
      tail: new OutputTailWriter(tail!),
      burst: 1,
      now: () => 0,
      schedule: () => 0,
      cancel: () => {},
    });
  }

  it('still reaches the console when the user presses Stop', async () => {
    const rt = await load(true);
    const shown: OutputChunk[] = [];
    const handle = rt.startRun({ kind: 'javascript' }, 'code', { interactive: true, onOutput: (c) => shown.push(c) });
    const out = workerOutput(FakeWorker.all[0]!);
    out.write('stdout', 'first\n');
    out.write('stdout', 'second\n');
    out.write('stderr', 'third\n');
    expect(shown.map((c) => c.text).join('')).toBe('first\n');
    handle.stop();
    const outcome = await handle.done;
    expect(outcome.status).toBe('stopped');
    expect(shown).toEqual([
      { stream: 'stdout', text: 'first\n' },
      { stream: 'stdout', text: 'second\n' },
      { stream: 'stderr', text: 'third\n' },
    ]);
    expect(outcome.stdout).toBe('first\nsecond\n');
  });

  it('appears while the program is still busy, and is not repeated when it arrives', async () => {
    const rt = await load(true);
    const shown: OutputChunk[] = [];
    const handle = rt.startRun({ kind: 'python' }, 'code', { interactive: true, onOutput: (c) => shown.push(c) });
    const worker = FakeWorker.all[0]!;
    worker.emit({ type: 'phase', id: worker.lastRun().id, phase: 'running' });
    const out = workerOutput(worker);
    out.write('stdout', 'first\n');
    out.write('stdout', 'second\n');
    expect(text(shown)).toBe('first\n');
    // The program keeps computing without printing again: the page polls the tail.
    await vi.waitFor(() => expect(text(shown)).toBe('first\nsecond\n'));
    out.write('stderr', 'third\n');
    out.flush();
    worker.finish();
    const outcome = await handle.done;
    expect(shown).toEqual([
      { stream: 'stdout', text: 'first\n' },
      { stream: 'stdout', text: 'second\n' },
      { stream: 'stderr', text: 'third\n' },
    ]);
    expect(outcome.stdout).toBe('first\nsecond\n');
  });

  it('still reaches the console when the worker crashes', async () => {
    const rt = await load(true);
    const shown: OutputChunk[] = [];
    const handle = rt.startRun({ kind: 'python' }, 'code', { interactive: true, onOutput: (c) => shown.push(c) });
    const worker = FakeWorker.all[0]!;
    const out = workerOutput(worker);
    out.write('stdout', 'one\n');
    out.write('stdout', 'two\n');
    worker.crash('out of memory');
    const outcome = await handle.done;
    expect(outcome.status).toBe('error');
    expect(outcome.error?.message).toContain('out of memory');
    expect(text(shown)).toBe('one\ntwo\n');
  });

  it('is part of a test that timed out', async () => {
    const rt = await load(true);
    const handle = rt.startRun({ kind: 'python' }, 'code', { timeoutMs: 20 });
    const worker = FakeWorker.all[0]!;
    worker.emit({ type: 'phase', id: worker.lastRun().id, phase: 'running' });
    const out = workerOutput(worker);
    out.write('stdout', 'a\n');
    out.write('stdout', 'b\n');
    const outcome = await handle.done;
    expect(outcome.status).toBe('timeout');
    expect(outcome.stdout).toBe('a\nb\n');
    expect(worker.terminated).toBe(true);
    await tick();
  });
});
