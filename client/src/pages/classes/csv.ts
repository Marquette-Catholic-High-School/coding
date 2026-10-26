// Spreadsheet import for the Students tab: a small RFC 4180 CSV parser (no dependencies) and the logic that finds the
// email and name columns in whatever a teacher exports from Excel, Google Sheets or a school system — or pastes in.

export type CsvDelimiter = ',' | ';' | '\t';

/** Candidate delimiters; on a tie the earlier one wins (a tab or `;` is a deliberate separator, a comma may be text). */
const DELIMITERS: readonly CsvDelimiter[] = ['\t', ';', ','];

/** How many records `detectDelimiter` looks at. */
const SAMPLE_RECORDS = 20;

/** Request limits from `inviteEntrySchema`. */
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 80;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Decodes an uploaded file: UTF-16 when it starts with a UTF-16 byte-order mark (Excel's "Unicode Text"), else UTF-8,
 * falling back to Windows-1252 for files that aren't valid UTF-8 (older Excel "CSV" files with accented names).
 */
export function decodeText(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Per-record counts of each candidate delimiter outside quotes, for the first `limit` non-blank records. */
function delimiterCounts(text: string, limit: number): Record<CsvDelimiter, number>[] {
  const records: Record<CsvDelimiter, number>[] = [];
  let current: Record<CsvDelimiter, number> = { '\t': 0, ';': 0, ',': 0 };
  let blank = true;
  let inQuotes = false;
  for (let i = 0; i < text.length && records.length < limit; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes; // an escaped quote ("") toggles twice
      blank = false;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (!blank) records.push(current);
      current = { '\t': 0, ';': 0, ',': 0 };
      blank = true;
    } else {
      if (!inQuotes && (ch === '\t' || ch === ';' || ch === ',')) current[ch]++;
      if (ch.trim()) blank = false;
    }
  }
  if (!blank && records.length < limit) records.push(current);
  return records;
}

/**
 * Picks the delimiter: the one found on the most records, then the one with the same count on every record, then the
 * most frequent. Text without any delimiter (a list of emails, one per line) is read as comma-separated.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const records = delimiterCounts(stripBom(text), SAMPLE_RECORDS);
  let best: CsvDelimiter = ',';
  let bestScore: number[] = [0, 0, 0];
  for (const d of DELIMITERS) {
    const perRecord = records.map((r) => r[d]);
    const withDelimiter = perRecord.filter((n) => n > 0).length;
    if (withDelimiter === 0) continue;
    const consistent = perRecord.every((n) => n === perRecord[0]) ? 1 : 0;
    const total = perRecord.reduce((sum, n) => sum + n, 0);
    const score = [withDelimiter, consistent, total];
    const better = score.findIndex((v, i) => v !== bestScore[i]);
    if (better !== -1 && score[better]! > bestScore[better]!) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Parses CSV text into rows of fields (RFC 4180): fields in double quotes may contain the delimiter, line breaks and
 * escaped quotes (`""`); records end with CRLF, LF or CR; a leading UTF-8 BOM is ignored and empty lines are skipped.
 * It is lenient like spreadsheet apps: spaces before an opening quote are dropped, text after a closing quote is kept,
 * a quote inside an unquoted field is literal, and an unterminated quoted field runs to the end of the text.
 * The delimiter is detected when not given.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
    quoted = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"' && !quoted && field.trim() === '') {
      field = '';
      inQuotes = true;
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || quoted || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Rows → students
// ---------------------------------------------------------------------------

export interface StudentEntry {
  /** As found (trimmed); may be blank or not an email — the server reports those rows as `invalid`. */
  email: string;
  /** '' when the list has no names. */
  name: string;
}

export interface StudentList {
  entries: StudentEntry[];
  /** Whether a header row was found (then the column names below are its labels). */
  hasHeader: boolean;
  /** Header label of the email column, or null without a header. */
  emailColumn: string | null;
  /** Header labels the names came from: one full-name column, or first + last name columns. */
  nameColumns: string[];
}

const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

/** The email in a cell: a bare address, `mailto:address`, or `Display Name <address>`; null when there is none. */
export function extractEmail(cell: string): { email: string; displayName: string } | null {
  const value = cell.trim().replace(/^mailto:/i, '');
  const angle = /^(.*?)<\s*([^<>\s]+)\s*>$/.exec(value);
  if (angle && EMAIL_PATTERN.test(angle[2]!)) {
    return { email: angle[2]!, displayName: cleanName(angle[1]!.replace(/^\s*"(.*)"\s*$/, '$1')) };
  }
  return EMAIL_PATTERN.test(value) ? { email: value, displayName: '' } : null;
}

function isEmailCell(cell: string): boolean {
  return extractEmail(cell) !== null;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** "FirstName", "first_name", "First Name" → "first name". */
function normalizeHeader(label: string): string {
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(label: string): string[] {
  const normalized = normalizeHeader(label);
  return normalized ? normalized.split(' ') : [];
}

function isEmailHeader(label: string): boolean {
  return /(^| )(e mail|\w*email\w*|mail)( |$)/.test(normalizeHeader(label));
}

/** Email columns that are probably not the student's own address. */
const OTHER_PERSON = new Set(['parent', 'parents', 'guardian', 'guardians', 'mother', 'father', 'carer', 'teacher', 'emergency', 'contact', 'alternate', 'alternative', 'secondary', 'personal', 'home']);
const STUDENT_WORDS = new Set(['student', 'pupil', 'learner', 'school']);

/** Words that may surround a name word in a header ("Student first name", "Legal last name"). */
const NAME_QUALIFIERS = new Set(['name', 'names', 'student', 'students', 'pupil', 'pupils', 'learner', 'legal', 'preferred', 's', 'of', 'the']);

/** A header made of `core` words plus qualifiers, with at least one core word. */
function headerOf(label: string, core: ReadonlySet<string>): boolean {
  const words = tokens(label);
  return words.some((w) => core.has(w)) && words.every((w) => core.has(w) || NAME_QUALIFIERS.has(w));
}

const FULL_NAME_WORDS = new Set([
  'name', 'names', 'full', 'fullname', 'display', 'displayname', 'studentname', 'student', 'pupil', 'learner',
  'lastfirst', 'firstlast', // PowerSchool-style "LastFirst"
  'what', 'is', 'your', // Google Forms "What is your name?"
]);
const FIRST_NAME_WORDS = new Set(['first', 'firstname', 'firstnames', 'given', 'givenname', 'givennames', 'forename', 'forenames', 'vorname', 'prenom', 'nombre']);
const LAST_NAME_WORDS = new Set(['last', 'lastname', 'lastnames', 'surname', 'surnames', 'family', 'familyname', 'nachname', 'nom', 'apellido', 'apellidos']);

/** "Name", "Full name", … and PowerSchool-style "LastFirst" / "Last, First" (one column holding the whole name). */
const isFullNameHeader = (label: string) =>
  headerOf(label, FULL_NAME_WORDS) || /^(last\s*,?\s*first|first\s*last)(\s*name)?$/i.test(label.trim());
const isFirstNameHeader = (label: string) => headerOf(label, FIRST_NAME_WORDS);
const isLastNameHeader = (label: string) => headerOf(label, LAST_NAME_WORDS);

/** Words that mark a row as a header row (it has no email addresses in it either). */
const HEADER_WORDS = new Set([
  ...FULL_NAME_WORDS,
  ...FIRST_NAME_WORDS,
  ...LAST_NAME_WORDS,
  'students',
  'pupils',
  'email',
  'mail',
  'user',
  'username',
  'login',
  'id',
  'class',
  'grade',
  'year',
  'form',
  'period',
  'section',
]);

/**
 * A header row has no addresses, and either names an email column or has at least two cells that are header words
 * (so a lone name such as "Grace Form" in a list without a header isn't mistaken for one).
 */
function looksLikeHeader(row: string[]): boolean {
  if (row.some(isEmailCell)) return false;
  if (row.some(isEmailHeader)) return true;
  return row.filter((cell) => tokens(cell).some((w) => HEADER_WORDS.has(w))).length >= 2;
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !cell.trim());
}

function nonBlankCount(row: string[]): number {
  return row.filter((cell) => cell.trim()).length;
}

/** Column with the most email addresses (leftmost on a tie), or -1 when there are none. `skip` columns don't count. */
function mostEmailsColumn(rows: string[][], skip: (col: number) => boolean = () => false): number {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best = -1;
  let bestCount = 0;
  for (let col = 0; col < width; col++) {
    if (skip(col)) continue;
    const count = rows.filter((r) => isEmailCell(r[col] ?? '')).length;
    if (count > bestCount) {
      best = col;
      bestCount = count;
    }
  }
  return best;
}

/** The header's email column: the student's own address before a parent's, one with addresses before an empty one. */
function emailHeaderColumn(header: string[], rows: string[][]): number {
  let best = -1;
  let bestScore = -Infinity;
  header.forEach((label, col) => {
    if (!isEmailHeader(label)) return;
    const words = tokens(label);
    const score =
      (words.some((w) => OTHER_PERSON.has(w)) ? -4 : 0) +
      (rows.some((r) => isEmailCell(r[col] ?? '')) ? 2 : 0) +
      (words.some((w) => STUDENT_WORDS.has(w)) ? 1 : 0);
    if (score > bestScore) {
      best = col;
      bestScore = score;
    }
  });
  return best;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function entry(email: string, name: string): StudentEntry {
  return { email: truncate(email.trim(), MAX_EMAIL_LENGTH), name: truncate(cleanName(name), MAX_NAME_LENGTH).trim() };
}

/**
 * Turns parsed rows into students. A header row is recognised by its labels (it may follow title lines); the email
 * column is the one labelled "Email" / "E-mail" / "Mail" (a student's address before a parent's), else the column with
 * the most email addresses. Names come from a "Name" / "Full name" / "Student" column, else "First" + "Last" ("Given",
 * "Surname", "Family name") columns joined, else the display name in `Name <email>` cells. Without a header, each
 * row's email is found by value and its name is the first other cell with text, so mixed pasted lists work too, and a
 * line of several addresses ("a@x.org; b@x.org") counts as several students. Blank rows are dropped; rows without a
 * usable email are kept (with the cell's text, maybe blank) so the preview can say why they were skipped.
 */
export function rowsToStudentList(input: string[][]): StudentList {
  const rows = input.map((r) => r.map((cell) => cell.trim())).filter((r) => !isBlankRow(r));
  const none: StudentList = { entries: [], hasHeader: false, emailColumn: null, nameColumns: [] };
  const firstEmailRow = rows.findIndex((r) => r.some(isEmailCell));
  if (firstEmailRow === -1) return none;

  // The header is the last header-looking row before the first address (earlier rows are titles), or else the row
  // right before it when that has several columns.
  let headerIndex = -1;
  for (let i = firstEmailRow - 1; i >= 0; i--) {
    if (looksLikeHeader(rows[i]!)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1 && firstEmailRow > 0 && nonBlankCount(rows[firstEmailRow - 1]!) >= 2) headerIndex = firstEmailRow - 1;
  if (headerIndex === -1) return { ...none, entries: headerlessEntries(rows) };

  const header = rows[headerIndex]!;
  const data = rows.slice(headerIndex + 1);
  let emailCol = emailHeaderColumn(header, data);
  const otherPerson = (col: number) => tokens(header[col] ?? '').some((w) => OTHER_PERSON.has(w));
  if (emailCol === -1 || otherPerson(emailCol) || !data.some((r) => isEmailCell(r[emailCol] ?? ''))) {
    // A parent's / alternate address column only counts when no other column holds addresses (e.g. a "Login" or
    // "User principal name" column with the students' own addresses).
    const byValue = mostEmailsColumn(data, (col) => otherPerson(col));
    if (byValue !== -1) emailCol = byValue;
    else if (emailCol === -1) emailCol = mostEmailsColumn(data);
  }
  if (emailCol === -1) return { ...none, hasHeader: true };

  const others = header.map((label, col) => ({ label, col })).filter(({ col }) => col !== emailCol);
  const full = others.find(({ label }) => isFullNameHeader(label));
  const first = others.find(({ label }) => isFirstNameHeader(label));
  const last = others.find(({ label }) => isLastNameHeader(label));
  const partCols = [first, last].filter((c) => c !== undefined);
  const nameCols = full ? [full] : partCols;

  const entries = data.flatMap((row) => {
    const cell = row[emailCol] ?? '';
    const found = extractEmail(cell);
    const joined = (cols: typeof partCols) => cleanName(cols.map(({ col }) => row[col] ?? '').join(' '));
    // A blank full-name cell (e.g. an unused "Preferred name" column) falls back to First + Last.
    const name = joined(nameCols) || (full ? joined(partCols) : '') || (found?.displayName ?? '');
    if (!cell && !name) return [];
    return [entry(found?.email ?? cell, name)];
  });
  return { entries, hasHeader: true, emailColumn: header[emailCol] || null, nameColumns: nameCols.map(({ label }) => label) };
}

function headerlessEntries(rows: string[][]): StudentEntry[] {
  // A pasted line of addresses ("a@x.org, Sam <s@x.org>") is several students, when every cell is an address.
  const allAddresses = rows.every((r) => r.every((cell) => !cell || isEmailCell(cell)));
  if (allAddresses && rows.some((r) => nonBlankCount(r) > 1)) {
    return rows.flatMap((r) =>
      r.filter((cell) => cell).map((cell) => {
        const found = extractEmail(cell)!;
        return entry(found.email, found.displayName);
      }),
    );
  }

  const emailCol = mostEmailsColumn(rows);
  return rows.map((row) => {
    const col = isEmailCell(row[emailCol] ?? '') ? emailCol : row.findIndex(isEmailCell);
    const at = col === -1 ? emailCol : col;
    const found = extractEmail(row[at] ?? '');
    const nameCell = row.find((cell, i) => i !== at && cell && !isEmailCell(cell) && !/^[\d\s.,#/-]+$/.test(cell));
    return entry(found?.email ?? row[at] ?? '', nameCell ?? found?.displayName ?? '');
  });
}

/** Parses a CSV/TSV file's text or a pasted list into students (see `rowsToStudentList`). */
export function parseStudentList(text: string): StudentList {
  return rowsToStudentList(parseCsv(text));
}
