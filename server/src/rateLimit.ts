// In-memory failure limiters (per process; they reset on restart). Each counts failures per key in a fixed window and
// answers 429 with Retry-After once a key has used them up. The map of keys is bounded, so a flood of distinct keys
// can't grow memory without limit; callers keep keys short (hash anything user-supplied).

import type { Request, Response } from 'express';
import { HttpError } from './http';

interface FailureWindow {
  failures: number;
  resetAt: number;
}

const SWEEP_INTERVAL_MS = 60_000;

export class FailureLimiter {
  private readonly entries = new Map<string, FailureWindow>();
  private lastSweep = 0;

  constructor(
    private readonly windowMs: number,
    private readonly maxFailures: number,
    /** Upper bound on tracked keys; the oldest windows are dropped first. */
    private readonly maxKeys = 10_000,
  ) {}

  /** Throws 429 (setting Retry-After) while `key` has no failures left in its window. */
  check(key: string, res: Response, message: string, fieldErrors?: Record<string, string>): void {
    const now = Date.now();
    const entry = this.active(key, now);
    if (entry && entry.failures >= this.maxFailures) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      throw new HttpError(429, message, fieldErrors);
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    this.sweep(now);
    const entry = this.active(key, now);
    if (entry) entry.failures += 1;
    else this.entries.set(key, { failures: 1, resetAt: now + this.windowMs });
  }

  /** Forgets the key's failures (e.g. after a successful sign-in). */
  clear(key: string): void {
    this.entries.delete(key);
  }

  private active(key: string, now: number): FailureWindow | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.resetAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_INTERVAL_MS && this.entries.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
    // Map iteration is insertion order, so this drops the oldest windows first.
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxKeys) break;
      this.entries.delete(key);
    }
  }
}

// --- Class codes ----------------------------------------------------------------------------------------

/**
 * Wrong class codes per IP (join preview, student registration, joining a class), against guessing the code space.
 * Only misses count, and the allowance is generous, so a whole class joining from one school address isn't blocked.
 */
const joinCodeMisses = new FailureLimiter(10 * 60_000, 60);
const JOIN_CODE_LIMIT_MESSAGE = 'Too many wrong class codes. Please wait a few minutes and try again.';

function clientKey(req: Request): string {
  return req.ip ?? 'unknown';
}

/** Throws 429 when this client has tried too many unknown class codes; `field` puts the message on that form field. */
export function checkJoinCodeAttempts(req: Request, res: Response, field?: string): void {
  joinCodeMisses.check(clientKey(req), res, JOIN_CODE_LIMIT_MESSAGE, field ? { [field]: JOIN_CODE_LIMIT_MESSAGE } : undefined);
}

/** Counts a class code that matched no class. */
export function recordJoinCodeMiss(req: Request): void {
  joinCodeMisses.recordFailure(clientKey(req));
}
