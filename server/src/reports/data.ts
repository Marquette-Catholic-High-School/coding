// Builds the report models (model.ts) from the database. The route checks access before calling these; they only
// read. Every count follows the counting rules in model.ts. Loading is set-based — a handful of queries per report,
// never one per student or assignment — so the school report stays quick for a whole school.

import type { ReportClassOption, ReportOptionsResponse, ReportQuery, ReportStudentOption, User } from '@codeclass/shared';
import { db, parseJson, type SubmissionDbRow } from '../db';
import { notFound } from '../http';
import { isLate } from '../mappers';
import type {
  ClassReport,
  ReportAssignment,
  ReportClass,
  ReportContext,
  ReportStudent,
  SchoolReport,
  SchoolReportClass,
  SchoolReportMissing,
  SchoolReportTeacher,
  StudentReport,
  StudentReportClass,
  StudentReportSet,
  WorkCell,
  WorkTotals,
} from './model';

interface ClassQueryRow {
  id: number;
  name: string;
  archived: 0 | 1;
  owner_id: number;
  owner_name: string;
}

interface AssignmentQueryRow {
  id: number;
  class_id: number;
  title: string;
  language_id: string;
  language_name: string | null;
  due_at: string | null;
  points: number;
  /** JSON TestCase[] ('[]' when the report doesn't need test counts). */
  tests: string;
  created_at: string;
}

type WorkRow = Pick<
  SubmissionDbRow,
  'assignment_id' | 'student_id' | 'status' | 'submitted_at' | 'returned_at' | 'grade' | 'auto_score' | 'auto_graded' | 'test_results'
>;

/** Case-insensitive, accent-aware, "Class 2" before "Class 10". */
const collator = new Intl.Collator('en', { sensitivity: 'accent', numeric: true });

/** Students by name (case-insensitive), then username. */
function compareStudents(a: ReportStudent, b: ReportStudent): number {
  return collator.compare(a.name, b.name) || collator.compare(a.username, b.username) || a.id - b.id;
}

type SortableClass = { id: number; name: string; archived: boolean | 0 | 1 };

/** Active classes first, then by name. */
function compareClasses(a: SortableClass, b: SortableClass): number {
  return Number(a.archived) - Number(b.archived) || collator.compare(a.name, b.name) || a.id - b.id;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export function reportContext(input: { title: string; viewer: User; query: ReportQuery; now?: Date }): ReportContext {
  return {
    title: input.title,
    generatedAt: (input.now ?? new Date()).toISOString(),
    generatedBy: input.viewer.name,
    timeZone: input.query.tz ?? 'UTC',
    paper: input.query.paper,
    range: { from: input.query.from ?? null, to: input.query.to ?? null },
  };
}

// --- Counting ----------------------------------------------------------------------------------------

/** Where one student's work on one assignment stands as of `now` (see `WorkStatus`); `row` undefined = not started. */
function workCell(assignment: { due_at: string | null; points: number }, row: WorkRow | undefined, now: number): WorkCell {
  const graded = row?.status === 'graded' && row.grade != null;
  const handedIn = !graded && (row?.status === 'submitted' || row?.status === 'graded');
  const returned = !graded && !handedIn && row?.returned_at != null;
  const status: WorkCell['status'] = graded
    ? 'graded'
    : handedIn
      ? 'handed-in'
      : returned
        ? 'returned'
        : assignment.due_at != null && Date.parse(assignment.due_at) < now
          ? 'missing'
          : 'not-handed-in';
  // Only handed-in work can be late; missing work is counted as missing, not also as late.
  const late =
    row != null &&
    (graded || handedIn) &&
    row.submitted_at != null &&
    isLate(assignment.due_at, row.status, row.submitted_at, row.returned_at, now);
  const grade = graded ? row!.grade : null;
  const tests = testTally(row?.test_results ?? null);
  return {
    status,
    late,
    grade,
    percent: grade != null && assignment.points > 0 ? (grade / assignment.points) * 100 : null,
    submittedAt: row?.submitted_at ?? null,
    autoScore: row?.auto_score ?? null,
    autoGraded: graded && row!.auto_graded === 1,
    testsPassed: tests?.passed ?? null,
    testsRun: tests?.run ?? null,
  };
}

/** Passed / run from stored `TestResult[]` JSON; null when there are none or the JSON isn't an array. */
function testTally(json: string | null): { passed: number; run: number } | null {
  const results = parseJson<unknown>(json, null);
  if (!Array.isArray(results)) return null;
  const entries = results.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  if (entries.length === 0) return null;
  return { passed: entries.filter((r) => r.passed === true).length, run: entries.length };
}

/** Accumulates `WorkTotals`; tallies merge, so a teacher's or the school's average weighs every piece of work equally. */
class Tally {
  work = 0;
  handedIn = 0;
  graded = 0;
  toGrade = 0;
  late = 0;
  missing = 0;
  percentSum = 0;
  percentCount = 0;

  add(cell: WorkCell): this {
    this.work += 1;
    if (cell.status === 'graded' || cell.status === 'handed-in') this.handedIn += 1;
    if (cell.status === 'graded') this.graded += 1;
    if (cell.status === 'handed-in') this.toGrade += 1;
    if (cell.status === 'missing') this.missing += 1;
    if (cell.late) this.late += 1;
    if (cell.percent != null) {
      this.percentSum += cell.percent;
      this.percentCount += 1;
    }
    return this;
  }

  addAll(cells: Iterable<WorkCell>): this {
    for (const cell of cells) this.add(cell);
    return this;
  }

  merge(other: Tally): this {
    this.work += other.work;
    this.handedIn += other.handedIn;
    this.graded += other.graded;
    this.toGrade += other.toGrade;
    this.late += other.late;
    this.missing += other.missing;
    this.percentSum += other.percentSum;
    this.percentCount += other.percentCount;
    return this;
  }

  totals(): WorkTotals {
    return {
      average: this.percentCount > 0 ? this.percentSum / this.percentCount : null,
      workCount: this.work,
      handedInCount: this.handedIn,
      gradedCount: this.graded,
      toGradeCount: this.toGrade,
      lateCount: this.late,
      missingCount: this.missing,
    };
  }
}

// --- Loading -----------------------------------------------------------------------------------------

const CLASS_COLUMNS = 'SELECT c.id, c.name, c.archived, c.owner_id, u.name AS owner_name FROM classes c JOIN users u ON u.id = c.owner_id';

function classRowsById(classIds: number[]): ClassQueryRow[] {
  const ids = [...new Set(classIds)];
  if (ids.length === 0) return [];
  return db.prepare(`${CLASS_COLUMNS} WHERE c.id IN (${placeholders(ids.length)})`).all(...ids) as ClassQueryRow[];
}

function toReportClass(row: ClassQueryRow): ReportClass {
  return { id: row.id, name: row.name, teacherName: row.owner_name, archived: row.archived === 1 };
}

/** One class's assignments in the range and its students' work on them. */
interface ClassWork {
  cls: ReportClass;
  ownerId: number;
  /** Published, in the range, in order and numbered. */
  assignments: ReportAssignment[];
  /** Current students by name (just the report's student for a student report). */
  students: ReportStudent[];
  /** Each student's cells, one per assignment in `assignments` order. */
  work: Map<number, WorkCell[]>;
}

/**
 * Loads `classes` (kept in the given order) with their assignments in `ctx`'s range and the work on them, in four
 * queries. `student` limits the work to that student (whether or not they're still enrolled; the route decides);
 * otherwise it's every current student. `totalsOnly` skips the test JSON (test counts and results come out empty).
 */
function loadClassWork(
  classes: ClassQueryRow[],
  ctx: ReportContext,
  options: { student?: ReportStudent; totalsOnly?: boolean } = {},
): ClassWork[] {
  if (classes.length === 0) return [];
  const classIds = classes.map((c) => c.id);
  const inClasses = `IN (${placeholders(classIds.length)})`;
  const now = Date.parse(ctx.generatedAt);
  const from = ctx.range.from == null ? null : Date.parse(ctx.range.from);
  const to = ctx.range.to == null ? null : Date.parse(ctx.range.to);

  // Assignments: published, in the range by due date (or created date without one), then ordered and numbered.
  const assignmentRows = db
    .prepare(
      `SELECT a.id, a.class_id, a.title, a.language_id, l.name AS language_name, a.due_at, a.points,
         ${options.totalsOnly ? "'[]' AS tests" : 'a.tests'}, a.created_at
       FROM assignments a LEFT JOIN languages l ON l.id = a.language_id
       WHERE a.published = 1 AND a.class_id ${inClasses}`,
    )
    .all(...classIds) as AssignmentQueryRow[];
  const dated = assignmentRows
    .map((row) => ({ row, at: Date.parse(row.due_at ?? row.created_at), createdAt: Date.parse(row.created_at) }))
    .filter(({ at }) => (from == null || at >= from) && (to == null || at <= to))
    .sort(
      (a, b) =>
        a.at - b.at || a.createdAt - b.createdAt || collator.compare(a.row.title, b.row.title) || a.row.id - b.row.id,
    );
  const assignmentsByClass = new Map<number, { row: AssignmentQueryRow; assignment: ReportAssignment }[]>();
  for (const { row } of dated) {
    let list = assignmentsByClass.get(row.class_id);
    if (!list) assignmentsByClass.set(row.class_id, (list = []));
    const tests = parseJson<unknown>(row.tests, []);
    list.push({
      row,
      assignment: {
        id: row.id,
        number: list.length + 1,
        title: row.title,
        languageName: row.language_name ?? row.language_id,
        dueAt: row.due_at,
        createdAt: row.created_at,
        points: row.points,
        testCount: Array.isArray(tests) ? tests.length : 0,
      },
    });
  }

  // Students: the given one, or each class's current students.
  const studentsByClass = new Map<number, ReportStudent[]>();
  if (options.student) {
    for (const id of classIds) studentsByClass.set(id, [options.student]);
  } else {
    const rows = db
      .prepare(
        `SELECT e.class_id, u.id, u.name, u.username
         FROM enrollments e JOIN users u ON u.id = e.user_id
         WHERE u.role = 'student' AND e.class_id ${inClasses}`,
      )
      .all(...classIds) as (ReportStudent & { class_id: number })[];
    for (const { class_id, ...student } of rows) {
      let list = studentsByClass.get(class_id);
      if (!list) studentsByClass.set(class_id, (list = []));
      list.push(student);
    }
    for (const list of studentsByClass.values()) list.sort(compareStudents);
  }

  // Work, keyed by student then assignment (rows outside the range or from former students are skipped below).
  const studentFilter = options.student ? 'AND s.student_id = ?' : '';
  const workRows = db
    .prepare(
      `SELECT s.assignment_id, s.student_id, s.status, s.submitted_at, s.returned_at, s.grade, s.auto_score,
         s.auto_graded, ${options.totalsOnly ? 'NULL AS test_results' : 's.test_results'}
       FROM submissions s JOIN assignments a ON a.id = s.assignment_id
       WHERE a.published = 1 AND a.class_id ${inClasses} ${studentFilter}`,
    )
    .all(...classIds, ...(options.student ? [options.student.id] : [])) as WorkRow[];
  const workByStudent = new Map<number, Map<number, WorkRow>>();
  for (const row of workRows) {
    let mine = workByStudent.get(row.student_id);
    if (!mine) workByStudent.set(row.student_id, (mine = new Map()));
    mine.set(row.assignment_id, row);
  }

  return classes.map((c) => {
    const assignments = assignmentsByClass.get(c.id) ?? [];
    const students = studentsByClass.get(c.id) ?? [];
    const work = new Map<number, WorkCell[]>();
    for (const student of students) {
      const mine = workByStudent.get(student.id);
      work.set(student.id, assignments.map(({ row }) => workCell(row, mine?.get(row.id), now)));
    }
    return { cls: toReportClass(c), ownerId: c.owner_id, assignments: assignments.map((a) => a.assignment), students, work };
  });
}

function loadStudent(studentId: number): ReportStudent {
  const student = db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(studentId) as ReportStudent | undefined;
  if (!student) throw notFound('Student not found');
  return student;
}

function loadClass(classId: number, ctx: ReportContext): ClassWork {
  const [work] = loadClassWork(classRowsById([classId]), ctx);
  if (!work) throw notFound('Class not found');
  return work;
}

function studentReportClass(c: ClassWork, studentId: number): StudentReportClass {
  const cells = c.work.get(studentId) ?? [];
  return {
    cls: c.cls,
    totals: new Tally().addAll(cells).totals(),
    rows: c.assignments.map((assignment, i) => ({ assignment, work: cells[i]! })),
  };
}

// --- Reports -----------------------------------------------------------------------------------------

export function buildClassReport(classId: number, ctx: ReportContext): ClassReport {
  const c = loadClass(classId, ctx);
  const cellsOf = (studentId: number) => c.work.get(studentId) ?? [];
  return {
    kind: 'class',
    context: ctx,
    cls: c.cls,
    assignments: c.assignments.map((assignment, i) => ({
      ...assignment,
      totals: new Tally().addAll(c.students.map((s) => cellsOf(s.id)[i]!)).totals(),
    })),
    students: c.students.map((student) => ({
      ...student,
      totals: new Tally().addAll(cellsOf(student.id)).totals(),
      work: cellsOf(student.id),
    })),
    totals: new Tally().addAll(c.students.flatMap((s) => cellsOf(s.id))).totals(),
  };
}

/** `classIds` come from the route (see `studentClassIdsFor`); unknown ids are ignored. */
export function buildStudentReport(studentId: number, classIds: number[], ctx: ReportContext): StudentReport {
  const student = loadStudent(studentId);
  const classRows = classRowsById(classIds).sort(compareClasses);
  const classes = loadClassWork(classRows, ctx, { student }).map((c) => studentReportClass(c, student.id));
  const totals = new Tally().addAll(classes.flatMap((c) => c.rows.map((r) => r.work))).totals();
  return { kind: 'student', context: ctx, student, classes, totals };
}

/** One report per current student of the class (by name), each covering only that class. */
export function buildClassStudentReports(classId: number, ctx: ReportContext): StudentReportSet {
  const c = loadClass(classId, ctx);
  return {
    kind: 'students',
    context: ctx,
    cls: c.cls,
    reports: c.students.map((student) => {
      const cls = studentReportClass(c, student.id);
      return { kind: 'student', context: ctx, student, classes: [cls], totals: cls.totals };
    }),
  };
}

export function buildSchoolReport(ctx: ReportContext, includeArchived: boolean): SchoolReport {
  const classRows = (
    db.prepare(`${CLASS_COLUMNS} ${includeArchived ? '' : 'WHERE c.archived = 0'}`).all() as ClassQueryRow[]
  ).sort((a, b) => collator.compare(a.owner_name, b.owner_name) || a.owner_id - b.owner_id || collator.compare(a.name, b.name) || a.id - b.id);
  const loaded = loadClassWork(classRows, ctx, { totalsOnly: true });

  const school = new Tally();
  const schoolStudents = new Set<number>();
  const teachers = new Map<number, { name: string; classCount: number; students: Set<number>; assignmentCount: number; tally: Tally }>();
  const classes: SchoolReportClass[] = [];
  const missingWork: SchoolReportMissing[] = [];

  for (const c of loaded) {
    const classTally = new Tally();
    for (const student of c.students) {
      const studentTally = new Tally().addAll(c.work.get(student.id) ?? []);
      classTally.merge(studentTally);
      schoolStudents.add(student.id);
      if (studentTally.missing > 0) {
        const totals = studentTally.totals();
        missingWork.push({
          student,
          cls: c.cls,
          missingCount: totals.missingCount,
          lateCount: totals.lateCount,
          average: totals.average,
        });
      }
    }
    school.merge(classTally);
    classes.push({ ...c.cls, studentCount: c.students.length, assignmentCount: c.assignments.length, totals: classTally.totals() });

    let teacher = teachers.get(c.ownerId);
    if (!teacher) {
      teacher = { name: c.cls.teacherName, classCount: 0, students: new Set(), assignmentCount: 0, tally: new Tally() };
      teachers.set(c.ownerId, teacher);
    }
    teacher.classCount += 1;
    teacher.assignmentCount += c.assignments.length;
    for (const student of c.students) teacher.students.add(student.id);
    teacher.tally.merge(classTally);
  }

  missingWork.sort(
    (a, b) =>
      b.missingCount - a.missingCount ||
      compareStudents(a.student, b.student) ||
      collator.compare(a.cls.name, b.cls.name) ||
      a.cls.id - b.cls.id,
  );
  const teacherRows: SchoolReportTeacher[] = [...teachers]
    .map(([id, t]) => ({
      id,
      name: t.name,
      classCount: t.classCount,
      studentCount: t.students.size,
      assignmentCount: t.assignmentCount,
      totals: t.tally.totals(),
    }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);

  return {
    kind: 'school',
    context: ctx,
    includesArchived: includeArchived,
    classCount: classes.length,
    teacherCount: teacherRows.length,
    studentCount: schoolStudents.size,
    assignmentCount: classes.reduce((sum, c) => sum + c.assignmentCount, 0),
    totals: school.totals(),
    classes,
    teachers: teacherRows,
    missingWork,
  };
}

// --- Options and access ------------------------------------------------------------------------------

export function reportOptions(viewer: User): ReportOptionsResponse {
  const admin = viewer.role === 'admin';
  const ownerArgs = admin ? [] : [viewer.id];

  const classRows = db
    .prepare(
      `SELECT c.id, c.name, c.archived, u.name AS owner_name,
         (SELECT COUNT(*) FROM enrollments e JOIN users s ON s.id = e.user_id
          WHERE e.class_id = c.id AND s.role = 'student') AS student_count
       FROM classes c JOIN users u ON u.id = c.owner_id
       ${admin ? '' : 'WHERE c.owner_id = ?'}`,
    )
    .all(...ownerArgs) as (Omit<ClassQueryRow, 'owner_id'> & { student_count: number })[];
  const classes: ReportClassOption[] = classRows
    .map((r) => ({ id: r.id, name: r.name, teacherName: r.owner_name, archived: r.archived === 1, studentCount: r.student_count }))
    .sort(compareClasses);
  const classOrder = new Map(classes.map((c, i) => [c.id, i]));

  const enrolled = db
    .prepare(
      `SELECT e.class_id, u.id, u.name, u.username
       FROM enrollments e JOIN users u ON u.id = e.user_id JOIN classes c ON c.id = e.class_id
       WHERE u.role = 'student' ${admin ? '' : 'AND c.owner_id = ?'}`,
    )
    .all(...ownerArgs) as (ReportStudent & { class_id: number })[];
  const students = new Map<number, ReportStudentOption>();
  for (const { class_id, ...student } of enrolled) {
    let option = students.get(student.id);
    if (!option) students.set(student.id, (option = { ...student, classIds: [] }));
    option.classIds.push(class_id);
  }
  for (const option of students.values()) option.classIds.sort((a, b) => classOrder.get(a)! - classOrder.get(b)!);

  return { classes, students: [...students.values()].sort(compareStudents), school: admin };
}

/** Classes `viewer` may report on that `studentId` is in (teacher: classes they own; admin: all). */
export function studentClassIdsFor(viewer: User, studentId: number): number[] {
  const admin = viewer.role === 'admin';
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.archived
       FROM enrollments e JOIN classes c ON c.id = e.class_id JOIN users u ON u.id = e.user_id
       WHERE e.user_id = ? AND u.role = 'student' ${admin ? '' : 'AND c.owner_id = ?'}`,
    )
    .all(studentId, ...(admin ? [] : [viewer.id])) as { id: number; name: string; archived: 0 | 1 }[];
  return rows
    .map((r) => ({ id: r.id, name: r.name, archived: r.archived === 1 }))
    .sort(compareClasses)
    .map((c) => c.id);
}
