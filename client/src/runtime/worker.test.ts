import type { PseudoIO } from '@codeclass/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MainToWorker, RunRequest, WorkerToMain } from './protocol';

// A stand-in pseudocode engine. Programs containing INPUT read a line and, like JavaScript's prompt() or Lua's
// io.read(), carry on without an error when there is none.
vi.mock('@codeclass/shared/pseudocode', () => ({
  createPseudocodeConfig: () => ({}),
  runPseudocode: (source: string, _config: unknown, io: PseudoIO) => {
    const line = source.includes('INPUT') ? io.readLine('Number? ') : '1';
    io.write(`${line === null ? 0 : Number(line) * 2}\n`);
    return { ok: true, error: null, steps: 1 };
  },
}));

// Interactive runs with SharedArrayBuffer: the typed answer is already there when the program asks.
vi.mock('./channel', () => ({ readInputLine: () => '5', resetInputChannel: () => {} }));

/** Loads worker.ts as if in a worker: records what it posts and returns a way to send it messages. */
async function loadWorker() {
  const posted: WorkerToMain[] = [];
  let listener: ((event: { data: MainToWorker }) => void) | null = null;
  vi.stubGlobal('postMessage', (message: WorkerToMain) => posted.push(message));
  vi.stubGlobal('addEventListener', (type: string, l: (event: { data: MainToWorker }) => void) => {
    if (type === 'message') listener = l;
  });
  vi.resetModules();
  await import('./worker');
  return {
    posted,
    send: (message: MainToWorker) => listener!({ data: message }),
    /** stdout as the page receives it, and the prompt messages. */
    stdout: () =>
      posted
        .flatMap((m) => (m.type === 'output' ? m.chunks : []))
        .filter((c) => c.stream === 'stdout')
        .map((c) => c.text)
        .join(''),
    prompts: () => posted.filter((m) => m.type === 'prompt'),
    done: async () => {
      await vi.waitFor(() => expect(posted.some((m) => m.type === 'done')).toBe(true));
      return posted.find((m) => m.type === 'done')!;
    },
  };
}

function run(code: string, partial: Partial<RunRequest> = {}): RunRequest {
  return { type: 'run', id: 1, kind: 'pseudocode', code, stdin: [], inputMode: 'none', channel: null, tail: null, pseudocode: null, ...partial };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker', () => {
  it('reports a program that asked for input, even when it finished without an error', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n'));
    expect(await worker.done()).toMatchObject({ type: 'done', status: 'ok', readInput: true });
  });

  it("reports a program that didn't read input", async () => {
    const worker = await loadWorker();
    worker.send(run('OUTPUT 2'));
    expect(await worker.done()).toMatchObject({ type: 'done', status: 'ok', readInput: false });
  });

  it('reports input read in a replay run', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n', { inputMode: 'replay', stdin: ['4'] }));
    expect(await worker.done()).toMatchObject({ type: 'done', status: 'ok', readInput: true });
  });
});

describe('worker input prompts', () => {
  it('tells the page where the prompt of a read with given input is, before the echo', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n', { stdin: ['4'] }));
    await worker.done();
    expect(worker.stdout()).toBe('Number? 8\n');
    expect(worker.prompts()).toEqual([{ type: 'prompt', id: 1, start: 0, end: 8 }]);
    const kinds = worker.posted.map((m) => (m.type === 'output' ? m.chunks.map((c) => c.stream).join('+') : m.type));
    expect(kinds.indexOf('prompt')).toBeLessThan(kinds.findIndex((k) => k.includes('stdin')));
  });

  it('counts a read at the end of the input', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n'));
    await worker.done();
    expect(worker.stdout()).toBe('Number? 0\n');
    expect(worker.prompts()).toEqual([{ type: 'prompt', id: 1, start: 0, end: 8 }]);
  });

  it('counts a read answered in the console', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n', { inputMode: 'channel', channel: new SharedArrayBuffer(64) }));
    await worker.done();
    expect(worker.stdout()).toBe('Number? 10\n');
    expect(worker.prompts()).toEqual([{ type: 'prompt', id: 1, start: 0, end: 8 }]);
  });

  it('counts each read of a replay run once', async () => {
    const worker = await loadWorker();
    worker.send(run('INPUT n', { inputMode: 'replay' }));
    await vi.waitFor(() => expect(worker.posted.some((m) => m.type === 'input-request')).toBe(true));
    worker.send({ type: 'input', id: 1, line: '7' });
    await worker.done();
    expect(worker.stdout()).toBe('Number? 14\n');
    expect(worker.prompts()).toEqual([{ type: 'prompt', id: 1, start: 0, end: 8 }]);
  });
});
