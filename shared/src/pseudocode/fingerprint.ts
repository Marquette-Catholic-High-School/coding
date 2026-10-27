// "Same program" check for pseudocode: two programs are the same when the engine's own parser turns them into the
// same syntax tree. Spacing, indentation, blank lines and comments never reach the tree, and neither do keyword
// spelling (END IF / ENDIF / end if), optional words (THEN, DO, CALL), `;` vs a new line, SET x TO v vs x ← v, ' vs "
// quotes or redundant brackets. Variable and function names, numbers, operators, statement order and block nesting
// are all kept, so two programs only compare equal when the engine would run them the same way. Text inside quotes
// counts as typed, except text that is printed as it is (an OUTPUT value, on its own or joined with + or &, and an
// INPUT prompt): that follows the assignment's compare mode, as the output comparison would.
import type { CompareMode } from '../types';
import type * as A from './ast';
import { getLanguage } from './language';
import { parseProgram } from './parser';
import type { PseudocodeConfig } from './types';

/** Whitespace for the compare modes: what `\s` matches plus the zero-width space, which `\s` leaves out. */
const SPACES = /[\s​]+/g;

/**
 * Printed literal text (inside quotes) as the compare mode sees it: exactly as typed for 'exact' and 'trim', without
 * whitespace for 'ignore-whitespace', and also in lowercase for 'ignore-case', so two literals compare equal when the
 * output they print would. Only for text that is printed as it is: anywhere else (a comparison, a dictionary key,
 * split()) spacing and capitals change what the program does. A literal that is only whitespace (or empty) is kept
 * as typed. With `escapes`, a backslash and the character after it are kept as typed (`\ ` without its space, or
 * `\N` in lowercase, would be another escape).
 */
export function normalizeLiteral(text: string, mode: CompareMode, escapes = false): string {
  if (mode === 'exact' || mode === 'trim' || text.replace(SPACES, '') === '') return text;
  const plain = (s: string) => {
    const t = s.replace(SPACES, '');
    return mode === 'ignore-case' ? t.toLowerCase() : t;
  };
  if (!escapes || !text.includes('\\')) return plain(text);
  return text.replace(/(\\[\s\S]?)|[^\\]+/g, (m, escape: string | undefined) => escape ?? plain(m));
}

// Source positions, the operator as typed (only used in messages) and the resolver's link to the called function
// (cyclic; the call is identified by its callee instead).
const DROP = new Set(['line', 'col', 'endCol', 'opPos', 'opText', 'fn']);

/** Whether `key` of node `o` is printed as it is, when `o` itself is (`printed`). */
function printedPart(o: Record<string, unknown>, key: string, printed: boolean): boolean {
  if (o.k === 'output') return key === 'values';
  if (o.k === 'inputStmt' || o.k === 'input') return key === 'prompt';
  // Text joined to printed text is printed too.
  return printed && o.k === 'bin' && (o.op === '+' || o.op === '&') && (key === 'left' || key === 'right');
}

function canon(node: unknown, mode: CompareMode, printed = false): unknown {
  if (Array.isArray(node)) return node.map((n) => canon(n, mode, printed));
  if (node === null || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  if (o.k === 'str') {
    const { value } = o as unknown as A.StringLit;
    return { k: 'str', value: printed ? normalizeLiteral(value, mode) : value };
  }
  // A call: a FUNCTION/PROCEDURE by its exact name, a built-in by its id (so LENGTH and length are the same call
  // when the language ignores case).
  if (o.k === 'call' && 'args' in o) {
    const call = o as unknown as A.CallExpr;
    return { k: 'call', callee: call.builtin ? `builtin:${call.builtin}` : `fn:${call.name}`, args: canon(call.args, mode) };
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o).sort()) {
    if (!DROP.has(key)) out[key] = canon(o[key], mode, printedPart(o, key, printed));
  }
  return out;
}

/**
 * A canonical form of the program's syntax tree (see the top of this file), or null when it doesn't parse.
 * FUNCTION/PROCEDURE definitions are sorted by name: they are hoisted, so where they appear doesn't matter.
 */
export function pseudocodeFingerprint(source: string, config: PseudocodeConfig, compareMode: CompareMode): string | null {
  let program: A.Program;
  try {
    program = parseProgram(source, getLanguage(config));
  } catch {
    return null;
  }
  const functions = [...program.functions.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => canon({ name: f.name, params: f.params, byRef: f.byRef, isProcedure: f.isProcedure, body: f.body }, compareMode));
  return JSON.stringify({ body: canon(program.body, compareMode), functions });
}

/**
 * Whether `code` is the same pseudocode program as `solution` (see the top of this file); null when either doesn't
 * parse. A blank solution matches nothing.
 */
export function samePseudocodeProgram(
  code: string,
  solution: string,
  config: PseudocodeConfig,
  compareMode: CompareMode,
): boolean | null {
  if (solution.trim() === '') return false;
  const a = pseudocodeFingerprint(code, config, compareMode);
  const b = pseudocodeFingerprint(solution, config, compareMode);
  if (a === null || b === null) return null;
  return a === b;
}
