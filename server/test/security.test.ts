// Regression tests for review findings: cross-teacher roster takeover, unbounded login strings, 4xx passthrough.

import type { AddStudentResponse, ClassResponse, TemporaryPasswordResponse } from '@codeclass/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db';
import { clientAs, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

async function createClass(client: TestClient, name: string) {
  const res = await client.post<ClassResponse>('/classes', { name });
  expect(res.status).toBe(201);
  return res.body.class;
}

describe('students shared between teachers', () => {
  it("doesn't show an existing student's email to a teacher who doesn't teach them", async () => {
    const teacherA = clientAs(srv.base, insertUser('teacher').id);
    const teacherB = clientAs(srv.base, insertUser('teacher').id);
    const alice = insertUser('student', { username: 'alice.shared', email: 'alice@example.org' });
    const a1 = await createClass(teacherA, 'A one');
    const a2 = await createClass(teacherA, 'A two');
    const b1 = await createClass(teacherB, 'B one');
    expect((await teacherA.post(`/classes/${a1.id}/students`, { name: 'Alice', username: 'alice.shared' })).status).toBe(201);

    // Teacher B can still enrol her by username, but doesn't learn her email that way.
    const byB = await teacherB.post<AddStudentResponse>(`/classes/${b1.id}/students`, { name: 'x', username: 'alice.shared' });
    expect(byB.status).toBe(201);
    expect(byB.body.student).toMatchObject({ id: alice.id, username: 'alice.shared', email: null });
    expect(byB.body.temporaryPassword).toBeNull();

    // Teacher A already teaches her, so adding her to another of A's classes shows it.
    const byA = await teacherA.post<AddStudentResponse>(`/classes/${a2.id}/students`, { name: 'x', username: 'alice.shared' });
    expect(byA.status).toBe(201);
    expect(byA.body.student.email).toBe('alice@example.org');

    // So do admins.
    const admin = clientAs(srv.base, insertUser('admin').id);
    const adminClass = await createClass(admin, 'Admin class');
    const byAdmin = await admin.post<AddStudentResponse>(`/classes/${adminClass.id}/students`, {
      name: 'x',
      username: 'alice.shared',
    });
    expect(byAdmin.body.student.email).toBe('alice@example.org');
  });

  it("refuses a teacher's password reset for a student who is also in another teacher's class", async () => {
    const teacherA = clientAs(srv.base, insertUser('teacher').id);
    const teacherB = clientAs(srv.base, insertUser('teacher').id);
    const bob = insertUser('student', { username: 'bob.shared' });
    const a1 = await createClass(teacherA, 'A class');
    const b1 = await createClass(teacherB, 'B class');
    expect((await teacherA.post(`/classes/${a1.id}/students`, { name: 'Bob', username: 'bob.shared' })).status).toBe(201);
    const passwordHash = () =>
      (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(bob.id) as { password_hash: string }).password_hash;

    // Only in A's class: A may reset.
    const own = await teacherA.post<TemporaryPasswordResponse>(`/classes/${a1.id}/students/${bob.id}/reset-password`);
    expect(own.status).toBe(200);
    const before = passwordHash();

    // B enrols him, then tries to take over the account.
    const bob1 = clientAs(srv.base, bob.id);
    expect((await teacherB.post(`/classes/${b1.id}/students`, { name: 'x', username: 'bob.shared' })).status).toBe(201);
    const hijack = await teacherB.post(`/classes/${b1.id}/students/${bob.id}/reset-password`);
    expect(hijack.status).toBe(403);
    expect(hijack.body.error.message).toMatch(/another teacher's class.*admin/);
    expect(hijack.body.temporaryPassword).toBeUndefined();
    // Nothing changed: same password, and his session survives.
    expect(passwordHash()).toBe(before);
    expect((await bob1.get('/auth/me')).status).toBe(200);

    // While he is in both classes, A has to ask an admin too; the admin can reset.
    expect((await teacherA.post(`/classes/${a1.id}/students/${bob.id}/reset-password`)).status).toBe(403);
    const admin = clientAs(srv.base, insertUser('admin').id);
    const byAdmin = await admin.post<TemporaryPasswordResponse>(`/classes/${b1.id}/students/${bob.id}/reset-password`);
    expect(byAdmin.status).toBe(200);
    expect(typeof byAdmin.body.temporaryPassword).toBe('string');
  });
});

describe('login input bounds', () => {
  it('rejects an over-long login or password before touching the rate limiter', async () => {
    const longLogin = await srv.client().post('/auth/login', { login: 'x'.repeat(255), password: 'whatever' });
    expect(longLogin.status).toBe(400);
    expect(longLogin.body.error.fieldErrors).toHaveProperty('login');

    const longPassword = await srv.client().post('/auth/login', { login: 'someone', password: 'p'.repeat(201) });
    expect(longPassword.status).toBe(400);
    expect(longPassword.body.error.fieldErrors).toHaveProperty('password');

    // The longest allowed values are just wrong credentials.
    const maxed = await srv.client().post('/auth/login', { login: 'x'.repeat(254), password: 'p'.repeat(200) });
    expect(maxed.status).toBe(401);
  });

  it('a near-limit login still gets rate-limited case-insensitively', async () => {
    const login = `${'Y'.repeat(248)}@x.io`;
    for (let i = 0; i < 10; i++) {
      expect((await srv.client().post('/auth/login', { login, password: `wrong-${i}` })).status).toBe(401);
    }
    const locked = await srv.client().post('/auth/login', { login: login.toLowerCase(), password: 'again' });
    expect(locked.status).toBe(429);
  });
});

describe('client errors keep their 4xx status', () => {
  const errorLog = vi.spyOn(console, 'error');
  afterEach(() => errorLog.mockClear());

  it('answers a malformed percent-encoded id with 400, not 500', async () => {
    const client = clientAs(srv.base, insertUser('teacher').id);
    for (const path of ['/languages/%E0%A4%A', '/classes/%E0%A4%A']) {
      const res = await client.get(path);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Bad request');
    }
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('answers an unsupported charset or content encoding with 415, not 500', async () => {
    const charset = await fetch(`${srv.base}/auth/login`, {
      method: 'POST',
      headers: { 'x-codeclass': '1', 'Content-Type': 'application/json; charset=latin1' },
      body: JSON.stringify({ login: 'a', password: 'b' }),
    });
    expect(charset.status).toBe(415);
    expect(((await charset.json()) as { error: { message: string } }).error.message).toBe('Unsupported request format');

    const encoding = await fetch(`${srv.base}/auth/login`, {
      method: 'POST',
      headers: { 'x-codeclass': '1', 'Content-Type': 'application/json', 'Content-Encoding': 'bogus' },
      body: JSON.stringify({ login: 'a', password: 'b' }),
    });
    expect(encoding.status).toBe(415);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
