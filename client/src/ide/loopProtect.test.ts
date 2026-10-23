import { describe, expect, it } from 'vitest';
import { LOOP_GUARD, loopGuardCall, protectLoops } from './loopProtect';

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
    const g = loopGuardCall;
    expect(g(3)).toBe(`(typeof ${LOOP_GUARD}!=='function'||${LOOP_GUARD}(3))`);
    expect(protectLoops('while (i < 5) {}', 3)).toBe(`while (${g(3)}&&(i < 5)) {}`);
    expect(protectLoops('do { i++ } while (i < 5);')).toBe(`do { i++ } while (${g(1)}&&(i < 5));`);
    expect(protectLoops('for (let i = 0; i < 3; i++) s += i;')).toBe(`for (let i = 0;${g(1)}&&( i < 3); i++) s += i;`);
    expect(protectLoops('for (;;) {}')).toBe(`for (;${g(1)};) {}`);
    expect(protectLoops('for (let i = 0, j = f(a, [1; 2]); ; ) {}')).toBe(`for (let i = 0, j = f(a, [1; 2]);${g(1)} ; ) {}`);
  });

  it('reports the line of each loop in the page and adds no line breaks', () => {
    const src = 'let i = 0;\n// count\nwhile (i < 3) {\n  for (;;) break;\n  i++;\n}';
    const out = protectLoops(src, 10);
    expect(out).toContain(`while (${loopGuardCall(12)}&&(i < 3))`);
    expect(out).toContain(`for (;${loopGuardCall(13)};)`);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('runs loops as written where the guard is not defined (e.g. a nested frame)', () => {
    const src = 'let s = 0; for (let i = 0; i < 3; i++) s += i; let n = 0; while (n < 4) n++; return [s, n];';
    expect(protectLoops(src)).not.toBe(src);
    expect(new Function(protectLoops(src))()).toEqual([3, 4]);
  });

  it('leaves loops without a condition, and words that are not loops, alone', () => {
    for (const src of [
      'for (const x of xs) {}',
      'for (const k in obj) {}',
      'async function f() { for await (const x of xs) {} }',
      'obj.while(x); obj?.for(y);',
      'const o = { while: 1, for: 2 };',
      'class A { while() {} }',
      'class A { while(x) { return x; } static for(a, b) {} }',
      'class A extends B { async while(x) {} *for(y) {} get while() {} }',
      'const o = { while(x) { return x; }, for(a) {} };',
      'f({ while(x) {} }, [{ while(y) {} }]);',
      'const k = { class: 1 }; const c = class { while(x) {} };',
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
    expect(out).toContain(`while (${loopGuardCall(1)}&&(n < 2))`);
    expect(new Function(LOOP_GUARD, `${out}; return t;`)(() => true)).toBe('a 2 b');
  });

  it('keeps methods called while working', () => {
    const src = 'class A { while(x) { return x * 2; } }\nconst o = { while(x) { return x + 1; } };\nreturn [new A().while(3), o.while(3)];';
    expect(run(src)).toEqual([6, 4]);
  });

  it('still guards loops in blocks that look like object literals at first glance', () => {
    for (const src of [
      'class A { run() { while (true) {} } }\nnew A().run();',
      'class A { static { while (true) {} } }',
      'const o = { f() { for (;;) {} } }; o.f();',
      'const f = () => { while (true) {} }; f();',
      'switch (1) { case 1: { while (true) {} } }',
      'outer: { while (true) {} }',
      'if (true) { do {} while (true); }',
      'try { while (true) {} } finally {}',
      'const o = { class: 1 }; if (o) { while (true) {} }',
    ]) {
      expect(() => run(src), src).toThrow(LoopStopped);
    }
  });

  // Each of these used to make the tokenizer give up (or misread the script), leaving the endless loop unguarded.
  it('reads regular expressions and divisions correctly in tricky spots', () => {
    for (const src of [
      'let i = 0, h = i++ / 2;\nwhile (true) {}', // division after ++
      'let i = 9, h = i-- / 2;\nwhile (true) {}', // division after --
      'let a = 1, b = a+++/\'/.source.length;\nwhile (true) {}', // a++ + /'/
      'let a = 1, b = a + +/\'/.test("\'");\nwhile (true) {}', // unary plus, then a regex
      'let s = "a\'";\nif (s) /\'/.test(s);\nwhile (true) {}', // regex after if (…)
      'let n = 0;\nwhile (n++ < 3) /\'/.test("\'");\nwhile (true) {}', // regex after while (…)
      'let s = "\'";\nfor (const m of /\'/g.exec(s) ?? []) {}\nwhile (true) {}', // regex after for…of
      'let of = 4, x = of / 2;\nwhile (true) {}', // a variable called of
      'const o = { return: 4 };\nconst h = o.return / 2;\nwhile (true) {}', // a property called return
      'const f = (x) => x;\nconst h = f(4) / 2;\nwhile (true) {}', // division after a call
      'const t = `${/\'/.source}`;\nwhile (true) {}', // regex at the start of a template substitution
      "<!-- don't run this in old browsers\nwhile (true) {}", // legacy HTML comment opener
      "let x = 1; <!-- don't\nwhile (true) {}",
      "let x = 1;\n  --> that's the end\nwhile (true) {}", // legacy HTML comment closer at a line start
      "/*\n*/ --> it's a comment\nwhile (true) {}",
    ]) {
      expect(protectLoops(src), src).toContain(LOOP_GUARD);
      expect(() => run(src), src).toThrow(LoopStopped);
    }
  });

  it('keeps finite code around tricky spots working', () => {
    const src = [
      'let i = 4, of = 6;',
      'const h = i++ / 2, k = of / 3;',
      'let hits = 0;',
      'if (h) /2/.test("2") && hits++;',
      'let x = 0; x = x-->0;', // x-- > 0 mid-line is not a comment
      'for (let j = 0; j < 3; j++) hits++;',
      'return [h, k, hits, x, i];',
    ].join('\n');
    expect(run(src)).toEqual([2, 2, 4, false, 5]);
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
