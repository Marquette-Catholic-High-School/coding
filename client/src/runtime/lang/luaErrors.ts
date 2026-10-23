// Lua error messages and tracebacks. Student code is loaded with the chunk name "=main", so positions look like
// `main:4: attempt to perform arithmetic on a nil value (global 'y')`.

import type { RunError } from '../types';

const POSITION = /^main:(\d+): ([\s\S]*)$/;
const FRAME = /^\s*main:(\d+):/;

/** Splits "main:N: message" into a line number and the message (other messages are kept as they are). */
export function parseLuaMessage(raw: string): { message: string; line?: number } {
  const match = POSITION.exec(raw);
  return match ? { message: match[2]!, line: Number(match[1]) } : { message: raw };
}

/** Keeps the message and the student's own frames of a `debug.traceback`, dropping the runner's frames. */
export function cleanLuaTraceback(traceback: string): string | undefined {
  const marker = traceback.indexOf('\nstack traceback:');
  if (marker < 0) return undefined;
  const frames = traceback
    .slice(marker + '\nstack traceback:'.length)
    .split('\n')
    .filter((line) => FRAME.test(line))
    .map((line) => `\t${line.trim()}`);
  if (frames.length === 0) return undefined;
  return `${traceback.slice(0, marker)}\nstack traceback:\n${frames.join('\n')}`;
}

export function luaRunError(rawMessage: string, traceback: string): RunError {
  const { message, line } = parseLuaMessage(rawMessage);
  const error: RunError = { message: message || 'Lua reported an error.' };
  const frameLine = FRAME.exec(traceback.split('\nstack traceback:')[1]?.split('\n').find((l) => FRAME.test(l)) ?? '');
  const errorLine = line ?? (frameLine ? Number(frameLine[1]) : undefined);
  if (errorLine !== undefined) error.line = errorLine;
  const details = cleanLuaTraceback(traceback);
  if (details) error.details = details;
  return error;
}
