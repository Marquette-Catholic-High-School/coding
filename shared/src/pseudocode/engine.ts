// STUB — replaced by the real lexer/parser/interpreter.
import type { PseudoDiagnostic, PseudoIO, PseudoRunOptions, PseudoRunResult, PseudocodeConfig } from './types';

/** Parses `source` and returns syntax diagnostics (empty array when the program is valid). Never throws. */
export function checkPseudocode(_source: string, _config: PseudocodeConfig): PseudoDiagnostic[] {
  return [];
}

/** Parses and runs `source` synchronously. Never throws; problems are reported in the result. */
export function runPseudocode(
  _source: string,
  _config: PseudocodeConfig,
  _io: PseudoIO,
  _options?: PseudoRunOptions,
): PseudoRunResult {
  return { ok: false, error: { severity: 'error', message: 'Pseudocode engine not implemented yet', line: 1, column: 1, phase: 'syntax' }, steps: 0 };
}
