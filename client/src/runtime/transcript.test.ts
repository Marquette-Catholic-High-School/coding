import { describe, expect, it } from 'vitest';
import { Transcript } from './transcript';

describe('Transcript', () => {
  it('merges consecutive chunks of one stream and skips empty ones', () => {
    const t = new Transcript();
    t.append({ stream: 'stdout', text: 'a' });
    t.append({ stream: 'stdout', text: 'b\n' });
    t.append({ stream: 'stderr', text: '' });
    t.append({ stream: 'stderr', text: 'oops\n' });
    expect(t.snapshot()).toEqual([
      { stream: 'stdout', text: 'ab\n' },
      { stream: 'stderr', text: 'oops\n' },
    ]);
  });

  it('never changes a snapshot it handed out', () => {
    const t = new Transcript();
    t.append({ stream: 'stdout', text: 'a' });
    const first = t.snapshot();
    t.append({ stream: 'stdout', text: 'b' });
    t.append({ stream: 'stderr', text: 'c' });
    expect(first).toEqual([{ stream: 'stdout', text: 'a' }]);
    expect(t.snapshot()).toEqual([
      { stream: 'stdout', text: 'ab' },
      { stream: 'stderr', text: 'c' },
    ]);
  });

  it('returns the same array until something changes', () => {
    const t = new Transcript();
    t.append({ stream: 'stdout', text: 'a' });
    const first = t.snapshot();
    expect(t.snapshot()).toBe(first);
    t.append({ stream: 'stdout', text: 'b' });
    expect(t.snapshot()).not.toBe(first);
  });

  it('merges the oldest segments once there are too many, keeping all the text', () => {
    const t = new Transcript(10);
    let expected = '';
    for (let i = 0; i < 1000; i++) {
      const stream = i % 2 === 0 ? 'stdout' : 'stderr';
      t.append({ stream, text: `${i}\n` });
      expected += `${i}\n`;
    }
    const output = t.snapshot();
    expect(output.length).toBeLessThanOrEqual(11);
    expect(output.map((c) => c.text).join('')).toBe(expected);
    expect(output[output.length - 1]).toEqual({ stream: 'stderr', text: '999\n' });
    expect(output[output.length - 2]).toEqual({ stream: 'stdout', text: '998\n' });
  });

  it('stays fast when output alternates between streams', () => {
    const t = new Transcript();
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      t.append({ stream: i % 2 === 0 ? 'stdout' : 'stderr', text: 'x\n' });
      if (i % 500 === 0) t.snapshot();
    }
    expect(t.snapshot().length).toBeLessThanOrEqual(5001);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('clears', () => {
    const t = new Transcript();
    t.append({ stream: 'stdout', text: 'a' });
    t.clear();
    expect(t.snapshot()).toEqual([]);
  });
});
