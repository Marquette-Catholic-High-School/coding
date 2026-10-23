import { describe, expect, it } from 'vitest';
import { formatConsoleTable, formatLogArgs, inspect } from './lang/inspect';

describe('inspect', () => {
  it('formats primitives like Node', () => {
    expect(inspect('hi')).toBe("'hi'");
    expect(inspect("it's")).toBe('"it\'s"');
    expect(inspect('a\nb')).toBe("'a\\nb'");
    expect(inspect(42)).toBe('42');
    expect(inspect(-0)).toBe('-0');
    expect(inspect(10n)).toBe('10n');
    expect(inspect(null)).toBe('null');
    expect(inspect(undefined)).toBe('undefined');
    expect(inspect(Symbol('x'))).toBe('Symbol(x)');
  });

  it('formats arrays and objects on one line when short', () => {
    expect(inspect([1, 'two', [3]])).toBe("[ 1, 'two', [ 3 ] ]");
    expect(inspect({ name: 'Sam', age: 12, 'favourite-food': 'pizza' })).toBe("{ name: 'Sam', age: 12, 'favourite-food': 'pizza' }");
    expect(inspect([])).toBe('[]');
    expect(inspect({})).toBe('{}');
  });

  it('breaks long structures over several lines', () => {
    const value = { description: 'x'.repeat(40), another: 'y'.repeat(40) };
    expect(inspect(value)).toBe(`{\n  description: '${'x'.repeat(40)}',\n  another: '${'y'.repeat(40)}'\n}`);
  });

  it('collapses deep nesting and marks circular references', () => {
    expect(inspect({ a: { b: { c: { d: 1 } } } })).toBe('{ a: { b: { c: [Object] } } }');
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(inspect(loop)).toBe("{ name: 'loop', self: [Circular] }");
  });

  it('formats Map, Set, class instances, functions and errors', () => {
    expect(inspect(new Map([['a', 1]]))).toBe("Map(1) { 'a' => 1 }");
    expect(inspect(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
    expect(inspect(new Map())).toBe('Map(0) {}');
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    expect(inspect(new Point(1, 2))).toBe('Point { x: 1, y: 2 }');
    expect(inspect(function greet() {})).toBe('[Function: greet]');
    expect(inspect(async () => {})).toBe('[AsyncFunction (anonymous)]');
    expect(inspect(Point)).toBe('[class Point]');
    expect(inspect(new TypeError('bad'))).toBe('TypeError: bad');
    expect(inspect([new Error('inner')])).toBe('[ [Error: inner] ]');
    expect(inspect(Object.create(null))).toBe('[Object: null prototype] {}');
  });

  it('shows holes and long arrays compactly', () => {
    expect(inspect([1, , , 4])).toBe('[ 1, <2 empty items>, 4 ]');
    const long = Array.from({ length: 103 }, (_, i) => i);
    expect(inspect(long, { breakLength: Infinity })).toMatch(/, 99, \.\.\. 3 more items \]$/);
  });
});

describe('formatLogArgs', () => {
  it('prints top-level strings raw and joins with spaces', () => {
    expect(formatLogArgs(['Total:', 5, 'items'])).toBe('Total: 5 items');
    expect(formatLogArgs([[1, 2], { a: 'x' }])).toBe("[ 1, 2 ] { a: 'x' }");
    expect(formatLogArgs([])).toBe('');
  });

  it('applies printf-style specifiers', () => {
    expect(formatLogArgs(['%s is %d years old', 'Sam', 12.5])).toBe('Sam is 12.5 years old');
    expect(formatLogArgs(['%i%%', 42.9])).toBe('42%');
    expect(formatLogArgs(['%j', { a: 1 }])).toBe('{"a":1}');
    expect(formatLogArgs(['%c styled', 'color: red'])).toBe(' styled');
    expect(formatLogArgs(['%s and %s', 'one'])).toBe('one and %s');
    expect(formatLogArgs(['100%'])).toBe('100%');
  });
});

describe('formatConsoleTable', () => {
  it('draws arrays of objects with an index column', () => {
    expect(formatConsoleTable([{ name: 'Rex', age: 3 }, { name: 'Tom' }])).toBe(
      [
        '┌─────────┬───────┬─────┐',
        '│ (index) │ name  │ age │',
        '├─────────┼───────┼─────┤',
        "│ 0       │ 'Rex' │ 3   │",
        "│ 1       │ 'Tom' │     │",
        '└─────────┴───────┴─────┘',
      ].join('\n'),
    );
  });

  it('uses a Values column for primitive rows', () => {
    expect(formatConsoleTable({ a: 1, b: 'x' })).toBe(
      [
        '┌─────────┬────────┐',
        '│ (index) │ Values │',
        '├─────────┼────────┤',
        '│ a       │ 1      │',
        "│ b       │ 'x'    │",
        '└─────────┴────────┘',
      ].join('\n'),
    );
  });

  it('returns null for non-objects', () => {
    expect(formatConsoleTable(5)).toBeNull();
    expect(formatConsoleTable(null)).toBeNull();
  });
});
