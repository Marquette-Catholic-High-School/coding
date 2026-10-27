import type { AddStudentResponse, ClassResponse, RosterResponse, TemporaryPasswordResponse } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth';
import { db, type UserRow } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let teacherA: TestClient;
let teacherB: TestClient;
let admin: TestClient;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('python', 'python');
  teacherA = clientAs(srv.base, insertUser('teacher').id);
  teacherB = clientAs(srv.base, insertUser('teacher', { username: 'mrs.b' }).id);
  admin = clientAs(srv.base, insertUser('admin').id);
});
afterAll(() => srv.close());

async function createClass(client: TestClient, name = 'Roster class') {
  const res = await client.post<ClassResponse>('/classes', { name });
  expect(res.status).toBe(201);
  return res.body.class;
}

function enroll(classId: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, userId);
}

function userRow(id: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString();

function insertAssignment(classId: number, opts: { points: number; dueAt: string | null; published?: boolean }) {
  const info = db
    .prepare('INSERT INTO assignments (class_id, title, language_id, points, due_at, published) VALUES (?, ?, ?, ?, ?, ?)')
    .run(classId, 'Task', 'python', opts.points, opts.dueAt, opts.published === false ? 0 : 1);
  return Number(info.lastInsertRowid);
}

function insertSubmission(
  assignmentId: number,
  studentId: number,
  status: 'in_progress' | 'submitted' | 'graded',
  extra: { submittedAt?: string | null; grade?: number | null } = {},
) {
  db.prepare('INSERT INTO submissions (assignment_id, student_id, status, submitted_at, grade) VALUES (?, ?, ?, ?, ?)').run(
    assignmentId,
    studentId,
    status,
    extra.submittedAt ?? null,
    extra.grade ?? null,
  );
}

describe('add students', () => {
  it('creates a new student with a temporary password and enrolls them', async () => {
    const cls = await createClass(teacherA);
    const res = await teacherA.post<AddStudentResponse>(`/classes/${cls.id}/students`, { name: 'Sam Smith', username: 'sam.smith' });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(res.body.student).toMatchObject({
      name: 'Sam Smith',
      username: 'sam.smith',
      mustChangePassword: true,
      submittedCount: 0,
      lateCount: 0,
      averagePercent: null,
    });
    const row = userRow(res.body.student.id);
    expect(row.role).toBe('student');
    expect(row.must_change_password).toBe(1);
    expect(verifyPassword(res.body.temporaryPassword!, row.password_hash)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('scrypt');

    const roster = await teacherA.get<RosterResponse>(`/classes/${cls.id}/students`);
    expect(roster.body.students.map((s) => s.username)).toEqual(['sam.smith']);
  });

  it('enrolls an existing student (matched case-insensitively) without a password', async () => {
    const existing = insertUser('student', { username: 'jo.bloggs', name: 'Jo Bloggs' });
    const cls = await createClass(teacherA);
    const res = await teacherA.post<AddStudentResponse>(`/classes/${cls.id}/students`, { name: 'Ignored', username: 'JO.BLOGGS' });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeNull();
    expect(res.body.student).toMatchObject({ id: existing.id, name: 'Jo Bloggs', username: 'jo.bloggs', mustChangePassword: false });
    expect(verifyPassword('password123', userRow(existing.id).password_hash)).toBe(true);
  });

  it('409s when the student is already enrolled', async () => {
    const cls = await createClass(teacherA);
    await teacherA.post(`/classes/${cls.id}/students`, { name: 'Twice', username: 'twice' });
    const res = await teacherA.post(`/classes/${cls.id}/students`, { name: 'Twice', username: 'twice' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors.username).toBeTruthy();
  });

  it('409s when the username belongs to a teacher or admin', async () => {
    const cls = await createClass(teacherA);
    const res = await teacherA.post(`/classes/${cls.id}/students`, { name: 'B', username: 'mrs.b' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors.username).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) FROM enrollments WHERE class_id = ?').pluck().get(cls.id)).toBe(0);
  });

  it('validates the fields', async () => {
    const cls = await createClass(teacherA);
    const res = await teacherA.post(`/classes/${cls.id}/students`, { name: '', username: 'no spaces allowed' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.name).toBeTruthy();
    expect(res.body.error.fieldErrors.username).toBeTruthy();
  });

  it("only the class's teacher or an admin can see or change the roster", async () => {
    const cls = await createClass(teacherA);
    const student = insertUser('student');
    enroll(cls.id, student.id);
    const studentClient = clientAs(srv.base, student.id);

    expect((await teacherB.get(`/classes/${cls.id}/students`)).status).toBe(403);
    expect((await teacherB.post(`/classes/${cls.id}/students`, { name: 'X', username: 'xx-b' })).status).toBe(403);
    expect((await studentClient.get(`/classes/${cls.id}/students`)).status).toBe(403);
    expect((await admin.get(`/classes/${cls.id}/students`)).status).toBe(200);
    const added = await admin.post<AddStudentResponse>(`/classes/${cls.id}/students`, { name: 'By Admin', username: 'by-admin' });
    expect(added.status).toBe(201);
  });
});

describe('remove students', () => {
  it('un-enrolls but keeps the account and work', async () => {
    const cls = await createClass(teacherA);
    const assignmentId = insertAssignment(cls.id, { points: 10, dueAt: null });
    const student = insertUser('student');
    enroll(cls.id, student.id);
    insertSubmission(assignmentId, student.id, 'submitted', { submittedAt: iso(-1) });

    expect((await teacherB.delete(`/classes/${cls.id}/students/${student.id}`)).status).toBe(403);
    const res = await teacherA.delete(`/classes/${cls.id}/students/${student.id}`);
    expect(res.status).toBe(200);
    expect((await teacherA.get<RosterResponse>(`/classes/${cls.id}/students`)).body.students).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM users WHERE id = ?').pluck().get(student.id)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM submissions WHERE student_id = ?').pluck().get(student.id)).toBe(1);

    expect((await teacherA.delete(`/classes/${cls.id}/students/${student.id}`)).status).toBe(404);
  });
});

describe('reset password', () => {
  it('resets an enrolled student and signs them out everywhere', async () => {
    const cls = await createClass(teacherA);
    const student = insertUser('student');
    enroll(cls.id, student.id);
    const studentClient = clientAs(srv.base, student.id);
    expect((await studentClient.get('/classes')).status).toBe(200);

    const res = await teacherA.post<TemporaryPasswordResponse>(`/classes/${cls.id}/students/${student.id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: student.id, mustChangePassword: true });
    expect(verifyPassword(res.body.temporaryPassword, userRow(student.id).password_hash)).toBe(true);
    expect(userRow(student.id).must_change_password).toBe(1);
    expect((await studentClient.get('/classes')).status).toBe(401);
  });

  it('is only allowed for students in that class, by its teacher or an admin', async () => {
    const cls = await createClass(teacherA);
    const other = await createClass(teacherA, 'Other class');
    const inClass = insertUser('student');
    const elsewhere = insertUser('student');
    enroll(cls.id, inClass.id);
    enroll(other.id, elsewhere.id);
    const teacherAUser = db.prepare("SELECT id FROM users WHERE role = 'teacher' ORDER BY id LIMIT 1").pluck().get() as number;

    expect((await teacherB.post(`/classes/${cls.id}/students/${inClass.id}/reset-password`)).status).toBe(403);
    expect((await teacherA.post(`/classes/${cls.id}/students/${elsewhere.id}/reset-password`)).status).toBe(404);
    expect((await teacherA.post(`/classes/${cls.id}/students/${teacherAUser}/reset-password`)).status).toBe(404);
    const studentClient = clientAs(srv.base, elsewhere.id);
    expect((await studentClient.post(`/classes/${cls.id}/students/${inClass.id}/reset-password`)).status).toBe(403);
    expect((await admin.post(`/classes/${cls.id}/students/${inClass.id}/reset-password`)).status).toBe(200);
    expect(verifyPassword('password123', userRow(elsewhere.id).password_hash)).toBe(true);
  });
});

describe('roster stats', () => {
  it('counts submitted, late and average per student in name order', async () => {
    const cls = await createClass(teacherA);
    const past = insertAssignment(cls.id, { points: 10, dueAt: iso(-2) });
    const future = insertAssignment(cls.id, { points: 20, dueAt: iso(5) });
    const draft = insertAssignment(cls.id, { points: 10, dueAt: iso(-2), published: false });
    const noPoints = insertAssignment(cls.id, { points: 0, dueAt: null });

    const zoe = insertUser('student', { name: 'Zoe' });
    const amir = insertUser('student', { name: 'amir' });
    const bea = insertUser('student', { name: 'Bea' });
    for (const s of [zoe, amir, bea]) enroll(cls.id, s.id);

    // Zoe: everything on time; graded 8/10 and 10/20; ungradable 0-point task excluded from the average.
    insertSubmission(past, zoe.id, 'graded', { submittedAt: iso(-3), grade: 8 });
    insertSubmission(future, zoe.id, 'graded', { submittedAt: iso(-1), grade: 10 });
    insertSubmission(noPoints, zoe.id, 'graded', { submittedAt: iso(-1), grade: 5 });
    insertSubmission(draft, zoe.id, 'in_progress');
    // Amir: missing the past-due task (late), working on the future one, handed in the no-due one.
    insertSubmission(future, amir.id, 'in_progress');
    insertSubmission(noPoints, amir.id, 'submitted', { submittedAt: iso(-1) });
    // Bea: handed in the past-due task after the deadline (late); nothing on the draft counts.
    insertSubmission(past, bea.id, 'submitted', { submittedAt: iso(-1) });

    // Someone else's work in another class must not leak into these numbers.
    const other = await createClass(teacherA, 'Elsewhere');
    const otherTask = insertAssignment(other.id, { points: 10, dueAt: iso(-2) });
    enroll(other.id, zoe.id);
    insertSubmission(otherTask, zoe.id, 'graded', { submittedAt: iso(-1), grade: 1 });

    const res = await teacherA.get<RosterResponse>(`/classes/${cls.id}/students`);
    expect(res.status).toBe(200);
    const students = res.body.students;
    expect(students.map((s) => s.name)).toEqual(['amir', 'Bea', 'Zoe']);
    const byName = Object.fromEntries(students.map((s) => [s.name, s]));
    expect(byName.Zoe).toMatchObject({ submittedCount: 3, lateCount: 0, averagePercent: 65 });
    expect(byName.amir).toMatchObject({ submittedCount: 1, lateCount: 1, averagePercent: null });
    expect(byName.Bea).toMatchObject({ submittedCount: 1, lateCount: 1, averagePercent: null });
    expect(byName.Zoe!.joinedAt).toEqual(expect.any(String));
  });

  it("doesn't count work on assignments that were unpublished after it was handed in or graded", async () => {
    const cls = await createClass(teacherA);
    const shown = insertAssignment(cls.id, { points: 10, dueAt: iso(-2) });
    const hidden = insertAssignment(cls.id, { points: 10, dueAt: iso(-2) });
    const student = insertUser('student', { name: 'Ann' });
    enroll(cls.id, student.id);
    insertSubmission(shown, student.id, 'graded', { submittedAt: iso(-3), grade: 4 });
    insertSubmission(hidden, student.id, 'graded', { submittedAt: iso(-3), grade: 10 });
    db.prepare('UPDATE assignments SET published = 0 WHERE id = ?').run(hidden);

    const res = await teacherA.get<RosterResponse>(`/classes/${cls.id}/students`);
    // Like the late count and the PDF reports: only published work (4 / 10), not the draft's 10 / 10.
    expect(res.body.students[0]).toMatchObject({ submittedCount: 1, lateCount: 0, averagePercent: 40 });
  });

  it('re-adding a removed student brings back their stats', async () => {
    const cls = await createClass(teacherA);
    const task = insertAssignment(cls.id, { points: 10, dueAt: null });
    const student = insertUser('student', { username: 'returner' });
    enroll(cls.id, student.id);
    insertSubmission(task, student.id, 'graded', { submittedAt: iso(-1), grade: 9 });
    await teacherA.delete(`/classes/${cls.id}/students/${student.id}`);

    const res = await teacherA.post<AddStudentResponse>(`/classes/${cls.id}/students`, { name: 'Returner', username: 'returner' });
    expect(res.status).toBe(201);
    expect(res.body.student).toMatchObject({ submittedCount: 1, averagePercent: 90 });
  });
});
