import { describe, expect, it } from 'vitest';
import { formatSqlCell, formatSqlTable, statementLine } from './lang/sqlTable';

describe('formatSqlTable', () => {
  it('pads columns, separates the header and leaves no trailing spaces', () => {
    expect(
      formatSqlTable(
        ['name', 'age'],
        [
          ['Rex', 3],
          ['Tom', 12],
        ],
      ),
    ).toBe(['name | age', '-----+----', 'Rex  | 3', 'Tom  | 12'].join('\n'));
  });

  it('shows NULL, blobs and real numbers', () => {
    expect(formatSqlTable(['a', 'b', 'c'], [[null, new Uint8Array([1, 171]), 2.5]])).toBe(
      ['a    | b       | c', '-----+---------+----', "NULL | X'01AB' | 2.5"].join('\n'),
    );
  });

  it('prints just the header for a query with no rows', () => {
    expect(formatSqlTable(['id'], [])).toBe('id\n--');
  });

  it('keeps multi-line values on one row', () => {
    expect(formatSqlCell('a\nb\tc')).toBe('a\\nb\\tc');
  });

  it('gives empty column names at least one character of width', () => {
    expect(formatSqlTable([''], [['']])).toBe('\n-\n');
  });
});

describe('statementLine', () => {
  const code = '-- pets\nCREATE TABLE pets (name TEXT);\n\n  /* note */\n  SELEC 1;';

  it('skips whitespace and comments before the statement', () => {
    expect(statementLine(code, 0)).toBe(2);
    expect(statementLine(code, code.indexOf(';') + 1)).toBe(5);
  });

  it('clamps offsets to the code', () => {
    expect(statementLine('SELECT 1;', -5)).toBe(1);
    expect(statementLine('SELECT 1;\n', 100)).toBe(2);
  });
});
