// Plain-text result tables for the SQL runner, and locating statements in the student's SQL.

export type SqlCell = number | string | Uint8Array | null;

export function formatSqlCell(value: SqlCell): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) {
    return `X'${Array.from(value, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}'`;
  }
  // Keep each row on one line.
  return String(value).replace(/\r\n|\r|\n/g, '\\n').replace(/\t/g, '\\t');
}

/**
 * A result set as text: header row, separator row, then one row per result, columns separated by " | " and
 * padded to the widest value. The last column is not padded so lines have no trailing spaces.
 *
 *   name | age
 *   -----+----
 *   Rex  | 3
 */
export function formatSqlTable(columns: readonly string[], rows: readonly (readonly SqlCell[])[]): string {
  const header = columns.map((c) => formatSqlCell(c));
  const body = rows.map((row) => columns.map((_, i) => formatSqlCell(row[i] ?? null)));
  const widths = header.map((h, i) => Math.max(1, h.length, ...body.map((cells) => cells[i]!.length)));
  const last = widths.length - 1;
  const line = (cells: string[]) => cells.map((cell, i) => (i === last ? cell : cell.padEnd(widths[i]!))).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');
  return [line(header), separator, ...body.map(line)].join('\n');
}

/**
 * 1-based line of the first token at or after `offset` (skipping whitespace and SQL comments), i.e. the line a
 * statement starts on.
 */
export function statementLine(code: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, code.length));
  for (;;) {
    while (i < code.length && /\s/.test(code[i]!)) i++;
    if (code.startsWith('--', i)) {
      const end = code.indexOf('\n', i);
      if (end < 0) break;
      i = end + 1;
    } else if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 2;
    } else {
      break;
    }
  }
  i = Math.min(i, code.length);
  let line = 1;
  for (let j = 0; j < i; j++) if (code.charCodeAt(j) === 10) line++;
  return line;
}
