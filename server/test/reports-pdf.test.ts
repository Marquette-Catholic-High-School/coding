import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Content, ContentTable } from 'pdfmake/interfaces';
import { describe, expect, it } from 'vitest';
import {
  cleanText,
  dateFormats,
  formatGrade,
  formatPercent,
  formatScore,
  ofCount,
  plainText,
  rangeText,
  statusLabel,
  truncate,
  userText,
} from '../src/reports/format';
import type { Report, StudentReport } from '../src/reports/model';
import { renderReportPdf, reportDocument } from '../src/reports/pdf';
import {
  classFixture,
  GENERATED_AT,
  LONG,
  NO_GLYPHS,
  reportContext,
  schoolClasses,
  schoolFixture,
  studentFixture,
  students,
  studentSetFixture,
} from './fixtures/reports';

interface ReadPdf {
  pageCount: number;
  /** [width, height] per page. */
  sizes: number[][];
  /** Text per page, whitespace collapsed. */
  pages: string[];
  info: Record<string, unknown>;
}

async function readPdf(bytes: Buffer): Promise<ReadPdf> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const sizes: number[][] = [];
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [, , width, height] = page.view;
    sizes.push([width!, height!]);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    );
  }
  const { info } = await doc.getMetadata();
  const pageCount = doc.numPages;
  await task.destroy();
  return { pageCount, sizes, pages, info: info as Record<string, unknown> };
}

async function render(report: Report) {
  const bytes = await renderReportPdf(report);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  return { bytes, pdf: await readPdf(bytes) };
}

const LETTER_LANDSCAPE = [792, 612];
const LETTER_PORTRAIT = [612, 792];
const A4_LANDSCAPE = [841.89, 595.28];
const A4_PORTRAIT = [595.28, 841.89];

function expectSize(sizes: number[][], expected: number[]) {
  for (const [width, height] of sizes) {
    expect(width).toBeCloseTo(expected[0]!, 1);
    expect(height).toBeCloseTo(expected[1]!, 1);
  }
}

describe('report formatting', () => {
  it('formats percents, grades and counts', () => {
    expect(formatPercent(87.4)).toBe('87%');
    expect(formatPercent(87.5)).toBe('88%');
    expect(formatPercent(null)).toBe('—');
    expect(formatGrade(10)).toBe('10');
    expect(formatGrade(7.5)).toBe('7.5');
    expect(formatGrade(7.25)).toBe('7.3');
    expect(formatGrade(1200)).toBe('1,200');
    expect(formatScore(7.5, 10)).toBe('7.5 / 10');
    expect(formatScore(10, 10)).toBe('10 / 10');
    expect(ofCount(1234, 2000)).toBe('1,234 of 2,000');
  });

  it('writes dates and times in the report time zone, with no characters Roboto lacks', () => {
    const chicago = dateFormats('America/Chicago');
    expect(chicago.date('2026-10-27T19:14:00Z')).toBe('Oct 27, 2026');
    // Some ICU versions put U+202F (not in Roboto) before AM/PM; it must come out as a normal or no-break space.
    expect(chicago.time('2026-10-27T19:14:00Z')).toMatch(/^2:14[ \u00A0]PM$/);
    expect(chicago.dateTime('2026-10-28T03:00:00Z')).toMatch(/^Oct 27, 2026, 10:00[ \u00A0]PM$/);
    expect(dateFormats('Not/AZone').date('2026-10-27T23:30:00Z')).toBe('Oct 27, 2026');
  });

  it('describes the date range', () => {
    const tz = 'America/New_York';
    expect(rangeText({ from: null, to: null }, tz)).toBe('All assignments');
    expect(rangeText({ from: '2026-09-01T04:00:00Z', to: '2026-10-28T03:59:59.999Z' }, tz)).toBe(
      'Assignments due Sep 1, 2026 – Oct 27, 2026',
    );
    expect(rangeText({ from: '2026-09-01T04:00:00Z', to: null }, tz)).toBe('Assignments due from Sep 1, 2026');
    expect(rangeText({ from: null, to: '2026-10-28T03:59:59.999Z' }, tz)).toBe('Assignments due up to Oct 27, 2026');
    expect(rangeText({ from: '2026-10-27T04:00:00Z', to: '2026-10-28T03:59:59.999Z' }, tz)).toBe('Assignments due Oct 27, 2026');
  });

  it('uses "To grade" for staff and "Handed in" on student reports', () => {
    expect(statusLabel('handed-in', 'staff')).toBe('To grade');
    expect(statusLabel('handed-in', 'student')).toBe('Handed in');
    expect(statusLabel('not-handed-in', 'staff')).toBe('Not handed in');
    expect(statusLabel('missing', 'student')).toBe('Missing');
  });

  it('cleans user text for drawing', () => {
    expect(cleanText('  Ana\u0000 \n María\t\u202E López ')).toBe('Ana María López');
    expect(cleanText('Zoë Ελένη Даша Nguyễn')).toBe('Zoë Ελένη Даша Nguyễn');
    // Decomposed accents are composed so Roboto draws them.
    expect(cleanText('Zoe\u0308')).toBe('Zoë');
    // Scripts Roboto lacks become U+FFFD (they would otherwise overlap the text around them).
    expect(cleanText('שלום Dana')).toBe('\uFFFD\uFFFD\uFFFD\uFFFD Dana');
    expect(cleanText('王小明')).toBe('\uFFFD\uFFFD\uFFFD');
    // Metadata keeps the original letters.
    expect(plainText(' 王小明\u0007 ')).toBe('王小明');
  });

  it('replaces characters Roboto lacks, so they cannot run words together', () => {
    // Look-alikes, the letter without the accent Roboto lacks, and spelled-out compatibility letters.
    expect(cleanText('Kaʻiulani Kahananui')).toBe('Ka‘iulani Kahananui');
    expect(cleanText('Loops→Functions review')).toBe('Loops->Functions review');
    expect(cleanText('Ἀλέξανδρος Martínez')).toBe('Αλέξανδρος Martínez');
    expect(cleanText('Ǆ ǝ ɣ')).toBe('DŽ ə γ');
    // Anything else is one U+FFFD per character; an emoji with its skin tone or joined emoji counts as one.
    expect(cleanText('Mia 🙂 Smith')).toBe('Mia \uFFFD Smith');
    expect(cleanText('👩\u200D💻 Coder 👍🏽')).toBe('\uFFFD Coder \uFFFD');
    expect(cleanText('Unit 1 ✓')).toBe('Unit 1 \uFFFD');
    // Invisible joiners go; characters Roboto has stay.
    expect(cleanText('a\u200Db')).toBe('ab');
    expect(cleanText('© Café №1 – “quotes”')).toBe('© Café №1 – “quotes”');
  });

  it('wraps hyphenated names at their hyphens and breaks only long parts of words', () => {
    expect(userText('Dr. Priya Ramaswamy-Venkataraman')).toBe('Dr. Priya Ramaswamy-Venkataraman');
    expect(userText('Dr. Alan Turing-Featherstonehaugh III')).toBe('Dr. Alan Turing-Featherstonehaugh III');
    expect(userText('Wolfeschlegelsteinhausenbergerdorff-Smith').split('\u200B')).toEqual([
      'Wolfeschle',
      'gelsteinha',
      'usenberger',
      'dorff-Smith',
    ]);
  });

  it('adds break opportunities only inside very long words, and truncates at a word when it can', () => {
    expect(userText('Hello, world')).toBe('Hello, world');
    const long = userText(LONG.username);
    expect(long).toContain('\u200B');
    expect(long.replace(/\u200B/g, '')).toBe(LONG.username);
    expect(truncate('Short', 10)).toBe('Short');
    expect(truncate('Lab 7: Building a text adventure game', 22)).toBe('Lab 7: Building a…');
    expect(Array.from(truncate(LONG.unbroken, 20))).toHaveLength(20);
  });
});

describe('class report PDF', () => {
  it('draws a landscape class report with the title block, tables, grade grid and notes', async () => {
    const report = classFixture({ studentCount: 6, assignmentCount: 12, seed: 3 });
    const { pdf } = await render(report);
    expectSize(pdf.sizes, LETTER_LANDSCAPE);
    expect(pdf.info.Title).toBe('Class report — Year 8 Computing');
    expect(pdf.info.Author).toBe('CodeClass');
    expect(pdf.info.Creator).toBe('CodeClass');
    expect(pdf.info.CreationDate).toBe('D:20261027191400Z');

    const all = pdf.pages.join('\n');
    expect(pdf.pages[0]).toContain('Class report');
    expect(pdf.pages[0]).toContain('Year 8 Computing · Ms. Rivera');
    expect(pdf.pages[0]).toContain('All assignments');
    for (const label of ['STUDENTS', 'ASSIGNMENTS', 'AVERAGE', 'HANDED IN', 'TO GRADE', 'LATE', 'MISSING']) {
      expect(pdf.pages[0]).toContain(label);
    }
    expect(all).toContain('Assignments');
    expect(all).toContain('Grades — assignments 1–6');
    expect(all).toContain('Grades — assignments 7–12');
    expect(all).toContain('About this report');
    expect(all).toContain('To grade');
    expect(all).toContain(report.students[0]!.name);
    expect(all).toContain('Generated Oct 27, 2026, 2:14');
    expect(all).toContain('Contains student information');
    pdf.pages.forEach((text, i) => expect(text).toContain(`Page ${i + 1} of ${pdf.pageCount}`));
  });

  it('keeps names with characters Roboto lacks readable, and explains how Late and Missing compare with the app', async () => {
    const report = classFixture({
      studentList: [
        { id: 1, name: 'Kaʻiulani Kahananui', username: 'kai' },
        { id: 2, name: 'Mia 🙂 Smith', username: 'mia' },
      ],
      assignmentCount: 2,
      titles: { 0: 'Loops→Functions review' },
    });
    const all = (await render(report)).pdf.pages.join('\n');
    expect(all).toContain('Ka‘iulani Kahananui');
    expect(all).toContain('Mia \uFFFD Smith');
    expect(all).toContain('Loops->Functions review');
    expect(all).toContain('The “late” counts on the class’s Students and Assignments tabs include missing work too');
  });

  it('shows the username under a name in the grade grid when two students’ names print the same', () => {
    const report = classFixture({
      studentList: [
        { id: 1, name: 'Aaliyah Johnson', username: 'apcsp14' },
        { id: 2, name: 'aaliyah johnson', username: 'apcsp34' },
        { id: 3, name: 'Elijah Müller', username: 'emuller' },
      ],
      assignmentCount: 3,
    });
    const content = reportDocument(report).content as Content[];
    const grid = content.find((c) => JSON.stringify(c).includes('Grades — ')) as ContentTable;
    const studentCells = grid.table.body.slice(2).map((row) => JSON.stringify(row[0]));
    expect(studentCells).toHaveLength(3);
    for (const username of ['apcsp14', 'apcsp34']) expect(studentCells.filter((c) => c.includes(username))).toHaveLength(1);
    expect(studentCells.find((c) => c.includes('Elijah'))).not.toContain('emuller');
  });

  it('uses A4 when asked', async () => {
    const { pdf } = await render(classFixture({ studentCount: 2, assignmentCount: 2, paper: 'a4' }));
    expectSize(pdf.sizes, A4_LANDSCAPE);
  });

  it('shows sentences instead of empty tables', async () => {
    const empty = classFixture({ studentCount: 0, assignmentCount: 0, archived: true });
    const { pdf } = await render(empty);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pages[0]).toContain('This class is archived.');
    expect(pdf.pages[0]).toContain('There are no published assignments yet.');
    expect(pdf.pages[0]).toContain('This class has no students.');
    expect(pdf.pages[0]).not.toContain('Grades —');

    const ranged = classFixture({
      studentCount: 3,
      assignmentCount: 0,
      context: { range: { from: '2027-01-01T06:00:00.000Z', to: null } },
    });
    const { pdf: rangedPdf } = await render(ranged);
    expect(rangedPdf.pages[0]).toContain('No published assignments are due in this date range.');
    expect(rangedPdf.pages[0]).toContain('Assignments due from Jan 1, 2027');
  });

  it('splits 40 assignments into balanced grade-grid chunks of at most 10 and handles odd names', async () => {
    const odd = students(35, 8, [
      { name: LONG.studentName, username: LONG.username },
      { name: NO_GLYPHS.studentName, username: 'wang.xiaoming' },
      { name: 'Даша Иванова', username: 'dasha.ivanova' },
      { name: 'Αλέξανδρος Παπαδόπουλος', username: 'alexandros.p' },
      { name: LONG.unbroken, username: LONG.unbroken },
    ]);
    const report = classFixture({
      name: LONG.className,
      teacherName: LONG.teacherName,
      studentList: odd,
      assignmentCount: 40,
      titles: { 0: LONG.assignmentTitle, 3: LONG.unbroken, 7: NO_GLYPHS.className },
    });
    const doc = reportDocument(report);
    const grids = JSON.stringify(doc.content).match(/Grades — assignments \d+–\d+/g);
    expect(grids).toEqual([
      'Grades — assignments 1–10',
      'Grades — assignments 11–20',
      'Grades — assignments 21–30',
      'Grades — assignments 31–40',
    ]);
    const { pdf } = await render(report);
    const all = pdf.pages.join('\n');
    expect(all).toContain('Даша Иванова');
    expect(all).toContain('Αλέξανδρος Παπαδόπουλος');
    expect(all).toContain('\uFFFD\uFFFD\uFFFD');
    expect(pdf.pageCount).toBeGreaterThan(5);
  });

  it('balances chunks (12 assignments → 6 + 6)', () => {
    const doc = reportDocument(classFixture({ studentCount: 2, assignmentCount: 12 }));
    expect(JSON.stringify(doc.content).match(/Grades — assignments? [\d–]+/g)).toEqual([
      'Grades — assignments 1–6',
      'Grades — assignments 7–12',
    ]);
    const one = reportDocument(classFixture({ studentCount: 2, assignmentCount: 1 }));
    expect(JSON.stringify(one.content)).toContain('Grades — assignment 1');
  });
});

describe('student report PDF', () => {
  const realistic = classFixture({ seed: 3, studentCount: 8, assignmentCount: 6 });
  const other = classFixture({
    seed: 10,
    name: 'Python Club',
    teacherName: 'Mr. Okafor',
    studentList: realistic.students.slice(0, 3),
    assignmentCount: 3,
    archived: true,
  });

  it('draws a portrait report across classes with autograde results and family wording', async () => {
    const report = studentFixture([realistic, other], realistic.students[1]!.id);
    const { pdf } = await render(report);
    expectSize(pdf.sizes, LETTER_PORTRAIT);
    expect(pdf.info.Title).toBe(`Student report — ${report.student.name}`);
    const all = pdf.pages.join('\n');
    expect(pdf.pages[0]).toContain(`${report.student.name} (${report.student.username})`);
    expect(pdf.pages[0]).toContain('Classes: Year 8 Computing, Python Club');
    expect(all).toContain('Mr. Okafor · Archived');
    for (const header of ['Assignment', 'Due', 'Status', 'Handed in', 'Grade', 'Auto score', 'Tests passed']) {
      expect(all).toContain(header);
    }
    // Work waiting for a grade is "Handed in" on reports that may go home, never "To grade".
    expect(all).not.toContain('To grade');
    expect(all).toContain('About this report');
  });

  it('marks autograded grades and shows tests passed', async () => {
    const base = studentFixture([classFixture({ studentCount: 1, assignmentCount: 2 })], 1000);
    const report: StudentReport = {
      ...base,
      classes: base.classes.map((c) => ({
        ...c,
        rows: [
          {
            assignment: { ...c.rows[0]!.assignment, points: 10, dueAt: '2026-10-01T12:00:00Z' },
            work: {
              status: 'graded',
              late: true,
              grade: 7.5,
              percent: 75,
              submittedAt: '2026-10-02T12:00:00Z',
              autoScore: 75,
              autoGraded: true,
              testsPassed: 3,
              testsRun: 4,
            },
          },
          {
            assignment: { ...c.rows[1]!.assignment, points: 10, dueAt: '2026-10-05T12:00:00Z' },
            work: {
              status: 'missing',
              late: false,
              grade: null,
              percent: null,
              submittedAt: null,
              autoScore: null,
              autoGraded: false,
              testsPassed: null,
              testsRun: null,
            },
          },
        ],
      })),
    };
    const { pdf } = await render(report);
    const text = pdf.pages.join('\n');
    expect(text).toContain('7.5 / 10');
    expect(text).toContain('Autograded');
    // Dates only, so rows take one line, except late work, which shows both times (Chicago time).
    expect(text).toContain('Oct 1, 2026 7:00 AM');
    expect(text).toContain('Oct 2, 2026 7:00 AM');
    expect(text).toMatch(/Oct 5, 2026 (?!\d)/);
    expect(text).toContain('3 of 4');
    expect(text).toContain('Late');
    expect(text).toContain('Missing');
  });

  it('explains when the student is in none of the classes', async () => {
    const report: StudentReport = {
      kind: 'student',
      context: reportContext({ title: 'Student report', paper: 'a4' }),
      student: { id: 5, name: 'Sam Lee', username: 'sam.lee' },
      classes: [],
      totals: { average: null, workCount: 0, handedInCount: 0, gradedCount: 0, toGradeCount: 0, lateCount: 0, missingCount: 0 },
    };
    const { pdf } = await render(report);
    expect(pdf.pageCount).toBe(1);
    expectSize(pdf.sizes, A4_PORTRAIT);
    expect(pdf.pages[0]).toContain('This student isn’t in any of the classes this report covers.');
  });

  it('puts each student of a set on their own pages, with their name in the header and per-student page numbers', async () => {
    const small = classFixture({ seed: 4, studentCount: 3, assignmentCount: 2, name: 'Python Club' });
    const { pdf } = await render(studentSetFixture(small));
    expect(pdf.pageCount).toBe(4);
    expect(pdf.info.Title).toBe('Student reports — Python Club');
    expectSize(pdf.sizes, LETTER_PORTRAIT);
    small.students.forEach((student, i) => {
      // Each student's pages are titled as a single report, even though the set shares one context.
      expect(pdf.pages[i]).toContain(`Student report · ${student.name}`);
      expect(pdf.pages[i]).not.toContain('Student reports');
      expect(pdf.pages[i]).toContain(`${student.name} (${student.username})`);
      expect(pdf.pages[i]).toContain(`Page 1 of 1 · ${i + 1} of 4 in this file`);
      expect(pdf.pages[i]).not.toContain('About th');
      for (const other of small.students.filter((s) => s !== student)) expect(pdf.pages[i]).not.toContain(other.name);
    });
    // The notes come once, on the last page.
    expect(pdf.pages[3]).toContain('Student reports · Python Club');
    expect(pdf.pages[3]).toContain('3 students, one report each');
    expect(pdf.pages[3]).toContain('About these reports');
    expect(pdf.pages[3]).toContain('Page 4 of 4');

    const empty = classFixture({ studentCount: 0, assignmentCount: 2 });
    const { pdf: emptyPdf } = await render(studentSetFixture(empty));
    expect(emptyPdf.pageCount).toBe(1);
    expect(emptyPdf.pages[0]).toContain('This class has no students.');
  });
});

describe('student report set size', () => {
  it('fits each student of a 25-student, 15-assignment set on one page (no page for notes alone)', async () => {
    for (const paper of ['letter', 'a4'] as const) {
      const { pdf } = await render(studentSetFixture(classFixture({ studentCount: 25, assignmentCount: 15, paper })));
      expect(pdf.pageCount, paper).toBe(26);
      pdf.pages.slice(0, 25).forEach((text, i) => expect(text, paper).toContain(`Page 1 of 1 · ${i + 1} of 26 in this file`));
      expect(pdf.pages[25]).toContain('About these reports');
    }
  }, 30_000);
});

describe('school report PDF', () => {
  it('draws the school summary, classes, teachers and students with missing work', async () => {
    const classes = schoolClasses(4, 6, 5);
    const report = schoolFixture(classes, { includesArchived: true, paper: 'a4' });
    const { pdf } = await render(report);
    expectSize(pdf.sizes, A4_LANDSCAPE);
    expect(pdf.info.Title).toBe('School report');
    const all = pdf.pages.join('\n');
    expect(pdf.pages[0]).toContain('Every class, including archived classes');
    for (const label of ['CLASSES', 'TEACHERS', 'STUDENTS', 'ASSIGNMENTS', 'AVERAGE', 'HANDED IN', 'TO GRADE', 'LATE', 'MISSING']) {
      expect(pdf.pages[0]).toContain(label);
    }
    expect(all).toContain('Teachers');
    expect(all).toContain('Students with missing work');
    expect(all).toContain(report.missingWork[0]!.student.name);
    expect(all).toContain(classes[0]!.cls.name);
    expect(all).toContain('The “late” counts on each class’s Students and Assignments tabs include missing work too');
  });

  it('explains an empty school', async () => {
    const { pdf } = await render(schoolFixture([]));
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pages[0]).toContain('There are no classes to report on.');
    expect(pdf.pages[0]).toContain('No teachers have classes in this report.');
    expect(pdf.pages[0]).toContain('No missing work.');
  });

  it('says so when nothing is missing', async () => {
    const classes = schoolClasses(2, 3, 2).map((c) => ({
      ...c,
      students: c.students.map((s) => ({ ...s, totals: { ...s.totals, missingCount: 0 } })),
    }));
    const { pdf } = await render(schoolFixture(classes));
    expect(pdf.pages.join('\n')).toContain('No missing work.');
    expect(pdf.pages[0]).toContain('Every active class (archived classes not included)');
  });

  it('renders a big school (60 classes, 1,500 students, 3,000 assignments) quickly', async () => {
    const report = schoolFixture(schoolClasses(60, 25, 50), { includesArchived: true });
    expect(report.studentCount).toBeGreaterThan(1400);
    expect(report.missingWork.length).toBeGreaterThan(500);
    const started = performance.now();
    const bytes = await renderReportPdf(report);
    const elapsed = performance.now() - started;
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(elapsed).toBeLessThan(5000);
    expect(bytes.length).toBeLessThan(3_000_000);
  }, 30_000);
});

describe('PDF safety', () => {
  it('draws user text as plain text only (no links, images or files in the document)', () => {
    const report = classFixture({
      name: 'https://evil.example/logo.png',
      studentList: [{ id: 1, name: '<img src=x onerror=alert(1)>', username: 'file:///etc/passwd' }],
      assignmentCount: 1,
    });
    const doc = reportDocument(report);
    expect(doc.images).toBeUndefined();
    expect(doc.files).toBeUndefined();
    expect(doc.attachments).toBeUndefined();
    expect(JSON.stringify(doc.content)).not.toMatch(/"(link|image|svg|qr|attachment|linkToFile)"/);
  });

  it('refuses every URL and every local file except the bundled fonts', async () => {
    await renderReportPdf(classFixture({ studentCount: 1, assignmentCount: 1 }));
    const pdfMake = createRequire(import.meta.url)('pdfmake') as typeof import('pdfmake');
    await expect(
      pdfMake.createPdf({ content: [{ image: 'remote' }], images: { remote: 'https://127.0.0.1:9/x.png' } }).getBuffer(),
    ).rejects.toThrow(/denied/i);
    await expect(
      pdfMake.createPdf({ content: [{ image: 'local' }], images: { local: '/etc/hosts' } }).getBuffer(),
    ).rejects.toThrow(/denied/i);
  });

  it('records when the report was made', () => {
    const doc = reportDocument(classFixture({ studentCount: 1, assignmentCount: 1 }));
    expect(doc.info?.creationDate?.toISOString()).toBe(GENERATED_AT);
  });
});
