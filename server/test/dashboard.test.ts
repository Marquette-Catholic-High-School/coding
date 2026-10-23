import type { ClassResponse, StudentDashboard, TeacherDashboard } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();

async function createClass(client: TestClient, name: string) {
  const res = await client.post<ClassResponse>('/classes', { name });
  expect(res.status).toBe(201);
  return res.body.class.id;
}

function enroll(classId: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, userId);
}

function insertAssignment(classId: number, title: string, dueAt: string | null, published = true) {
  const info = db
    .prepare('INSERT INTO assignments (class_id, title, language_id, points, due_at, published) VALUES (?, ?, ?, 10, ?, ?)')
    .run(classId, title, 'python', dueAt, published ? 1 : 0);
  return Number(info.lastInsertRowid);
}

function insertSubmission(
  assignmentId: number,
  studentId: number,
  status: 'in_progress' | 'submitted' | 'graded',
  extra: { submittedAt?: string; grade?: number; gradedAt?: string } = {},
) {
  db.prepare(
    'INSERT INTO submissions (assignment_id, student_id, status, submitted_at, grade, graded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(assignmentId, studentId, status, extra.submittedAt ?? null, extra.grade ?? null, extra.gradedAt ?? null);
}

// Fixture: teacher T has two active classes and one archived class; teacher O has one class.
let teacher: TestClient;
let otherTeacher: TestClient;
let admin: TestClient;
const s: Record<'s1' | 's2' | 's3' | 's4' | 's5' | 'removed', { id: number; client: TestClient }> = {} as never;
const ids: Record<string, number> = {};

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('python', 'python');
  teacher = clientAs(srv.base, insertUser('teacher').id);
  otherTeacher = clientAs(srv.base, insertUser('teacher').id);
  admin = clientAs(srv.base, insertUser('admin').id);
  for (const key of ['s1', 's2', 's3', 's4', 's5', 'removed'] as const) {
    const u = insertUser('student', { name: `Student ${key}` });
    s[key] = { id: u.id, client: clientAs(srv.base, u.id) };
  }

  ids.class1 = await createClass(teacher, 'Alpha');
  ids.class2 = await createClass(teacher, 'Beta');
  ids.class3 = await createClass(teacher, 'Archived');
  await teacher.patch(`/classes/${ids.class3}`, { archived: true });
  ids.classO = await createClass(otherTeacher, 'Other');

  enroll(ids.class1, s.s1.id);
  enroll(ids.class1, s.s2.id);
  enroll(ids.class2, s.s1.id);
  enroll(ids.class2, s.s3.id);
  enroll(ids.class3, s.s4.id);
  enroll(ids.classO, s.s5.id);

  ids.a1 = insertAssignment(ids.class1, 'A1 past', iso(-3));
  ids.a2 = insertAssignment(ids.class1, 'A2 soon', iso(2));
  ids.a3 = insertAssignment(ids.class1, 'A3 draft', iso(1), false);
  ids.a4 = insertAssignment(ids.class1, 'A4 far', iso(20));
  ids.a5 = insertAssignment(ids.class1, 'A5 no due', null);
  ids.b1 = insertAssignment(ids.class2, 'B1 tomorrow', iso(1));
  ids.b2 = insertAssignment(ids.class2, 'B2 yesterday', iso(-1));
  ids.c1 = insertAssignment(ids.class3, 'C1 archived', iso(-1));
  ids.o1 = insertAssignment(ids.classO, 'O1 other', iso(1));

  insertSubmission(ids.a1, s.s1.id, 'submitted', { submittedAt: iso(-4) });
  insertSubmission(ids.a1, s.s2.id, 'submitted', { submittedAt: iso(-1) }); // late
  insertSubmission(ids.a2, s.s1.id, 'submitted', { submittedAt: iso(-0.5) });
  insertSubmission(ids.a5, s.s1.id, 'graded', { submittedAt: iso(-0.5), grade: 7, gradedAt: iso(-0.1) });
  insertSubmission(ids.b1, s.s1.id, 'in_progress', { grade: 3 }); // returned for revision; grade not shown
  insertSubmission(ids.b2, s.s1.id, 'graded', { submittedAt: iso(-2), grade: 9, gradedAt: iso(-1) });
  insertSubmission(ids.c1, s.s4.id, 'submitted', { submittedAt: iso(-2) });
  insertSubmission(ids.o1, s.s5.id, 'submitted', { submittedAt: iso(-0.2) });
  // A student who handed work in and was then removed from the class.
  enroll(ids.class1, s.removed.id);
  insertSubmission(ids.a1, s.removed.id, 'submitted', { submittedAt: iso(-5) });
  db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(ids.class1, s.removed.id);
});
afterAll(() => srv.close());

describe('teacher dashboard', () => {
  it('summarises the teacher\'s active classes', async () => {
    const res = await teacher.get<TeacherDashboard>('/dashboard');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.role).toBe('teacher');
    expect(d.classes.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    expect(d.classes[0]!.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(d.stats).toEqual({ classCount: 2, studentCount: 3, toGradeCount: 3, lateCount: 2 });
  });

  it('lists work to grade, oldest first, with late flags', async () => {
    const { toGrade } = (await teacher.get<TeacherDashboard>('/dashboard')).body;
    expect(toGrade.map((t) => [t.assignmentId, t.student.id, t.late])).toEqual([
      [ids.a1, s.s1.id, false],
      [ids.a1, s.s2.id, true],
      [ids.a2, s.s1.id, false],
    ]);
    expect(toGrade[0]).toMatchObject({
      assignmentTitle: 'A1 past',
      classId: ids.class1,
      className: 'Alpha',
      student: { id: s.s1.id, name: 'Student s1' },
      submittedAt: expect.any(String),
    });
  });

  it('lists published work due in the next 14 days with progress', async () => {
    const { upcoming } = (await teacher.get<TeacherDashboard>('/dashboard')).body;
    expect(upcoming.map((u) => u.assignmentId)).toEqual([ids.b1, ids.a2]);
    expect(upcoming[0]).toMatchObject({ assignmentTitle: 'B1 tomorrow', className: 'Beta', submittedCount: 0, studentCount: 2 });
    expect(upcoming[1]).toMatchObject({ assignmentTitle: 'A2 soon', className: 'Alpha', submittedCount: 1, studentCount: 2 });
    expect(upcoming[0]!.dueAt).toEqual(expect.any(String));
  });

  it('only shows the teacher their own classes', async () => {
    const d = (await otherTeacher.get<TeacherDashboard>('/dashboard')).body;
    expect(d.role).toBe('teacher');
    expect(d.classes.map((c) => c.id)).toEqual([ids.classO]);
    expect(d.stats).toEqual({ classCount: 1, studentCount: 1, toGradeCount: 1, lateCount: 0 });
    expect(d.toGrade.map((t) => t.assignmentId)).toEqual([ids.o1]);
    expect(d.upcoming.map((u) => u.assignmentId)).toEqual([ids.o1]);
  });

  it('admins see every active class', async () => {
    const d = (await admin.get<TeacherDashboard>('/dashboard')).body;
    expect(d.role).toBe('admin');
    expect(d.classes.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'Other']);
    expect(d.stats).toEqual({ classCount: 3, studentCount: 4, toGradeCount: 4, lateCount: 2 });
    expect(d.toGrade.map((t) => t.assignmentId)).toContain(ids.o1);
    expect(d.upcoming.map((u) => u.assignmentId)).toEqual([ids.b1, ids.o1, ids.a2]);
  });

  it('caps the lists (10 to grade, 8 upcoming)', async () => {
    const t = clientAs(srv.base, insertUser('teacher').id);
    const classId = await createClass(t, 'Busy');
    const student = insertUser('student');
    enroll(classId, student.id);
    const assignments = Array.from({ length: 12 }, (_, i) => insertAssignment(classId, `Task ${i + 1}`, iso(12 - i)));
    assignments.slice(0, 11).forEach((id, i) => insertSubmission(id, student.id, 'submitted', { submittedAt: iso(-1 - i) }));

    const d = (await t.get<TeacherDashboard>('/dashboard')).body;
    expect(d.stats.toGradeCount).toBe(11);
    expect(d.toGrade).toHaveLength(10);
    // Oldest hand-in first: Task 11 was submitted 11 days ago.
    expect(d.toGrade[0]!.assignmentTitle).toBe('Task 11');
    expect(d.upcoming).toHaveLength(8);
    expect(d.upcoming.map((u) => u.assignmentTitle)).toEqual(['Task 12', 'Task 11', 'Task 10', 'Task 9', 'Task 8', 'Task 7', 'Task 6', 'Task 5']);
  });

  it('is empty for a brand-new teacher', async () => {
    const t = clientAs(srv.base, insertUser('teacher').id);
    const d = (await t.get<TeacherDashboard>('/dashboard')).body;
    expect(d).toEqual({
      role: 'teacher',
      stats: { classCount: 0, studentCount: 0, toGradeCount: 0, lateCount: 0 },
      toGrade: [],
      upcoming: [],
      classes: [],
    });
  });

  it('requires sign-in', async () => {
    expect((await srv.client().get('/dashboard')).status).toBe(401);
  });
});

describe('student dashboard', () => {
  it('lists published work across enrolled classes in to-do / submitted / graded order', async () => {
    const res = await s.s1.client.get<StudentDashboard>('/dashboard');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.role).toBe('student');
    expect(d.classes.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    expect(d.classes.every((c) => c.joinCode === null)).toBe(true);
    expect(d.assignments.map((a) => a.title)).toEqual([
      'B1 tomorrow', // to do, soonest due first
      'A4 far',
      'A1 past', // submitted, by due date
      'A2 soon',
      'A5 no due', // graded, most recently graded first
      'B2 yesterday',
    ]);
    const byTitle = Object.fromEntries(d.assignments.map((a) => [a.title, a]));
    expect(byTitle['B1 tomorrow']).toMatchObject({ status: 'in_progress', grade: null, late: false, className: 'Beta', languageId: 'python', points: 10 });
    expect(byTitle['A5 no due']).toMatchObject({ status: 'graded', grade: 7, dueAt: null });
    expect(byTitle['A4 far']).toMatchObject({ status: 'not_started', grade: null });
    expect(d.stats).toEqual({ classCount: 2, dueSoonCount: 1, lateCount: 0, gradedCount: 2 });
  });

  it('puts work with no due date after dated work and counts late items', async () => {
    const d = (await s.s2.client.get<StudentDashboard>('/dashboard')).body;
    expect(d.assignments.map((a) => a.title)).toEqual(['A2 soon', 'A4 far', 'A5 no due', 'A1 past']);
    expect(d.assignments.find((a) => a.title === 'A1 past')).toMatchObject({ status: 'submitted', late: true });
    expect(d.stats).toEqual({ classCount: 1, dueSoonCount: 1, lateCount: 1, gradedCount: 0 });
  });

  it('flags missing work after the due date as late', async () => {
    const d = (await s.s3.client.get<StudentDashboard>('/dashboard')).body;
    expect(d.assignments.map((a) => [a.title, a.status, a.late])).toEqual([
      ['B2 yesterday', 'not_started', true],
      ['B1 tomorrow', 'not_started', false],
    ]);
    expect(d.stats).toEqual({ classCount: 1, dueSoonCount: 1, lateCount: 1, gradedCount: 0 });
  });

  it('leaves out archived classes and drafts', async () => {
    const d = (await s.s4.client.get<StudentDashboard>('/dashboard')).body;
    expect(d).toEqual({
      role: 'student',
      stats: { classCount: 0, dueSoonCount: 0, lateCount: 0, gradedCount: 0 },
      classes: [],
      assignments: [],
    });
    const s1 = (await s.s1.client.get<StudentDashboard>('/dashboard')).body;
    expect(s1.assignments.map((a) => a.assignmentId)).not.toContain(ids.a3);
  });
});
