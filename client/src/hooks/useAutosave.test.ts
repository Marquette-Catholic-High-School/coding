import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveQueue } from './useAutosave';

/** A save function whose calls resolve/reject when the test says so. */
function controlledSave() {
  const calls: Array<{ value: string; resolve: () => void; reject: (e: unknown) => void }> = [];
  const save = vi.fn(
    (value: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { save, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AutosaveQueue', () => {
  it('debounces and saves only the latest value', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 1500 });
    q.update('a');
    await vi.advanceTimersByTimeAsync(1000);
    q.update('ab');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(q.state).toMatchObject({ dirty: true, status: 'idle' });

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0]!.value).toBe('ab');
    expect(q.state.status).toBe('saving');

    calls[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.state).toMatchObject({ status: 'saved', dirty: false, error: null });
    expect(q.state.lastSavedAt).toBeInstanceOf(Date);
  });

  it('keeps one save in flight and then saves the newest queued value', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    q.update('1');
    await vi.advanceTimersByTimeAsync(100);
    q.update('2');
    q.update('3');
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);

    calls[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1]!.value).toBe('3');
    expect(q.state).toMatchObject({ status: 'saving', dirty: true });

    calls[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.state).toMatchObject({ status: 'saved', dirty: false });
  });

  it('waits for a pending debounce before saving a value queued during a save', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    q.update('1');
    await vi.advanceTimersByTimeAsync(100);
    q.update('2'); // debounce running
    calls[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1]!.value).toBe('2');
  });

  it('reports errors, keeps the value and retries it', async () => {
    const { save, calls } = controlledSave();
    const onError = vi.fn();
    const q = new AutosaveQueue<string>({ save, delayMs: 100, onError });
    q.update('x');
    await vi.advanceTimersByTimeAsync(100);
    const boom = new Error('offline');
    calls[0]!.reject(boom);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.state).toMatchObject({ status: 'error', error: boom, dirty: true });
    expect(q.hasFailed).toBe(true);
    expect(onError).toHaveBeenCalledWith(boom);

    q.saveSoon();
    expect(calls[1]!.value).toBe('x');
    calls[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.state).toMatchObject({ status: 'saved', dirty: false, error: null });
    expect(q.hasFailed).toBe(false);
  });

  it('does not let a failed older value replace a newer queued one', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    q.update('old');
    await vi.advanceTimersByTimeAsync(100);
    q.update('new');
    calls[0]!.reject(new Error('fail'));
    await vi.advanceTimersByTimeAsync(0);
    q.saveSoon();
    expect(calls[1]!.value).toBe('new');
  });

  it('flush saves immediately and waits for queued values', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 1500 });
    q.update('a');
    await vi.advanceTimersByTimeAsync(1500);
    q.update('b');

    let flushed = false;
    const flushing = q.flush().then(() => {
      flushed = true;
    });
    calls[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    expect(calls[1]!.value).toBe('b');
    calls[1]!.resolve();
    await flushing;
    expect(flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(q.state).toMatchObject({ status: 'saved', dirty: false });
  });

  it('flush resolves straight away when there is nothing to save', async () => {
    const { save } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    await q.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('flush rejects when the save fails', async () => {
    const { save, calls } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    q.update('a');
    const flushing = q.flush();
    calls[0]!.reject(new Error('409'));
    await expect(flushing).rejects.toThrow('409');
  });

  it('cancel drops queued changes', async () => {
    const { save } = controlledSave();
    const q = new AutosaveQueue<string>({ save, delayMs: 100 });
    q.update('a');
    q.cancel();
    expect(q.state.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
  });

  it('notifies subscribers with the current state and changes', async () => {
    const { save } = controlledSave();
    const since = new Date('2026-01-01T00:00:00Z');
    const q = new AutosaveQueue<string>({ save, delayMs: 100 }, since);
    const seen: boolean[] = [];
    const unsubscribe = q.subscribe((s) => seen.push(s.dirty));
    expect(q.state.lastSavedAt).toBe(since);
    q.update('a');
    unsubscribe();
    q.cancel();
    expect(seen).toEqual([false, true]);
  });
});
