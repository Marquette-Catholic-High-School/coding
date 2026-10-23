import { transform } from 'sucrase';
import { describe, expect, it } from 'vitest';
import {
  engineSyntaxLocation,
  formatStackFrame,
  heuristicSyntaxLocation,
  parseStackFrames,
  sucraseErrorLocation,
  sucraseErrorMessage,
} from './lang/jsErrors';

describe('parseStackFrames', () => {
  it('maps V8 frames to student lines and drops runner frames', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      '    at greet (main.js:5:11)',
      '    at anonymous (main.js:9:1)',
      '    at Session.run (http://localhost:5173/src/runtime/lang/javascript.ts:210:7)',
    ].join('\n');
    expect(parseStackFrames(stack, 2, 10)).toEqual([
      { fn: 'greet', line: 3, column: 11 },
      { fn: null, line: 7, column: 1 },
    ]);
  });

  it('understands Firefox/Safari frames and code without a sourceURL', () => {
    expect(parseStackFrames('greet@main.js:4:3\n@main.js:6:1', 2, 10)).toEqual([
      { fn: 'greet', line: 2, column: 3 },
      { fn: null, line: 4, column: 1 },
    ]);
    expect(parseStackFrames('anonymous@http://x/javascript.ts line 120 > Function:3:9', 2, 5)).toEqual([
      { fn: null, line: 1, column: 9 },
    ]);
    expect(parseStackFrames('    at eval (eval at run (http://x/javascript.ts:1:1), <anonymous>:4:2)', 2, 5)).toEqual([
      { fn: null, line: 2, column: 2 },
    ]);
  });

  it('ignores frames outside the student code', () => {
    expect(parseStackFrames('    at main.js:1:1\n    at main.js:50:1', 2, 10)).toEqual([]);
  });

  it('formats frames for error details', () => {
    expect(formatStackFrame({ fn: 'greet', line: 3, column: 11 })).toBe('    at greet (main.js:3:11)');
    expect(formatStackFrame({ fn: null, line: 7, column: 1 })).toBe('    at main.js:7:1');
  });
});

describe('syntax error locations', () => {
  it('reads sucrase parse errors', () => {
    let error: unknown;
    try {
      transform('let x = 1;\nconsole.log(x\nlet y = 2;', { transforms: [] });
    } catch (err) {
      error = err;
    }
    expect(sucraseErrorLocation(error)).toEqual({ line: 3, column: 1 });
    expect(sucraseErrorMessage(error)).toBe('Unexpected token, expected ","');
  });

  it('falls back to the message suffix', () => {
    expect(sucraseErrorLocation({ message: 'Unexpected token (4:2)' })).toEqual({ line: 4, column: 2 });
    expect(sucraseErrorLocation('nope')).toBeNull();
  });

  it('uses lineNumber when the engine provides it', () => {
    expect(engineSyntaxLocation({ lineNumber: 5, columnNumber: 3 }, 2, 10)).toEqual({ line: 3, column: 4 });
    expect(engineSyntaxLocation({ lineNumber: 1 }, 2, 10)).toBeNull();
    expect(engineSyntaxLocation(new SyntaxError('x'), 2, 10)).toBeNull();
  });

  it('finds redeclared variables and module syntax', () => {
    const code = 'let score = 0;\nconsole.log(score);\nlet score = 1;';
    expect(heuristicSyntaxLocation("SyntaxError: Identifier 'score' has already been declared", code)).toEqual({ line: 3, column: 1 });
    expect(heuristicSyntaxLocation('SyntaxError: Cannot use import statement outside a module', '\nimport x from "y";')).toEqual({
      line: 2,
      column: 1,
    });
    expect(heuristicSyntaxLocation('SyntaxError: Unexpected token', 'x')).toBeNull();
  });
});
