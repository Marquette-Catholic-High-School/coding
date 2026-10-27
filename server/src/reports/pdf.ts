// Draws report models (model.ts) into PDF bytes with pdfmake. Layouts per report kind live here; the shared pieces
// (colours, header/footer, stat boxes, tables) are in pdfParts.ts and the wording/number formats in format.ts.
//
// Safety: pdfmake can fetch remote fonts/images and read local files. We give it only the Roboto fonts it ships,
// refuse every URL and every other local path, and draw report text (names, titles) only as plain text.

import { createRequire } from 'node:module';
import type * as PdfMake from 'pdfmake';
import type { Content, ContentStack, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import { ROBOTO } from './fonts';
import {
  cleanText,
  dateFormats,
  DASH,
  formatCount,
  formatGrade,
  formatPercent,
  formatScore,
  ofCount,
  plainText,
  rangeDays,
  rangeText,
  share,
  statusLabel,
  truncate,
  userText,
  type DateFormats,
} from './format';
import type {
  ClassReport,
  ClassReportStudent,
  Report,
  ReportAssignment,
  ReportClass,
  ReportContext,
  SchoolReport,
  StudentReport,
  StudentReportSet,
  WorkCell,
  WorkTotals,
} from './model';
import {
  charsThatFit,
  COLORS,
  dataTable,
  emptySection,
  FONT_SIZE,
  notesBox,
  PAGE_MARGINS,
  pageFooter,
  pageFrame,
  pageHeader,
  statBoxes,
  STATUS_STYLE,
  titleBlock,
  type Cell,
  type Column,
  type PageFrame,
  type Stat,
} from './pdfParts';

const require = createRequire(import.meta.url);
let configured: typeof PdfMake | null = null;

/** The pdfmake instance (a process-wide singleton), set up once: bundled Roboto only, no URLs, no other files. */
function pdfMake(): typeof PdfMake {
  if (configured) return configured;
  const lib = require('pdfmake') as typeof PdfMake;
  const fontFiles = new Set<string>(Object.values(ROBOTO));
  lib.setFonts({ Roboto: { ...ROBOTO } });
  lib.setUrlAccessPolicy(() => false);
  lib.setLocalAccessPolicy((path) => fontFiles.has(path));
  configured = lib;
  return lib;
}

/** Draws any report into a PDF. */
export async function renderReportPdf(report: Report): Promise<Buffer> {
  return pdfMake().createPdf(reportDocument(report)).getBuffer();
}

/** The pdfmake document definition for a report (exported for tests). */
export function reportDocument(report: Report): TDocumentDefinitions {
  switch (report.kind) {
    case 'class':
      return classDocument(report);
    case 'student':
      return studentDocument(report);
    case 'students':
      return studentSetDocument(report);
    case 'school':
      return schoolDocument(report);
  }
}

// --- Shared ---------------------------------------------------------------------------------------------------------

interface Frame extends PageFrame {
  dates: DateFormats;
  /** "Generated Oct 27, 2026, 3:14 PM by Ms. Smith". */
  generated: string;
}

function frameFor(context: ReportContext, orientation: PageFrame['orientation']): Frame {
  const dates = dateFormats(context.timeZone);
  return {
    ...pageFrame(context.paper, orientation),
    dates,
    generated: `Generated ${dates.dateTime(context.generatedAt)} by ${truncate(context.generatedBy, 60)}`,
  };
}

function documentShell(
  context: ReportContext,
  frame: Frame,
  title: string,
  rest: Pick<TDocumentDefinitions, 'content'> & Partial<TDocumentDefinitions>,
): TDocumentDefinitions {
  return {
    pageSize: frame.pageSize,
    pageOrientation: frame.orientation,
    pageMargins: PAGE_MARGINS,
    info: {
      title: plainText(title),
      author: 'CodeClass',
      creator: 'CodeClass',
      producer: 'CodeClass',
      creationDate: new Date(context.generatedAt),
    },
    language: 'en-US',
    displayTitle: true,
    defaultStyle: { font: 'Roboto', fontSize: FONT_SIZE.body, color: COLORS.ink },
    ...rest,
  };
}

const pageOfCount = (page: number, count: number) => `Page ${page} of ${count}`;

/** "1 student", "24 students". */
function plural(n: number, noun: string): string {
  return `${formatCount(n)} ${n === 1 ? noun : noun.endsWith('s') ? `${noun}es` : `${noun}s`}`;
}

/** Average, Handed in, To grade (staff) or Graded (student), Late and Missing boxes; Late/Missing coloured when > 0. */
function workStats(totals: WorkTotals, audience: 'staff' | 'student'): Stat[] {
  const handedIn: Stat = {
    label: 'Handed in',
    value: formatPercent(share(totals.handedInCount, totals.workCount)),
    detail: ofCount(totals.handedInCount, totals.workCount),
  };
  return [
    { label: 'Average', value: formatPercent(totals.average), detail: `${formatCount(totals.gradedCount)} graded` },
    handedIn,
    audience === 'staff'
      ? { label: 'To grade', value: formatCount(totals.toGradeCount) }
      : { label: 'Graded', value: formatCount(totals.gradedCount), detail: `of ${formatCount(totals.workCount)}` },
    { label: 'Late', value: formatCount(totals.lateCount), tone: totals.lateCount > 0 ? 'late' : undefined },
    { label: 'Missing', value: formatCount(totals.missingCount), tone: totals.missingCount > 0 ? 'missing' : undefined },
  ];
}

/** A count cell that stands out when non-zero (Missing bold red, Late italic amber; zero stays plain). */
function countCell(n: number, tone: 'missing' | 'late' | null = null): Cell {
  if (n === 0) return { text: '0', color: COLORS.faint };
  return tone ? { text: formatCount(n), ...STATUS_STYLE[tone] } : formatCount(n);
}

function percentCell(percent: number | null): Cell {
  return percent === null ? { text: DASH, color: COLORS.faint } : formatPercent(percent);
}

function handedInCell(totals: WorkTotals): Cell {
  return totals.workCount === 0 ? { text: DASH, color: COLORS.faint } : ofCount(totals.handedInCount, totals.workCount);
}

function rangeNote(context: ReportContext): string {
  const days = rangeDays(context.range, context.timeZone);
  if (!days) return 'Every published assignment is included.';
  return (
    `Only published assignments due in the date range (${days}) are included; an assignment without a due date ` +
    'counts by the date it was set.'
  );
}

/**
 * Reports count work that was never handed in once, as Missing; the app's "late" badges (Students and Assignments
 * tabs) count it as late too. Said in the staff reports' notes so the numbers don't look wrong side by side.
 */
function lateBadgesNote(whose: string): string {
  return (
    `Late and Missing never overlap here. The “late” counts on ${whose} Students and Assignments tabs include ` +
    'missing work too, so compare them with Late + Missing in this report.'
  );
}

function noAssignmentsSentence(context: ReportContext): string {
  return context.range.from || context.range.to
    ? 'No published assignments are due in this date range.'
    : 'There are no published assignments yet.';
}

/** A due date (or "No due date"): with its time on one line, the date alone, or the date with its time under it. */
function dueCell(dueAt: string | null, dates: DateFormats, form: 'one-line' | 'date' | 'two-lines'): Cell {
  if (!dueAt) return { text: 'No due date', ...STATUS_STYLE.quiet };
  if (form === 'one-line') return dates.dateTime(dueAt);
  return form === 'date' ? dates.date(dueAt) : dateTimeCell(dueAt, dates);
}

function dateTimeCell(iso: string, dates: DateFormats): Cell {
  return { text: [dates.date(iso), { text: `\n${dates.time(iso)}`, color: COLORS.muted, fontSize: FONT_SIZE.small }] };
}

function archivedTag(cls: ReportClass): ContentText[] {
  return cls.archived ? [{ text: '  Archived', ...STATUS_STYLE.quiet, fontSize: FONT_SIZE.small }] : [];
}

// --- Class report ---------------------------------------------------------------------------------------------------

function classDocument(report: ClassReport): TDocumentDefinitions {
  const { context, cls, assignments, students, totals } = report;
  const frame = frameFor(context, 'landscape');
  const details = [rangeText(context.range, context.timeZone)];
  if (cls.archived) details.push('This class is archived.');

  const content: Content[] = [
    titleBlock(context.title, `${userText(cls.name)} · ${userText(cls.teacherName)}`, details),
    statBoxes([
      { label: 'Students', value: formatCount(students.length) },
      { label: 'Assignments', value: formatCount(assignments.length) },
      ...workStats(totals, 'staff'),
    ]),
  ];

  if (assignments.length === 0) {
    content.push(emptySection({ title: 'Assignments' }, noAssignmentsSentence(context)));
  } else {
    content.push(
      dataTable({
        heading: {
          title: 'Assignments',
          detail: `${plural(assignments.length, 'assignment')} in due-date order (# is used in the grade grid)`,
        },
        rows: assignments,
        columns: [
          { header: '#', width: 16, align: 'right', cell: (a) => String(a.number) },
          { header: 'Title', width: '*', cell: (a) => userText(a.title) },
          { header: 'Language', width: 100, cell: (a) => userText(a.languageName) },
          { header: 'Due', width: 98, cell: (a) => dueCell(a.dueAt, frame.dates, 'one-line') },
          { header: 'Points', width: 34, align: 'right', cell: (a) => formatGrade(a.points) },
          { header: 'Handed in', width: 54, align: 'right', cell: (a) => handedInCell(a.totals) },
          { header: 'To grade', width: 38, align: 'right', cell: (a) => countCell(a.totals.toGradeCount) },
          { header: 'Late', width: 30, align: 'right', cell: (a) => countCell(a.totals.lateCount, 'late') },
          { header: 'Missing', width: 38, align: 'right', cell: (a) => countCell(a.totals.missingCount, 'missing') },
          { header: 'Average', width: 40, align: 'right', cell: (a) => percentCell(a.totals.average) },
        ],
      }),
    );
  }

  if (students.length === 0) {
    content.push(emptySection({ title: 'Students' }, 'This class has no students.'));
  } else {
    content.push(
      dataTable({
        heading: { title: 'Students', detail: `${plural(students.length, 'student')} by name` },
        rows: students,
        columns: [
          { header: 'Name', width: '*', cell: (s) => userText(s.name) },
          { header: 'Username', width: 130, cell: (s) => ({ text: userText(s.username), color: COLORS.muted }) },
          { header: 'Average', width: 44, align: 'right', cell: (s) => percentCell(s.totals.average) },
          { header: 'Handed in', width: 54, align: 'right', cell: (s) => handedInCell(s.totals) },
          { header: 'Graded', width: 40, align: 'right', cell: (s) => countCell(s.totals.gradedCount) },
          { header: 'To grade', width: 40, align: 'right', cell: (s) => countCell(s.totals.toGradeCount) },
          { header: 'Late', width: 32, align: 'right', cell: (s) => countCell(s.totals.lateCount, 'late') },
          { header: 'Missing', width: 40, align: 'right', cell: (s) => countCell(s.totals.missingCount, 'missing') },
        ],
      }),
    );
  }

  if (assignments.length > 0 && students.length > 0) content.push(...gradeGrids(report, frame));

  content.push(
    notesBox([
      'Average: the mean of the percentage scores of graded work (each graded assignment counts equally). Work that ' +
        'isn’t graded yet doesn’t count, and neither do assignments worth 0 points.',
      'Handed in: work that was handed in or has a grade. To grade: handed in and waiting for a grade. Late: handed in ' +
        'after the due date (work returned for changes is not late).',
      `Missing: not handed in and past the due date, as of ${frame.dates.dateTime(context.generatedAt)}. ` +
        'Work with a grade (such as a 0 for work never handed in) counts as graded, not missing.',
      lateBadgesNote('the class’s'),
      `${rangeNote(context)} Students are the class’s current students.`,
    ]),
  );

  return documentShell(context, frame, `${context.title} — ${cls.name}`, {
    header: pageHeader(context.title, cleanText(cls.name)),
    footer: pageFooter(frame.generated, pageOfCount),
    content,
  });
}

const GRID_NAME_MIN = 150;
const GRID_COLUMN_MIN = 56;
const GRID_COLUMN_MAX = 90;
const GRID_COLUMNS_MAX = 10;
/** Cell padding pdfmake adds on top of a column's width (left + right). */
const CELL_PADDING = 8;

/**
 * The grade grid: students down, assignments across, split into chunks of at most 10 assignments so every column
 * stays readable. Each chunk repeats the student names and has its own heading and legend.
 */
function gradeGrids(report: ClassReport, frame: Frame): Content[] {
  const { assignments, students } = report;
  const room = frame.contentWidth - GRID_NAME_MIN;
  const maxPerChunk = Math.max(1, Math.min(GRID_COLUMNS_MAX, Math.floor(room / GRID_COLUMN_MIN)));
  // Balanced chunks (12 assignments → 6 + 6, not 10 + 2).
  const chunkCount = Math.ceil(assignments.length / maxPerChunk);
  const perChunk = Math.ceil(assignments.length / chunkCount);
  const columnWidth = Math.min(GRID_COLUMN_MAX, Math.floor(room / perChunk)) - CELL_PADDING;
  const titleChars = charsThatFit(columnWidth, FONT_SIZE.tiny + 0.5) * 2;
  const studentCell = gridStudentCell(students);

  const grids: Content[] = [];
  for (let start = 0; start < assignments.length; start += perChunk) {
    const indexes = assignments.slice(start, start + perChunk).map((_, i) => start + i);
    const first = assignments[indexes[0]!]!;
    const last = assignments[indexes[indexes.length - 1]!]!;
    const span = first === last ? `assignment ${first.number}` : `assignments ${first.number}–${last.number}`;
    const columns: Column<ClassReportStudent>[] = [
      { header: 'Student', width: '*', cell: studentCell },
      ...indexes.map(
        (index): Column<ClassReportStudent> => ({
          header: gridHeader(assignments[index]!, titleChars),
          width: columnWidth,
          align: 'center',
          cell: (s) => gridCell(s.work[index]!),
        }),
      ),
    ];
    grids.push(
      dataTable({
        heading: { title: `Grades — ${span}`, detail: gridLegend() },
        rows: students,
        columns,
        fontSize: FONT_SIZE.grid,
        marginTop: grids.length === 0 ? 22 : 18,
      }),
    );
  }
  return grids;
}

/**
 * The grade grid's Student cell: the name, and when another student's name prints the same, the username small under
 * it (the Students table shows usernames, but it may be pages away).
 */
function gridStudentCell(students: ClassReportStudent[]): (student: ClassReportStudent) => Cell {
  const printed = (s: ClassReportStudent) => cleanText(s.name).toLocaleLowerCase('en-US');
  const count = new Map<string, number>();
  for (const s of students) count.set(printed(s), (count.get(printed(s)) ?? 0) + 1);
  return (s) => {
    if ((count.get(printed(s)) ?? 0) < 2) return userText(s.name);
    const username: ContentText = { text: `\n${userText(s.username)}`, fontSize: FONT_SIZE.tiny, color: COLORS.muted };
    return { text: [userText(s.name), username] };
  };
}

/** Grade grid column header: number, short title (full titles are in the Assignments table) and points. */
function gridHeader(assignment: ReportAssignment, titleChars: number): ContentStack {
  return {
    alignment: 'center',
    color: COLORS.muted,
    stack: [
      { text: `#${assignment.number}`, bold: true, fontSize: FONT_SIZE.tableHeader, color: COLORS.ink },
      { text: userText(truncate(assignment.title, titleChars)), fontSize: FONT_SIZE.tiny + 0.5, margin: [0, 1, 0, 0] },
      {
        text: assignment.points > 0 ? `out of ${formatGrade(assignment.points)}` : 'no points',
        fontSize: FONT_SIZE.tiny,
        color: COLORS.faint,
        margin: [0, 1, 0, 0],
      },
    ],
  };
}

function gridCell(work: WorkCell): Cell {
  const late: ContentText[] = work.late ? [{ text: '\nLate', ...STATUS_STYLE.late, fontSize: FONT_SIZE.small }] : [];
  switch (work.status) {
    case 'graded':
      return { text: [{ text: work.grade === null ? DASH : formatGrade(work.grade) }, ...late] };
    case 'handed-in':
      return { text: [{ text: 'To grade' }, ...late] };
    case 'returned':
      return { text: 'Returned', ...STATUS_STYLE.quiet };
    case 'missing':
      return { text: 'Missing', ...STATUS_STYLE.missing };
    case 'not-handed-in':
      return { text: DASH, ...STATUS_STYLE.none };
  }
}

function gridLegend(): ContentText {
  return {
    text: [
      { text: 'To grade', color: COLORS.ink },
      ': handed in, not graded yet  ·  ',
      { text: 'Returned', ...STATUS_STYLE.quiet },
      ': sent back for changes  ·  ',
      { text: 'Missing', ...STATUS_STYLE.missing },
      ': not handed in, past due  ·  ',
      { text: DASH, color: COLORS.ink },
      ': not handed in, not due yet  ·  ',
      { text: 'Late', ...STATUS_STYLE.late },
      ': handed in after the due date',
    ],
  };
}

// --- Student report -------------------------------------------------------------------------------------------------

function studentDocument(report: StudentReport): TDocumentDefinitions {
  const { context, student } = report;
  const frame = frameFor(context, 'portrait');
  return documentShell(context, frame, `${context.title} — ${student.name}`, {
    header: pageHeader(context.title, cleanText(student.name)),
    footer: pageFooter(frame.generated, pageOfCount),
    content: [...studentContent(report, context.title, frame, null), notesBox(studentNotes(context, frame))],
  });
}

/**
 * One student set: each student's report is its own section (new page, header with that student's name), and
 * pages are numbered per student as well as through the file. The notes come once, at the end of the file: in each
 * student's pages they would often need a page of their own (one wasted sheet per student).
 */
function studentSetDocument(set: StudentReportSet): TDocumentDefinitions {
  const { context, cls } = set;
  const frame = frameFor(context, 'portrait');
  const docTitle = `${context.title} — ${cls.name}`;

  if (set.reports.length === 0) {
    return documentShell(context, frame, docTitle, {
      header: pageHeader(context.title, cleanText(cls.name)),
      footer: pageFooter(frame.generated, pageOfCount),
      content: [
        titleBlock(
          context.title,
          `${userText(cls.name)} · ${userText(cls.teacherName)}`,
          [rangeText(context.range, context.timeZone), ...(cls.archived ? ['This class is archived.'] : [])],
        ),
        { text: 'This class has no students.', italics: true, color: COLORS.muted },
      ],
    });
  }

  // pdfmake draws every page's header before any footer, so the headers can note which pages belong to which student
  // and the footers can then say "Page 1 of 2" for that student.
  const pagesOf: number[][] = set.reports.map(() => []);
  const content: Content[] = set.reports.map((report, i): Content => {
    const header = pageHeader(STUDENT_REPORT, cleanText(report.student.name));
    return {
      section: studentContent(report, STUDENT_REPORT, frame, cls),
      header: (page, count, pageSize) => {
        if (!pagesOf[i]!.includes(page)) pagesOf[i]!.push(page);
        return header(page, count, pageSize);
      },
      footer: pageFooter(frame.generated, (page, count) => {
        const own = pagesOf[i]!;
        const n = own.indexOf(page) + 1;
        return n > 0 ? `Page ${n} of ${own.length}  ·  ${page} of ${count} in this file` : pageOfCount(page, count);
      }),
    };
  });
  content.push({
    section: [
      titleBlock(context.title, `${userText(cls.name)} · ${userText(cls.teacherName)}`, [
        rangeText(context.range, context.timeZone),
        `${plural(set.reports.length, 'student')}, one report each`,
        ...(cls.archived ? ['This class is archived.'] : []),
      ]),
      notesBox(studentNotes(context, frame), 'About these reports'),
    ],
    header: pageHeader(context.title, cleanText(cls.name)),
    footer: pageFooter(frame.generated, pageOfCount),
  });
  return documentShell(context, frame, docTitle, { content });
}

/** Each student's part of a "Student reports" set is titled as a single report. */
const STUDENT_REPORT = 'Student report';

function studentContent(report: StudentReport, title: string, frame: Frame, setClass: ReportClass | null): Content[] {
  const { context, student, classes, totals } = report;
  const details: string[] = [];
  if (setClass) {
    details.push(`${userText(setClass.name)} · ${userText(setClass.teacherName)}`);
  } else if (classes.length > 0) {
    const names = classes.map((c) => userText(c.cls.name)).join(', ');
    details.push(`${classes.length === 1 ? 'Class' : 'Classes'}: ${names}`);
  }
  details.push(rangeText(context.range, context.timeZone));

  const content: Content[] = [
    titleBlock(title, `${userText(student.name)} (${userText(student.username)})`, details),
    statBoxes(workStats(totals, 'student')),
  ];

  if (classes.length === 0) {
    content.push({
      text: 'This student isn’t in any of the classes this report covers.',
      italics: true,
      color: COLORS.muted,
      margin: [0, 18, 0, 0],
    });
  }

  for (const { cls, totals: classTotals, rows } of classes) {
    const heading = {
      title: userText(cls.name),
      detail: {
        text: [
          userText(cls.teacherName),
          ...(cls.archived ? [{ text: '  ·  Archived', italics: true }] : []),
          `  ·  ${classTotalsLine(classTotals)}`,
        ],
      },
    };
    if (rows.length === 0) {
      content.push(emptySection(heading, noAssignmentsSentence(context)));
      continue;
    }
    content.push(
      dataTable({
        heading,
        rows,
        columns: [
          { header: '#', width: 14, align: 'right', cell: (r) => String(r.assignment.number) },
          { header: 'Assignment', width: '*', cell: (r) => userText(r.assignment.title) },
          // Dates only, so most rows take one line; late work shows both times (its row has "Late" under the status).
          {
            header: 'Due',
            width: 52,
            cell: (r) => dueCell(r.assignment.dueAt, frame.dates, r.work.late ? 'two-lines' : 'date'),
          },
          { header: 'Status', width: 56, cell: (r) => studentStatusCell(r.work) },
          { header: 'Handed in', width: 52, cell: (r) => handedInCellFor(r.work, frame.dates) },
          { header: 'Grade', width: 48, align: 'right', cell: (r) => gradeCell(r.work, r.assignment) },
          { header: '%', width: 26, align: 'right', cell: (r) => percentCell(r.work.percent) },
          { header: 'Auto score', width: 34, align: 'right', cell: (r) => percentCell(r.work.autoScore) },
          { header: 'Tests passed', width: 40, align: 'right', cell: (r) => testsCell(r.work) },
        ],
      }),
    );
  }

  return content;
}

/** The counting rules in plain words, for student reports (which may go home to families). */
function studentNotes(context: ReportContext, frame: Frame): string[] {
  // One line each on portrait paper, so the box takes little room under the last table.
  return [
    'Average: the mean of the percentage scores of graded work (each graded assignment counts equally).',
    'Late: handed in after the due date (both times are shown). Work the teacher returned for changes is not late.',
    `Missing: not handed in and past the due date, as of ${frame.dates.dateTime(context.generatedAt)}.`,
    'Returned: sent back by the teacher for changes, to be handed in again.',
    'Auto score and Tests passed: results of the automatic tests run on the student’s code. Autograded: graded from ' +
      'those tests.',
    rangeNote(context),
  ];
}

function classTotalsLine(totals: WorkTotals): string {
  return [
    `Average ${formatPercent(totals.average)}`,
    `Handed in ${ofCount(totals.handedInCount, totals.workCount)}`,
    `Graded ${formatCount(totals.gradedCount)}`,
    `Late ${formatCount(totals.lateCount)}`,
    `Missing ${formatCount(totals.missingCount)}`,
  ].join('  ·  ');
}

/** When the work was handed in: the date, with the time under it for late work. */
function handedInCellFor(work: WorkCell, dates: DateFormats): Cell {
  if (!work.submittedAt) return { text: DASH, color: COLORS.faint };
  return work.late ? dateTimeCell(work.submittedAt, dates) : dates.date(work.submittedAt);
}

/** The status word ("Autograded" for a grade set by autograde), with "Late" under it for late work. */
function studentStatusCell(work: WorkCell): Cell {
  const label = work.status === 'graded' && work.autoGraded ? 'Autograded' : statusLabel(work.status, 'student');
  const late: ContentText[] = work.late ? [{ text: '\nLate', ...STATUS_STYLE.late }] : [];
  switch (work.status) {
    case 'missing':
      return { text: label, ...STATUS_STYLE.missing };
    case 'returned':
      return { text: label, ...STATUS_STYLE.quiet };
    case 'not-handed-in':
      return { text: label, color: COLORS.muted };
    default:
      return { text: [label, ...late] };
  }
}

function gradeCell(work: WorkCell, assignment: ReportAssignment): Cell {
  if (work.status !== 'graded' || work.grade === null) return { text: DASH, color: COLORS.faint };
  return formatScore(work.grade, assignment.points);
}

function testsCell(work: WorkCell): Cell {
  if (work.testsRun === null || work.testsPassed === null || work.testsRun === 0) return { text: DASH, color: COLORS.faint };
  return ofCount(work.testsPassed, work.testsRun);
}

// --- School report --------------------------------------------------------------------------------------------------

function schoolDocument(report: SchoolReport): TDocumentDefinitions {
  const { context, totals } = report;
  const frame = frameFor(context, 'landscape');
  const [average, handedIn, toGrade, late, missing] = workStats(totals, 'staff');

  const content: Content[] = [
    titleBlock(
      context.title,
      report.includesArchived ? 'Every class, including archived classes' : 'Every active class (archived classes not included)',
      [rangeText(context.range, context.timeZone)],
    ),
    statBoxes([
      { label: 'Classes', value: formatCount(report.classCount) },
      { label: 'Teachers', value: formatCount(report.teacherCount) },
      { label: 'Students', value: formatCount(report.studentCount) },
      { label: 'Assignments', value: formatCount(report.assignmentCount) },
      average!,
      handedIn!,
      toGrade!,
      late!,
      missing!,
    ]),
  ];

  if (report.classes.length === 0) {
    content.push(emptySection({ title: 'Classes' }, 'There are no classes to report on.'));
  } else {
    content.push(
      dataTable({
        heading: { title: 'Classes', detail: `${plural(report.classes.length, 'class')} by teacher, then class name` },
        rows: report.classes,
        columns: [
          { header: 'Class', width: '*', cell: (c) => ({ text: [userText(c.name), ...archivedTag(c)] }) },
          // As wide as the Class column: long and hyphenated teacher names wrap at their spaces and hyphens.
          { header: 'Teacher', width: '*', cell: (c) => userText(c.teacherName) },
          { header: 'Students', width: 40, align: 'right', cell: (c) => formatCount(c.studentCount) },
          { header: 'Assignments', width: 50, align: 'right', cell: (c) => formatCount(c.assignmentCount) },
          { header: 'Handed in', width: 44, align: 'right', cell: (c) => percentCell(share(c.totals.handedInCount, c.totals.workCount)) },
          { header: 'Average', width: 40, align: 'right', cell: (c) => percentCell(c.totals.average) },
          { header: 'To grade', width: 38, align: 'right', cell: (c) => countCell(c.totals.toGradeCount) },
          { header: 'Late', width: 32, align: 'right', cell: (c) => countCell(c.totals.lateCount, 'late') },
          { header: 'Missing', width: 40, align: 'right', cell: (c) => countCell(c.totals.missingCount, 'missing') },
        ],
      }),
    );
  }

  if (report.teachers.length === 0) {
    content.push(emptySection({ title: 'Teachers' }, 'No teachers have classes in this report.'));
  } else {
    content.push(
      dataTable({
        heading: { title: 'Teachers', detail: `${plural(report.teachers.length, 'teacher')} by name` },
        rows: report.teachers,
        columns: [
          { header: 'Teacher', width: '*', cell: (t) => userText(t.name) },
          { header: 'Classes', width: 40, align: 'right', cell: (t) => formatCount(t.classCount) },
          { header: 'Students', width: 40, align: 'right', cell: (t) => formatCount(t.studentCount) },
          { header: 'Assignments', width: 50, align: 'right', cell: (t) => formatCount(t.assignmentCount) },
          { header: 'Handed in', width: 44, align: 'right', cell: (t) => percentCell(share(t.totals.handedInCount, t.totals.workCount)) },
          { header: 'Average', width: 40, align: 'right', cell: (t) => percentCell(t.totals.average) },
          { header: 'To grade', width: 38, align: 'right', cell: (t) => countCell(t.totals.toGradeCount) },
          { header: 'Late', width: 32, align: 'right', cell: (t) => countCell(t.totals.lateCount, 'late') },
          { header: 'Missing', width: 40, align: 'right', cell: (t) => countCell(t.totals.missingCount, 'missing') },
        ],
      }),
    );
  }

  if (report.missingWork.length === 0) {
    content.push(emptySection({ title: 'Students with missing work' }, 'No missing work.'));
  } else {
    const people = new Set(report.missingWork.map((m) => m.student.id)).size;
    content.push(
      dataTable({
        heading: {
          title: 'Students with missing work',
          detail: `${plural(people, 'student')}, one row for each class with missing work, most missing first`,
        },
        rows: report.missingWork,
        columns: [
          { header: 'Student', width: '*', cell: (m) => userText(m.student.name) },
          { header: 'Username', width: 110, cell: (m) => ({ text: userText(m.student.username), color: COLORS.muted }) },
          { header: 'Class', width: '*', cell: (m) => ({ text: [userText(m.cls.name), ...archivedTag(m.cls)] }) },
          { header: 'Teacher', width: '*', cell: (m) => userText(m.cls.teacherName) },
          { header: 'Missing', width: 40, align: 'right', cell: (m) => countCell(m.missingCount, 'missing') },
          { header: 'Late', width: 32, align: 'right', cell: (m) => countCell(m.lateCount, 'late') },
          { header: 'Average', width: 40, align: 'right', cell: (m) => percentCell(m.average) },
        ],
      }),
    );
  }

  content.push(
    notesBox([
      'Average: the mean of the percentage scores of graded work (each graded assignment counts equally). Work that ' +
        'isn’t graded yet doesn’t count. Handed in: the share of all work that was handed in or has a grade.',
      'To grade: handed in and waiting for a grade. Late: handed in after the due date (work returned for changes is ' +
        'not late).',
      `Missing: not handed in and past the due date, as of ${frame.dates.dateTime(context.generatedAt)}.`,
      lateBadgesNote('each class’s'),
      `${rangeNote(context)} Students are each class’s current students; a student in several classes is counted once ` +
        'in the Students total.',
    ]),
  );

  return documentShell(context, frame, context.title, {
    header: pageHeader(context.title, null),
    footer: pageFooter(frame.generated, pageOfCount),
    content,
  });
}
