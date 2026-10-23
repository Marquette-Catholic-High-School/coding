import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssignmentInput, AssignmentResponse, AssignmentsResponse } from '@codeclass/shared';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let classCounter = 0;

function insertClass(ownerId: number, languageIds: string[], studentIds: number[] = []): number {
  classCounter += 1;
  const id = Number(
    db
      .prepare('INSERT INTO classes (name, join_code, owner_id) VALUES (?, ?, ?)')
      .run(`Class ${classCounter}`, `ASG${String(classCounter).padStart(3, '0')}`, ownerId).lastInsertRowid,
  );
  for (const l of languageIds) db.prepare('INSERT INTO class_languages (class_id, language_id) VALUES (?, ?)').run(id, l);
  for (const s of studentIds) db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(id, s);
  return id;
}

const tests = [
  { id: 't1', name: 'Greets', input: 'Ada', expectedOutput: 'Hello, Ada!', hidden: false, points: 1 },
  { id: 't2', name: 'Secret', input: 'Bob', expectedOutput: 'Hello, Bob!', hidden: true, points: 2 },
];

function input(overrides: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    title: 'Hello',
    instructions: '# Say hello',
    languageId: 'js',
    starterCode: '// start here',
    dueAt: null,
    points: 10,
    published: true,
    allowLate: true,
    tests,
    compareMode: 'trim',
    ...overrides,
  };
}

let teacher: TestClient;
let otherTeacher: TestClient;
let admin: TestClient;
let student: TestClient;
let outsider: TestClient;
let studentId: number;
let classId: number;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('js', 'javascript');
  insertLanguage('web', 'web');
  insertLanguage('py', 'python');
  insertLanguage('lua-off', 'lua', { enabled: false });
  const t = insertUser('teacher');
  const s = insertUser('student');
  studentId = s.id;
  classId = insertClass(t.id, ['js', 'web', 'lua-off'], [s.id]);
  teacher = clientAs(srv.base, t.id);
  otherTeacher = clientAs(srv.base, insertUser('teacher').id);
  admin = clientAs(srv.base, insertUser('admin').id);
  student = clientAs(srv.base, s.id);
  outsider = clientAs(srv.base, insertUser('student').id);
});
afterAll(() => srv.close());

async function create(overrides: Partial<AssignmentInput> = {}, cls = classId) {
  const res = await teacher.post<AssignmentResponse>(`/classes/${cls}/assignments`, input(overrides));
  expect(res.status).toBe(201);
  return res.body;
}

describe('create', () => {
  it('lets the class owner and admins create assignments, not other teachers or students', async () => {
    const created = await create();
    expect(created.assignment).toMatchObject({ classId, title: 'Hello', languageId: 'js', points: 10, published: true });
    expect(created.assignment.tests).toHaveLength(2);
    expect(created.language).toMatchObject({ id: 'js', kind: 'javascript' });
    expect(created.class).toEqual({ id: classId, name: expect.any(String) });
    expect(created.submission).toBeNull();

    expect((await admin.post(`/classes/${classId}/assignments`, input())).status).toBe(201);
    expect((await otherTeacher.post(`/classes/${classId}/assignments`, input())).status).toBe(403);
    expect((await student.post(`/classes/${classId}/assignments`, input())).status).toBe(403);
  });

  it('requires a language that belongs to the class and is enabled', async () => {
    for (const languageId of ['py', 'nope', 'lua-off']) {
      const res = await teacher.post(`/classes/${classId}/assignments`, input({ languageId }));
      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.languageId).toBeTruthy();
    }
  });

  it('rejects tests for kinds that do not support them and duplicate test ids', async () => {
    const web = await teacher.post(`/classes/${classId}/assignments`, input({ languageId: 'web' }));
    expect(web.status).toBe(400);
    expect(web.body.error.fieldErrors.tests).toBeTruthy();
    expect((await teacher.post(`/classes/${classId}/assignments`, input({ languageId: 'web', tests: [] }))).status).toBe(201);

    const dup = await teacher.post(`/classes/${classId}/assignments`, input({ tests: [tests[0]!, { ...tests[1]!, id: 't1' }] }));
    expect(dup.status).toBe(400);
    expect(dup.body.error.fieldErrors.tests).toBeTruthy();
  });

  it('validates fields and stores due dates in UTC', async () => {
    const bad = await teacher.post(`/classes/${classId}/assignments`, input({ title: '  ' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.fieldErrors.title).toBeTruthy();

    const created = await create({ dueAt: '2030-01-15T09:30:00-05:00' });
    expect(created.assignment.dueAt).toBe('2030-01-15T14:30:00.000Z');
  });
});

describe('update and delete', () => {
  it('only changes the fields that are sent', async () => {
    const { assignment } = await create({ points: 25, dueAt: '2030-02-01T12:00:00Z' });
    const res = await teacher.patch<AssignmentResponse>(`/assignments/${assignment.id}`, { title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.assignment).toMatchObject({
      title: 'Renamed',
      points: 25,
      dueAt: '2030-02-01T12:00:00.000Z',
      instructions: '# Say hello',
      tests,
    });
    expect(res.body.assignment.updatedAt >= assignment.updatedAt).toBe(true);

    const cleared = await teacher.patch<AssignmentResponse>(`/assignments/${assignment.id}`, { dueAt: null, published: false });
    expect(cleared.body.assignment).toMatchObject({ dueAt: null, published: false, title: 'Renamed' });
  });

  it('validates language changes but lets an assignment keep a language that was later disabled', async () => {
    const { assignment } = await create();
    const notInClass = await teacher.patch(`/assignments/${assignment.id}`, { languageId: 'py' });
    expect(notInClass.status).toBe(400);
    expect(notInClass.body.error.fieldErrors.languageId).toBeTruthy();
    expect((await teacher.patch(`/assignments/${assignment.id}`, { languageId: 'lua-off' })).status).toBe(400);

    db.prepare('UPDATE languages SET enabled = 0 WHERE id = ?').run('js');
    try {
      const kept = await teacher.patch<AssignmentResponse>(`/assignments/${assignment.id}`, { languageId: 'js', title: 'Still JS' });
      expect(kept.status).toBe(200);
      expect(kept.body.assignment.title).toBe('Still JS');
    } finally {
      db.prepare('UPDATE languages SET enabled = 1 WHERE id = ?').run('js');
    }
  });

  it('rejects lowering the points below a grade students already have', async () => {
    const { assignment } = await create({ points: 100 });
    expect((await student.post(`/assignments/${assignment.id}/submit`, { code: 'x' })).status).toBe(200);
    expect((await teacher.patch(`/assignments/${assignment.id}/submissions/${studentId}`, { grade: 90 })).status).toBe(200);

    const lowered = await teacher.patch(`/assignments/${assignment.id}`, { points: 10, title: 'Not saved' });
    expect(lowered.status).toBe(400);
    expect(lowered.body.error.fieldErrors.points).toMatch(/90/);
    expect((await teacher.get<AssignmentResponse>(`/assignments/${assignment.id}`)).body.assignment).toMatchObject({ points: 100, title: 'Hello' });

    const atGrade = await teacher.patch<AssignmentResponse>(`/assignments/${assignment.id}`, { points: 90 });
    expect(atGrade.status).toBe(200);
    expect(atGrade.body.assignment.points).toBe(90);
    // Other edits don't re-check the points.
    expect((await teacher.patch(`/assignments/${assignment.id}`, { title: 'Renamed' })).status).toBe(200);

    // Without grades, any points value is fine.
    const ungraded = await create({ points: 100 });
    expect((await student.post(`/assignments/${ungraded.assignment.id}/submit`, { code: 'x' })).status).toBe(200);
    expect((await teacher.patch(`/assignments/${ungraded.assignment.id}`, { points: 5 })).status).toBe(200);
  });

  it("ignores grades of students who left the class, and suggests whole points", async () => {
    const leaver = insertUser('student');
    const stayer = insertUser('student');
    const cls = insertClass(insertUser('teacher').id, ['js'], [leaver.id, stayer.id]);
    const owner = clientAs(srv.base, (db.prepare('SELECT owner_id FROM classes WHERE id = ?').pluck().get(cls) as number));
    const created = await owner.post<AssignmentResponse>(`/classes/${cls}/assignments`, input({ points: 100 }));
    const id = created.body.assignment.id;
    for (const [s, grade] of [[leaver, 95], [stayer, 40.5]] as const) {
      expect((await clientAs(srv.base, s.id).post(`/assignments/${id}/submit`, { code: 'x' })).status).toBe(200);
      expect((await owner.patch(`/assignments/${id}/submissions/${s.id}`, { grade })).status).toBe(200);
    }
    db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(cls, leaver.id);

    const tooLow = await owner.patch(`/assignments/${id}`, { points: 40 });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.fieldErrors.points).toMatch(/keep at least 41 points/);
    expect((await owner.patch(`/assignments/${id}`, { points: 41 })).status).toBe(200);
  });

  it('rejects switching to a kind without tests while tests remain', async () => {
    const { assignment } = await create();
    const res = await teacher.patch(`/assignments/${assignment.id}`, { languageId: 'web' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.tests).toBeTruthy();
    const ok = await teacher.patch<AssignmentResponse>(`/assignments/${assignment.id}`, { languageId: 'web', tests: [] });
    expect(ok.status).toBe(200);
    expect(ok.body.language.kind).toBe('web');
  });

  it('only lets managers update or delete', async () => {
    const { assignment } = await create();
    expect((await otherTeacher.patch(`/assignments/${assignment.id}`, { title: 'X' })).status).toBe(403);
    expect((await student.patch(`/assignments/${assignment.id}`, { title: 'X' })).status).toBe(403);
    expect((await student.delete(`/assignments/${assignment.id}`)).status).toBe(403);
    expect((await otherTeacher.delete(`/assignments/${assignment.id}`)).status).toBe(403);
    expect((await admin.patch(`/assignments/${assignment.id}`, { title: 'By admin' })).status).toBe(200);

    expect((await teacher.delete(`/assignments/${assignment.id}`)).body).toEqual({ ok: true });
    expect((await teacher.get(`/assignments/${assignment.id}`)).status).toBe(404);
    expect((await teacher.delete('/assignments/999999')).status).toBe(404);
  });
});

describe('read', () => {
  it('strips hidden tests and includes the student submission for students', async () => {
    const { assignment } = await create();
    const res = await student.get<AssignmentResponse>(`/assignments/${assignment.id}`);
    expect(res.status).toBe(200);
    expect(res.body.assignment.tests.map((t) => t.id)).toEqual(['t1']);
    expect(res.body.assignment.hiddenTestCount).toBe(1);
    expect(res.body.submission).toMatchObject({ id: null, status: 'not_started', code: '// start here', studentId });
    expect(JSON.stringify(res.body)).not.toContain('Secret');

    const staff = await teacher.get<AssignmentResponse>(`/assignments/${assignment.id}`);
    expect(staff.body.assignment.tests).toHaveLength(2);
    expect(staff.body.submission).toBeNull();
  });

  it('hides drafts from students and assignments from students outside the class', async () => {
    const { assignment } = await create({ published: false });
    expect((await student.get(`/assignments/${assignment.id}`)).status).toBe(404);
    expect((await teacher.get(`/assignments/${assignment.id}`)).status).toBe(200);
    const { assignment: published } = await create();
    expect((await outsider.get(`/assignments/${published.id}`)).status).toBe(404);
    expect((await otherTeacher.get(`/assignments/${published.id}`)).status).toBe(403);
    expect((await student.get('/assignments/abc')).status).toBe(404);
  });
});

describe('list', () => {
  it('orders by due date (none last) then newest, with role-specific rows', async () => {
    const t = insertUser('teacher');
    const s1 = insertUser('student');
    const s2 = insertUser('student');
    const cls = insertClass(t.id, ['js'], [s1.id, s2.id]);
    const owner = clientAs(srv.base, t.id);
    const mk = async (title: string, extra: Partial<AssignmentInput>) => {
      const res = await owner.post<AssignmentResponse>(`/classes/${cls}/assignments`, input({ title, ...extra }));
      expect(res.status).toBe(201);
      return res.body.assignment.id;
    };
    const noDueOld = await mk('No due (old)', {});
    const later = await mk('Later', { dueAt: '2031-05-01T00:00:00Z' });
    const draft = await mk('Draft', { dueAt: '2031-01-01T00:00:00Z', published: false });
    const past = await mk('Past', { dueAt: '2020-01-01T00:00:00Z' });
    const noDueNew = await mk('No due (new)', {});

    // s1 submits "Past" (late); s1's "Later" gets graded.
    const s1c = clientAs(srv.base, s1.id);
    expect((await s1c.post(`/assignments/${past}/submit`, { code: 'x' })).status).toBe(200);
    expect((await s1c.post(`/assignments/${later}/submit`, { code: 'y' })).status).toBe(200);
    expect((await owner.patch(`/assignments/${later}/submissions/${s1.id}`, { grade: 7 })).status).toBe(200);

    const staff = await owner.get<AssignmentsResponse>(`/classes/${cls}/assignments`);
    expect(staff.status).toBe(200);
    expect(staff.body.assignments.map((a) => a.id)).toEqual([past, draft, later, noDueNew, noDueOld]);
    const byId = new Map(staff.body.assignments.map((a) => [a.id, a]));
    expect(byId.get(past)).toMatchObject({ submittedCount: 1, gradedCount: 0, lateCount: 2, studentCount: 2, myStatus: null });
    expect(byId.get(later)).toMatchObject({ submittedCount: 1, gradedCount: 1, lateCount: 0 });
    expect(byId.get(draft)).toMatchObject({ published: false, lateCount: 0 });

    const mine = await s1c.get<AssignmentsResponse>(`/classes/${cls}/assignments`);
    expect(mine.body.assignments.map((a) => a.id)).toEqual([past, later, noDueNew, noDueOld]);
    const mineById = new Map(mine.body.assignments.map((a) => [a.id, a]));
    expect(mineById.get(past)).toMatchObject({ myStatus: 'submitted', myLate: true, myGrade: null, submittedCount: 0 });
    expect(mineById.get(later)).toMatchObject({ myStatus: 'graded', myLate: false, myGrade: 7 });
    expect(mineById.get(noDueOld)).toMatchObject({ myStatus: 'not_started', myLate: false });

    const s2List = await clientAs(srv.base, s2.id).get<AssignmentsResponse>(`/classes/${cls}/assignments`);
    expect(s2List.body.assignments.find((a) => a.id === past)).toMatchObject({ myStatus: 'not_started', myLate: true });

    expect((await outsider.get(`/classes/${cls}/assignments`)).status).toBe(404);
    expect((await otherTeacher.get(`/classes/${cls}/assignments`)).status).toBe(403);
  });
});
