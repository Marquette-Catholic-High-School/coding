import type { ClassResponse, ClassesResponse, ClassSummary } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let teacherA: TestClient;
let teacherB: TestClient;
let admin: TestClient;
let teacherAId: number;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('python', 'python');
  insertLanguage('javascript', 'javascript');
  insertLanguage('lua', 'lua', { enabled: false });
  const a = insertUser('teacher', { name: 'Ada Teacher' });
  teacherAId = a.id;
  teacherA = clientAs(srv.base, a.id);
  teacherB = clientAs(srv.base, insertUser('teacher').id);
  admin = clientAs(srv.base, insertUser('admin').id);
});
afterAll(() => srv.close());

async function createClass(client: TestClient, input: Record<string, unknown> = {}): Promise<ClassSummary> {
  const res = await client.post<ClassResponse>('/classes', { name: 'Computer Science — Period 3', ...input });
  expect(res.status).toBe(201);
  return res.body.class;
}

function newStudent() {
  const s = insertUser('student');
  return { ...s, client: clientAs(srv.base, s.id) };
}

function insertAssignment(classId: number, published: boolean) {
  const info = db
    .prepare('INSERT INTO assignments (class_id, title, language_id, published) VALUES (?, ?, ?, ?)')
    .run(classId, 'Task', 'python', published ? 1 : 0);
  return Number(info.lastInsertRowid);
}

describe('create', () => {
  it('creates a class with a join code and languages', async () => {
    const cls = await createClass(teacherA, { description: 'Mondays', languageIds: ['python', 'javascript', 'python'] });
    expect(cls.name).toBe('Computer Science — Period 3');
    expect(cls.description).toBe('Mondays');
    expect(cls.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(cls.joinEnabled).toBe(true);
    expect(cls.archived).toBe(false);
    expect(cls.ownerId).toBe(teacherAId);
    expect(cls.ownerName).toBe('Ada Teacher');
    expect(cls.studentCount).toBe(0);
    expect(cls.assignmentCount).toBe(0);
    expect(cls.languageIds).toEqual(['javascript', 'python']);
  });

  it('allows a class with no languages', async () => {
    const cls = await createClass(teacherA, { name: 'No languages yet' });
    expect(cls.languageIds).toEqual([]);
  });

  it('validates the name', async () => {
    const res = await teacherA.post('/classes', { name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.name).toBeTruthy();
  });

  it('rejects unknown and disabled languages', async () => {
    const unknown = await teacherA.post('/classes', { name: 'X', languageIds: ['cobol'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fieldErrors.languageIds).toBeTruthy();
    const disabled = await teacherA.post('/classes', { name: 'X', languageIds: ['python', 'lua'] });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error.fieldErrors.languageIds).toMatch(/lua/);
  });

  it('is staff only', async () => {
    const student = newStudent();
    expect((await student.client.post('/classes', { name: 'Mine' })).status).toBe(403);
    expect((await srv.client().post('/classes', { name: 'Mine' })).status).toBe(401);
  });

  it('gives every class a different join code', async () => {
    const a = await createClass(teacherA, { name: 'One' });
    const b = await createClass(teacherA, { name: 'Two' });
    expect(a.joinCode).not.toBe(b.joinCode);
  });
});

describe('list and read permissions', () => {
  let classA: ClassSummary;
  let classB: ClassSummary;

  beforeAll(async () => {
    classA = await createClass(teacherA, { name: 'A list class' });
    classB = await createClass(teacherB, { name: 'B list class' });
  });

  it('teachers list only their own classes; admins list all', async () => {
    const a = await teacherA.get<ClassesResponse>('/classes');
    const aIds = a.body.classes.map((c) => c.id);
    expect(aIds).toContain(classA.id);
    expect(aIds).not.toContain(classB.id);

    const b = await teacherB.get<ClassesResponse>('/classes');
    expect(b.body.classes.map((c) => c.id)).toEqual([classB.id]);

    const all = await admin.get<ClassesResponse>('/classes');
    const allIds = all.body.classes.map((c) => c.id);
    expect(allIds).toEqual(expect.arrayContaining([classA.id, classB.id]));
  });

  it('teacher B cannot read or change teacher A\'s class; admin can', async () => {
    expect((await teacherB.get(`/classes/${classA.id}`)).status).toBe(403);
    expect((await teacherB.patch(`/classes/${classA.id}`, { name: 'Hijacked' })).status).toBe(403);
    expect((await teacherB.post(`/classes/${classA.id}/regenerate-code`)).status).toBe(403);
    expect((await teacherB.delete(`/classes/${classA.id}`)).status).toBe(403);

    const read = await admin.get<ClassResponse>(`/classes/${classA.id}`);
    expect(read.status).toBe(200);
    expect(read.body.class.joinCode).toBe(classA.joinCode);
    const patched = await admin.patch<ClassResponse>(`/classes/${classA.id}`, { description: 'Checked by admin' });
    expect(patched.status).toBe(200);
    expect(patched.body.class.description).toBe('Checked by admin');
  });

  it('students only see classes they are enrolled in, without the join code', async () => {
    const student = newStudent();
    expect((await student.client.get(`/classes/${classA.id}`)).status).toBe(404);
    expect((await student.client.get<ClassesResponse>('/classes')).body.classes).toEqual([]);

    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classA.id, student.id);
    const read = await student.client.get<ClassResponse>(`/classes/${classA.id}`);
    expect(read.status).toBe(200);
    expect(read.body.class.joinCode).toBeNull();
    const list = await student.client.get<ClassesResponse>('/classes');
    expect(list.body.classes.map((c) => c.id)).toEqual([classA.id]);
    expect(list.body.classes[0]!.joinCode).toBeNull();
  });

  it('students count only published assignments; staff count all', async () => {
    const cls = await createClass(teacherA, { name: 'Counting' });
    insertAssignment(cls.id, true);
    insertAssignment(cls.id, false);
    const student = newStudent();
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, student.id);
    expect((await teacherA.get<ClassResponse>(`/classes/${cls.id}`)).body.class.assignmentCount).toBe(2);
    const seen = (await student.client.get<ClassResponse>(`/classes/${cls.id}`)).body.class;
    expect(seen.assignmentCount).toBe(1);
    expect(seen.studentCount).toBe(1);
  });

  it('404s for unknown or malformed ids', async () => {
    expect((await teacherA.get('/classes/999999')).status).toBe(404);
    expect((await teacherA.get('/classes/abc')).status).toBe(404);
  });
});

describe('update', () => {
  it('updates name, description and joining', async () => {
    const cls = await createClass(teacherA, { name: 'Before' });
    const res = await teacherA.patch<ClassResponse>(`/classes/${cls.id}`, {
      name: 'After',
      description: 'New description',
      joinEnabled: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.class).toMatchObject({ name: 'After', description: 'New description', joinEnabled: false });
    const empty = await teacherA.patch(`/classes/${cls.id}`, { name: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fieldErrors.name).toBeTruthy();
  });

  it('keeps already-assigned languages that were disabled, but only adds enabled ones', async () => {
    insertLanguage('sql', 'sql');
    const cls = await createClass(teacherA, { name: 'Langs', languageIds: ['python', 'sql'] });
    db.prepare('UPDATE languages SET enabled = 0 WHERE id = ?').run('sql');

    const keep = await teacherA.patch<ClassResponse>(`/classes/${cls.id}`, { languageIds: ['sql', 'python', 'javascript'] });
    expect(keep.status).toBe(200);
    expect(keep.body.class.languageIds).toEqual(['javascript', 'python', 'sql']);

    const addDisabled = await teacherA.patch(`/classes/${cls.id}`, { languageIds: ['python', 'lua'] });
    expect(addDisabled.status).toBe(400);
    expect(addDisabled.body.error.fieldErrors.languageIds).toBeTruthy();

    const drop = await teacherA.patch<ClassResponse>(`/classes/${cls.id}`, { languageIds: ['python'] });
    expect(drop.body.class.languageIds).toEqual(['python']);
    // Once removed, a disabled language can't come back.
    const readd = await teacherA.patch(`/classes/${cls.id}`, { languageIds: ['python', 'sql'] });
    expect(readd.status).toBe(400);
  });

  it('leaves languages alone when languageIds is omitted', async () => {
    const cls = await createClass(teacherA, { name: 'Untouched', languageIds: ['python'] });
    const res = await teacherA.patch<ClassResponse>(`/classes/${cls.id}`, { name: 'Renamed' });
    expect(res.body.class.languageIds).toEqual(['python']);
  });

  it('archives and unarchives', async () => {
    const cls = await createClass(teacherA, { name: 'Old class' });
    const archived = await teacherA.patch<ClassResponse>(`/classes/${cls.id}`, { archived: true });
    expect(archived.body.class.archived).toBe(true);
    expect((await teacherA.get<ClassesResponse>('/classes')).body.classes.map((c) => c.id)).not.toContain(cls.id);
    expect((await teacherA.get<ClassesResponse>('/classes?archived=1')).body.classes.map((c) => c.id)).toContain(cls.id);

    await teacherA.patch(`/classes/${cls.id}`, { archived: false });
    expect((await teacherA.get<ClassesResponse>('/classes')).body.classes.map((c) => c.id)).toContain(cls.id);
    expect((await teacherA.get<ClassesResponse>('/classes?archived=1')).body.classes.map((c) => c.id)).not.toContain(cls.id);
  });
});

describe('join codes', () => {
  it('lets a student join with a code (case-insensitive) and is idempotent', async () => {
    const cls = await createClass(teacherA, { name: 'Joinable' });
    const student = newStudent();
    const res = await student.client.post<ClassResponse>('/classes/join', { joinCode: cls.joinCode!.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.class.id).toBe(cls.id);
    expect(res.body.class.joinCode).toBeNull();
    expect(res.body.class.studentCount).toBe(1);

    const again = await student.client.post<ClassResponse>('/classes/join', { joinCode: cls.joinCode });
    expect(again.status).toBe(200);
    expect(again.body.class.studentCount).toBe(1);
    const count = db.prepare('SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND user_id = ?').pluck().get(cls.id, student.id);
    expect(count).toBe(1);
  });

  it('rejects unknown, malformed, disabled and archived codes', async () => {
    const student = newStudent();
    const unknown = await student.client.post('/classes/join', { joinCode: 'ZZZZZZ' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fieldErrors.joinCode).toBeTruthy();

    const malformed = await student.client.post('/classes/join', { joinCode: 'abc' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.fieldErrors.joinCode).toBeTruthy();

    const closed = await createClass(teacherA, { name: 'Closed' });
    await teacherA.patch(`/classes/${closed.id}`, { joinEnabled: false });
    const disabled = await student.client.post('/classes/join', { joinCode: closed.joinCode });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error.fieldErrors.joinCode).toBeTruthy();

    const old = await createClass(teacherA, { name: 'Archived' });
    await teacherA.patch(`/classes/${old.id}`, { archived: true });
    const archived = await student.client.post('/classes/join', { joinCode: old.joinCode });
    expect(archived.status).toBe(400);
    expect(archived.body.error.fieldErrors.joinCode).toBeTruthy();

    expect(db.prepare('SELECT COUNT(*) FROM enrollments WHERE user_id = ?').pluck().get(student.id)).toBe(0);
  });

  it('still succeeds for a student who is already in a class that stopped taking joins', async () => {
    const cls = await createClass(teacherA, { name: 'Members only' });
    const student = newStudent();
    await student.client.post('/classes/join', { joinCode: cls.joinCode });
    await teacherA.patch(`/classes/${cls.id}`, { joinEnabled: false });
    expect((await student.client.post('/classes/join', { joinCode: cls.joinCode })).status).toBe(200);
  });

  it('does not let staff join', async () => {
    const cls = await createClass(teacherA, { name: 'Staff join' });
    expect((await teacherB.post('/classes/join', { joinCode: cls.joinCode })).status).toBe(400);
    expect((await admin.post('/classes/join', { joinCode: cls.joinCode })).status).toBe(400);
  });

  it('regenerates the code so the old one stops working', async () => {
    const cls = await createClass(teacherA, { name: 'Leaked code' });
    const res = await teacherA.post<ClassResponse>(`/classes/${cls.id}/regenerate-code`);
    expect(res.status).toBe(200);
    expect(res.body.class.joinCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(res.body.class.joinCode).not.toBe(cls.joinCode);

    const student = newStudent();
    expect((await student.client.post('/classes/join', { joinCode: cls.joinCode })).status).toBe(400);
    expect((await student.client.post('/classes/join', { joinCode: res.body.class.joinCode })).status).toBe(200);
    expect((await student.client.post(`/classes/${cls.id}/regenerate-code`)).status).toBe(403);
  });
});

describe('delete', () => {
  it('deletes the class with its enrollments and assignments', async () => {
    const cls = await createClass(teacherA, { name: 'Doomed', languageIds: ['python'] });
    const student = newStudent();
    await student.client.post('/classes/join', { joinCode: cls.joinCode });
    const assignmentId = insertAssignment(cls.id, true);

    expect((await student.client.delete(`/classes/${cls.id}`)).status).toBe(403);
    const res = await teacherA.delete(`/classes/${cls.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await teacherA.get(`/classes/${cls.id}`)).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) FROM enrollments WHERE class_id = ?').pluck().get(cls.id)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM assignments WHERE id = ?').pluck().get(assignmentId)).toBe(0);
    // The student account itself is kept.
    expect(db.prepare('SELECT COUNT(*) FROM users WHERE id = ?').pluck().get(student.id)).toBe(1);
  });

  it('admins can delete any class', async () => {
    const cls = await createClass(teacherB, { name: 'Admin cleanup' });
    expect((await admin.delete(`/classes/${cls.id}`)).status).toBe(200);
    expect((await teacherB.get(`/classes/${cls.id}`)).status).toBe(404);
  });
});
