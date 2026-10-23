// Mapping JavaScript errors back to the student's source. Student code runs inside `new AsyncFunction(…)` with a
// `//# sourceURL=main.js` comment, so stack frames look like `at greet (main.js:5:11)` (V8) or
// `greet@main.js:5:11` (Firefox/Safari); the wrapper adds a fixed number of lines before the student's first line.

export const SOURCE_NAME = 'main.js';

export interface StackFrame {
  /** Function name, or null for top-level code. */
  fn: string | null;
  line: number;
  column: number;
}

export interface SourceLocation {
  line: number;
  column?: number;
}

const V8_FRAME = /^\s*at (?:async )?(?:(.+?) \()?.*?(?:main\.js|<anonymous>):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@.*?(?:main\.js|> Function|> eval):(\d+):(\d+)\s*$/;
const ANONYMOUS_NAMES = new Set(['', 'anonymous', 'eval', 'async anonymous', 'Object.anonymous', 'global code']);

/**
 * Frames of the student's code in a stack trace, top (innermost) first, with lines shifted by `offset` (the
 * wrapper's extra lines). Frames outside 1..lineCount belong to the runner and are dropped.
 */
export function parseStackFrames(stack: string, offset: number, lineCount: number): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const match = V8_FRAME.exec(raw) ?? GECKO_FRAME.exec(raw);
    if (!match) continue;
    const line = Number(match[2]) - offset;
    if (line < 1 || line > lineCount) continue;
    const name = (match[1] ?? '').trim();
    frames.push({ fn: ANONYMOUS_NAMES.has(name) ? null : name, line, column: Number(match[3]) });
  }
  return frames;
}

export function formatStackFrame(frame: StackFrame): string {
  const location = `${SOURCE_NAME}:${frame.line}:${frame.column}`;
  return frame.fn ? `    at ${frame.fn} (${location})` : `    at ${location}`;
}

/** Location from the `(line:column)` suffix sucrase puts on its parse errors (`loc` holds the same numbers). */
export function sucraseErrorLocation(err: unknown): SourceLocation | null {
  if (!err || typeof err !== 'object') return null;
  const loc = (err as { loc?: { line?: unknown; column?: unknown } }).loc;
  if (loc && typeof loc.line === 'number') {
    return { line: loc.line, ...(typeof loc.column === 'number' ? { column: loc.column } : {}) };
  }
  const message = (err as { message?: unknown }).message;
  const match = typeof message === 'string' ? /\((\d+):(\d+)\)\s*$/.exec(message) : null;
  return match ? { line: Number(match[1]), column: Number(match[2]) } : null;
}

/** Sucrase's message without its "(line:column)" suffix. */
export function sucraseErrorMessage(err: unknown): string {
  const message = err && typeof err === 'object' ? (err as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message.replace(/\s*\(\d+:\d+\)\s*$/, '') : String(err);
}

/** Firefox exposes the position of a SyntaxError thrown by the Function constructor. */
export function engineSyntaxLocation(err: unknown, offset: number, lineCount: number): SourceLocation | null {
  if (!err || typeof err !== 'object') return null;
  const { lineNumber, columnNumber } = err as { lineNumber?: unknown; columnNumber?: unknown };
  if (typeof lineNumber !== 'number') return null;
  const line = lineNumber - offset;
  if (line < 1 || line > lineCount) return null;
  return { line, ...(typeof columnNumber === 'number' ? { column: columnNumber + 1 } : {}) };
}

/**
 * Best-effort location for "early errors" that a parser accepts but the engine rejects without saying where
 * (a variable declared twice, import/export in a script).
 */
export function heuristicSyntaxLocation(message: string, code: string): SourceLocation | null {
  const lines = code.split('\n');
  const findLine = (pattern: RegExp, occurrence: number): SourceLocation | null => {
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = pattern.exec(lines[i]!);
      if (match && ++seen === occurrence) return { line: i + 1, column: match.index + 1 };
    }
    return null;
  };
  const redeclared = /Identifier '(.+?)' has already been declared|redeclaration of (?:let|const|class) (\S+)/.exec(message);
  if (redeclared) {
    const name = (redeclared[1] ?? redeclared[2] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = new RegExp(`\\b(?:let|const|var|class|function)\\s+${name}\\b`);
    return findLine(declaration, 2) ?? findLine(declaration, 1);
  }
  if (/\bimport\b/i.test(message)) return findLine(/^\s*import\b/, 1);
  if (/\bexport\b/i.test(message)) return findLine(/^\s*export\b/, 1);
  return null;
}
