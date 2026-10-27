// Hand-built report models for the PDF tests (and the visual check): deterministic, realistic data built straight
// from model.ts, with totals worked out by the same counting rules data.ts uses.

import type { PaperSize } from '@codeclass/shared';
import type {
  ClassReport,
  ClassReportAssignment,
  ClassReportStudent,
  ReportAssignment,
  ReportClass,
  ReportContext,
  ReportStudent,
  SchoolReport,
  SchoolReportMissing,
  StudentReport,
  StudentReportSet,
  WorkCell,
  WorkTotals,
} from '../../src/reports/model';

export const GENERATED_AT = '2026-10-27T19:14:00.000Z';
const DAY = 86_400_000;

export function reportContext(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    title: 'Class report',
    generatedAt: GENERATED_AT,
    generatedBy: 'Ms. Rivera',
    timeZone: 'America/Chicago',
    paper: 'letter',
    range: { from: null, to: null },
    ...overrides,
  };
}

/** Small deterministic PRNG (mulberry32) so fixtures are the same on every run. */
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return { next, pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
}

// --- Totals (the counting rules in model.ts) ------------------------------------------------------------------------

export function totalsOf(cells: WorkCell[]): WorkTotals {
  const percents = cells.filter((c) => c.status === 'graded' && c.percent !== null).map((c) => c.percent!);
  return {
    average: percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null,
    workCount: cells.length,
    handedInCount: cells.filter((c) => c.status === 'graded' || c.status === 'handed-in').length,
    gradedCount: cells.filter((c) => c.status === 'graded').length,
    toGradeCount: cells.filter((c) => c.status === 'handed-in').length,
    lateCount: cells.filter((c) => c.late).length,
    missingCount: cells.filter((c) => c.status === 'missing').length,
  };
}

// --- Names ----------------------------------------------------------------------------------------------------------

const FIRST = [
  'Ava', 'Liam', 'Zoë', 'José', 'Mia', 'Noah', 'Siobhán', 'Łukasz', 'Amara', 'Mateo', 'Chloé', 'Ethan', 'Ingrid',
  'Kofi', 'Priya', 'Søren', 'Isabella', 'Hiro', 'Fatima', 'Lucas', 'Ana María', 'Oliver', 'Nia', 'Björn', 'Emma',
  'Diego', 'Leïla', 'Samuel', 'Grace', 'Jonás',
];
const LAST = [
  'Nguyễn', 'Smith', 'García', 'Okafor', "O'Brien", 'Müller', 'Kowalski', 'Patel', 'Johansson', 'Rossi', 'Dubois',
  'Kim', 'Haddad', 'Novak', 'Fernández', 'Brown', 'Ivanova', 'Lefèvre', 'Tanaka', 'Wright', 'Mensah', 'Costa',
  'Andersen', 'Schmidt', 'Lopez', 'Moreau', 'Walker', 'Silva', 'Chen', 'Murphy',
];
const TITLES = [
  'Hello, world', 'Variables and input', 'If statements', 'FizzBuzz', 'Loops practice', 'Lists and averages',
  'Functions', 'Guess the number', 'String methods', 'Dictionaries', 'Reading files', 'Recursion',
  'Sorting algorithms', 'Binary search in pseudocode', 'Text adventure project', 'Turtle drawing', 'Quiz game',
  'Temperature converter', 'Tic-tac-toe', 'Caesar cipher', 'Unit 3 review', 'Debugging challenge',
  'Password checker', 'Shopping list app', 'Grade calculator',
];
const LANGUAGES = ['Python', 'JavaScript', 'CodeClass Pseudocode', 'HTML & CSS', 'Java'];

export const LONG = {
  className: 'AP Computer Science Principles — Period 3 (Room 214, Tuesdays & Thursdays) with the extended lab block',
  teacherName: 'Dr. Margarethe Alexandrina Featherstonehaugh-Villanueva',
  studentName: 'Maximilian Alexander Wolfgang von Hohenzollern-Sigmaringen der Dritte',
  username: 'maximilian.alexander.hohenzollern.sigmaringen2031',
  assignmentTitle:
    'Lab 7: Building a text adventure game with dictionaries, loops, functions and file input/output (extension: save games)',
  unbroken: 'Supercalifragilisticexpialidocious_and_another_very_long_unbroken_identifier_for_overflow_testing',
};

/** Characters Roboto doesn't have (CJK, emoji, Arabic): must not crash. */
export const NO_GLYPHS = { studentName: '王小明 🙂', className: 'برمجة 101 · 프로그래밍' };

export function students(count: number, seed = 1, extra: Partial<ReportStudent>[] = []): ReportStudent[] {
  const rnd = random(seed);
  const list: ReportStudent[] = extra.map((s, i) => ({ id: 10_000 + i, name: 'Extra', username: `extra${i}`, ...s }));
  for (let i = list.length; i < count; i++) {
    const first = rnd.pick(FIRST);
    const last = rnd.pick(LAST);
    list.push({
      id: seed * 1000 + i,
      name: `${first} ${last}`,
      username: `${first.split(' ')[0]!.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}${i}`,
    });
  }
  return list
    .slice(0, count)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.username.localeCompare(b.username));
}

// --- Class reports --------------------------------------------------------------------------------------------------

export interface ClassFixtureOptions {
  id?: number;
  name?: string;
  teacherName?: string;
  archived?: boolean;
  studentCount?: number;
  assignmentCount?: number;
  seed?: number;
  paper?: PaperSize;
  context?: Partial<ReportContext>;
  /** Replace generated students (e.g. long or odd names). */
  studentList?: ReportStudent[];
  /** Override some assignment titles by index. */
  titles?: Record<number, string>;
}

export function assignments(count: number, seed: number, titles: Record<number, string> = {}): ReportAssignment[] {
  const rnd = random(seed + 7);
  const now = Date.parse(GENERATED_AT);
  return Array.from({ length: count }, (_, i) => {
    // Spread due dates from ~10 weeks ago to ~2 weeks ahead; every 7th has no due date.
    const dueAt = i % 7 === 5 ? null : new Date(now - (70 - Math.round((i / Math.max(1, count - 1)) * 84)) * DAY + 5 * 3_600_000).toISOString();
    const createdAt = new Date((dueAt ? Date.parse(dueAt) : now - 20 * DAY) - 7 * DAY).toISOString();
    const points = i % 11 === 4 ? 0 : rnd.pick([10, 10, 10, 20, 25, 5, 100]);
    return {
      id: seed * 1000 + i,
      number: i + 1,
      title: titles[i] ?? `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : ''}`,
      languageName: rnd.pick(LANGUAGES),
      dueAt,
      createdAt,
      points,
      testCount: rnd.pick([0, 0, 3, 4, 5, 8]),
    };
  });
}

function workFor(assignment: ReportAssignment, rnd: ReturnType<typeof random>): WorkCell {
  const now = Date.parse(GENERATED_AT);
  const due = assignment.dueAt ? Date.parse(assignment.dueAt) : null;
  const past = due !== null && due < now;
  const roll = rnd.next();
  const tests = (): Pick<WorkCell, 'testsPassed' | 'testsRun' | 'autoScore'> => {
    if (assignment.testCount === 0) return { testsPassed: null, testsRun: null, autoScore: null };
    const passed = Math.floor(rnd.next() * (assignment.testCount + 1));
    return { testsPassed: passed, testsRun: assignment.testCount, autoScore: (passed / assignment.testCount) * 100 };
  };
  const blank: WorkCell = {
    status: 'not-handed-in',
    late: false,
    grade: null,
    percent: null,
    submittedAt: null,
    autoScore: null,
    autoGraded: false,
    testsPassed: null,
    testsRun: null,
  };
  const submitted = (late: boolean) =>
    new Date(Math.min(now - 3_600_000, (due ?? now - 3 * DAY) + (late ? 0.5 + rnd.next() * 3 : -rnd.next() * 4) * DAY)).toISOString();

  if (!past && due !== null) {
    if (roll < 0.25) return { ...blank, status: 'handed-in', submittedAt: submitted(false), ...tests() };
    return blank;
  }
  if (roll < 0.08 && past) return { ...blank, status: 'missing' };
  if (roll < 0.11) return { ...blank, status: 'returned', submittedAt: null, ...tests() };
  if (roll < 0.2) {
    const late = past && rnd.next() < 0.3;
    return { ...blank, status: 'handed-in', late, submittedAt: submitted(late), ...tests() };
  }
  if (roll < 0.23 && due === null) return blank;
  const late = past && rnd.next() < 0.12;
  const t = tests();
  const autoGraded = t.autoScore !== null && rnd.next() < 0.5;
  const grade = autoGraded
    ? Math.round(((t.autoScore! / 100) * assignment.points) * 10) / 10
    : Math.round(assignment.points * (0.55 + rnd.next() * 0.45) * 2) / 2;
  return {
    ...blank,
    ...t,
    status: 'graded',
    late,
    grade,
    percent: assignment.points > 0 ? (grade / assignment.points) * 100 : null,
    submittedAt: submitted(late),
    autoGraded,
  };
}

export function classFixture(options: ClassFixtureOptions = {}): ClassReport {
  const seed = options.seed ?? 1;
  const rnd = random(seed + 13);
  const cls: ReportClass = {
    id: options.id ?? seed,
    name: options.name ?? 'Year 8 Computing',
    teacherName: options.teacherName ?? 'Ms. Rivera',
    archived: options.archived ?? false,
  };
  const list = options.studentList ?? students(options.studentCount ?? 24, seed);
  const tasks = assignments(options.assignmentCount ?? 12, seed, options.titles);
  const rows: ClassReportStudent[] = list.map((student) => {
    const work = tasks.map((a) => workFor(a, rnd));
    return { ...student, work, totals: totalsOf(work) };
  });
  const withTotals: ClassReportAssignment[] = tasks.map((a, i) => ({ ...a, totals: totalsOf(rows.map((s) => s.work[i]!)) }));
  return {
    kind: 'class',
    context: reportContext({ paper: options.paper ?? 'letter', ...options.context }),
    cls,
    assignments: withTotals,
    students: rows,
    totals: totalsOf(rows.flatMap((s) => s.work)),
  };
}

// --- Student reports ------------------------------------------------------------------------------------------------

/** One student's report across some class reports (they must all contain `studentId`). */
export function studentFixture(classes: ClassReport[], studentId: number, context: Partial<ReportContext> = {}): StudentReport {
  const sections = classes.map((report) => {
    const row = report.students.find((s) => s.id === studentId)!;
    return {
      cls: report.cls,
      totals: row.totals,
      rows: report.assignments.map(({ totals: _t, ...assignment }, i) => ({ assignment, work: row.work[i]! })),
    };
  });
  const row = classes[0]!.students.find((s) => s.id === studentId)!;
  return {
    kind: 'student',
    context: reportContext({ title: 'Student report', paper: classes[0]!.context.paper, ...context }),
    student: { id: row.id, name: row.name, username: row.username },
    classes: sections.sort((a, b) => Number(a.cls.archived) - Number(b.cls.archived) || a.cls.name.localeCompare(b.cls.name)),
    totals: totalsOf(sections.flatMap((s) => s.rows.map((r) => r.work))),
  };
}

export function studentSetFixture(report: ClassReport): StudentReportSet {
  return {
    kind: 'students',
    context: { ...report.context, title: 'Student reports' },
    cls: report.cls,
    // Like data.ts, every student's report shares the set's context.
    reports: report.students.map((s) => studentFixture([report], s.id, { ...report.context, title: 'Student reports' })),
  };
}

// --- School report --------------------------------------------------------------------------------------------------

export function schoolFixture(classes: ClassReport[], options: { includesArchived?: boolean; paper?: PaperSize } = {}): SchoolReport {
  const included = classes.filter((c) => options.includesArchived || !c.cls.archived);
  const byTeacher = new Map<string, ClassReport[]>();
  for (const c of included) byTeacher.set(c.cls.teacherName, [...(byTeacher.get(c.cls.teacherName) ?? []), c]);
  const missingWork: SchoolReportMissing[] = included
    .flatMap((c) =>
      c.students
        .filter((s) => s.totals.missingCount > 0)
        .map((s) => ({
          student: { id: s.id, name: s.name, username: s.username },
          cls: c.cls,
          missingCount: s.totals.missingCount,
          lateCount: s.totals.lateCount,
          average: s.totals.average,
        })),
    )
    .sort((a, b) => b.missingCount - a.missingCount || a.student.name.localeCompare(b.student.name) || a.cls.name.localeCompare(b.cls.name));
  const teachers = [...byTeacher.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list], i) => ({
      id: i + 1,
      name,
      classCount: list.length,
      studentCount: new Set(list.flatMap((c) => c.students.map((s) => s.id))).size,
      assignmentCount: list.reduce((n, c) => n + c.assignments.length, 0),
      totals: totalsOf(list.flatMap((c) => c.students.flatMap((s) => s.work))),
    }));
  return {
    kind: 'school',
    context: reportContext({ title: 'School report', generatedBy: 'Mr. Okafor (Admin)', paper: options.paper ?? 'letter' }),
    includesArchived: options.includesArchived ?? false,
    classCount: included.length,
    teacherCount: byTeacher.size,
    studentCount: new Set(included.flatMap((c) => c.students.map((s) => s.id))).size,
    assignmentCount: included.reduce((n, c) => n + c.assignments.length, 0),
    totals: totalsOf(included.flatMap((c) => c.students.flatMap((s) => s.work))),
    classes: included
      .map((c) => ({
        ...c.cls,
        studentCount: c.students.length,
        assignmentCount: c.assignments.length,
        totals: c.totals,
      }))
      .sort((a, b) => a.teacherName.localeCompare(b.teacherName) || a.name.localeCompare(b.name)),
    teachers,
    missingWork,
  };
}

const TEACHERS = [
  'Ms. Rivera', 'Mr. Okafor', 'Mrs. Lindqvist', 'Mr. Dubois', 'Ms. Nakamura', 'Dr. Patel', 'Mr. García',
  'Ms. O’Connor', 'Mr. Kowalski', 'Mrs. Haddad', 'Ms. Ivanova', 'Mr. Mensah',
];
const SUBJECTS = [
  'Intro to Programming', 'Year 7 Computing', 'Year 8 Computing', 'Year 9 Computing', 'AP CS Principles',
  'AP CS A', 'Web Design', 'Python Club', 'Robotics', 'Data Science', 'Game Design', 'Cybersecurity Basics',
];

/**
 * A school of `classCount` classes with `studentsPerClass` students each, all different, except that every third
 * class also has five students from the class before it (so distinct counting matters).
 */
export function schoolClasses(classCount: number, studentsPerClass: number, assignmentsPerClass: number): ClassReport[] {
  const pool = students(classCount * studentsPerClass, 99);
  return Array.from({ length: classCount }, (_, i) => {
    const own = pool.slice(i * studentsPerClass, (i + 1) * studentsPerClass);
    const shared = i % 3 === 2 ? pool.slice((i - 1) * studentsPerClass, (i - 1) * studentsPerClass + 5) : [];
    const studentList = [...own, ...shared].sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username));
    return classFixture({
      id: i + 1,
      seed: 500 + i,
      name: `${SUBJECTS[i % SUBJECTS.length]} — Period ${(i % 7) + 1}${i >= SUBJECTS.length * 2 ? ` (${String.fromCharCode(65 + (i % 26))})` : ''}`,
      teacherName: TEACHERS[i % TEACHERS.length]!,
      archived: i % 9 === 8,
      studentList,
      assignmentCount: assignmentsPerClass,
    });
  });
}
