import { createPseudocodeConfig, starterProgram } from '@codeclass/shared/pseudocode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, type LanguageRow, type UserRow } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

let classCounter = 0;
function insertClass(ownerId: number, extra: { joinEnabled?: boolean; archived?: boolean; name?: string } = {}) {
  classCounter += 1;
  const code = `CODE${String(classCounter).padStart(2, '0')}`;
  const info = db
    .prepare('INSERT INTO classes (name, join_code, join_enabled, archived, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(extra.name ?? `Class ${classCounter}`, code, extra.joinEnabled === false ? 0 : 1, extra.archived ? 1 : 0, ownerId);
  return { id: Number(info.lastInsertRowid), code };
}

function userRow(id: number): UserRow {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

// Setup must run first: it only works while the database has no users.
describe('setup', () => {
  it('reports that setup is needed on an empty database', async () => {
    const res = await srv.client().get('/setup');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ needsSetup: true });
  });

  it('validates the admin details', async () => {
    const res = await srv.client().post('/setup', { name: '', username: 'a', password: 'short', email: 'nope' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['email', 'name', 'password', 'username']);
  });

  it('creates the admin, seeds starter languages (keeping existing rows) and signs in', async () => {
    // A pre-existing row must be left alone.
    insertLanguage('python', 'python');
    db.prepare("UPDATE languages SET name = 'Our Python' WHERE id = 'python'").run();

    const client = srv.client();
    const res = await client.post('/setup', {
      name: 'Ada Admin',
      username: 'ada',
      email: 'Ada@School.org',
      password: 'correct horse',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ada Admin', username: 'ada', email: 'ada@school.org', role: 'admin', mustChangePassword: false });
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(client.cookie).toMatch(/^sid=.+/);

    const me = await client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(res.body.user.id);

    const langs = db.prepare('SELECT * FROM languages ORDER BY id').all() as LanguageRow[];
    expect(langs.map((l) => l.id)).toEqual(['javascript', 'pseudocode', 'python']);

    const js = langs.find((l) => l.id === 'javascript')!;
    expect(js).toMatchObject({ kind: 'javascript', name: 'JavaScript', enabled: 1, owner_id: null, config: null });
    expect(js.starter_code.length).toBeGreaterThan(0);

    expect(langs.find((l) => l.id === 'python')!.name).toBe('Our Python');

    const pseudo = langs.find((l) => l.id === 'pseudocode')!;
    const config = createPseudocodeConfig('classroom');
    expect(pseudo).toMatchObject({
      kind: 'pseudocode',
      name: 'Classroom Pseudocode',
      version: 'CodeClass pseudocode',
      owner_id: res.body.user.id,
      enabled: 1,
      starter_code: starterProgram(config),
    });
    expect(JSON.parse(pseudo.config!)).toEqual(config);
  });

  it('only runs once', async () => {
    const status = await srv.client().get('/setup');
    expect(status.body).toEqual({ needsSetup: false });

    const res = await srv.client().post('/setup', { name: 'Eve', username: 'eve', password: 'password123' });
    expect(res.status).toBe(409);
    expect((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n).toBe(1);
  });
});

describe('login', () => {
  it('signs in by username, case-insensitively', async () => {
    const u = insertUser('teacher', { username: 'MsHopper' });
    const client = srv.client();
    const res = await client.post('/auth/login', { login: 'mshopper', password: u.password });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: u.id, username: 'MsHopper', role: 'teacher' });
    expect((await client.get('/auth/me')).body.user.id).toBe(u.id);
  });

  it('signs in by email, case-insensitively', async () => {
    const u = insertUser('teacher', { email: 'grace@school.org' });
    const client = srv.client();
    const res = await client.post('/auth/login', { login: '  GRACE@School.org ', password: u.password });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(u.id);
  });

  it('rejects wrong passwords and unknown users with the same message', async () => {
    const u = insertUser('student');
    const wrong = await srv.client().post('/auth/login', { login: u.username, password: 'not-the-password' });
    const unknown = await srv.client().post('/auth/login', { login: 'nobody-here', password: 'whatever123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe('Incorrect username or password');
    expect(unknown.body.error.message).toBe('Incorrect username or password');
  });

  it('validates the body', async () => {
    const res = await srv.client().post('/auth/login', { login: ' ', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty('login');
    expect(res.body.error.fieldErrors).toHaveProperty('password');
  });

  it('rate-limits after 10 failures for the same login', async () => {
    const u = insertUser('student');
    const other = insertUser('student');
    for (let i = 0; i < 10; i++) {
      const res = await srv.client().post('/auth/login', { login: u.username, password: `wrong-${i}` });
      expect(res.status).toBe(401);
    }
    // Even the right password is refused while locked; case doesn't create a new bucket.
    const locked = await srv.client().post('/auth/login', { login: u.username.toUpperCase(), password: u.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/too many/i);

    // Other accounts are unaffected.
    const ok = await srv.client().post('/auth/login', { login: other.username, password: other.password });
    expect(ok.status).toBe(200);
  });

  it('a successful login clears earlier failures', async () => {
    const u = insertUser('student');
    for (let i = 0; i < 9; i++) await srv.client().post('/auth/login', { login: u.username, password: 'wrong-pass' });
    expect((await srv.client().post('/auth/login', { login: u.username, password: u.password })).status).toBe(200);
    for (let i = 0; i < 9; i++) await srv.client().post('/auth/login', { login: u.username, password: 'wrong-pass' });
    expect((await srv.client().post('/auth/login', { login: u.username, password: u.password })).status).toBe(200);
  });
});

describe('logout and me', () => {
  it('me is 401 when signed out', async () => {
    const res = await srv.client().get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('me returns the user without secrets', async () => {
    const u = insertUser('student', { name: 'Sam Student' });
    const res = await clientAs(srv.base, u.id).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: u.id, name: 'Sam Student', role: 'student', mustChangePassword: false });
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|scrypt/);
  });

  it('logout ends the session', async () => {
    const u = insertUser('teacher');
    const client = clientAs(srv.base, u.id);
    const sessionCookie = client.cookie;
    const res = await client.post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // The old token no longer works even if replayed.
    client.cookie = sessionCookie;
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('logout always succeeds, even when signed out', async () => {
    const res = await srv.client().post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('register and join preview', () => {
  it('previews a class by code (case-insensitive) and 404s unknown codes', async () => {
    const teacher = insertUser('teacher', { name: 'Mr Turing' });
    const open = insertClass(teacher.id, { name: 'Year 9 Computing' });
    const closed = insertClass(teacher.id, { joinEnabled: false });
    const archived = insertClass(teacher.id, { archived: true });

    const res = await srv.client().get(`/join/${open.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ className: 'Year 9 Computing', teacherName: 'Mr Turing', joinEnabled: true });

    expect((await srv.client().get(`/join/${closed.code}`)).body.joinEnabled).toBe(false);
    expect((await srv.client().get(`/join/${archived.code}`)).body.joinEnabled).toBe(false);
    expect((await srv.client().get('/join/ZZZZZZ')).status).toBe(404);
    expect((await srv.client().get('/join/not-a-code')).status).toBe(404);
  });

  it('rejects unknown, disabled and archived class codes on joinCode', async () => {
    const teacher = insertUser('teacher');
    const closed = insertClass(teacher.id, { joinEnabled: false });
    const archived = insertClass(teacher.id, { archived: true });
    const base = { name: 'New Student', username: 'newbie', password: 'password123' };

    for (const joinCode of ['QQQQQQ', closed.code, archived.code, 'abc']) {
      const res = await srv.client().post('/auth/register', { ...base, joinCode });
      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors).toHaveProperty('joinCode');
    }
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'newbie'").get()).toBeUndefined();
  });

  it('rejects a taken username (case-insensitively) on username', async () => {
    const teacher = insertUser('teacher');
    const cls = insertClass(teacher.id);
    insertUser('student', { username: 'taken.name' });
    const res = await srv.client().post('/auth/register', {
      joinCode: cls.code,
      name: 'Copy Cat',
      username: 'Taken.Name',
      password: 'password123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors).toHaveProperty('username');
  });

  it('creates a student, enrolls them and signs them in', async () => {
    const teacher = insertUser('teacher');
    const cls = insertClass(teacher.id, { name: "Lin's class" });
    const client = srv.client();
    const res = await client.post('/auth/register', {
      joinCode: cls.code.toLowerCase(),
      name: '  Lin Learner ',
      username: 'lin.l',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Lin Learner', username: 'lin.l', role: 'student', email: null, mustChangePassword: false });
    expect(res.body.joinedClasses).toEqual([{ id: cls.id, name: "Lin's class" }]);

    const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?').get(cls.id, res.body.user.id);
    expect(enrolled).toBeTruthy();
    expect((await client.get('/auth/me')).body.user.id).toBe(res.body.user.id);

    // And they can sign in later with the password they chose.
    expect((await srv.client().post('/auth/login', { login: 'lin.l', password: 'password123' })).status).toBe(200);
  });
});

describe('change password', () => {
  it('requires the current password', async () => {
    const u = insertUser('student');
    const res = await clientAs(srv.base, u.id).post('/auth/change-password', { currentPassword: 'wrong-one', newPassword: 'brand-new-pass' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty('currentPassword');
  });

  it('validates the new password', async () => {
    const u = insertUser('student');
    const client = clientAs(srv.base, u.id);
    const short = await client.post('/auth/change-password', { currentPassword: u.password, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.fieldErrors).toHaveProperty('newPassword');
    const same = await client.post('/auth/change-password', { currentPassword: u.password, newPassword: u.password });
    expect(same.status).toBe(400);
    expect(same.body.error.fieldErrors).toHaveProperty('newPassword');
  });

  it('changes the password, clears the temporary flag and ends other sessions', async () => {
    const u = insertUser('student');
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(u.id);
    const current = clientAs(srv.base, u.id);
    const other = clientAs(srv.base, u.id);
    expect((await current.get('/auth/me')).body.user.mustChangePassword).toBe(true);

    const res = await current.post('/auth/change-password', { currentPassword: u.password, newPassword: 'a-much-better-one' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const me = await current.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(false);
    expect((await other.get('/auth/me')).status).toBe(401);

    expect((await srv.client().post('/auth/login', { login: u.username, password: u.password })).status).toBe(401);
    expect((await srv.client().post('/auth/login', { login: u.username, password: 'a-much-better-one' })).status).toBe(200);
  });

  it('requires sign-in', async () => {
    const res = await srv.client().post('/auth/change-password', { currentPassword: 'x', newPassword: 'password123' });
    expect(res.status).toBe(401);
  });
});

describe('profile', () => {
  it('updates name and email (lower-cased) and can clear the email', async () => {
    const u = insertUser('teacher');
    const client = clientAs(srv.base, u.id);
    const res = await client.patch('/auth/profile', { name: ' Dr Lovelace ', email: 'Ada.L@School.org' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'Dr Lovelace', email: 'ada.l@school.org' });

    // Saving your own email again is not a clash.
    expect((await client.patch('/auth/profile', { name: 'Dr Lovelace', email: 'ada.l@school.org' })).status).toBe(200);

    // Leaving the email out keeps it.
    const nameOnly = await client.patch('/auth/profile', { name: 'Ada Lovelace' });
    expect(nameOnly.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada.l@school.org' });

    const cleared = await client.patch('/auth/profile', { name: 'Dr Lovelace', email: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.user.email).toBeNull();
    expect(userRow(u.id).email).toBeNull();
  });

  it('rejects an email used by another account', async () => {
    insertUser('teacher', { email: 'shared@school.org' });
    const u = insertUser('student');
    const res = await clientAs(srv.base, u.id).patch('/auth/profile', { name: 'Someone', email: 'SHARED@school.org' });
    expect(res.status).toBe(409);
    expect(res.body.error.fieldErrors).toHaveProperty('email');
  });

  it('validates the name and email', async () => {
    const u = insertUser('student');
    const res = await clientAs(srv.base, u.id).patch('/auth/profile', { name: '   ', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty('name');
    expect(res.body.error.fieldErrors).toHaveProperty('email');
  });

  it('requires sign-in', async () => {
    expect((await srv.client().patch('/auth/profile', { name: 'X' })).status).toBe(401);
  });
});
