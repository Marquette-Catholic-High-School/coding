import { describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, extractEmail, parseCsv, parseStudentList, rowsToStudentList } from './csv';

describe('parseCsv', () => {
  it('splits simple comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps delimiters, line breaks and escaped quotes inside quoted fields', () => {
    expect(parseCsv('name,note\n"Smith, Sam","He said ""hi""\nthen left"\n')).toEqual([
      ['name', 'note'],
      ['Smith, Sam', 'He said "hi"\nthen left'],
    ]);
  });

  it('handles CRLF, LF and CR line endings, with or without a final newline', () => {
    const expected = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual(expected);
    expect(parseCsv('a,b\nc,d')).toEqual(expected);
    expect(parseCsv('a,b\rc,d\r')).toEqual(expected);
    expect(parseCsv('"a","b"\r\n"c","d"')).toEqual(expected);
  });

  it('ignores a UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿Email\nsam@school.org')).toEqual([['Email'], ['sam@school.org']]);
  });

  it('skips empty lines but keeps empty fields', () => {
    expect(parseCsv('a,,c\n\n\r\n,b,\n')).toEqual([
      ['a', '', 'c'],
      ['', 'b', ''],
    ]);
  });

  it('keeps quoted empty fields and a trailing empty field', () => {
    expect(parseCsv('"",x,\n')).toEqual([['', 'x', '']]);
  });

  it('is lenient like spreadsheet apps', () => {
    // Space before an opening quote, text after a closing quote, a quote inside an unquoted field.
    expect(parseCsv('a, "b, c" ,Sam "Sammy" Smith')).toEqual([['a', 'b, c ', 'Sam "Sammy" Smith']]);
    expect(parseCsv('"Sam Smith" <sam@school.org>', ',')).toEqual([['Sam Smith <sam@school.org>']]);
    // An unterminated quote runs to the end.
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']]);
  });

  it('uses the given delimiter', () => {
    expect(parseCsv('a;b,c\td', ';')).toEqual([['a', 'b,c\td']]);
    expect(parseCsv('a;b,c\td', '\t')).toEqual([['a;b,c', 'd']]);
  });

  it('returns no rows for empty or blank-line-only text', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\r\n\n')).toEqual([]);
  });
});

describe('detectDelimiter', () => {
  it('detects commas, semicolons and tabs', () => {
    expect(detectDelimiter('Name,Email\nSam,sam@x.org')).toBe(',');
    expect(detectDelimiter('Name;Email\nSam;sam@x.org')).toBe(';');
    expect(detectDelimiter('Name\tEmail\nSam\tsam@x.org')).toBe('\t');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('Name;Email\n"Smith, Sam";sam@x.org\n"Lee, Jo";jo@x.org')).toBe(';');
    expect(detectDelimiter('Name,Email\n"Smith; Sam",sam@x.org')).toBe(',');
  });

  it('prefers the delimiter found on every line', () => {
    // Excel in a semicolon locale doesn't quote commas in names.
    expect(detectDelimiter('Name;Email\nSmith, Sam;sam@x.org\nLee, Jo;jo@x.org')).toBe(';');
  });

  it('prefers a tab over a comma in text pasted from a spreadsheet', () => {
    expect(detectDelimiter('Smith, Sam\tsam@x.org\nLee, Jo\tjo@x.org')).toBe('\t');
  });

  it('falls back to a comma when there is no delimiter', () => {
    expect(detectDelimiter('sam@x.org\njo@x.org')).toBe(',');
    expect(detectDelimiter('')).toBe(',');
  });
});

describe('decodeText', () => {
  it('decodes UTF-8 and drops the BOM', () => {
    const bytes = new TextEncoder().encode('﻿Name;Email\nZoë;zoe@x.org');
    expect(decodeText(bytes)).toBe('Name;Email\nZoë;zoe@x.org');
    expect(decodeText(bytes.buffer)).toBe('Name;Email\nZoë;zoe@x.org');
  });

  it('falls back to Windows-1252 for files that are not UTF-8', () => {
    // "Zoë" saved by older Excel versions: ë is the single byte 0xEB.
    const bytes = new Uint8Array([0x5a, 0x6f, 0xeb, 0x3b, 0x7a, 0x40, 0x78, 0x2e, 0x6f, 0x72, 0x67]);
    expect(decodeText(bytes)).toBe('Zoë;z@x.org');
  });

  it('decodes UTF-16 with a byte-order mark (Excel "Unicode Text")', () => {
    const text = 'Name\tEmail\nZoë\tzoe@x.org';
    const le = new Uint8Array(2 + text.length * 2);
    le[0] = 0xff;
    le[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      le[2 + i * 2] = text.charCodeAt(i) & 0xff;
      le[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    expect(decodeText(le)).toBe(text);
  });
});

describe('extractEmail', () => {
  it('accepts bare addresses, mailto: links and "Name <address>"', () => {
    expect(extractEmail(' sam@school.org ')).toEqual({ email: 'sam@school.org', displayName: '' });
    expect(extractEmail('mailto:Sam@School.org')).toEqual({ email: 'Sam@School.org', displayName: '' });
    expect(extractEmail('Sam Smith <sam@school.org>')).toEqual({ email: 'sam@school.org', displayName: 'Sam Smith' });
    expect(extractEmail('"Smith, Sam" <sam@school.org>')).toEqual({ email: 'sam@school.org', displayName: 'Smith, Sam' });
    expect(extractEmail('<sam@school.org>')).toEqual({ email: 'sam@school.org', displayName: '' });
  });

  it('rejects things that are not addresses', () => {
    for (const value of ['', 'Sam Smith', 'sam@', '@school.org', 'sam@school', 'sam smith@school.org', 'a@b@c.org', 'Sam <not an email>']) {
      expect(extractEmail(value)).toBeNull();
    }
  });
});

describe('parseStudentList', () => {
  it('reads an Excel export with semicolons, a BOM, CRLF and trailing empty rows', () => {
    const text = '﻿First name;Last name;E-mail address;Class\r\nSam;Smith;sam@school.org;7B\r\nJo;Lee;jo@school.org;7B\r\n;;;\r\n;;;\r\n';
    expect(parseStudentList(text)).toEqual({
      entries: [
        { email: 'sam@school.org', name: 'Sam Smith' },
        { email: 'jo@school.org', name: 'Jo Lee' },
      ],
      hasHeader: true,
      emailColumn: 'E-mail address',
      nameColumns: ['First name', 'Last name'],
    });
  });

  it('reads quoted commas in a comma-separated export', () => {
    const text = 'Name,Email\n"Smith, Sam",sam@school.org\n"O\'Neil, Jo ""JJ""",jo@school.org\n';
    expect(parseStudentList(text).entries).toEqual([
      { email: 'sam@school.org', name: 'Smith, Sam' },
      { email: 'jo@school.org', name: 'O\'Neil, Jo "JJ"' },
    ]);
  });

  it('finds the columns whatever their order, and joins first + last name in that order', () => {
    const text = 'Surname\tStudent ID\tEmail\tGiven name\nSmith\t1001\tsam@school.org\tSam\n';
    const list = parseStudentList(text);
    expect(list.entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
    expect(list.nameColumns).toEqual(['Given name', 'Surname']);

    expect(parseStudentList('email,Student Name\nsam@school.org,Sam Smith').entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
    expect(parseStudentList('FirstName,LastName,EmailAddress\nSam,Smith,sam@school.org').entries).toEqual([
      { email: 'sam@school.org', name: 'Sam Smith' },
    ]);
  });

  it('prefers a full-name column over first/last columns and ignores username / last-login columns', () => {
    const text = 'Username,Full name,First name,Last name,Last login,Mail\nssmith,Samuel Smith,Sam,Smith,2024-01-01,sam@school.org';
    const list = parseStudentList(text);
    expect(list.entries).toEqual([{ email: 'sam@school.org', name: 'Samuel Smith' }]);
    expect(list.emailColumn).toBe('Mail');
    expect(list.nameColumns).toEqual(['Full name']);

    expect(parseStudentList('Username,Email\nssmith,sam@school.org').entries).toEqual([{ email: 'sam@school.org', name: '' }]);
  });

  it("prefers the student's own email column over a parent's", () => {
    const text = 'Name,Parent email,Student email\nSam,mum@home.org,sam@school.org';
    const list = parseStudentList(text);
    expect(list.entries).toEqual([{ email: 'sam@school.org', name: 'Sam' }]);
    expect(list.emailColumn).toBe('Student email');
  });

  it('uses the column with addresses when the header has no email label', () => {
    const list = parseStudentList('Pupil;Contact\nSam Smith;sam@school.org\nJo Lee;jo@school.org');
    expect(list.entries).toEqual([
      { email: 'sam@school.org', name: 'Sam Smith' },
      { email: 'jo@school.org', name: 'Jo Lee' },
    ]);
    expect(list.emailColumn).toBe('Contact');
  });

  it('treats the row before the first address as the header even without known labels', () => {
    expect(parseStudentList('Nom,Courriel\nSam,sam@school.org').entries).toEqual([{ email: 'sam@school.org', name: 'Sam' }]);
    expect(parseStudentList('Kennung,Adresse\nx1,sam@school.org').entries).toEqual([{ email: 'sam@school.org', name: '' }]);
  });

  it('skips title lines above the header', () => {
    const text = 'Class list — Period 3,,\nExported 2024-09-01,,\n,,\nStudent,Email,Year\nSam Smith,sam@school.org,7';
    expect(parseStudentList(text).entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
  });

  it('keeps rows without a usable email so the preview can explain them', () => {
    const text = 'Name,Email\nSam Smith,sam@school.org\nJo Lee,\nAl Kay,al(at)school.org\n,\n';
    expect(parseStudentList(text).entries).toEqual([
      { email: 'sam@school.org', name: 'Sam Smith' },
      { email: '', name: 'Jo Lee' },
      { email: 'al(at)school.org', name: 'Al Kay' },
    ]);
  });

  it('uses the display name of "Name <address>" cells when there is no name column', () => {
    expect(parseStudentList('Email\nSam Smith <sam@school.org>').entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
  });

  it('reads a pasted list with one address per line, ignoring blank lines and spaces', () => {
    expect(parseStudentList('  sam@school.org \n\n jo@school.org\r\n\r\nal@school.org\n').entries).toEqual([
      { email: 'sam@school.org', name: '' },
      { email: 'jo@school.org', name: '' },
      { email: 'al@school.org', name: '' },
    ]);
  });

  it('reads pasted "Name <address>" and "name, address" lines, even mixed', () => {
    const text = 'Sam Smith <sam@school.org>\nJo Lee, jo@school.org\nal@school.org\nkay@school.org, Kay Ali';
    const list = parseStudentList(text);
    expect(list.hasHeader).toBe(false);
    expect(list.entries).toEqual([
      { email: 'sam@school.org', name: 'Sam Smith' },
      { email: 'jo@school.org', name: 'Jo Lee' },
      { email: 'al@school.org', name: '' },
      { email: 'kay@school.org', name: 'Kay Ali' },
    ]);
  });

  it('reads rows pasted from a spreadsheet without a header (tab-separated)', () => {
    expect(parseStudentList('Smith, Sam\tsam@school.org\t7B\nLee, Jo\tjo@school.org\t7B').entries).toEqual([
      { email: 'sam@school.org', name: 'Smith, Sam' },
      { email: 'jo@school.org', name: 'Lee, Jo' },
    ]);
  });

  it('skips ID-like cells when guessing a name without a header', () => {
    expect(parseStudentList('1001,sam@school.org,Sam Smith').entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
  });

  it('splits a line of several addresses into several students', () => {
    expect(parseStudentList('sam@school.org; Jo Lee <jo@school.org>;"Kay, Al" <al@school.org>').entries).toEqual([
      { email: 'sam@school.org', name: '' },
      { email: 'jo@school.org', name: 'Jo Lee' },
      { email: 'al@school.org', name: 'Kay, Al' },
    ]);
    expect(parseStudentList('sam@school.org, jo@school.org\nal@school.org').entries.map((e) => e.email)).toEqual([
      'sam@school.org',
      'jo@school.org',
      'al@school.org',
    ]);
  });

  it('keeps a pasted line that is not an address', () => {
    expect(parseStudentList('sam@school.org\nSam Smith\n').entries).toEqual([
      { email: 'sam@school.org', name: '' },
      { email: 'Sam Smith', name: '' },
    ]);
  });

  it('keeps duplicates for the server to report', () => {
    expect(parseStudentList('sam@school.org\nSAM@school.org').entries).toHaveLength(2);
  });

  it('finds nothing in text without addresses', () => {
    for (const text of ['', '\n\n', 'Name,Email\n', 'Sam Smith\nJo Lee', 'Name;Email\nSam;\nJo;']) {
      expect(parseStudentList(text)).toEqual({ entries: [], hasHeader: false, emailColumn: null, nameColumns: [] });
    }
  });

  it('collapses whitespace in names and trims long values to the request limits', () => {
    const longName = 'A'.repeat(100);
    const longEmail = `${'a'.repeat(300)}@school.org`;
    const [first, second] = rowsToStudentList([
      ['Name', 'Email'],
      ['  Sam    Smith ', 'sam@school.org'],
      [longName, longEmail],
    ]).entries;
    expect(first).toEqual({ email: 'sam@school.org', name: 'Sam Smith' });
    expect(second!.name).toHaveLength(80);
    expect(second!.email).toHaveLength(254);
  });
});

describe('choosing columns in real exports', () => {
  it("prefers the column with the students' own addresses over a parent's or alternate address", () => {
    const text = 'Name,Login,Parent Email\nSam Smith,sam@school.org,mom@home.org\nJo Lee,jo@school.org,dad@home.org';
    expect(parseStudentList(text).entries.map((e) => e.email)).toEqual(['sam@school.org', 'jo@school.org']);
    const ms = 'Display name,User principal name,Alternate email addresses\nSam Smith,sam@school.org,sam@gmail.com';
    expect(parseStudentList(ms).entries).toEqual([{ email: 'sam@school.org', name: 'Sam Smith' }]);
  });

  it('still uses a parent column when it is the only one with addresses', () => {
    const text = 'Student,Parent email\nSam Smith,mom@home.org';
    expect(parseStudentList(text).entries).toEqual([{ email: 'mom@home.org', name: 'Sam Smith' }]);
  });

  it('falls back to first and last names when a full-name cell is blank', () => {
    const text = 'Preferred Name,First Name,Last Name,Email\n,Sam,Smith,sam@school.org\nJo,Joanna,Lee,jo@school.org';
    expect(parseStudentList(text).entries).toEqual([
      { email: 'sam@school.org', name: 'Sam Smith' },
      { email: 'jo@school.org', name: 'Jo' },
    ]);
  });

  it('reads German and PowerSchool-style name headers', () => {
    expect(parseStudentList('Vorname;Nachname;E-Mail\nAnna;Schmidt;anna@schule.de').entries).toEqual([{ email: 'anna@schule.de', name: 'Anna Schmidt' }]);
    expect(parseStudentList('LastFirst,Email\n"Smith, Sam",sam@school.org').entries).toEqual([{ email: 'sam@school.org', name: 'Smith, Sam' }]);
  });

  it("doesn't mistake a lone name for a header in a list without one", () => {
    const text = 'Grace Form\nsam@school.org\nJo Lee <jo@school.org>';
    // Kept (not dropped as a header), so the preview can say it isn't an email address.
    expect(parseStudentList(text)).toMatchObject({
      hasHeader: false,
      entries: [{ email: 'Grace Form' }, { email: 'sam@school.org' }, { email: 'jo@school.org', name: 'Jo Lee' }],
    });
  });
});

