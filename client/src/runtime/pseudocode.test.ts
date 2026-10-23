import type { PseudoIO, PseudoRunOptions, PseudoRunResult } from '@codeclass/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnosticToRunError, runReplayAttempt, seededRandom, type ReplayState } from './lang/pseudocode';

// A stand-in engine: prints a random number, asks for a name (prompt passed to readLine) and an age.
const engine = { catchesErrors: false };

vi.mock('@codeclass/shared/pseudocode', () => ({
  createPseudocodeConfig: () => ({}),
  runPseudocode: (_source: string, _config: unknown, io: PseudoIO, options?: PseudoRunOptions): PseudoRunResult => {
    const body = (): PseudoRunResult => {
      io.write(`Lucky number ${Math.floor((options?.random ?? Math.random)() * 1000)}\n`);
      const name = io.readLine('Name? ');
      if (name === null) {
        return { ok: false, steps: 1, error: { severity: 'error', message: 'There is no more input.', line: 2, column: 1, phase: 'runtime' } };
      }
      io.write(`Hello ${name}\n`);
      const age = io.readLine('Age? ');
      io.write(`Age ${age}\n`);
      return { ok: true, error: null, steps: 3 };
    };
    if (!engine.catchesErrors) return body();
    try {
      return body();
    } catch {
      return { ok: false, steps: 1, error: { severity: 'error', message: 'Internal error', line: 1, column: 1, phase: 'runtime' } };
    }
  },
}));

function collect() {
  let text = '';
  return {
    out: { write: (stream: 'stdout' | 'stdin', chunk: string) => (text += stream === 'stdin' ? `<${chunk}>` : chunk) },
    text: () => text,
  };
}

function newState(stdin: string[]): ReplayState {
  return { code: '', config: null, stdin, typed: [], ended: false, seed: 1234, shown: 0 };
}

describe('pseudocode replay', () => {
  beforeEach(() => {
    engine.catchesErrors = false;
  });

  it('stops at the input request and resumes without repeating output', () => {
    const state = newState(['Sam']);
    const { out, text } = collect();
    expect(runReplayAttempt(state, out)).toBeNull();
    const lucky = Math.floor(seededRandom(1234)() * 1000);
    expect(text()).toBe(`Lucky number ${lucky}\nName? <Sam\n>Hello Sam\nAge? `);
    state.typed.push('12');
    expect(runReplayAttempt(state, out)).toEqual({ status: 'ok', error: null });
    expect(text()).toBe(`Lucky number ${lucky}\nName? <Sam\n>Hello Sam\nAge? Age 12\n`);
  });

  it('works when the engine catches the interruption itself', () => {
    engine.catchesErrors = true;
    const state = newState([]);
    const { out, text } = collect();
    expect(runReplayAttempt(state, out)).toBeNull();
    state.typed.push('Ann');
    expect(runReplayAttempt(state, out)).toBeNull();
    state.typed.push('9');
    expect(runReplayAttempt(state, out)).toEqual({ status: 'ok', error: null });
    expect(text()).toMatch(/^Lucky number \d+\nName\? Hello Ann\nAge\? Age 9\n$/);
  });

  it('gives end of input once the user ended it, instead of waiting', () => {
    const state = newState([]);
    const { out, text } = collect();
    expect(runReplayAttempt(state, out)).toBeNull();
    state.ended = true;
    expect(runReplayAttempt(state, out)).toEqual({
      status: 'error',
      error: { message: 'There is no more input.', line: 2, column: 1 },
      recycle: false,
    });
    expect(text()).toMatch(/^Lucky number \d+\nName\? $/);
  });

  it('uses lines typed before the input was ended first', () => {
    const state = newState([]);
    const { out } = collect();
    expect(runReplayAttempt(state, out)).toBeNull();
    state.typed.push('Ann');
    state.ended = true;
    // The age read gets end of input (null), which the stand-in engine prints as-is.
    expect(runReplayAttempt(state, out)).toEqual({ status: 'ok', error: null });
  });
});

describe('pseudocode helpers', () => {
  it('maps diagnostics to run errors', () => {
    expect(
      diagnosticToRunError({ severity: 'error', message: 'I don\'t know "scroe".', hint: 'Did you mean "score"?', line: 4, column: 8, phase: 'runtime' }),
    ).toEqual({ message: 'I don\'t know "scroe".', hint: 'Did you mean "score"?', line: 4, column: 8 });
    expect(diagnosticToRunError({ severity: 'error', message: 'Oops', line: 1, column: 1, phase: 'syntax' })).toEqual({
      message: 'Oops',
      line: 1,
      column: 1,
    });
  });

  it('seeded random numbers repeat for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seededRandom(43)()).not.toBe(first[0]);
  });
});
