// Maps a language kind (and, for pseudocode, the teacher's configuration) to CodeMirror language support.

import { completeFromList } from '@codemirror/autocomplete';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { SQLite, sql } from '@codemirror/lang-sql';
import { StreamLanguage, indentUnit } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import type { Extension } from '@codemirror/state';
import type { LanguageKind } from '@codeclass/shared';
import type { PseudocodeConfig } from '@codeclass/shared/pseudocode';
import { pseudocodeSupport } from './pseudocodeMode';

const LUA_WORDS = [
  ...['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or']
    .concat(['repeat', 'return', 'then', 'true', 'until', 'while'])
    .map((label) => ({ label, type: 'keyword' })),
  ...['print', 'tostring', 'tonumber', 'type', 'pairs', 'ipairs', 'io.write', 'io.read', 'string.format', 'string.sub']
    .concat(['string.upper', 'string.lower', 'string.len', 'string.rep', 'table.insert', 'table.remove', 'table.concat'])
    .concat(['table.sort', 'math.floor', 'math.ceil', 'math.random', 'math.max', 'math.min', 'math.abs', 'math.sqrt'])
    .map((label) => ({ label, type: 'function' })),
];

function luaSupport(): Extension {
  const language = StreamLanguage.define(lua);
  return [language, language.data.of({ autocomplete: completeFromList(LUA_WORDS) })];
}

/** A half-edited config in the language builder must never break the editor: fall back to plain text. */
function safePseudocodeSupport(config: PseudocodeConfig): Extension {
  try {
    return pseudocodeSupport(config);
  } catch {
    return [];
  }
}

/** Language extensions for the editor's language compartment. */
export function languageSupport(kind: LanguageKind, pseudocode: PseudocodeConfig | null | undefined): Extension {
  switch (kind) {
    case 'javascript':
      return [javascript(), indentUnit.of('  ')];
    case 'typescript':
      return [javascript({ typescript: true }), indentUnit.of('  ')];
    case 'python':
      return [python(), indentUnit.of('    ')];
    case 'sql':
      return [sql({ dialect: SQLite, upperCaseKeywords: true }), indentUnit.of('  ')];
    case 'web':
      return [html(), indentUnit.of('  ')];
    case 'lua':
      return [luaSupport(), indentUnit.of('  ')];
    case 'pseudocode':
      return [pseudocode ? safePseudocodeSupport(pseudocode) : [], indentUnit.of('  ')];
    default:
      return [];
  }
}
