// Signing in as a student: teachers (their own students) and admins (any student) use a student's account, and signing
// out of that student view returns them to their own account without a password.

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, AssignmentResponse, LogoutResponse, UserResponse } from '@codeclass/shared';
import { createSessionToken, csrfTokenFor } from '../src/auth';
import { db, migrate, type SessionRow } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
type TestUser = ReturnType<typeof insertUser>;
let admin: TestUser;
let teacher: TestUser;
let otherTeacher: TestUser;
let classId: number;
let otherClassId: number;
let maya: TestUser; // in the teacher's class
let archivedOnly: TestUser; // only in the teacher's archived class
let otherStudent: TestUser; // only in the other teacher's class
let loneStudent: TestUser; // in no class
let assignmentId: number;

let classCounter = 0;
function insertClass(ownerId: number, archived = false) {
  classCounter += 1;
  const info = db
    .prepare('INSERT INTO classes (name, join_code, archived, owner_id) VALUES (?, ?, ?, ?)')
    .run(`Class ${classCounter}`, `IMP${String(classCounter).padStart(3, '0')}`, archived ? 1 : 0, ownerId);
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO class_languages (class_id, language_id) VALUES (?, 'js')").run(id);
  return id;
}

function enroll(cls: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls, userId);
}

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('js', 'javascript');
  admin = insertUser('admin', { name: 'Dev Admin', username: 'devadmin' });
  teacher = insertUser('teacher', { name: 'Grace Hopper', username: 'ghopper' });
  otherTeacher = insertUser('teacher');
  classId = insertClass(teacher.id);
  const archivedId = insertClass(teacher.id, true);
  otherClassId = insertClass(otherTeacher.id);
  maya = insertUser('student', { name: 'Maya Rivera', username: 'maya.rivera' });
  archivedOnly = insertUser('student');
  otherStudent = insertUser('student');
  loneStudent = insertUser('student');
  enroll(classId, maya.id);
  enroll(archivedId, archivedOnly.id);
  enroll(otherClassId, otherStudent.id);

  const created = await clientAs(srv.base, teacher.id).post<AssignmentResponse>(`/classes/${classId}/assignments`, {
    title: 'Echo',
    languageId: 'js',
    points: 10,
  });
  expect(created.status).toBe(201);
  assignmentId = created.body.assignment.id;
});
afterAll(() => srv.close());

/** A second client holding the same session cookies (to check an old session after the original moved on). */
function copyOf(client: TestClient): TestClient {
  const copy = new TestClient(srv.base);
  copy.cookie = client.cookie;
  copy.csrf = client.csrf;
  return copy;
}

/** Signs `staffId` in (fresh session) and then in as `studentId`. */
async function signInAs(staffId: number, studentId: number) {
  const client = clientAs(srv.base, staffId);
  const res = await client.post<UserResponse>('/auth/impersonate', { userId: studentId });
  return { client, res };
}

/** A client signed in as `userId` with a session ending at `expires`. */
function clientUntil(userId: number, expires: Date): TestClient {
  const token = createSessionToken(userId, expires);
  const client = new TestClient(srv.base);
  client.cookie = `sid=${token}`;
  client.csrf = csrfTokenFor(token);
  return client;
}

/** The session row behind a client's cookie. */
function sessionOf(client: TestClient): SessionRow | undefined {
  const id = crypto.createHash('sha256').update(client.cookie.slice('sid='.length)).digest('hex');
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
}

function impersonationSessions(studentId: number, staffId: number): SessionRow[] {
  return db.prepare('SELECT * FROM sessions WHERE user_id = ? AND impersonator_id = ?').all(studentId, staffId) as SessionRow[];
}

describe('starting', () => {
  it('lets an admin sign in as any student, replacing their own session', async () => {
    for (const student of [maya, otherStudent, loneStudent]) {
      const client = clientAs(srv.base, admin.id);
      const staffSession = copyOf(client);
      const res = await client.post<UserResponse>('/auth/impersonate', { userId: student.id });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: student.id, role: 'student' });
      expect(res.body.impersonator).toEqual({ id: admin.id, name: 'Dev Admin', username: 'devadmin', role: 'admin' });
      expect(client.cookie).not.toBe(staffSession.cookie);
      expect(client.csrf).toBe(csrfTokenFor(client.cookie.slice('sid='.length)));

      const me = await client.get<UserResponse>('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(student.id);
      expect(me.body.impersonator).toEqual(res.body.impersonator);
      // The admin's own session ended.
      expect((await staffSession.get('/auth/me')).status).toBe(401);
    }
  });

  it("lets a teacher sign in as their own students, archived classes included", async () => {
    for (const student of [maya, archivedOnly]) {
      const { client, res } = await signInAs(teacher.id, student.id);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(student.id);
      expect(res.body.impersonator).toEqual({ id: teacher.id, name: 'Grace Hopper', username: 'ghopper', role: 'teacher' });
      expect((await client.get<UserResponse>('/auth/me')).body.user.id).toBe(student.id);
    }
  });

  it("gives a teacher the same 404 for other teachers' students, staff and unknown ids", async () => {
    const results = [];
    for (const userId of [otherStudent.id, loneStudent.id, otherTeacher.id, admin.id, teacher.id, 999_999]) {
      const client = clientAs(srv.base, teacher.id);
      const res = await client.post('/auth/impersonate', { userId });
      results.push({ status: res.status, message: res.body.error.message });
      // Still signed in as the teacher.
      const me = await client.get<UserResponse>('/auth/me');
      expect(me.body).toMatchObject({ user: { id: teacher.id }, impersonator: null });
    }
    expect(new Set(results.map((r) => JSON.stringify(r)))).toEqual(
      new Set([JSON.stringify({ status: 404, message: "That student isn't in any of your classes" })]),
    );
  });

  it("doesn't let a teacher sign in as a student who is also in another teacher's class", async () => {
    // Teachers can add any existing student to their classes by username, so being in one of their classes isn't enough.
    const cls = insertClass(teacher.id);
    const shared = insertUser('student', { name: 'Sam Shared' });
    enroll(otherClassId, shared.id);
    const added = await clientAs(srv.base, teacher.id).post(`/classes/${cls}/students`, { name: 'Sam Shared', username: shared.username });
    expect(added.status).toBe(201);

    const { client, res } = await signInAs(teacher.id, shared.id);
    expect(res.status).toBe(403);
    expect((res.body as unknown as ApiErrorBody).error.message).toBe(
      "Sam Shared is also in another teacher's class — ask an admin to sign in as them",
    );
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: teacher.id }, impersonator: null });
    // The same rule as resetting their password. An admin can do both.
    expect((await clientAs(srv.base, teacher.id).post(`/classes/${cls}/students/${shared.id}/reset-password`)).status).toBe(403);
    expect((await signInAs(admin.id, shared.id)).res.status).toBe(200);
  });

  it("doesn't let an admin sign in as staff", async () => {
    const asTeacher = await clientAs(srv.base, admin.id).post('/auth/impersonate', { userId: teacher.id });
    expect(asTeacher.status).toBe(403);
    expect(asTeacher.body.error.message).toBe('Grace Hopper is a teacher. You can only sign in as a student.');
    const asSelf = await clientAs(srv.base, admin.id).post('/auth/impersonate', { userId: admin.id });
    expect(asSelf.status).toBe(403);
    expect(asSelf.body.error.message).toBe('Dev Admin is an admin. You can only sign in as a student.');
    const unknown = await clientAs(srv.base, admin.id).post('/auth/impersonate', { userId: 999_999 });
    expect(unknown.status).toBe(404);
  });

  it('is staff only and validates the body', async () => {
    expect((await srv.client().post('/auth/impersonate', { userId: maya.id })).status).toBe(401);
    expect((await clientAs(srv.base, otherStudent.id).post('/auth/impersonate', { userId: maya.id })).status).toBe(403);
    const bad = await clientAs(srv.base, admin.id).post('/auth/impersonate', { userId: 'maya' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fieldErrors).toHaveProperty('userId');
  });

  it("can't start from a session that is already signed in as a student", async () => {
    const { client } = await signInAs(admin.id, maya.id);
    const res = await client.post('/auth/impersonate', { userId: loneStudent.id });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("You're signed in as Maya Rivera. Go back to your own account first.");
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: maya.id }, impersonator: { id: admin.id } });
  });

  it('still needs the anti-CSRF token', async () => {
    const client = clientAs(srv.base, admin.id);
    const worker = copyOf(client);
    worker.csrf = '';
    const res = await worker.post('/auth/impersonate', { userId: maya.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: admin.id }, impersonator: null });

    const { client: studentView } = await signInAs(admin.id, maya.id);
    for (const path of ['/auth/stop-impersonating', '/auth/logout']) {
      const tokenless = copyOf(studentView);
      tokenless.csrf = '';
      const refused = await tokenless.post(path);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('csrf');
    }
    expect((await studentView.get<UserResponse>('/auth/me')).body.user.id).toBe(maya.id);
  });

  it('lasts at most 8 hours, and never longer than the session it replaced', async () => {
    const before = Date.now();
    const { client } = await signInAs(admin.id, loneStudent.id);
    expect(client.cookie).not.toBe('');
    const latest = db
      .prepare('SELECT MAX(expires_at) FROM sessions WHERE user_id = ? AND impersonator_id = ?')
      .pluck()
      .get(loneStudent.id, admin.id) as string;
    const expires = Date.parse(latest);
    expect(expires).toBeGreaterThanOrEqual(before + 8 * 3_600_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 8 * 3_600_000);

    // A staff session with an hour left gives a student view with the same hour.
    const staffExpires = new Date(Date.now() + 3_600_000);
    const short = clientUntil(teacher.id, staffExpires);
    expect((await short.post('/auth/impersonate', { userId: archivedOnly.id })).status).toBe(200);
    expect(sessionOf(short)).toMatchObject({
      expires_at: staffExpires.toISOString(),
      return_expires_at: staffExpires.toISOString(),
    });
  });
});

describe('while signed in as a student', () => {
  it("shows no impersonator on a normal session", async () => {
    const me = await clientAs(srv.base, maya.id).get<UserResponse>('/auth/me');
    expect(me.body).toEqual({ user: expect.objectContaining({ id: maya.id }), impersonator: null });
  });

  it("does the student's work as the student", async () => {
    const { client } = await signInAs(teacher.id, maya.id);
    const classes = await client.get('/classes');
    expect(classes.status).toBe(200);
    expect(classes.body.classes.map((c: { id: number }) => c.id)).toEqual([classId]);

    expect((await client.put(`/assignments/${assignmentId}/submission`, { code: 'print(1)' })).status).toBe(200);
    expect((await client.post(`/assignments/${assignmentId}/submit`, { code: 'print(2)' })).status).toBe(200);
    expect(
      db.prepare('SELECT student_id, code, status FROM submissions WHERE assignment_id = ?').all(assignmentId),
    ).toEqual([{ student_id: maya.id, code: 'print(2)', status: 'submitted' }]);
    expect((await client.post(`/assignments/${assignmentId}/unsubmit`)).status).toBe(200);

    const project = await client.post('/projects', { title: 'Playground', languageId: 'js' });
    expect(project.status).toBe(201);
    expect(db.prepare('SELECT owner_id FROM projects WHERE id = ?').pluck().get(project.body.project.id)).toBe(maya.id);
  });

  it('has no teacher or admin access: the session is the student', async () => {
    for (const staff of [teacher, admin]) {
      const { client } = await signInAs(staff.id, maya.id);
      for (const [method, path] of [
        ['GET', `/classes/${classId}/students`],
        ['GET', `/assignments/${assignmentId}/submissions`],
        ['GET', `/assignments/${assignmentId}/submissions/${maya.id}`],
        ['GET', '/admin/users'],
        ['GET', '/languages/catalog'],
        ['POST', '/classes'],
        ['POST', `/classes/${classId}/students/${maya.id}/reset-password`],
      ] as const) {
        const res = await client.request(method, path, method === 'POST' ? { name: 'X' } : undefined);
        expect(res.status, `${staff.username} ${method} ${path}`).toBe(403);
      }
    }
  });

  it("refuses to change the student's password, name or email", async () => {
    const { client } = await signInAs(teacher.id, maya.id);
    const password = await client.post('/auth/change-password', { currentPassword: 'password123', newPassword: 'new-password-1' });
    expect(password.status).toBe(403);
    expect(password.body.error.message).toBe("You're signed in as Maya Rivera. Only they can change their password.");
    const profile = await client.patch('/auth/profile', { name: 'Someone Else', email: 'else@school.org' });
    expect(profile.status).toBe(403);
    expect(profile.body.error.message).toBe("You're signed in as Maya Rivera. Only they can change their name or email.");
    expect(db.prepare('SELECT name, email FROM users WHERE id = ?').get(maya.id)).toEqual({ name: 'Maya Rivera', email: null });
    // The student can still sign in with their own password.
    expect((await srv.client().post('/auth/login', { login: maya.username, password: 'password123' })).status).toBe(200);
  });

  it("leaves the student's own sessions alone", async () => {
    const own = clientAs(srv.base, maya.id);
    const { client } = await signInAs(teacher.id, maya.id);
    await client.post('/auth/stop-impersonating');
    expect((await own.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: maya.id }, impersonator: null });
  });

  it('is replaced by signing in to another account, like any session', async () => {
    const { client } = await signInAs(teacher.id, maya.id);
    const login = await client.post<UserResponse>('/auth/login', { login: otherTeacher.username, password: 'password123' });
    expect(login.status).toBe(200);
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: otherTeacher.id }, impersonator: null });
  });
});

describe('going back', () => {
  it('returns to the staff account with a fresh session and ends the student view', async () => {
    const { client } = await signInAs(teacher.id, maya.id);
    const studentView = copyOf(client);
    const res = await client.post<UserResponse>('/auth/stop-impersonating');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: expect.objectContaining({ id: teacher.id, role: 'teacher' }), impersonator: null });
    expect(client.cookie).not.toBe(studentView.cookie);

    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: teacher.id }, impersonator: null });
    expect((await client.get(`/classes/${classId}/students`)).status).toBe(200);
    expect((await studentView.get('/auth/me')).status).toBe(401);
    expect(Date.parse(sessionOf(client)!.expires_at)).toBeGreaterThan(Date.now() + 24 * 3_600_000);
  });

  it("never extends the staff member's own session: going back keeps the expiry it had", async () => {
    for (const path of ['/auth/stop-impersonating', '/auth/logout']) {
      const staffExpires = new Date(Date.now() + 60_000);
      const client = clientUntil(admin.id, staffExpires);
      expect((await client.post('/auth/impersonate', { userId: maya.id })).status).toBe(200);
      const res = await client.post(path);
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: admin.id });
      expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: admin.id }, impersonator: null });
      expect(sessionOf(client)).toMatchObject({ user_id: admin.id, impersonator_id: null, expires_at: staffExpires.toISOString() });
    }
  });

  it("signs out instead once the staff member's own session would have ended", async () => {
    for (const path of ['/auth/stop-impersonating', '/auth/logout']) {
      const { client } = await signInAs(teacher.id, maya.id);
      const viewId = sessionOf(client)!.id;
      db.prepare('UPDATE sessions SET return_expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), viewId);
      const res = await client.post(path);
      if (path === '/auth/logout') expect(res.body).toEqual({ ok: true });
      else expect(res.status).toBe(401);
      expect(client.cookie).toBe('');
      expect(db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(viewId)).toBeUndefined();
    }
  });

  it('goes back until the student view would have ended for views started before the return expiry was kept', async () => {
    const { client } = await signInAs(teacher.id, maya.id);
    const view = sessionOf(client)!;
    db.prepare('UPDATE sessions SET return_expires_at = NULL WHERE id = ?').run(view.id);
    expect((await client.post('/auth/stop-impersonating')).status).toBe(200);
    expect(sessionOf(client)).toMatchObject({ user_id: teacher.id, expires_at: view.expires_at });
  });

  it('only works from a student view', async () => {
    const own = await clientAs(srv.base, teacher.id).post('/auth/stop-impersonating');
    expect(own.status).toBe(400);
    expect(own.body.error.message).toBe("You're already using your own account");
    expect((await srv.client().post('/auth/stop-impersonating')).status).toBe(401);
  });

  it('logging out of a student view goes back to the staff account', async () => {
    const { client } = await signInAs(admin.id, otherStudent.id);
    const studentView = copyOf(client);
    const res = await client.post<LogoutResponse>('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, user: expect.objectContaining({ id: admin.id, role: 'admin' }) });
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: admin.id }, impersonator: null });
    expect((await client.get('/admin/users')).status).toBe(200);
    expect((await studentView.get('/auth/me')).status).toBe(401);
  });

  it('logging out of a normal session is unchanged', async () => {
    const client = clientAs(srv.base, teacher.id);
    const res = await client.post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(client.cookie).toBe('');
    expect((await client.get('/auth/me')).status).toBe(401);
  });
});

describe('ending the student view from elsewhere', () => {
  it('signs out when the admin account is deleted', async () => {
    const extra = insertUser('admin');
    const { client } = await signInAs(extra.id, maya.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(extra.id);
    expect((await client.get('/auth/me')).status).toBe(401);
    expect(impersonationSessions(maya.id, extra.id)).toEqual([]);
  });

  it('signs out when the admin is no longer staff, and stays signed out if they become staff again', async () => {
    const extra = insertUser('admin');
    const { client } = await signInAs(extra.id, maya.id);
    const studentView = copyOf(client);
    db.prepare("UPDATE users SET role = 'student' WHERE id = ?").run(extra.id);
    const stop = await client.post('/auth/stop-impersonating');
    expect(stop.status).toBe(401);
    expect(client.cookie).toBe('');
    expect(impersonationSessions(maya.id, extra.id)).toEqual([]);

    expect((await signInAs(extra.id, maya.id)).res.status).toBe(403); // a student can't start one
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(extra.id);
    expect((await studentView.get('/auth/me')).status).toBe(401);
    expect((await studentView.post('/auth/stop-impersonating')).status).toBe(401);
  });

  it("keeps only the way back when the student is no longer the teacher's", async () => {
    const cases: [string, (studentId: number) => void][] = [
      ['left their class', (id) => db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(classId, id)],
      ["joined another teacher's class", (id) => enroll(otherClassId, id)],
    ];
    for (const [what, change] of cases) {
      for (const path of ['/auth/stop-impersonating', '/auth/logout']) {
        const student = insertUser('student');
        enroll(classId, student.id);
        const { client } = await signInAs(teacher.id, student.id);
        expect((await client.get('/auth/me')).status).toBe(200);
        change(student.id);

        // Nothing as the student any more...
        expect((await client.get('/auth/me')).status, what).toBe(401);
        expect((await client.get(`/classes/${otherClassId}`)).status, what).toBe(401);
        expect((await client.post('/projects', { title: 'P', languageId: 'js' })).status, what).toBe(401);
        // ...but going back to the teacher's own account needs no password (and still needs the anti-CSRF token).
        const tokenless = copyOf(client);
        tokenless.csrf = '';
        expect((await tokenless.post(path)).body.error.code, what).toBe('csrf');
        const res = await client.post(path);
        expect(res.status, `${what} ${path}`).toBe(200);
        expect(res.body.user).toMatchObject({ id: teacher.id });
        expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: teacher.id }, impersonator: null });
      }
    }
  });

  it("keeps only the way back when an admin becomes a teacher of other students", async () => {
    const extra = insertUser('admin');
    const { client } = await signInAs(extra.id, otherStudent.id);
    db.prepare("UPDATE users SET role = 'teacher' WHERE id = ?").run(extra.id);
    expect((await client.get('/auth/me')).status).toBe(401);
    const back = await client.post<UserResponse>('/auth/stop-impersonating');
    expect(back.status).toBe(200);
    expect(back.body).toEqual({ user: expect.objectContaining({ id: extra.id, role: 'teacher' }), impersonator: null });
  });

  it("ends when the staff member's password is reset, or the student's", async () => {
    const extraTeacher = insertUser('teacher');
    const cls = insertClass(extraTeacher.id);
    enroll(cls, loneStudent.id);
    const { client: teacherView } = await signInAs(extraTeacher.id, loneStudent.id);
    expect((await clientAs(srv.base, admin.id).post(`/admin/users/${extraTeacher.id}/reset-password`)).status).toBe(200);
    expect((await teacherView.get('/auth/me')).status).toBe(401);

    const { client: adminView } = await signInAs(admin.id, loneStudent.id);
    expect((await clientAs(srv.base, extraTeacher.id).post(`/classes/${cls}/students/${loneStudent.id}/reset-password`)).status).toBe(200);
    expect((await adminView.get('/auth/me')).status).toBe(401);
  });
});

describe('a tab still showing another account', () => {
  it("refuses calls made for another account than the session's", async () => {
    // The teacher signed in as Maya in one tab; another tab still shows the teacher's account.
    const { client } = await signInAs(teacher.id, maya.id);
    client.headers = { 'x-codeclass-user': String(teacher.id) };
    for (const [method, path, body] of [
      ['PUT', `/assignments/${assignmentId}/submission`, { code: 'from the stale tab' }],
      ['POST', '/auth/stop-impersonating', {}],
      ['POST', '/auth/logout', {}],
      ['GET', '/classes', undefined],
    ] as const) {
      const res = await client.request(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(res.body.error.code).toBe('account-changed');
    }
    // /auth/me always answers, so the tab can find out who is signed in.
    expect((await client.get<UserResponse>('/auth/me')).body).toMatchObject({ user: { id: maya.id }, impersonator: { id: teacher.id } });
    expect(db.prepare('SELECT code FROM submissions WHERE assignment_id = ? AND student_id = ?').pluck().get(assignmentId, maya.id)).not.toBe(
      'from the stale tab',
    );

    // The tab that knows it is Maya's view works as usual; so do callers that don't say (e.g. older clients).
    client.headers = { 'x-codeclass-user': String(maya.id) };
    expect((await client.put(`/assignments/${assignmentId}/submission`, { code: 'print(3)' })).status).toBe(200);
    client.headers = {};
    expect((await client.get('/classes')).status).toBe(200);

    // Signed out: the usual 401.
    const signedOut = srv.client();
    signedOut.headers = { 'x-codeclass-user': String(maya.id) };
    expect((await signedOut.get('/classes')).status).toBe(401);
  });
});

describe('migration', () => {
  it('has the impersonator columns and index on new databases', () => {
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string; notnull: number }[];
    expect(columns.find((c) => c.name === 'impersonator_id')).toMatchObject({ notnull: 0 });
    expect(columns.find((c) => c.name === 'return_expires_at')).toMatchObject({ notnull: 0 });
    const indexes = db.prepare('PRAGMA index_list(sessions)').all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('sessions_impersonator');
  });

  it('adds impersonator_id to databases created before it existed', () => {
    const old = new Database(':memory:');
    try {
      old.pragma('foreign_keys = ON');
      old.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      old.exec(`CREATE TABLE sessions (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT, expires_at TEXT NOT NULL)`);
      old.exec('CREATE TABLE assignments (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
      old.exec('CREATE TABLE submissions (id INTEGER PRIMARY KEY, status TEXT NOT NULL, feedback TEXT, updated_at TEXT NOT NULL)');
      old.exec("INSERT INTO users (id, name) VALUES (1, 'Student'), (2, 'Teacher')");
      old.exec("INSERT INTO sessions (id, user_id, expires_at) VALUES ('old', 1, '2099-01-01T00:00:00.000Z')");
      migrate(old);
      migrate(old); // idempotent

      const columns = old.prepare('PRAGMA table_info(sessions)').all() as { name: string; notnull: number; dflt_value: unknown }[];
      expect(columns.find((c) => c.name === 'impersonator_id')).toMatchObject({ notnull: 0, dflt_value: null });
      expect(columns.find((c) => c.name === 'return_expires_at')).toMatchObject({ notnull: 0, dflt_value: null });
      expect(old.prepare('PRAGMA foreign_key_list(sessions)').all()).toContainEqual(
        expect.objectContaining({ table: 'users', from: 'impersonator_id', to: 'id', on_delete: 'CASCADE' }),
      );
      expect(old.prepare("SELECT impersonator_id FROM sessions WHERE id = 'old'").pluck().get()).toBeNull();

      old.exec("INSERT INTO sessions (id, user_id, impersonator_id, expires_at) VALUES ('view', 1, 2, '2099-01-01T00:00:00.000Z')");
      old.exec('DELETE FROM users WHERE id = 2');
      expect(old.prepare('SELECT id FROM sessions').pluck().all()).toEqual(['old']);
    } finally {
      old.close();
    }
  });
});
