import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, type UserRow } from '../src/db';
import { clientAs, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let admin: ReturnType<typeof insertUser>;
beforeAll(async () => {
  srv = await startTestServer();
  admin = insertUser('admin', { name: 'Ada Admin', username: 'ada' });
});
afterAll(() => srv.close());

let classCounter = 0;
function insertClass(ownerId: number) {
  classCounter += 1;
  const info = db
    .prepare('INSERT INTO classes (name, join_code, owner_id) VALUES (?, ?, ?)')
    .run(`Class ${classCounter}`, `USR${String(classCounter).padStart(3, '0')}`, ownerId);
  return Number(info.lastInsertRowid);
}

function enroll(classId: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, userId);
}

function userRow(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

const asAdmin = () => clientAs(srv.base, admin.id);

describe('access', () => {
  it('is admin only', async () => {
    const teacher = insertUser('teacher');
    const student = insertUser('student');
    expect((await srv.client().get('/admin/users')).status).toBe(401);
    expect((await clientAs(srv.base, teacher.id).get('/admin/users')).status).toBe(403);
    expect((await clientAs(srv.base, student.id).get('/admin/users')).status).toBe(403);
    expect((await clientAs(srv.base, teacher.id).post('/admin/users', { name: 'X', username: 'xxx', role: 'admin' })).status).toBe(403);
    expect((await clientAs(srv.base, teacher.id).delete(`/admin/users/${student.id}`)).status).toBe(403);
  });
});

describe('list', () => {
  it('lists users with classCount and filters by role', async () => {
    const teacher = insertUser('teacher', { name: 'Aaron Teacher' });
    const student = insertUser('student', { name: 'Abby Student' });
    const c1 = insertClass(teacher.id);
    insertClass(teacher.id);
    enroll(c1, student.id);

    const all = await asAdmin().get('/admin/users');
    expect(all.status).toBe(200);
    const byId = new Map(all.body.users.map((u: { id: number }) => [u.id, u]));
    expect(byId.get(teacher.id)).toMatchObject({ role: 'teacher', classCount: 2 });
    expect(byId.get(student.id)).toMatchObject({ role: 'student', classCount: 1 });
    expect(byId.get(admin.id)).toMatchObject({ role: 'admin', classCount: 0 });
    expect(JSON.stringify(all.body)).not.toMatch(/password_hash|scrypt/);

    // Sorted by name, ignoring case.
    const names: string[] = all.body.users.map((u: { name: string }) => u.name.toLowerCase());
    expect(names).toEqual([...names].sort());

    const students = await asAdmin().get('/admin/users?role=student');
    expect(students.body.users.length).toBeGreaterThan(0);
    expect(students.body.users.every((u: { role: string }) => u.role === 'student')).toBe(true);

    expect((await asAdmin().get('/admin/users?role=wizard')).status).toBe(400);
  });
});

describe('create', () => {
  it('creates a user with a temporary password they must change', async () => {
    const res = await asAdmin().post('/admin/users', { name: 'Tess Teacher', username: 'tess', email: 'Tess@School.org', role: 'teacher' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Tess Teacher', username: 'tess', email: 'tess@school.org', role: 'teacher', mustChangePassword: true });
    expect(res.body.temporaryPassword).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);

    const login = await srv.client().post('/auth/login', { login: 'tess', password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('rejects taken usernames and emails case-insensitively', async () => {
    insertUser('teacher', { username: 'dupe', email: 'dupe@school.org' });
    const user = await asAdmin().post('/admin/users', { name: 'Dupe', username: 'DUPE', role: 'student' });
    expect(user.status).toBe(409);
    expect(user.body.error.fieldErrors).toHaveProperty('username');

    const email = await asAdmin().post('/admin/users', { name: 'Dupe', username: 'dupe2', email: 'Dupe@School.org', role: 'student' });
    expect(email.status).toBe(409);
    expect(email.body.error.fieldErrors).toHaveProperty('email');
  });

  it('validates the body', async () => {
    const res = await asAdmin().post('/admin/users', { name: '', username: 'a b', role: 'king' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['name', 'role', 'username']);
  });
});

describe('edit', () => {
  it('updates name and email, leaving omitted fields alone', async () => {
    const u = insertUser('teacher', { email: 'keep@school.org' });
    const res = await asAdmin().patch(`/admin/users/${u.id}`, { name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Renamed', email: 'keep@school.org', role: 'teacher' });

    const cleared = await asAdmin().patch(`/admin/users/${u.id}`, { email: null });
    expect(cleared.body.user.email).toBeNull();
  });

  it('rejects an email used by someone else', async () => {
    insertUser('teacher', { email: 'taken@school.org' });
    const u = insertUser('teacher');
    const res = await asAdmin().patch(`/admin/users/${u.id}`, { email: 'TAKEN@school.org' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors).toHaveProperty('email');
  });

  it('can change another user’s role', async () => {
    const u = insertUser('teacher');
    const res = await asAdmin().patch(`/admin/users/${u.id}`, { role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(userRow(u.id)!.role).toBe('admin');
  });

  it('does not let an admin change their own role (so the last admin stays an admin)', async () => {
    const res = await asAdmin().patch(`/admin/users/${admin.id}`, { role: 'teacher' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty('role');
    expect(userRow(admin.id)!.role).toBe('admin');

    // Editing your own name (and "changing" to the same role) is fine.
    const same = await asAdmin().patch(`/admin/users/${admin.id}`, { name: 'Ada A.', role: 'admin' });
    expect(same.status).toBe(200);
    expect(same.body.user.name).toBe('Ada A.');
  });

  it('lets one admin demote another while at least one admin remains', async () => {
    const other = insertUser('admin');
    const res = await clientAs(srv.base, other.id).patch(`/admin/users/${admin.id}`, { role: 'teacher' });
    expect(res.status).toBe(200);
    // The demoted admin has lost access; restore for the remaining tests.
    expect((await asAdmin().get('/admin/users')).status).toBe(403);
    expect((await clientAs(srv.base, other.id).patch(`/admin/users/${admin.id}`, { role: 'admin' })).status).toBe(200);
  });

  it('refuses to make a teacher who owns classes a student', async () => {
    const teacher = insertUser('teacher');
    insertClass(teacher.id);
    const res = await asAdmin().patch(`/admin/users/${teacher.id}`, { role: 'student' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors).toHaveProperty('role');
    expect(userRow(teacher.id)!.role).toBe('teacher');
  });

  it('refuses to make an enrolled student staff', async () => {
    const teacher = insertUser('teacher');
    const student = insertUser('student');
    enroll(insertClass(teacher.id), student.id);
    const res = await asAdmin().patch(`/admin/users/${student.id}`, { role: 'teacher' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors).toHaveProperty('role');

    const free = insertUser('student');
    expect((await asAdmin().patch(`/admin/users/${free.id}`, { role: 'teacher' })).status).toBe(200);
  });

  it('404s for unknown users', async () => {
    expect((await asAdmin().patch('/admin/users/99999', { name: 'Ghost' })).status).toBe(404);
    expect((await asAdmin().patch('/admin/users/abc', { name: 'Ghost' })).status).toBe(404);
  });
});

describe('reset password', () => {
  it('sets a temporary password and ends their sessions', async () => {
    const u = insertUser('student');
    const session = clientAs(srv.base, u.id);
    expect((await session.get('/auth/me')).status).toBe(200);

    const res = await asAdmin().post(`/admin/users/${u.id}/reset-password`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: u.id, mustChangePassword: true });
    expect(typeof res.body.temporaryPassword).toBe('string');

    expect((await session.get('/auth/me')).status).toBe(401);
    expect((await srv.client().post('/auth/login', { login: u.username, password: u.password })).status).toBe(401);
    expect((await srv.client().post('/auth/login', { login: u.username, password: res.body.temporaryPassword })).status).toBe(200);
  });

  it('is not for your own account', async () => {
    const res = await asAdmin().post(`/admin/users/${admin.id}/reset-password`);
    expect(res.status).toBe(400);
    expect(userRow(admin.id)!.must_change_password).toBe(0);
  });

  it('404s for unknown users', async () => {
    expect((await asAdmin().post('/admin/users/99999/reset-password')).status).toBe(404);
  });
});

describe('delete', () => {
  it('deletes students and teachers without classes', async () => {
    const teacher = insertUser('teacher');
    const student = insertUser('student');
    enroll(insertClass(insertUser('teacher').id), student.id);

    const a = await asAdmin().delete(`/admin/users/${student.id}`);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ ok: true });
    expect(userRow(student.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM enrollments WHERE user_id = ?').get(student.id)).toBeUndefined();

    expect((await asAdmin().delete(`/admin/users/${teacher.id}`)).status).toBe(200);
    expect(userRow(teacher.id)).toBeUndefined();
  });

  it('refuses to delete a teacher who still owns classes', async () => {
    const teacher = insertUser('teacher');
    insertClass(teacher.id);
    const res = await asAdmin().delete(`/admin/users/${teacher.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/1 class/);
    expect(userRow(teacher.id)).toBeDefined();
  });

  it('does not let you delete yourself', async () => {
    const res = await asAdmin().delete(`/admin/users/${admin.id}`);
    expect(res.status).toBe(400);
    expect(userRow(admin.id)).toBeDefined();
  });

  it('404s for unknown users', async () => {
    expect((await asAdmin().delete('/admin/users/99999')).status).toBe(404);
  });
});
