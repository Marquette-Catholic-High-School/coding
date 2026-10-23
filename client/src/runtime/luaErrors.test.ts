import { describe, expect, it } from 'vitest';
import { cleanLuaTraceback, luaRunError, parseLuaMessage } from './lang/luaErrors';

const TRACE = [
  "main:3: attempt to index a nil value (field 'x')",
  'stack traceback:',
  "\tmain:3: in local 'f'",
  '\tmain:5: in main chunk',
  "\t[C]: in function 'xpcall'",
  '\t[string "..."]:203: in main chunk',
].join('\n');

describe('Lua errors', () => {
  it('splits the line number from the message', () => {
    expect(parseLuaMessage("main:3: '=' expected near 'x'")).toEqual({ message: "'=' expected near 'x'", line: 3 });
    expect(parseLuaMessage('(error object is a table value)')).toEqual({ message: '(error object is a table value)' });
  });

  it("keeps only the student's frames in the traceback", () => {
    expect(cleanLuaTraceback(TRACE)).toBe(
      ["main:3: attempt to index a nil value (field 'x')", 'stack traceback:', "\tmain:3: in local 'f'", '\tmain:5: in main chunk'].join('\n'),
    );
    expect(cleanLuaTraceback('no traceback here')).toBeUndefined();
  });

  it('builds a RunError, using the traceback when the message has no position', () => {
    expect(luaRunError("main:3: attempt to index a nil value (field 'x')", TRACE)).toMatchObject({
      message: "attempt to index a nil value (field 'x')",
      line: 3,
    });
    const tableError = luaRunError(
      '(error object is a table value)',
      "(error object is a table value)\nstack traceback:\n\t[C]: in function 'error'\n\tmain:7: in main chunk",
    );
    expect(tableError).toMatchObject({ message: '(error object is a table value)', line: 7 });
    expect(luaRunError("main:1: unexpected symbol near '='", '')).toEqual({ message: "unexpected symbol near '='", line: 1 });
  });
});
