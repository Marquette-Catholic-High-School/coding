// SQL runner (SQLite via sql.js). Each run gets a fresh in-memory database; statements run one by one so results
// print as they come and an error can point at the statement's line. Statements that return columns print a
// text table; others print nothing.

import sqlJsSource from 'sql.js/dist/sql-wasm-browser.js?raw';
import sqlWasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { Database, InitSqlJsStatic, SqlJsStatic, Statement } from 'sql.js';
import { evaluateCommonJs } from './commonjs';
import { describeError, failure, OK, type LangResult, type LanguageRunner } from './io';
import { formatSqlTable, statementLine, type SqlCell } from './sqlTable';

let SQL: SqlJsStatic | null = null;
let loading: Promise<void> | null = null;

async function loadRuntime(): Promise<void> {
  const initSqlJs = evaluateCommonJs<InitSqlJsStatic>(sqlJsSource, 'sql-wasm.js');
  try {
    SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  } catch (err) {
    throw new Error("Couldn't load SQLite. Check your internet connection and try again.", { cause: err });
  }
}

function sqlMessage(err: unknown): string {
  return describeError(err).replace(/^Error:\s*/, '');
}

export const sqlRunner: LanguageRunner = {
  loaded: () => SQL !== null,
  load: () => {
    loading ??= loadRuntime().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  },
  run: async (code, io): Promise<LangResult> => {
    if (!SQL) await sqlRunner.load();
    let db: Database;
    try {
      db = new SQL!.Database();
    } catch (err) {
      return failure({ message: `SQLite stopped unexpectedly: ${describeError(err)}` }, true);
    }
    let printedTable = false;
    try {
      const statements = db.iterateStatements(code);
      for (;;) {
        const startOffset = code.length - statements.getRemainingSQL().length;
        let statement: Statement;
        try {
          const next = statements.next();
          if (next.done) break;
          statement = next.value;
        } catch (err) {
          return failure({ message: sqlMessage(err), line: statementLine(code, startOffset) });
        }
        try {
          const columns = statement.getColumnNames();
          const rows: SqlCell[][] = [];
          while (statement.step()) rows.push(statement.get() as SqlCell[]);
          if (columns.length > 0) {
            io.write('stdout', `${printedTable ? '\n' : ''}${formatSqlTable(columns, rows)}\n`);
            printedTable = true;
          }
        } catch (err) {
          return failure({ message: sqlMessage(err), line: statementLine(code, startOffset) });
        } finally {
          statement.free();
        }
      }
      return OK;
    } finally {
      db.close();
    }
  },
};
