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
    send: (message: MainToWorker) => listener!({ data: message }),
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
