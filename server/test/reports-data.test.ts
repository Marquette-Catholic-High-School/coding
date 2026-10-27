import { reportQuerySchema, type ReportQuery, type User } from '@codeclass/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import {
  buildClassReport,
  buildClassStudentReports,
  buildSchoolReport,
  buildStudentReport,
  reportContext,
  reportOptions,
  studentClassIdsFor,
} from '../src/reports/data';
import type { ClassReport, ReportContext, WorkCell, WorkTotals } from '../src/reports/model';

// Every report is made "now" = NOW, so due dates are fixed relative to it.
const NOW = new Date('2026-10-15T12:00:00.000Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** NOW moved by `days` (+ `hours`), as stored ISO. */
const at = (days: number, hours = 0) => new Date(NOW.getTime() + days * DAY_MS + hours * HOUR_MS).toISOString();

/** Each describe block starts from an empty database (the file shares one in-memory DB). */
function resetDb() {
  db.exec(`
    DELETE FROM submissions; DELETE FROM assignments; DELETE FROM enrollments; DELETE FROM class_languages;
    DELETE FROM class_invites; DELETE FROM classes; DELETE FROM sessions; DELETE FROM projects; DELETE FROM users;
    DELETE FROM languages;`);
  db.prepare('INSERT INTO languages (id, kind, name) VALUES (?, ?, ?)').run('python', 'python', 'Python 3');
}

let seq = 0;

function addUser(role: User['role'], name: string, username = `${role}${++seq}`): User {
  const info = db
    .prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)')
    .run(username, name, role, 'not-a-real-hash');
  return {
    id: Number(info.lastInsertRowid),
    username,
    email: null,
    name,
    role,
    mustChangePassword: false,
    createdAt: NOW.toISOString(),
  };
}

function addClass(owner: User, name: string, archived = false): number {
  const info = db
    .prepare('INSERT INTO classes (name, join_code, archived, owner_id) VALUES (?, ?, ?, ?)')
    .run(name, `CODE${++seq}`, archived ? 1 : 0, owner.id);
  return Number(info.lastInsertRowid);
}

function enroll(classId: number, user: User) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, user.id);
}

function addAssignment(
  classId: number,
  title: string,
  opts: { dueAt?: string | null; createdAt?: string; points?: number; published?: boolean; tests?: string } = {},
): number {
  const info = db
    .prepare(
      `INSERT INTO assignments (class_id, title, language_id, due_at, points, published, tests, created_at)
       VALUES (?, ?, 'python', ?, ?, ?, ?, ?)`,
    )
    .run(
      classId,
      title,
      opts.dueAt === undefined ? at(-1) : opts.dueAt,
      opts.points ?? 10,
      opts.published === false ? 0 : 1,
      opts.tests ?? '[]',
      opts.createdAt ?? at(-30),
    );
  return Number(info.lastInsertRowid);
}

function addWork(
  assignmentId: number,
  student: User,
  opts: {
    status?: 'in_progress' | 'submitted' | 'graded';
    submittedAt?: string | null;
    grade?: number | null;
    returnedAt?: string | null;
    autoScore?: number | null;
    autoGraded?: boolean;
    testResults?: string | null;
  } = {},
) {
  db.prepare(
    `INSERT INTO submissions (assignment_id, student_id, status, submitted_at, grade, returned_at, auto_score,
       auto_graded, test_results)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    assignmentId,
    student.id,
    opts.status ?? 'submitted',
    opts.submittedAt ?? null,
    opts.grade ?? null,
    opts.returnedAt ?? null,
    opts.autoScore ?? null,
    opts.autoGraded ? 1 : 0,
    opts.testResults ?? null,
  );
}

const VIEWER: User = {
  id: 999_999,
  username: 'rivera',
  email: null,
  name: 'Ms Rivera',
  role: 'teacher',
  mustChangePassword: false,
  createdAt: NOW.toISOString(),
};

function ctx(query: Partial<ReportQuery> = {}, title = 'Class report'): ReportContext {
  return reportContext({ title, viewer: VIEWER, query: { paper: 'letter', ...query }, now: NOW });
}

function cellOf(report: ClassReport, studentId: number, assignmentId: number): WorkCell {
  const student = report.students.find((s) => s.id === studentId);
  const index = report.assignments.findIndex((a) => a.id === assignmentId);
  if (!student || index < 0) throw new Error(`No cell for student ${studentId}, assignment ${assignmentId}`);
  return student.work[index]!;
}

/** Totals without the average (checked separately with toBeCloseTo). */
function counts(totals: WorkTotals): Omit<WorkTotals, 'average'> {
  const { average: _average, ...rest } = totals;
  return rest;
}

const ZERO_TOTALS: WorkTotals = {
  average: null,
  workCount: 0,
  handedInCount: 0,
  gradedCount: 0,
  toGradeCount: 0,
  lateCount: 0,
  missingCount: 0,
};

describe('reportContext', () => {
  it('takes the title, viewer, time zone, paper and range from the request', () => {
    const query = reportQuerySchema.parse({
      from: '2026-09-01T00:00:00-05:00',
      to: '2026-10-31T23:59:59.999-05:00',
      tz: 'America/Chicago',
      paper: 'a4',
    });
    expect(reportContext({ title: 'Class report', viewer: VIEWER, query, now: NOW })).toEqual({
      title: 'Class report',
      generatedAt: '2026-10-15T12:00:00.000Z',
      generatedBy: 'Ms Rivera',
      timeZone: 'America/Chicago',
      paper: 'a4',
      range: { from: '2026-09-01T00:00:00-05:00', to: '2026-10-31T23:59:59.999-05:00' },
    });
  });

  it('defaults to UTC, Letter paper, every date and the current time', () => {
    const before = Date.now();
    const context = reportContext({ title: 'School report', viewer: VIEWER, query: reportQuerySchema.parse({}) });
    expect(context).toMatchObject({ timeZone: 'UTC', paper: 'letter', range: { from: null, to: null } });
    expect(Date.parse(context.generatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(context.generatedAt)).toBeLessThanOrEqual(Date.now());
  });
});

describe('work cells: statuses, late and missing', () => {
  const ids: Record<string, number> = {};
  const s: Record<string, User> = {};
  let report: ClassReport;
  const DUE = at(-2);

  beforeAll(() => {
    resetDb();
    const teacher = addUser('teacher', 'Teacher');
    ids.cls = addClass(teacher, 'Statuses');
    ids.past = addAssignment(ids.cls, 'Past', { dueAt: DUE, createdAt: at(-10) });
    ids.future = addAssignment(ids.cls, 'Future', { dueAt: at(2), createdAt: at(-10) });
    ids.noDue = addAssignment(ids.cls, 'No due date', { dueAt: null, createdAt: at(-9) });
    ids.zero = addAssignment(ids.cls, 'Zero points', { dueAt: at(-1), points: 0, createdAt: at(-10) });
    const due = Date.parse(DUE);
    const offset = (ms: number) => new Date(due + ms).toISOString();

    const scenarios: [string, (user: User) => void][] = [
      ['notStarted', () => {}],
      ['inProgress', (u) => addWork(ids.past, u, { status: 'in_progress' })],
      // Returned for revision keeps submitted_at (and stays "returned" after the due date).
      ['returned', (u) => addWork(ids.past, u, { status: 'in_progress', submittedAt: offset(-HOUR_MS), returnedAt: at(-1) })],
      ['early', (u) => addWork(ids.past, u, { status: 'submitted', submittedAt: offset(-HOUR_MS) })],
      ['late', (u) => addWork(ids.past, u, { status: 'submitted', submittedAt: offset(HOUR_MS) })],
      ['onTheDot', (u) => addWork(ids.past, u, { status: 'submitted', submittedAt: DUE })],
      [
        'gradedLate',
        (u) =>
          addWork(ids.past, u, {
            status: 'graded',
            submittedAt: offset(HOUR_MS),
            grade: 7.5,
            autoGraded: true,
            autoScore: 75,
            testResults: JSON.stringify([{ passed: true }, { passed: false }, { passed: true }]),
          }),
      ],
      // A graded row without a grade (grade taken off) is still waiting to be graded.
      ['gradedNoGrade', (u) => addWork(ids.past, u, { status: 'graded', submittedAt: offset(-HOUR_MS), autoGraded: true })],
      // 0 for missing work: graded, never handed in, not late.
      ['gradedNeverHandedIn', (u) => addWork(ids.past, u, { status: 'graded', grade: 0 })],
      [
        'returnedThenLate',
        (u) => addWork(ids.past, u, { status: 'submitted', submittedAt: offset(HOUR_MS), returnedAt: offset(-HOUR_MS) }),
      ],
      ['returnedThenGraded', (u) => addWork(ids.past, u, { status: 'graded', submittedAt: offset(HOUR_MS), grade: 9, returnedAt: at(-3) })],
      ['badJson', (u) => addWork(ids.past, u, { status: 'in_progress', autoScore: 50, testResults: '{oops' })],
    ];
    for (const [key, setUp] of scenarios) {
      s[key] = addUser('student', `Student ${key}`);
      enroll(ids.cls, s[key]);
      setUp(s[key]);
    }

    // Other assignments: handed in with no due date / before a future due date; graded on a 0-point assignment.
    addWork(ids.future, s.early!, { status: 'submitted', submittedAt: at(-1) });
    addWork(ids.future, s.inProgress!, { status: 'in_progress' });
    addWork(ids.noDue, s.early!, { status: 'submitted', submittedAt: at(-1), testResults: '[]' });
    addWork(ids.noDue, s.late!, { status: 'submitted', submittedAt: at(-1), testResults: '{"passed":true}' });
    addWork(ids.noDue, s.onTheDot!, { status: 'submitted', submittedAt: at(-1), testResults: '[1, {"passed":true}, {"passed":"yes"}]' });
    addWork(ids.zero, s.early!, { status: 'graded', submittedAt: at(-3), grade: 0 });

    report = buildClassReport(ids.cls, ctx());
  });

  const cell = (student: string, assignment = 'past') => cellOf(report, s[student]!.id, ids[assignment]!);

  it('not started or in progress past the due date is missing (and not also late)', () => {
    expect(cell('notStarted')).toMatchObject({ status: 'missing', late: false, grade: null, submittedAt: null });
    expect(cell('inProgress')).toMatchObject({ status: 'missing', late: false });
  });

  it('not handed in before a future due date, or with no due date, is not handed in yet', () => {
    expect(cell('notStarted', 'future')).toMatchObject({ status: 'not-handed-in', late: false });
    expect(cell('inProgress', 'future')).toMatchObject({ status: 'not-handed-in', late: false });
    expect(cell('notStarted', 'noDue')).toMatchObject({ status: 'not-handed-in', late: false });
  });

  it('returned work is returned, never missing or late', () => {
    expect(cell('returned')).toMatchObject({ status: 'returned', late: false, submittedAt: at(-2, -1) });
  });

  it('handed-in work is late only when handed in after the due date', () => {
    expect(cell('early')).toMatchObject({ status: 'handed-in', late: false, submittedAt: at(-2, -1) });
    expect(cell('late')).toMatchObject({ status: 'handed-in', late: true });
    expect(cell('onTheDot')).toMatchObject({ status: 'handed-in', late: false });
    expect(cell('early', 'future')).toMatchObject({ status: 'handed-in', late: false });
    expect(cell('early', 'noDue')).toMatchObject({ status: 'handed-in', late: false });
  });

  it('graded work has a grade, percent and autograde details', () => {
    expect(cell('gradedLate')).toEqual({
      status: 'graded',
      late: true,
      grade: 7.5,
      percent: 75,
      submittedAt: at(-2, 1),
      autoScore: 75,
      autoGraded: true,
      testsPassed: 2,
      testsRun: 3,
    });
  });

  it('a graded row without a grade is handed in (to grade), not autograded', () => {
    expect(cell('gradedNoGrade')).toMatchObject({ status: 'handed-in', grade: null, percent: null, autoGraded: false, late: false });
  });

  it('graded work that was never handed in is graded and not late', () => {
    expect(cell('gradedNeverHandedIn')).toMatchObject({ status: 'graded', grade: 0, percent: 0, late: false, submittedAt: null });
  });

  it('work returned for revision is never late, even handed in again or graded after the due date', () => {
    expect(cell('returnedThenLate')).toMatchObject({ status: 'handed-in', late: false });
    expect(cell('returnedThenGraded')).toMatchObject({ status: 'graded', late: false, grade: 9, percent: 90 });
  });

  it('a 0-point assignment has no percent', () => {
    expect(cell('early', 'zero')).toMatchObject({ status: 'graded', grade: 0, percent: null });
  });

  it('reads test results leniently', () => {
    expect(cell('badJson')).toMatchObject({ status: 'missing', autoScore: 50, testsPassed: null, testsRun: null });
    expect(cell('notStarted')).toMatchObject({ autoScore: null, testsPassed: null, testsRun: null });
    expect(cell('early', 'noDue')).toMatchObject({ testsPassed: null, testsRun: null }); // []
    expect(cell('late', 'noDue')).toMatchObject({ testsPassed: null, testsRun: null }); // not an array
    expect(cell('onTheDot', 'noDue')).toMatchObject({ testsPassed: 1, testsRun: 2 }); // non-objects skipped
  });

  it('missing is decided as of the report time', () => {
    const earlier = buildClassReport(ids.cls, reportContext({ title: 'Class report', viewer: VIEWER, query: { paper: 'letter' }, now: new Date(Date.parse(DUE) - 1) }));
    expect(cellOf(earlier, s.notStarted!.id, ids.past!).status).toBe('not-handed-in');
    const exactly = buildClassReport(ids.cls, reportContext({ title: 'Class report', viewer: VIEWER, query: { paper: 'letter' }, now: new Date(DUE) }));
    expect(cellOf(exactly, s.notStarted!.id, ids.past!).status).toBe('not-handed-in');
  });

  it('counts every status into the class totals', () => {
    const past = report.assignments.find((a) => a.id === ids.past)!;
    // 12 students: graded = gradedLate, gradedNeverHandedIn, returnedThenGraded; handed in = those + early, late,
    // onTheDot, gradedNoGrade, returnedThenLate; late = late, gradedLate; missing = notStarted, inProgress, badJson.
    expect(counts(past.totals)).toEqual({
      workCount: 12,
      handedInCount: 8,
      gradedCount: 3,
      toGradeCount: 5,
      lateCount: 2,
      missingCount: 3,
    });
    expect(past.totals.average).toBeCloseTo((75 + 0 + 90) / 3);
  });
});

describe('assignments: drafts, order, numbering, range', () => {
  const ids: Record<string, number> = {};
  let student: User;

  beforeAll(() => {
    resetDb();
    const teacher = addUser('teacher', 'Teacher');
    ids.cls = addClass(teacher, 'Order');
    student = addUser('student', 'Student');
    enroll(ids.cls, student);
    // Inserted out of order on purpose.
    ids.hotel = addAssignment(ids.cls, 'Hotel', {
      dueAt: at(3),
      tests: JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c', hidden: true }]),
    });
    ids.bravo = addAssignment(ids.cls, 'Bravo', { dueAt: at(-5), createdAt: at(-10) });
    ids.alpha = addAssignment(ids.cls, 'Alpha', { dueAt: at(-5), createdAt: at(-20) });
    ids.india = addAssignment(ids.cls, 'India', { dueAt: null, createdAt: at(-1), tests: 'not json' });
    ids.echo1 = addAssignment(ids.cls, 'Echo', { dueAt: at(-3), createdAt: at(-15) });
    ids.delta = addAssignment(ids.cls, 'delta', { dueAt: at(-3), createdAt: at(-15) });
    ids.echo2 = addAssignment(ids.cls, 'Echo', { dueAt: at(-3), createdAt: at(-15) });
    ids.foxtrot = addAssignment(ids.cls, 'Foxtrot', { dueAt: null, createdAt: at(-4) });
    ids.draft = addAssignment(ids.cls, 'Draft', { dueAt: at(-4), published: false });
    addWork(ids.draft, student, { status: 'graded', submittedAt: at(-5), grade: 10 });
  });

  it('lists published assignments by due date (or created date), then created date, title and id, numbered from 1', () => {
    const report = buildClassReport(ids.cls, ctx());
    expect(report.assignments.map((a) => [a.number, a.id])).toEqual(
      ['alpha', 'bravo', 'foxtrot', 'delta', 'echo1', 'echo2', 'india', 'hotel'].map((key, i) => [i + 1, ids[key]]),
    );
    // Drafts and work on them don't count.
    expect(report.students[0]!.work).toHaveLength(8);
    expect(report.totals.gradedCount).toBe(0);
  });

  it('carries the language name, dates, points and test count (hidden tests included; bad JSON = 0)', () => {
    const report = buildClassReport(ids.cls, ctx());
    const hotel = report.assignments.find((a) => a.id === ids.hotel)!;
    expect(hotel).toMatchObject({ title: 'Hotel', languageName: 'Python 3', dueAt: at(3), createdAt: at(-30), points: 10, testCount: 3 });
    expect(report.assignments.find((a) => a.id === ids.india)).toMatchObject({ dueAt: null, testCount: 0 });
  });

  it('keeps assignments due (or, with no due date, created) in the range, both ends included', () => {
    const report = buildClassReport(ids.cls, ctx({ from: at(-4), to: at(-1) }));
    expect(report.assignments.map((a) => [a.number, a.id])).toEqual(
      ['foxtrot', 'delta', 'echo1', 'echo2', 'india'].map((key, i) => [i + 1, ids[key]]),
    );
    expect(report.students[0]!.work).toHaveLength(5);
  });

  it('compares range ends as instants, whatever their offset', () => {
    // at(-3) = 2026-10-12T12:00:00.000Z = 07:00 in Chicago (UTC-5).
    expect(at(-3)).toBe('2026-10-12T12:00:00.000Z');
    const included = buildClassReport(ids.cls, ctx({ from: '2026-10-12T07:00:00-05:00', to: '2026-10-12T07:00:00-05:00' }));
    expect(included.assignments.map((a) => a.id)).toEqual([ids.delta, ids.echo1, ids.echo2]);
    const after = buildClassReport(ids.cls, ctx({ from: '2026-10-12T07:00:00.001-05:00', to: '2026-10-13T00:00:00+00:00' }));
    expect(after.assignments).toEqual([]);
  });

  it('takes open-ended ranges', () => {
    expect(buildClassReport(ids.cls, ctx({ from: at(0) })).assignments.map((a) => a.id)).toEqual([ids.hotel]);
    expect(buildClassReport(ids.cls, ctx({ to: at(-5) })).assignments.map((a) => a.id)).toEqual([ids.alpha, ids.bravo]);
  });
});

describe('students', () => {
  const ids: Record<string, number> = {};
  const u: Record<string, User> = {};

  beforeAll(() => {
    resetDb();
    const teacher = addUser('teacher', 'Teacher');
    ids.cls = addClass(teacher, 'Roster');
    ids.a = addAssignment(ids.cls, 'A', { dueAt: at(-1) });
    u.zoe = addUser('student', 'Zoe', 'zoe');
    u.alice2 = addUser('student', 'Alice', 'alice2');
    u.bob = addUser('student', 'bob', 'bob');
    u.emile = addUser('student', 'Émile', 'emile');
    u.alice1 = addUser('student', 'alice', 'alice1');
    u.former = addUser('student', 'Former', 'former');
    u.helper = addUser('teacher', 'Helper Teacher', 'helper');
    for (const key of ['zoe', 'alice2', 'bob', 'emile', 'alice1', 'helper']) enroll(ids.cls, u[key]!);
    // Work from a student who has left the class is kept but not reported.
    addWork(ids.a, u.former, { status: 'graded', submittedAt: at(-2), grade: 10 });
    addWork(ids.a, u.zoe, { status: 'submitted', submittedAt: at(-2) });
  });

  it('reports current students only, by name (case-insensitive, accents next to their letter), then username', () => {
    const report = buildClassReport(ids.cls, ctx());
    expect(report.students.map((s) => s.username)).toEqual(['alice1', 'alice2', 'bob', 'emile', 'zoe']);
    expect(report.students[3]).toMatchObject({ id: u.emile!.id, name: 'Émile', username: 'emile' });
    expect(counts(report.totals)).toEqual({ workCount: 5, handedInCount: 1, gradedCount: 0, toGradeCount: 1, lateCount: 0, missingCount: 4 });
  });

  it('answers 404 for a class that does not exist', () => {
    expect(() => buildClassReport(123_456, ctx())).toThrow('Class not found');
    expect(() => buildClassStudentReports(123_456, ctx())).toThrow('Class not found');
  });
});

describe('totals and averages', () => {
  const ids: Record<string, number> = {};
  let x: User;
  let y: User;
  let report: ClassReport;

  beforeAll(() => {
    resetDb();
    const teacher = addUser('teacher', 'Teacher');
    ids.cls = addClass(teacher, 'Totals');
    ids.empty = addClass(teacher, 'No students');
    ids.t1 = addAssignment(ids.cls, 'T1', { dueAt: at(-2), points: 10 });
    ids.t2 = addAssignment(ids.cls, 'T2', { dueAt: at(-1, -1), points: 20 });
    ids.t3 = addAssignment(ids.cls, 'T3', { dueAt: at(-1), points: 0 });
    ids.t4 = addAssignment(ids.cls, 'T4', { dueAt: at(5), points: 10 });
    addAssignment(ids.empty, 'Nobody', { dueAt: at(-1) });
    x = addUser('student', 'Xavier');
    y = addUser('student', 'Yasmin');
    enroll(ids.cls, x);
    enroll(ids.cls, y);
    addWork(ids.t1, x, { status: 'graded', submittedAt: at(-2, 1), grade: 8 }); // 80%, late
    addWork(ids.t2, x, { status: 'graded', submittedAt: at(-3), grade: 10 }); // 50%
    addWork(ids.t3, x, { status: 'graded', submittedAt: at(-3), grade: 0 }); // no percent (0 points)
    addWork(ids.t4, x, { status: 'submitted', submittedAt: at(-1) }); // to grade
    addWork(ids.t1, y, { status: 'graded', submittedAt: at(-3), grade: 10 }); // 100%
    // t2: nothing → missing
    addWork(ids.t3, y, { status: 'submitted', submittedAt: at(0) }); // to grade, late
    // t4: nothing → not handed in yet
    report = buildClassReport(ids.cls, ctx());
  });

  it('per student: the mean of their graded percents and their counts', () => {
    const [rx, ry] = report.students;
    expect(rx!.totals.average).toBeCloseTo(65);
    expect(counts(rx!.totals)).toEqual({ workCount: 4, handedInCount: 4, gradedCount: 3, toGradeCount: 1, lateCount: 1, missingCount: 0 });
    expect(ry!.totals.average).toBeCloseTo(100);
    expect(counts(ry!.totals)).toEqual({ workCount: 4, handedInCount: 2, gradedCount: 1, toGradeCount: 1, lateCount: 1, missingCount: 1 });
  });

  it('per assignment', () => {
    const byId = (id: number) => report.assignments.find((a) => a.id === id)!.totals;
    expect(byId(ids.t1!).average).toBeCloseTo(90);
    expect(counts(byId(ids.t1!))).toEqual({ workCount: 2, handedInCount: 2, gradedCount: 2, toGradeCount: 0, lateCount: 1, missingCount: 0 });
    expect(byId(ids.t2!).average).toBeCloseTo(50);
    expect(counts(byId(ids.t2!))).toEqual({ workCount: 2, handedInCount: 1, gradedCount: 1, toGradeCount: 0, lateCount: 0, missingCount: 1 });
    // Graded 0-point work counts as graded but not in the average.
    expect(byId(ids.t3!)).toEqual({ average: null, workCount: 2, handedInCount: 2, gradedCount: 1, toGradeCount: 1, lateCount: 1, missingCount: 0 });
    expect(byId(ids.t4!)).toEqual({ average: null, workCount: 2, handedInCount: 1, gradedCount: 0, toGradeCount: 1, lateCount: 0, missingCount: 0 });
  });

  it('per class: every piece of graded work counts equally', () => {
    expect(report.totals.average).toBeCloseTo((80 + 50 + 100) / 3);
    expect(counts(report.totals)).toEqual({ workCount: 8, handedInCount: 6, gradedCount: 4, toGradeCount: 2, lateCount: 2, missingCount: 1 });
  });

  it('a class without students has zero totals everywhere', () => {
    const empty = buildClassReport(ids.empty!, ctx());
    expect(empty.students).toEqual([]);
    expect(empty.assignments).toHaveLength(1);
    expect(empty.assignments[0]!.totals).toEqual(ZERO_TOTALS);
    expect(empty.totals).toEqual(ZERO_TOTALS);
  });

  it('a class without assignments in the range still lists its students', () => {
    const none = buildClassReport(ids.cls, ctx({ from: at(10) }));
    expect(none.assignments).toEqual([]);
    expect(none.students.map((s) => [s.id, s.work, s.totals])).toEqual([
      [x.id, [], ZERO_TOTALS],
      [y.id, [], ZERO_TOTALS],
    ]);
    expect(none.totals).toEqual(ZERO_TOTALS);
  });

  it('the class report carries the class and the context', () => {
    expect(report.kind).toBe('class');
    expect(report.context).toEqual(ctx());
    expect(report.cls).toEqual({ id: ids.cls, name: 'Totals', teacherName: 'Teacher', archived: false });
  });
});

describe('student reports', () => {
  const ids: Record<string, number> = {};
  const u: Record<string, User> = {};

  beforeAll(() => {
    resetDb();
    u.t1 = addUser('teacher', 'Teacher One');
    u.t2 = addUser('teacher', 'Teacher Two');
    u.admin = addUser('admin', 'Admin');
    ids.zeta = addClass(u.t1, 'Zeta');
    ids.alpha = addClass(u.t1, 'Alpha', true);
    ids.beta = addClass(u.t1, 'Beta');
    ids.gamma = addClass(u.t2, 'Gamma');
    ids.other = addClass(u.t1, 'Not theirs');
    u.sam = addUser('student', 'Sam', 'sam');
    u.ann = addUser('student', 'Ann', 'ann');
    u.loner = addUser('student', 'Loner', 'loner');
    for (const c of ['gamma', 'zeta', 'beta', 'alpha']) enroll(ids[c]!, u.sam);
    enroll(ids.zeta, u.ann);
    enroll(ids.other, u.t2); // staff in an enrollment never count as students

    ids.z1 = addAssignment(ids.zeta, 'Z1', { dueAt: at(-3) });
    ids.z2 = addAssignment(ids.zeta, 'Z2', { dueAt: at(-2), points: 20 });
    ids.z3 = addAssignment(ids.zeta, 'Z3', { dueAt: at(-1) });
    ids.zOld = addAssignment(ids.zeta, 'Z old', { dueAt: at(-40) });
    ids.g1 = addAssignment(ids.gamma, 'G1', { dueAt: at(-2) });
    ids.a1 = addAssignment(ids.alpha, 'A1', { dueAt: at(-2) });
    ids.bOld = addAssignment(ids.beta, 'B old', { dueAt: at(-40) });

    addWork(ids.z1, u.sam, { status: 'graded', submittedAt: at(-4), grade: 10, autoGraded: true, autoScore: 100 }); // 100%
    addWork(ids.z2, u.sam, { status: 'graded', submittedAt: at(-1), grade: 10 }); // 50%, late
    // z3: missing
    addWork(ids.zOld, u.sam, { status: 'graded', submittedAt: at(-41), grade: 1 }); // out of range below
    addWork(ids.g1, u.sam, { status: 'graded', submittedAt: at(-3), grade: 0 }); // 0%
    addWork(ids.a1, u.sam, { status: 'submitted', submittedAt: at(-3) });
    addWork(ids.z1, u.ann, { status: 'graded', submittedAt: at(-4), grade: 5 });
    addWork(ids.z3, u.ann, { status: 'submitted', submittedAt: at(-1, 1) }); // late
  });

  const range = () => ctx({ from: at(-10) }, 'Student report');

  it('covers the given classes, active first then by name; a class with nothing in range still appears', () => {
    const report = buildStudentReport(u.sam!.id, [ids.gamma!, ids.alpha!, ids.zeta!, ids.beta!, ids.zeta!, 987_654], range());
    expect(report.kind).toBe('student');
    expect(report.student).toEqual({ id: u.sam!.id, name: 'Sam', username: 'sam' });
    expect(report.classes.map((c) => c.cls.name)).toEqual(['Beta', 'Gamma', 'Zeta', 'Alpha']);
    expect(report.classes[0]).toEqual({
      cls: { id: ids.beta, name: 'Beta', teacherName: 'Teacher One', archived: false },
      totals: ZERO_TOTALS,
      rows: [],
    });
    expect(report.classes[1]!.cls).toEqual({ id: ids.gamma, name: 'Gamma', teacherName: 'Teacher Two', archived: false });
    expect(report.classes[3]!.cls.archived).toBe(true);

    const zeta = report.classes[2]!;
    expect(zeta.rows.map((r) => [r.assignment.number, r.assignment.title, r.work.status, r.work.late])).toEqual([
      [1, 'Z1', 'graded', false],
      [2, 'Z2', 'graded', true],
      [3, 'Z3', 'missing', false],
    ]);
    expect(zeta.rows[0]!.work).toMatchObject({ autoGraded: true, autoScore: 100, percent: 100 });
    expect(zeta.totals.average).toBeCloseTo(75);
    expect(counts(zeta.totals)).toEqual({ workCount: 3, handedInCount: 2, gradedCount: 2, toGradeCount: 0, lateCount: 1, missingCount: 1 });
  });

  it('overall totals count every row equally (not the mean of class averages)', () => {
    const report = buildStudentReport(u.sam!.id, [ids.zeta!, ids.gamma!, ids.alpha!, ids.beta!], range());
    expect(report.totals.average).toBeCloseTo((100 + 50 + 0) / 3);
    expect(counts(report.totals)).toEqual({ workCount: 5, handedInCount: 4, gradedCount: 3, toGradeCount: 1, lateCount: 1, missingCount: 1 });
  });

  it('with no classes there are no rows and empty totals', () => {
    const report = buildStudentReport(u.loner!.id, [], range());
    expect(report.classes).toEqual([]);
    expect(report.totals).toEqual(ZERO_TOTALS);
    expect(() => buildStudentReport(123_456, [], range())).toThrow('Student not found');
  });

  it('studentClassIdsFor: a teacher gets their own classes the student is in, an admin all of them', () => {
    expect(studentClassIdsFor(u.t1!, u.sam!.id)).toEqual([ids.beta, ids.zeta, ids.alpha]);
    expect(studentClassIdsFor(u.t2!, u.sam!.id)).toEqual([ids.gamma]);
    expect(studentClassIdsFor(u.admin!, u.sam!.id)).toEqual([ids.beta, ids.gamma, ids.zeta, ids.alpha]);
    expect(studentClassIdsFor(u.t2!, u.ann!.id)).toEqual([]);
    expect(studentClassIdsFor(u.admin!, u.loner!.id)).toEqual([]);
    // Only students: a teacher's enrollment doesn't make them reportable.
    expect(studentClassIdsFor(u.admin!, u.t2!.id)).toEqual([]);
  });

  it('student reports for a class: one per current student by name, covering only that class', () => {
    const context = ctx({ from: at(-10) }, 'Student reports');
    const set = buildClassStudentReports(ids.zeta!, context);
    const classReport = buildClassReport(ids.zeta!, context);
    expect(set.kind).toBe('students');
    expect(set.context).toEqual(context);
    expect(set.cls).toEqual(classReport.cls);
    expect(set.reports.map((r) => r.student.name)).toEqual(['Ann', 'Sam']);
    for (const [i, r] of set.reports.entries()) {
      expect(r.kind).toBe('student');
      expect(r.context).toEqual(context);
      expect(r.classes).toHaveLength(1);
      expect(r.classes[0]!.cls).toEqual(classReport.cls);
      expect(r.classes[0]!.rows.map((row) => row.work)).toEqual(classReport.students[i]!.work);
      expect(r.classes[0]!.rows.map((row) => row.assignment)).toEqual(
        classReport.assignments.map(({ totals: _totals, ...assignment }) => assignment),
      );
      expect(r.totals).toEqual(classReport.students[i]!.totals);
      expect(r.classes[0]!.totals).toEqual(r.totals);
    }
    // Same rows as the student's own report limited to that class.
    const own = buildStudentReport(u.sam!.id, [ids.zeta!], context);
    expect(set.reports[1]!.classes).toEqual(own.classes);
  });

  it('student reports for a class without students is empty', () => {
    expect(buildClassStudentReports(ids.other!, ctx()).reports).toEqual([]);
  });
});

describe('school report and report options', () => {
  const ids: Record<string, number> = {};
  const u: Record<string, User> = {};

  beforeAll(() => {
    resetDb();
    u.bell = addUser('teacher', 'Ms Bell');
    u.adams = addUser('teacher', 'Mr Adams');
    u.cole = addUser('teacher', 'Mx Cole');
    u.admin = addUser('admin', 'Head');
    ids.b2 = addClass(u.bell, 'B2');
    ids.b1 = addClass(u.bell, 'B1');
    ids.a1 = addClass(u.adams, 'A1');
    ids.a2 = addClass(u.adams, 'A2', true);
    ids.c1 = addClass(u.cole, 'C1', true); // archived, no students

    u.ava = addUser('student', 'Ava', 'ava');
    u.ben = addUser('student', 'Ben', 'ben');
    u.cara = addUser('student', 'Cara', 'cara');
    u.dev = addUser('student', 'Dev', 'dev');
    u.eli = addUser('student', 'Eli', 'eli');
    u.gone = addUser('student', 'Gone', 'gone');
    enroll(ids.a1, u.ava);
    enroll(ids.a1, u.ben);
    enroll(ids.a2, u.eli);
    enroll(ids.b2, u.dev); // enrolled in B2 before B1: classIds still follow the class list
    enroll(ids.b1, u.dev);
    enroll(ids.b1, u.ava);
    enroll(ids.b2, u.cara);
    enroll(ids.b1, u.adams); // a teacher in an enrollment is not a student

    ids.aa1 = addAssignment(ids.a1, 'a1', { dueAt: at(-2) });
    ids.aa2 = addAssignment(ids.a1, 'a2', { dueAt: at(-1) });
    ids.aa3 = addAssignment(ids.a1, 'a3', { dueAt: at(3) });
    ids.ac1 = addAssignment(ids.a2, 'c1', { dueAt: at(-2) });
    ids.bb1 = addAssignment(ids.b1, 'b1', { dueAt: at(-2) });
    ids.bb2 = addAssignment(ids.b1, 'b2', { dueAt: null, createdAt: at(-10) });
    ids.bd1 = addAssignment(ids.b2, 'd1', { dueAt: at(-1) });
    ids.bd2 = addAssignment(ids.b2, 'd2', { dueAt: at(1) });
    addAssignment(ids.b2, 'draft', { dueAt: at(-3), published: false });

    addWork(ids.aa1, u.ava, { status: 'graded', submittedAt: at(-3), grade: 9 }); // 90%; Ava misses a2
    addWork(ids.aa3, u.ben, { status: 'submitted', submittedAt: at(-1) }); // Ben misses a1, a2
    addWork(ids.bb1, u.ava, { status: 'submitted', submittedAt: at(-2, 2) }); // late
    addWork(ids.bb2, u.dev, { status: 'graded', submittedAt: at(-3), grade: 5 }); // 50%; Dev misses b1
    addWork(ids.bd1, u.cara, { status: 'graded', submittedAt: at(-2), grade: 7 }); // 70%; Dev misses d1
    addWork(ids.bb1, u.gone, { status: 'graded', submittedAt: at(-3), grade: 10 }); // former student
    // Eli misses c1 (archived class).
  });

  it('active classes only: counts, classes by teacher then name, teachers, missing work', () => {
    const report = buildSchoolReport(ctx({}, 'School report'), false);
    expect(report).toMatchObject({ kind: 'school', includesArchived: false, classCount: 3, teacherCount: 2, studentCount: 4, assignmentCount: 7 });
    expect(report.totals.average).toBeCloseTo(70);
    expect(counts(report.totals)).toEqual({ workCount: 14, handedInCount: 5, gradedCount: 3, toGradeCount: 2, lateCount: 1, missingCount: 5 });

    expect(report.classes.map((c) => [c.name, c.teacherName, c.archived, c.studentCount, c.assignmentCount])).toEqual([
      ['A1', 'Mr Adams', false, 2, 3],
      ['B1', 'Ms Bell', false, 2, 2],
      ['B2', 'Ms Bell', false, 2, 2],
    ]);
    const [a1, b1, b2] = report.classes;
    expect(a1!.totals.average).toBeCloseTo(90);
    expect(counts(a1!.totals)).toEqual({ workCount: 6, handedInCount: 2, gradedCount: 1, toGradeCount: 1, lateCount: 0, missingCount: 3 });
    expect(counts(b1!.totals)).toEqual({ workCount: 4, handedInCount: 2, gradedCount: 1, toGradeCount: 1, lateCount: 1, missingCount: 1 });
    expect(counts(b2!.totals)).toEqual({ workCount: 4, handedInCount: 1, gradedCount: 1, toGradeCount: 0, lateCount: 0, missingCount: 1 });

    expect(report.teachers.map((t) => [t.id, t.name, t.classCount, t.studentCount, t.assignmentCount])).toEqual([
      [u.adams!.id, 'Mr Adams', 1, 2, 3],
      [u.bell!.id, 'Ms Bell', 2, 3, 4], // Dev is in both of her classes: counted once
    ]);
    expect(report.teachers[1]!.totals.average).toBeCloseTo(60);
    expect(counts(report.teachers[1]!.totals)).toEqual({ workCount: 8, handedInCount: 3, gradedCount: 2, toGradeCount: 1, lateCount: 1, missingCount: 2 });

    expect(report.missingWork.map((m) => [m.student.name, m.cls.name, m.missingCount, m.lateCount])).toEqual([
      ['Ben', 'A1', 2, 0],
      ['Ava', 'A1', 1, 0],
      ['Dev', 'B1', 1, 0],
      ['Dev', 'B2', 1, 0],
    ]);
    expect(report.missingWork[1]!.average).toBeCloseTo(90);
    expect(report.missingWork[0]!.average).toBeNull();
    expect(report.missingWork[0]!.student).toEqual({ id: u.ben!.id, name: 'Ben', username: 'ben' });
    expect(report.missingWork[0]!.cls).toEqual({ id: ids.a1, name: 'A1', teacherName: 'Mr Adams', archived: false });
  });

  it('with archived classes', () => {
    const report = buildSchoolReport(ctx({}, 'School report'), true);
    expect(report).toMatchObject({ includesArchived: true, classCount: 5, teacherCount: 3, studentCount: 5, assignmentCount: 8 });
    expect(report.classes.map((c) => [c.name, c.archived, c.studentCount])).toEqual([
      ['A1', false, 2],
      ['A2', true, 1],
      ['B1', false, 2],
      ['B2', false, 2],
      ['C1', true, 0],
    ]);
    expect(report.classes[4]!.totals).toEqual(ZERO_TOTALS);
    expect(report.teachers.map((t) => [t.name, t.classCount, t.studentCount, t.assignmentCount])).toEqual([
      ['Mr Adams', 2, 3, 4],
      ['Ms Bell', 2, 3, 4],
      ['Mx Cole', 1, 0, 0],
    ]);
    expect(report.teachers[2]!.totals).toEqual(ZERO_TOTALS);
    expect(counts(report.totals)).toEqual({ workCount: 15, handedInCount: 5, gradedCount: 3, toGradeCount: 2, lateCount: 1, missingCount: 6 });
    expect(report.missingWork.map((m) => [m.student.name, m.cls.name, m.missingCount])).toEqual([
      ['Ben', 'A1', 2],
      ['Ava', 'A1', 1],
      ['Dev', 'B1', 1],
      ['Dev', 'B2', 1],
      ['Eli', 'A2', 1],
    ]);
  });

  it('counts only assignments in the range', () => {
    const report = buildSchoolReport(ctx({ to: at(0) }, 'School report'), false);
    expect(report.assignmentCount).toBe(5);
    expect(report.classes.map((c) => c.assignmentCount)).toEqual([2, 2, 1]);
    expect(report.totals.workCount).toBe(10);
  });

  it('report options for a teacher: their classes (archived too) and the students in them', () => {
    expect(reportOptions(u.adams!)).toEqual({
      classes: [
        { id: ids.a1, name: 'A1', teacherName: 'Mr Adams', archived: false, studentCount: 2 },
        { id: ids.a2, name: 'A2', teacherName: 'Mr Adams', archived: true, studentCount: 1 },
      ],
      students: [
        { id: u.ava!.id, name: 'Ava', username: 'ava', classIds: [ids.a1] },
        { id: u.ben!.id, name: 'Ben', username: 'ben', classIds: [ids.a1] },
        { id: u.eli!.id, name: 'Eli', username: 'eli', classIds: [ids.a2] },
      ],
      school: false,
    });
    expect(reportOptions(u.bell!)).toEqual({
      classes: [
        { id: ids.b1, name: 'B1', teacherName: 'Ms Bell', archived: false, studentCount: 2 },
        { id: ids.b2, name: 'B2', teacherName: 'Ms Bell', archived: false, studentCount: 2 },
      ],
      students: [
        { id: u.ava!.id, name: 'Ava', username: 'ava', classIds: [ids.b1] },
        { id: u.cara!.id, name: 'Cara', username: 'cara', classIds: [ids.b2] },
        { id: u.dev!.id, name: 'Dev', username: 'dev', classIds: [ids.b1, ids.b2] },
      ],
      school: false,
    });
    const teacherWithNothing = addUser('teacher', 'New Teacher');
    expect(reportOptions(teacherWithNothing)).toEqual({ classes: [], students: [], school: false });
  });

  it('report options for an admin: every class, active first, every student in them, and the school report', () => {
    const options = reportOptions(u.admin!);
    expect(options.school).toBe(true);
    expect(options.classes.map((c) => [c.name, c.teacherName, c.archived, c.studentCount])).toEqual([
      ['A1', 'Mr Adams', false, 2],
      ['B1', 'Ms Bell', false, 2],
      ['B2', 'Ms Bell', false, 2],
      ['A2', 'Mr Adams', true, 1],
      ['C1', 'Mx Cole', true, 0],
    ]);
    expect(options.students.map((s) => [s.username, s.classIds])).toEqual([
      ['ava', [ids.a1, ids.b1]],
      ['ben', [ids.a1]],
      ['cara', [ids.b2]],
      ['dev', [ids.b1, ids.b2]],
      ['eli', [ids.a2]],
    ]);
  });
});

describe('a whole school', () => {
  const CLASSES = 60;
  const TEACHERS = 30;
  const STUDENTS = 1500;
  const ASSIGNMENTS_PER_CLASS = 50;
  const SUBMISSIONS = 60_000;
  let admin: User;
  let firstClass = 0;

  beforeAll(() => {
    resetDb();
    admin = addUser('admin', 'Head');
    const testResults = JSON.stringify(
      Array.from({ length: 4 }, (_, i) => ({ testId: `t${i}`, passed: i % 2 === 0, actualOutput: 'x'.repeat(200), error: null, durationMs: 3 })),
    );
    db.transaction(() => {
      const user = db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, 'x')");
      const cls = db.prepare('INSERT INTO classes (name, join_code, archived, owner_id) VALUES (?, ?, ?, ?)');
      const enrollment = db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)');
      const assignment = db.prepare(
        "INSERT INTO assignments (class_id, title, language_id, due_at, points, tests, created_at) VALUES (?, ?, 'python', ?, 10, ?, ?)",
      );
      const submission = db.prepare(
        `INSERT INTO submissions (assignment_id, student_id, status, submitted_at, grade, test_results, auto_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const teachers = Array.from({ length: TEACHERS }, (_, i) => Number(user.run(`bigteacher${i}`, `Teacher ${i}`, 'teacher').lastInsertRowid));
      const students = Array.from({ length: STUDENTS }, (_, i) => Number(user.run(`bigstudent${i}`, `Student ${i}`, 'student').lastInsertRowid));
      const classStudents: number[][] = [];
      const classAssignments: number[][] = [];
      for (let c = 0; c < CLASSES; c++) {
        const id = Number(cls.run(`Class ${c}`, `BIG${c}`, c % 10 === 9 ? 1 : 0, teachers[c % TEACHERS]).lastInsertRowid);
        if (c === 0) firstClass = id;
        // Every student is in two classes: 50 students per class.
        const members = students.filter((_, i) => i % CLASSES === c || (i + 7) % CLASSES === c);
        for (const s of members) enrollment.run(id, s);
        classStudents.push(members);
        classAssignments.push(
          Array.from({ length: ASSIGNMENTS_PER_CLASS }, (_, a) =>
            Number(assignment.run(id, `Assignment ${a}`, a % 5 === 4 ? null : at(a - 40), '[{"id":"t"}]', at(a - 60)).lastInsertRowid),
          ),
        );
      }
      // Spread the submissions over (class, student, assignment) pairs.
      for (let n = 0; n < SUBMISSIONS; n++) {
        const c = n % CLASSES;
        const members = classStudents[c]!;
        const k = Math.floor(n / CLASSES);
        const s = members[k % members.length]!;
        const a = classAssignments[c]![Math.floor(k / members.length)]!;
        const graded = n % 3 === 0;
        submission.run(a, s, graded ? 'graded' : 'submitted', at(-30 + (n % 50)), graded ? n % 11 : null, testResults, 50);
      }
    })();
  });

  it('builds the school report quickly with a handful of queries', () => {
    const started = performance.now();
    const report = buildSchoolReport(ctx({}, 'School report'), true);
    const elapsed = performance.now() - started;
    expect(report.classCount).toBe(CLASSES);
    expect(report.teacherCount).toBe(TEACHERS);
    expect(report.studentCount).toBe(STUDENTS);
    expect(report.assignmentCount).toBe(CLASSES * ASSIGNMENTS_PER_CLASS);
    expect(report.totals.workCount).toBe(CLASSES * 50 * ASSIGNMENTS_PER_CLASS);
    expect(report.totals.handedInCount).toBe(SUBMISSIONS);
    expect(report.missingWork.length).toBeGreaterThan(100);
    for (let i = 1; i < report.missingWork.length; i++) {
      expect(report.missingWork[i - 1]!.missingCount).toBeGreaterThanOrEqual(report.missingWork[i]!.missingCount);
    }
    expect(elapsed).toBeLessThan(3000);
  });

  it('builds a class report, student reports and options quickly too', () => {
    const started = performance.now();
    const cls = buildClassReport(firstClass, ctx());
    const set = buildClassStudentReports(firstClass, ctx({}, 'Student reports'));
    const options = reportOptions(admin);
    const elapsed = performance.now() - started;
    expect(cls.students).toHaveLength(50);
    expect(cls.assignments).toHaveLength(ASSIGNMENTS_PER_CLASS);
    expect(cls.students.every((s) => s.work.every((w) => w.testsRun == null || (w.testsRun === 4 && w.testsPassed === 2)))).toBe(true);
    expect(set.reports).toHaveLength(50);
    expect(options.classes).toHaveLength(CLASSES);
    expect(options.students).toHaveLength(STUDENTS);
    expect(options.students.every((s) => s.classIds.length === 2)).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  });
});
