import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AssignmentInput,
  AssignmentResponse,
  SubmissionDetailResponse,
  User,
} from '@codeclass/shared';
import { db, migrate, type AssignmentRow } from '../src/db';
import { toAssignment } from '../src/mappers';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;

const SOLUTION = 'console.log("the answer is 42")';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

let teacher: TestClient;
let admin: TestClient;
let classId: number;
// Enrolled students; each test puts them in different states on a fresh assignment.
let ann: { id: number; client: TestClient };
let ben: { id: number; client: TestClient };
let cat: { id: number; client: TestClient };
let dan: { id: number; client: TestClient };

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('js', 'javascript');
  const t = insertUser('teacher');
  teacher = clientAs(srv.base, t.id);
  admin = clientAs(srv.base, insertUser('admin').id);
  classId = Number(db.prepare("INSERT INTO classes (name, join_code, owner_id) VALUES ('Solutions', 'SOLN01', ?)").run(t.id).lastInsertRowid);
  db.prepare("INSERT INTO class_languages (class_id, language_id) VALUES (?, 'js')").run(classId);
  const mk = (name: string) => {
    const u = insertUser('student', { name });
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, u.id);
    return { id: u.id, client: clientAs(srv.base, u.id) };
  };
  ann = mk('Ann');
  ben = mk('Ben');
  cat = mk('Cat');
  dan = mk('Dan');
});
afterAll(() => srv.close());

async function create(overrides: Partial<AssignmentInput> = {}) {
  const res = await teacher.post<AssignmentResponse>(`/classes/${classId}/assignments`, {
    title: 'Answer',
    languageId: 'js',
    starterCode: '// starter',
    points: 10,
    solutionCode: SOLUTION,
    ...overrides,
  } satisfies AssignmentInput);
  expect(res.status).toBe(201);
  return res.body.assignment.id;
}

/** The solution code the student receives on the assignment page (null = not released). */
async function seen(client: TestClient, id: number) {
  const res = await client.get<AssignmentResponse>(`/assignments/${id}`);
  expect(res.status).toBe(200);
  return res.body.assignment.solutionCode;
}

const save = async (s: { client: TestClient }, id: number) => expect((await s.client.put(`/assignments/${id}/submission`, { code: 'x' })).status).toBe(200);
const submit = async (s: { client: TestClient }, id: number) => expect((await s.client.post(`/assignments/${id}/submit`, { code: 'x' })).status).toBe(200);
const grade = async (s: { id: number }, id: number) => expect((await teacher.patch(`/assignments/${id}/submissions/${s.id}`, { grade: 8 })).status).toBe(200);
const giveBack = async (s: { id: number }, id: number) =>
  expect((await teacher.patch(`/assignments/${id}/submissions/${s.id}`, { status: 'in_progress', feedback: 'Try again' })).status).toBe(200);

/** Ann has not started, Ben is working on it, Cat handed in, Dan was graded. */
async function spreadStatuses(id: number) {
  await save(ben, id);
  await submit(cat, id);
  await submit(dan, id);
  await grade(dan, id);
}

describe('who sees the solution', () => {
  it('always shows it to teachers and admins, with the visibility and hasSolution', async () => {
    const id = await create({ solutionVisibility: 'hidden' });
    const created = await teacher.get<AssignmentResponse>(`/assignments/${id}`);
    expect(created.body.assignment).toMatchObject({ solutionCode: SOLUTION, solutionVisibility: 'hidden', hasSolution: true });
    expect((await admin.get<AssignmentResponse>(`/assignments/${id}`)).body.assignment.solutionCode).toBe(SOLUTION);

    await submit(ann, id);
    const grading = await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${ann.id}`);
    expect(grading.status).toBe(200);
    expect(grading.body.assignment.solutionCode).toBe(SOLUTION);

    const patched = await teacher.patch<AssignmentResponse>(`/assignments/${id}`, { title: 'Renamed' });
    expect(patched.body.assignment).toMatchObject({ title: 'Renamed', solutionCode: SOLUTION, solutionVisibility: 'hidden' });
  });

  it('reports no solution when the code is empty or only whitespace', async () => {
    const none = await create({ solutionCode: undefined, solutionVisibility: undefined });
    expect((await teacher.get<AssignmentResponse>(`/assignments/${none}`)).body.assignment).toMatchObject({
      solutionCode: '',
      solutionVisibility: 'hidden',
      hasSolution: false,
    });

    const blank = await create({ solutionCode: '  \n\t', solutionVisibility: 'visible' });
    expect((await teacher.get<AssignmentResponse>(`/assignments/${blank}`)).body.assignment).toMatchObject({
      solutionCode: '  \n\t',
      hasSolution: false,
    });
    const student = (await ann.client.get<AssignmentResponse>(`/assignments/${blank}`)).body.assignment;
    expect(student).toMatchObject({ solutionCode: null, solutionVisibility: 'visible', hasSolution: false });
  });

  it("'visible' shows it to every student straight away", async () => {
    const id = await create({ solutionVisibility: 'visible' });
    await spreadStatuses(id);
    for (const s of [ann, ben, cat, dan]) expect(await seen(s.client, id)).toBe(SOLUTION);
    expect((await ann.client.get<AssignmentResponse>(`/assignments/${id}`)).body.assignment.hasSolution).toBe(true);
  });

  it("'hidden' never shows it to students, on any endpoint", async () => {
    const id = await create({ solutionVisibility: 'hidden', dueAt: FUTURE, allowLate: false });
    await spreadStatuses(id);
    // Past due with late work off would release an 'after_due' solution to everyone.
    db.prepare('UPDATE assignments SET due_at = ? WHERE id = ?').run(PAST, id);
    for (const s of [ann, ben, cat, dan]) {
      const res = await s.client.get<AssignmentResponse>(`/assignments/${id}`);
      expect(res.body.assignment).toMatchObject({ solutionCode: null, solutionVisibility: 'hidden', hasSolution: true });
      expect(JSON.stringify(res.body)).not.toContain('the answer is 42');
    }
    // Nothing else a student can call carries it either.
    const responses = [
      await ann.client.get(`/assignments/${id}/submission`),
      await ann.client.get(`/classes/${classId}/assignments`),
      await ann.client.get('/dashboard'),
      await dan.client.get(`/assignments/${id}/submission`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('the answer is 42');
    }
  });

  it("'after_graded' shows it once the student's own work is graded, and hides it again when returned", async () => {
    const id = await create({ solutionVisibility: 'after_graded' });
    await spreadStatuses(id);
    expect(await seen(ann.client, id)).toBeNull();
    expect(await seen(ben.client, id)).toBeNull();
    expect(await seen(cat.client, id)).toBeNull();
    expect(await seen(dan.client, id)).toBe(SOLUTION);

    await grade(cat, id);
    expect(await seen(cat.client, id)).toBe(SOLUTION);

    // Returned for revision: no longer graded, so the solution goes away until it's graded again.
    await giveBack(dan, id);
    const returned = await dan.client.get<AssignmentResponse>(`/assignments/${id}`);
    expect(returned.body.submission).toMatchObject({ status: 'in_progress', returnedAt: expect.any(String) });
    expect(returned.body.assignment.solutionCode).toBeNull();
    await submit(dan, id);
    expect(await seen(dan.client, id)).toBeNull();
    await grade(dan, id);
    expect(await seen(dan.client, id)).toBe(SOLUTION);
  });

  it("'after_due' keeps it hidden before the due date, whatever the student did", async () => {
    for (const allowLate of [true, false]) {
      const id = await create({ solutionVisibility: 'after_due', dueAt: FUTURE, allowLate });
      await spreadStatuses(id);
      for (const s of [ann, ben, cat, dan]) expect(await seen(s.client, id)).toBeNull();
    }
  });

  it("'after_due' without late work shows it to everyone once the due date has passed", async () => {
    const id = await create({ solutionVisibility: 'after_due', dueAt: FUTURE, allowLate: false });
    await spreadStatuses(id);
    db.prepare('UPDATE assignments SET due_at = ? WHERE id = ?').run(PAST, id);
    for (const s of [ann, ben, cat, dan]) expect(await seen(s.client, id)).toBe(SOLUTION);
  });

  it("'after_due' with late work allowed only shows it to students who have handed in", async () => {
    const id = await create({ solutionVisibility: 'after_due', dueAt: PAST, allowLate: true });
    await spreadStatuses(id);
    expect(await seen(ann.client, id)).toBeNull();
    expect(await seen(ben.client, id)).toBeNull();
    expect(await seen(cat.client, id)).toBe(SOLUTION);
    expect(await seen(dan.client, id)).toBe(SOLUTION);

    // Handing in late releases it, and then the work can't be taken back (or the solution could be handed in).
    await submit(ann, id);
    expect(await seen(ann.client, id)).toBe(SOLUTION);
    const unsubmit = await ann.client.post(`/assignments/${id}/unsubmit`);
    expect(unsubmit.status).toBe(409);
    expect(unsubmit.body.error.message).toMatch(/solution/);
    expect(await seen(ann.client, id)).toBe(SOLUTION);

    // Work returned for revision is in progress again, so it's hidden until handed in again.
    await giveBack(cat, id);
    expect(await seen(cat.client, id)).toBeNull();
    await submit(cat, id);
    expect(await seen(cat.client, id)).toBe(SOLUTION);
  });

  it("'after_due' without late work keeps it from returned work until that is handed in again, then locks it", async () => {
    const id = await create({ solutionVisibility: 'after_due', dueAt: FUTURE, allowLate: false });
    await spreadStatuses(id);
    expect((await teacher.patch(`/assignments/${id}`, { dueAt: PAST })).status).toBe(200);
    // Closed work can't change, so it may see the solution; work returned for revision can still be handed in.
    expect(await seen(ann.client, id)).toBe(SOLUTION);
    expect(await seen(ben.client, id)).toBe(SOLUTION);
    await giveBack(cat, id);
    expect(await seen(cat.client, id)).toBeNull();
    await submit(cat, id);
    expect(await seen(cat.client, id)).toBe(SOLUTION);
    expect((await cat.client.post(`/assignments/${id}/unsubmit`)).status).toBe(409);
    // A closed assignment can't be edited either (saving the solution into a draft would show up as their work).
    expect((await ann.client.put(`/assignments/${id}/submission`, { code: SOLUTION })).status).toBe(409);
  });

  it('follows changes the teacher makes to the visibility', async () => {
    const id = await create({ solutionVisibility: 'hidden' });
    expect(await seen(ann.client, id)).toBeNull();
    expect((await teacher.patch(`/assignments/${id}`, { solutionVisibility: 'visible' })).status).toBe(200);
    expect(await seen(ann.client, id)).toBe(SOLUTION);
    expect((await teacher.patch(`/assignments/${id}`, { solutionCode: 'better()' })).status).toBe(200);
    expect(await seen(ann.client, id)).toBe('better()');
    const removed = await teacher.patch<AssignmentResponse>(`/assignments/${id}`, { solutionCode: '' });
    expect(removed.body.assignment).toMatchObject({ solutionCode: '', hasSolution: false, solutionVisibility: 'visible' });
    expect(await seen(ann.client, id)).toBeNull();
  });

  it("can't map an assignment for a student without their submission status", () => {
    const id = Number(db.prepare('SELECT MAX(id) FROM assignments').pluck().get());
    const row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as AssignmentRow;
    const student = { id: ann.id, role: 'student' } as User;
    expect(() => toAssignment(row, student, null)).toThrow();
    expect(toAssignment(row, { id: 1, role: 'teacher' } as User, null).solutionCode).toBe(row.solution_code);
  });
});

describe('validation', () => {
  it("requires a due date for 'after_due' when creating", async () => {
    const res = await teacher.post(`/classes/${classId}/assignments`, {
      title: 'No due date',
      languageId: 'js',
      solutionCode: SOLUTION,
      solutionVisibility: 'after_due',
    } satisfies AssignmentInput);
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.solutionVisibility).toBeTruthy();
    expect(await create({ solutionVisibility: 'after_due', dueAt: FUTURE })).toEqual(expect.any(Number));
  });

  it('rejects unknown visibilities and over-long solutions', async () => {
    const bad = await teacher.post(`/classes/${classId}/assignments`, { title: 'X', languageId: 'js', solutionVisibility: 'sometimes' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fieldErrors.solutionVisibility).toBeTruthy();
    const long = await teacher.post(`/classes/${classId}/assignments`, { title: 'X', languageId: 'js', solutionCode: 'x'.repeat(50001) });
    expect(long.status).toBe(400);
    expect(long.body.error.fieldErrors.solutionCode).toBeTruthy();
  });

  it("checks 'after_due' against the saved due date merged with the PATCH", async () => {
    const id = await create({ solutionVisibility: 'after_due', dueAt: FUTURE });

    // Clearing the due date while the solution stays 'after_due' would leave it with nothing to wait for.
    const cleared = await teacher.patch(`/assignments/${id}`, { dueAt: null, title: 'Not saved' });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.fieldErrors.solutionVisibility).toBeTruthy();
    expect((await teacher.get<AssignmentResponse>(`/assignments/${id}`)).body.assignment).toMatchObject({ dueAt: FUTURE, title: 'Answer' });

    const both = await teacher.patch<AssignmentResponse>(`/assignments/${id}`, { dueAt: null, solutionVisibility: 'after_graded' });
    expect(both.status).toBe(200);
    expect(both.body.assignment).toMatchObject({ dueAt: null, solutionVisibility: 'after_graded' });

    // No due date saved: switching to 'after_due' alone fails, together with a due date it works.
    const alone = await teacher.patch(`/assignments/${id}`, { solutionVisibility: 'after_due' });
    expect(alone.status).toBe(400);
    expect(alone.body.error.fieldErrors.solutionVisibility).toBeTruthy();
    const withDue = await teacher.patch<AssignmentResponse>(`/assignments/${id}`, { solutionVisibility: 'after_due', dueAt: PAST });
    expect(withDue.status).toBe(200);
    expect(withDue.body.assignment).toMatchObject({ dueAt: PAST, solutionVisibility: 'after_due' });
  });

  it("leaves the solution alone when a PATCH doesn't send it (partial() defaults are not applied)", async () => {
    const id = await create({ solutionVisibility: 'after_graded' });
    const res = await teacher.patch<AssignmentResponse>(`/assignments/${id}`, { title: 'Renamed', points: 20 });
    expect(res.status).toBe(200);
    expect(res.body.assignment).toMatchObject({ title: 'Renamed', solutionCode: SOLUTION, solutionVisibility: 'after_graded' });
  });
});

describe('migration', () => {
  it('adds the solution columns, with their defaults, to databases created before they existed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeclass-solutions-'));
    const file = path.join(dir, 'old.db');
    try {
      // The assignments/submissions tables as older versions created them (other tables aren't needed here).
      const before = new Database(file);
      before.exec(`
        CREATE TABLE assignments (
          id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '',
          language_id TEXT NOT NULL, starter_code TEXT NOT NULL DEFAULT '', due_at TEXT,
          points INTEGER NOT NULL DEFAULT 100, published INTEGER NOT NULL DEFAULT 1, allow_late INTEGER NOT NULL DEFAULT 1,
          tests TEXT NOT NULL DEFAULT '[]', compare_mode TEXT NOT NULL DEFAULT 'trim',
          created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z', updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z');
        CREATE TABLE submissions (
          id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL, student_id INTEGER NOT NULL, code TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'in_progress', feedback TEXT, updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z');
        INSERT INTO assignments (id, class_id, title, language_id) VALUES (1, 1, 'Old one', 'js');
      `);
      before.close();

      const after = new Database(file);
      try {
        migrate(after);
        migrate(after); // idempotent
        const columns = after.prepare('PRAGMA table_info(assignments)').all() as { name: string; notnull: number; dflt_value: string | null }[];
        expect(columns.find((c) => c.name === 'solution_code')).toMatchObject({ notnull: 1, dflt_value: "''" });
        expect(columns.find((c) => c.name === 'solution_visibility')).toMatchObject({ notnull: 1, dflt_value: "'hidden'" });
        const submissionColumns = after.prepare('PRAGMA table_info(submissions)').all() as { name: string }[];
        expect(submissionColumns.map((c) => c.name)).toContain('returned_at');

        expect(after.prepare('SELECT solution_code, solution_visibility FROM assignments WHERE id = 1').get()).toEqual({
          solution_code: '',
          solution_visibility: 'hidden',
        });
        after.prepare("INSERT INTO assignments (id, class_id, title, language_id) VALUES (2, 1, 'New one', 'js')").run();
        expect(after.prepare('SELECT solution_visibility FROM assignments WHERE id = 2').pluck().get()).toBe('hidden');
        expect(() => after.prepare("UPDATE assignments SET solution_visibility = 'sometimes' WHERE id = 1").run()).toThrow(/CHECK/);
        after.prepare("UPDATE assignments SET solution_visibility = 'after_graded' WHERE id = 1").run();
      } finally {
        after.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
