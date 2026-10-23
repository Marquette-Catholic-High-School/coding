// Anti-CSRF token: every /api call made with a session must echo the readable cc_csrf cookie in x-codeclass-token.
// Student code that a teacher runs executes in a Web Worker on our origin: its requests carry the teacher's cookies
// (sid and cc_csrf) but it can't read cookies, so it can't send the header. These tests play that worker.

import type { ClassResponse } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionToken, csrfTokenFor } from '../src/auth';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('javascript', 'javascript');
});
afterAll(() => srv.close());

/** A request the way a Web Worker on our origin makes it: the browser attaches every cookie, but no token header. */
function workerFetch(client: TestClient, method: string, path: string, body?: unknown) {
  return fetch(srv.base + path, {
    method,
    headers: {
      'x-codeclass': '1',
      Cookie: `${client.cookie}; cc_csrf=${client.csrf}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function setCookies(res: Response): Record<string, string> {
  return Object.fromEntries(res.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf('=')), c]));
}

describe('anti-CSRF token', () => {
  it('sign-in sets a readable cc_csrf cookie derived from the session', async () => {
    const u = insertUser('teacher');
    const res = await fetch(`${srv.base}/auth/login`, {
      method: 'POST',
      headers: { 'x-codeclass': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: u.username, password: u.password }),
    });
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.sid).toMatch(/HttpOnly/i);
    expect(cookies.cc_csrf).not.toMatch(/HttpOnly/i);
    expect(cookies.cc_csrf).toMatch(/SameSite=Lax/i);
    expect(cookies.cc_csrf).toMatch(/Path=\//);
    const sid = /^sid=([^;]*)/.exec(cookies.sid!)![1]!;
    const csrf = /^cc_csrf=([^;]*)/.exec(cookies.cc_csrf!)![1]!;
    expect(csrf).toBe(csrfTokenFor(sid));
  });

  it('the test client (like the real one) passes with the token', async () => {
    const client = clientAs(srv.base, insertUser('teacher').id);
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await client.post('/classes', { name: 'Fine' })).status).toBe(201);
  });

  it('rejects GETs that carry the session cookie but no token', async () => {
    const teacher = clientAs(srv.base, insertUser('teacher').id);
    for (const path of ['/auth/me', '/classes', '/dashboard']) {
      const res = await workerFetch(teacher, 'GET', path);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { message: string; code?: string } };
      expect(body.error.code).toBe('csrf');
      expect(body.error.message).toMatch(/reload the page/);
      // The cc_csrf cookie it sent was right, so there is nothing to refresh.
      expect(setCookies(res).cc_csrf).toBeUndefined();
    }
  });

  it("stops student code run by the teacher from grading itself or reading hidden tests", async () => {
    const teacher = clientAs(srv.base, insertUser('teacher').id);
    const student = insertUser('student');
    const cls = (await teacher.post<ClassResponse>('/classes', { name: 'C', languageIds: ['javascript'] })).body.class;
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, student.id);
    const created = await teacher.post(`/classes/${cls.id}/assignments`, {
      title: 'A',
      languageId: 'javascript',
      points: 10,
      published: true,
      tests: [{ id: 't1', input: '', expectedOutput: 'SECRET', hidden: true }],
    });
    expect(created.status).toBe(201);
    const assignmentId = created.body.assignment.id as number;

    const read = await workerFetch(teacher, 'GET', `/assignments/${assignmentId}`);
    expect(read.status).toBe(403);
    expect(await read.text()).not.toContain('SECRET');

    const grade = await workerFetch(teacher, 'PATCH', `/assignments/${assignmentId}/submissions/${student.id}`, {
      grade: 10,
      feedback: 'ok',
    });
    expect(grade.status).toBe(403);
    const after = await teacher.get(`/assignments/${assignmentId}/submissions/${student.id}`);
    expect(after.status).toBe(200);
    expect(after.body.submission.grade).toBeNull();

    const rename = await workerFetch(teacher, 'PATCH', `/classes/${cls.id}`, { name: 'Hacked' });
    expect(rename.status).toBe(403);
    expect((await teacher.get<ClassResponse>(`/classes/${cls.id}`)).body.class.name).toBe('C');

    // Nor can it sign the teacher out.
    expect((await workerFetch(teacher, 'POST', '/auth/logout')).status).toBe(403);
    expect((await teacher.get('/auth/me')).status).toBe(200);
  });

  it('stops student code run by an admin from creating accounts', async () => {
    const admin = clientAs(srv.base, insertUser('admin').id);
    const res = await workerFetch(admin, 'POST', '/admin/users', {
      name: 'Evil',
      username: 'evil-admin',
      role: 'admin',
    });
    expect(res.status).toBe(403);
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'evil-admin'").get()).toBeUndefined();
  });

  it('rejects a wrong token', async () => {
    const teacher = clientAs(srv.base, insertUser('teacher').id);
    const other = clientAs(srv.base, insertUser('teacher').id);
    teacher.csrf = other.csrf;
    const res = await teacher.get('/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('re-sets the cookie for sessions that predate it, so the client can retry', async () => {
    const u = insertUser('student');
    const token = createSessionToken(u.id);
    const res = await fetch(`${srv.base}/auth/me`, { headers: { Cookie: `sid=${token}` } });
    expect(res.status).toBe(403);
    const cookie = setCookies(res).cc_csrf;
    expect(cookie).toBeDefined();
    expect(cookie).not.toMatch(/HttpOnly/i);
    const csrf = /^cc_csrf=([^;]*)/.exec(cookie!)![1]!;
    expect(csrf).toBe(csrfTokenFor(token));

    const retry = await fetch(`${srv.base}/auth/me`, {
      headers: { Cookie: `sid=${token}; cc_csrf=${csrf}`, 'x-codeclass-token': csrf },
    });
    expect(retry.status).toBe(200);
  });

  it('leaves the signed-out endpoints open even with a session', async () => {
    const teacher = clientAs(srv.base, insertUser('teacher').id);
    const code = (await teacher.post<ClassResponse>('/classes', { name: 'Open' })).body.class.joinCode!;
    expect((await workerFetch(teacher, 'GET', '/setup')).status).toBe(200);
    expect((await workerFetch(teacher, 'GET', `/join/${code}`)).status).toBe(200);
    expect((await workerFetch(teacher, 'POST', '/auth/login', { login: 'nobody', password: 'x' })).status).toBe(401);
    expect((await workerFetch(teacher, 'POST', '/auth/register', {})).status).toBe(400);
  });

  it('signed-out requests behave as before', async () => {
    expect((await fetch(`${srv.base}/auth/me`)).status).toBe(401);
    expect((await fetch(`${srv.base}/setup`)).status).toBe(200);
    // Non-GET calls still need x-codeclass: 1.
    expect((await fetch(`${srv.base}/auth/logout`, { method: 'POST' })).status).toBe(403);
    expect((await srv.client().post('/auth/logout')).status).toBe(200);
  });

  it('sign-out clears both cookies', async () => {
    const client = clientAs(srv.base, insertUser('teacher').id);
    const res = await fetch(`${srv.base}/auth/logout`, {
      method: 'POST',
      headers: { 'x-codeclass': '1', 'x-codeclass-token': client.csrf, Cookie: `${client.cookie}; cc_csrf=${client.csrf}` },
    });
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.sid).toMatch(/^sid=;/);
    expect(cookies.cc_csrf).toMatch(/^cc_csrf=;/);
  });
});
