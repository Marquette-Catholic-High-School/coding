import { useCallback, useEffect, useState } from 'react';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  error: unknown;
  /** There are changes that are not saved yet (queued, in flight, or failed). */
  dirty: boolean;
}

export interface AutosaveQueueOptions<T> {
  /** Persists a value. A rejection keeps the value queued and sets status 'error'. */
  save: (value: T) => Promise<unknown>;
  delayMs: number;
  onError?: (error: unknown) => void;
}

const NOTHING: unique symbol = Symbol('nothing queued');

/**
 * Debounced save queue with at most one save in flight: while a save runs, newer values replace each other and the
 * latest one is saved when it finishes. Framework-free so it can be unit tested; `useAutosave` wraps it for React.
 */
export class AutosaveQueue<T> {
  state: AutosaveState;
  private queued: T | typeof NOTHING = NOTHING;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private listener: ((state: AutosaveState) => void) | null = null;

  constructor(
    public options: AutosaveQueueOptions<T>,
    initialSavedAt: Date | null = null,
  ) {
    this.state = { status: 'idle', lastSavedAt: initialSavedAt, error: null, dirty: false };
  }

  /** The listener is called with the current state straight away and after every change. */
  subscribe(listener: (state: AutosaveState) => void): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  /** The last save failed and nothing has succeeded since. */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** Queue the latest value; it is saved `delayMs` after the last call. */
  update(value: T): void {
    this.queued = value;
    if (!this.state.dirty) this.set({ dirty: true });
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveSoon();
    }, this.options.delayMs);
  }

  /** Start saving whatever is queued now, without waiting (errors surface through the state). */
  saveSoon(): void {
    void this.run()?.catch(() => {});
  }

  /** Save anything queued now and wait until everything is saved. Rejects if a save fails. */
  async flush(): Promise<void> {
    for (;;) {
      const running = this.run();
      if (!running) return;
      await running;
    }
  }

  /** Forget queued changes (e.g. the server says the record can no longer be edited). */
  cancel(): void {
    this.clearTimer();
    this.queued = NOTHING;
    this.failed = false;
    this.set({ dirty: this.inFlight !== null, error: null, status: this.state.status === 'error' ? 'idle' : this.state.status });
  }

  /** Starts saving the queued value unless a save is already running. Returns the running save, if any. */
  private run(): Promise<void> | null {
    this.clearTimer();
    if (this.inFlight) return this.inFlight;
    if (this.queued === NOTHING) return null;
    const value = this.queued;
    this.queued = NOTHING;
    this.failed = false;
    this.set({ status: 'saving', error: null, dirty: true });

    const promise = this.options.save(value).then(
      () => {
        this.inFlight = null;
        const more = this.queued !== NOTHING;
        this.set({ lastSavedAt: new Date(), ...(more ? {} : { status: 'saved' as const, dirty: false }) });
        // Something newer arrived while saving: save it now unless its debounce is still running.
        if (more && !this.timer) this.saveSoon();
      },
      (error: unknown) => {
        this.inFlight = null;
        // Keep the newest value for the retry.
        if (this.queued === NOTHING) this.queued = value;
        this.failed = true;
        this.set({ status: 'error', error, dirty: true });
        this.options.onError?.(error);
        throw error;
      },
    );
    this.inFlight = promise;
    return promise;
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    this.listener?.(this.state);
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** What flushAutosaves/cancelAutosaves need from a queue. */
interface TrackedQueue {
  flush(): Promise<void>;
  cancel(): void;
}

/** The queues of the autosaving editors on the page. */
const trackedQueues = new Set<TrackedQueue>();

/** Includes `queue` in flushAutosaves and cancelAutosaves until the returned function is called. */
export function trackAutosave(queue: TrackedQueue): () => void {
  trackedQueues.add(queue);
  return () => {
    trackedQueues.delete(queue);
  };
}

/**
 * Saves what every autosaving editor on the page still holds and waits until all of it is saved, e.g. before this tab
 * switches accounts (afterwards the saves would go to the wrong account or be refused). Rejects with the first error
 * once every save has finished.
 */
export async function flushAutosaves(): Promise<void> {
  const results = await Promise.allSettled([...trackedQueues].map((queue) => queue.flush()));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Forgets what every autosaving editor still holds: the account it belongs to is no longer the one in this tab. */
export function cancelAutosaves(): void {
  for (const queue of trackedQueues) queue.cancel();
}

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<unknown>;
  /** Debounce after the last change. Default 1500 ms. */
  delayMs?: number;
  /** While false, `update` is ignored (read-only). Anything still queued is saved straight away. */
  enabled?: boolean;
  /** Shown as "Saved …" before the first save in this session (e.g. the record's updatedAt). */
  initialSavedAt?: string | null;
  onError?: (error: unknown) => void;
}

export interface Autosave<T> extends AutosaveState {
  /** Queue the latest value; it is saved after the debounce. */
  update: (value: T) => void;
  /** Save anything queued now and wait for it. Rejects if the save fails. */
  flush: () => Promise<void>;
  /** Try a failed save again. */
  retry: () => void;
  /** Forget queued changes (e.g. the server says the record can no longer be edited). */
  cancel: () => void;
}

/**
 * Debounced autosave (≈1.5 s) with one request in flight at a time. Also saves on unmount, when the tab is hidden
 * and before unload, and asks the browser to warn before leaving while changes are unsaved.
 */
export function useAutosave<T>({ save, delayMs = 1500, enabled = true, initialSavedAt = null, onError }: AutosaveOptions<T>): Autosave<T> {
  const [queue] = useState(() => new AutosaveQueue<T>({ save, delayMs, onError }, initialSavedAt ? new Date(initialSavedAt) : null));
  const [state, setState] = useState(queue.state);

  useEffect(() => {
    queue.options = { save, delayMs, onError };
  });
  useEffect(() => queue.subscribe(setState), [queue]);
  useEffect(() => trackAutosave(queue), [queue]);

  // Became read-only (e.g. the due date passed): save what was typed before it locked.
  useEffect(() => {
    if (!enabled && !queue.hasFailed) queue.saveSoon();
  }, [enabled, queue]);

  const update = useCallback(
    (value: T) => {
      if (enabled) queue.update(value);
    },
    [enabled, queue],
  );
  const flush = useCallback(() => queue.flush(), [queue]);
  const retry = useCallback(() => queue.saveSoon(), [queue]);
  const cancel = useCallback(() => queue.cancel(), [queue]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && !queue.hasFailed) queue.saveSoon();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [queue]);

  useEffect(() => {
    if (!state.dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      queue.saveSoon();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.dirty, queue]);

  // Leaving the page inside the app: save anything still queued.
  useEffect(() => () => queue.saveSoon(), [queue]);

  return { ...state, update, flush, retry, cancel };
}
