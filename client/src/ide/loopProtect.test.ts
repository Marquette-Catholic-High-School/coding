import { describe, expect, it } from 'vitest';
import { LOOP_GUARD, protectLoops } from './loopProtect';

class LoopStopped extends Error {}

/** Runs instrumented code with a guard that gives up after `budget` checks; returns the code's result. */
function run(code: string, budget = 10_000): unknown {
  let calls = 0;
  const guard = () => {
    if (++calls > budget) throw new LoopStopped('stopped');
    return true;
  };
  return new Function(LOOP_GUARD, protectLoops(code))(guard);
}

describe('protectLoops', () => {
  it('guards while, do…while and for conditions', () => {
    expect(protectLoops('while (i < 5) {}', 3)).toBe(`while (${LOOP_GUARD}(3)&&(i < 5)) {}`);
    expect(protectLoops('do { i++ } while (i < 5);')).toBe(`do { i++ } while (${LOOP_GUARD}(1)&&(i < 5));`);
    expect(protectLoops('for (let i = 0; i < 3; i++) s += i;')).toBe(`for (let i = 0;${LOOP_GUARD}(1)&&( i < 3); i++) s += i;`);
    expect(protectLoops('for (;;) {}')).toBe(`for (;${LOOP_GUARD}(1);) {}`);
    expect(protectLoops('for (let i = 0, j = f(a, [1; 2]); ; ) {}')).toBe(`for (let i = 0, j = f(a, [1; 2]);${LOOP_GUARD}(1) ; ) {}`);
  });

  it('reports the line of each loop in the page and adds no line breaks', () => {
    const src = 'let i = 0;\n// count\nwhile (i < 3) {\n  for (;;) break;\n  i++;\n}';
    const out = protectLoops(src, 10);
    expect(out).toContain(`while (${LOOP_GUARD}(12)&&(i < 3))`);
    expect(out).toContain(`for (;${LOOP_GUARD}(13);)`);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('leaves loops without a condition, and words that are not loops, alone', () => {
    for (const src of [
      'for (const x of xs) {}',
      'for (const k in obj) {}',
      'async function f() { for await (const x of xs) {} }',
      'obj.while(x); obj?.for(y);',
      'const o = { while: 1, for: 2 };',
      'class A { while() {} }',
    ]) {
      expect(protectLoops(src)).toBe(src);
    }
  });

  it('ignores loops inside strings, comments, templates and regular expressions', () => {
    const src = [
      'const s = "while (x) {}" + \'for (;;)\';',
      '// while (true) {}',
      '/* for (;;) {} */',
      'const r = /for (;;) [/]while(1)/g.test(s) ? 1 / 2 : 3;',
      'const t = `while (1) ${s} for (;;)`;',
    ].join('\n');
    expect(protectLoops(src)).toBe(src);
  });

  it('guards loops inside template substitutions', () => {
    const out = protectLoops('const t = `a ${(() => { let n = 0; while (n < 2) n++; return n; })()} b`;');
    expect(out).toContain(`while (${LOOP_GUARD}(1)&&(n < 2))`);
    expect(new Function(LOOP_GUARD, `${out}; return t;`)(() => true)).toBe('a 2 b');
  });

  it('leaves code it cannot read (half-typed) unchanged', () => {
    for (const src of ['while (i < 5) { console.log("hi', 'for (;;) { /* note', 'while (x) { `a ${b', 'while (x) {']) {
      expect(protectLoops(src)).toBe(src);
    }
  });

  it('stops loops that never end', () => {
    for (const src of [
      'while (true) {}',
      'let i = 0; while (i < 5) {}',
      'do {} while (true);',
      'for (;;) {}',
      'for (let i = 0; i >= 0; i++) {}',
      'for (;;) { try { while (true) {} } catch (e) {} }',
      'while (true) { try { for (;;) {} } catch (e) { continue; } }',
    ]) {
      expect(() => run(src), src).toThrow(LoopStopped);
    }
  });

  it('keeps what finite loops do', () => {
    const src = [
      'let total = 0;',
      'for (let i = 0; i < 10; i++) { if (i % 2) continue; total += i; }',
      'let n = 0; while (n < 5) n++;',
      'let d = 0; do { d += 2 } while (d < 7)',
      'label: for (const a of [1, 2]) { for (let b = 0; ; b++) { if (b > 2) continue label; total += a * b; } }',
      'return [total, n, d, /\\/\\*/.test("/*"), `${n}/${d}`];',
    ].join('\n');
    expect(run(src)).toEqual([20 + 3 + 6, 5, 8, true, '5/8']);
  });
});
