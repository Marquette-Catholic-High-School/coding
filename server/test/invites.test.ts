// Class invitations by email: importing a list (dry run and real), the invite list, deleting, and claiming an invited
// email by registering, changing a profile email or an admin creating the account. The per-IP miss limiter is
// in memory per test file, so the test that locks 127.0.0.1 out runs last.

import type { InviteImportResponse, InvitesResponse } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, type ClassInviteRow, type UserRow } from '../src/db';
import { clientAs, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let teacherId: number;
let teacher: TestClient;
let otherTeacher: TestClient;
let admin: TestClient;

beforeAll(async () => {
  srv = await startTestServer();
  teacherId = insertUser('teacher', { name: 'Ms Teach' }).id;
  teacher = clientAs(srv.base, teacherId);
  otherTeacher = clientAs(srv.base, insertUser('teacher').id);
  admin = clientAs(srv.base, insertUser('admin', { name: 'Ada Admin' }).id);
});
afterAll(() => srv.close());

let classCounter = 0;
function insertClass(extra: { name?: string; archived?: boolean; joinEnabled?: boolean } = {}) {
  classCounter += 1;
  const code = `INV${String(classCounter).padStart(3, '0')}`;
  const name = extra.name ?? `Invite class ${classCounter}`;
  const info = db
    .prepare('INSERT INTO classes (name, join_code, join_enabled, archived, owner_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, code, extra.joinEnabled === false ? 0 : 1, extra.archived ? 1 : 0, teacherId);
  return { id: Number(info.lastInsertRowid), code, name };
}

function enroll(classId: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, userId);
}

function isEnrolled(classId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?').get(classId, userId);
}

function invitesOf(classId: number): ClassInviteRow[] {
  return db.prepare('SELECT * FROM class_invites WHERE class_id = ? ORDER BY id').all(classId) as ClassInviteRow[];
}

function userByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

type Entry = { email: string; name?: string };

function importInvites(client: TestClient, classId: number, entries: Entry[], dryRun = false) {
  return client.post<InviteImportResponse>(`/classes/${classId}/invites`, { entries, dryRun });
}

let usernameCounter = 0;
/** Signed-out self-registration; `username` defaults to a fresh one. */
function register(body: { joinCode?: string; email?: string; username?: string }, client = srv.client()) {
  usernameCounter += 1;
  return client.post('/auth/register', {
    name: 'New Student',
    password: 'password123',
    username: `invitee${usernameCounter}`,
    ...body,
  });
}

const NO_INVITE = 'No class has invited this email yet. Check the spelling, or use the class code from your teacher.';

describe('import', () => {
  it('previews with a dry run without writing anything, then imports with the same outcomes', async () => {
    const cls = insertClass();
    // Stored with capitals: matching ignores case.
    const kim = insertUser('student', { name: 'Kim Existing', email: 'Kim@School.org' });
    const here = insertUser('student', { name: 'Hal Here', email: 'here@school.org' });
    enroll(cls.id, here.id);
    insertUser('teacher', { email: 'staff@school.org' });

    const entries: Entry[] = [
      { email: ' KIM@school.org ', name: ' Kim ' },
      { email: 'New.Kid@School.org', name: 'New Kid' },
      { email: 'here@school.org' },
      { email: 'STAFF@school.org' },
      { email: 'not-an-email', name: 'Oops' },
      { email: '', name: 'No Email' },
      { email: 'new.kid@school.org', name: 'Again' },
    ];
    const dry = await importInvites(teacher, cls.id, entries, true);
    expect(dry.status).toBe(200);
    expect(dry.body.rows).toEqual([
      // A dry run doesn't name students this teacher doesn't teach yet (it would let teachers look people up).
      { email: 'kim@school.org', name: 'Kim', outcome: 'enrolled', student: null },
      { email: 'new.kid@school.org', name: 'New Kid', outcome: 'invited', student: null },
      { email: 'here@school.org', name: '', outcome: 'already_enrolled', student: { id: here.id, name: 'Hal Here', username: here.username } },
      { email: 'staff@school.org', name: '', outcome: 'not_a_student', student: null },
      { email: 'not-an-email', name: 'Oops', outcome: 'invalid', student: null },
      { email: '', name: 'No Email', outcome: 'invalid', student: null },
      { email: 'new.kid@school.org', name: 'Again', outcome: 'duplicate', student: null },
    ]);
    expect(dry.body.counts).toEqual({
      enrolled: 1,
      invited: 1,
      already_enrolled: 1,
      already_invited: 0,
      not_a_student: 1,
      invalid: 2,
      duplicate: 1,
    });
    expect(invitesOf(cls.id)).toEqual([]);
    expect(isEnrolled(cls.id, kim.id)).toBe(false);

    const real = await importInvites(teacher, cls.id, entries);
    expect(real.status).toBe(200);
    expect(real.body.counts).toEqual(dry.body.counts);
    expect(real.body.rows.map((r) => r.outcome)).toEqual(dry.body.rows.map((r) => r.outcome));
    expect(real.body.rows[0]!.student).toEqual({ id: kim.id, name: 'Kim Existing', username: kim.username });
    expect(isEnrolled(cls.id, kim.id)).toBe(true);
    // The existing student's invite is recorded as joined (audit trail); the staff email gets no invite.
    const rows = invitesOf(cls.id);
    expect(rows.map((r) => [r.email, r.name, r.invited_by, r.claimed_by])).toEqual([
      ['kim@school.org', 'Kim', teacherId, kim.id],
      ['new.kid@school.org', 'New Kid', teacherId, null],
    ]);
    expect(rows[0]!.claimed_at).toEqual(expect.any(String));
    expect(rows[1]!.claimed_at).toBeNull();
  });

  it('is idempotent when the same list is imported again', async () => {
    const cls = insertClass();
    const sam = insertUser('student', { email: 'sam.again@school.org' });
    const entries: Entry[] = [{ email: 'sam.again@school.org' }, { email: 'pending.again@school.org', name: 'Pending' }];
    expect((await importInvites(teacher, cls.id, entries)).body.counts).toMatchObject({ enrolled: 1, invited: 1 });

    const again = await importInvites(teacher, cls.id, entries.map((e) => ({ ...e, email: e.email.toUpperCase() })));
    expect(again.status).toBe(200);
    expect(again.body.rows.map((r) => r.outcome)).toEqual(['already_enrolled', 'already_invited']);
    expect(again.body.counts).toMatchObject({ enrolled: 0, invited: 0, already_enrolled: 1, already_invited: 1 });
    expect(invitesOf(cls.id)).toHaveLength(2);

    // A student removed from the class is enrolled again; their invite record is updated, not duplicated.
    db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(cls.id, sam.id);
    const readded = await importInvites(teacher, cls.id, entries);
    expect(readded.body.rows.map((r) => r.outcome)).toEqual(['enrolled', 'already_invited']);
    expect(isEnrolled(cls.id, sam.id)).toBe(true);
    expect(invitesOf(cls.id)).toHaveLength(2);
  });

  it('validates the list', async () => {
    const cls = insertClass();
    const empty = await teacher.post(`/classes/${cls.id}/invites`, { entries: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fieldErrors).toHaveProperty('entries');

    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ email: `s${i}@school.org` }));
    expect((await teacher.post(`/classes/${cls.id}/invites`, { entries: tooMany })).status).toBe(400);
    expect((await teacher.post(`/classes/${cls.id}/invites`, { entries: [{ email: `${'a'.repeat(250)}@x.org` }] })).status).toBe(400);
    expect(invitesOf(cls.id)).toEqual([]);
  });
});

describe('invite list', () => {
  it('lists pending invites first (newest first), then joined ones with who joined', async () => {
    const cls = insertClass();
    const jo = insertUser('student', { name: 'Joined Jo', email: 'jo@school.org' });
    await importInvites(teacher, cls.id, [{ email: 'first@school.org', name: 'First' }]);
    await importInvites(admin, cls.id, [{ email: 'jo@school.org' }, { email: 'second@school.org' }]);

    const res = await teacher.get<InvitesResponse>(`/classes/${cls.id}/invites`);
    expect(res.status).toBe(200);
    expect(res.body.invites.map((i) => [i.email, i.status])).toEqual([
      ['second@school.org', 'pending'],
      ['first@school.org', 'pending'],
      ['jo@school.org', 'joined'],
    ]);
    const [second, first, joined] = res.body.invites;
    expect(first).toMatchObject({ name: 'First', invitedByName: 'Ms Teach', joinedAt: null, joinedUser: null });
    expect(first!.invitedAt).toEqual(expect.any(String));
    expect(second).toMatchObject({ name: '', invitedByName: 'Ada Admin' });
    expect(joined).toMatchObject({
      name: '',
      status: 'joined',
      invitedByName: 'Ada Admin',
      joinedUser: { id: jo.id, name: 'Joined Jo', username: jo.username },
    });
    expect(joined!.joinedAt).toEqual(expect.any(String));

    // Once the account that used it is gone, the invitation is open again, so the real student can still use it.
    db.prepare('DELETE FROM users WHERE id = ?').run(jo.id);
    const after = await teacher.get<InvitesResponse>(`/classes/${cls.id}/invites`);
    expect(after.body.invites.find((i) => i.email === 'jo@school.org')).toMatchObject({ status: 'pending', joinedUser: null, joinedAt: null });
    expect((await importInvites(teacher, cls.id, [{ email: 'jo@school.org' }])).body.rows[0]!.outcome).toBe('already_invited');
    expect((await register({ email: 'jo@school.org' })).status).toBe(201);
  });
});

describe('permissions and delete', () => {
  it('only lets the class teacher and admins see, import and delete invites', async () => {
    const cls = insertClass();
    const student = insertUser('student');
    enroll(cls.id, student.id);
    await importInvites(teacher, cls.id, [{ email: 'perm@school.org' }]);
    const inviteId = invitesOf(cls.id)[0]!.id;

    for (const client of [otherTeacher, clientAs(srv.base, student.id)]) {
      expect((await client.get(`/classes/${cls.id}/invites`)).status).toBe(403);
      expect((await importInvites(client, cls.id, [{ email: 'sneaky@school.org' }])).status).toBe(403);
      expect((await client.delete(`/classes/${cls.id}/invites/${inviteId}`)).status).toBe(403);
    }
    expect((await srv.client().get(`/classes/${cls.id}/invites`)).status).toBe(401);
    expect((await teacher.get('/classes/99999/invites')).status).toBe(404);
    expect((await admin.get<InvitesResponse>(`/classes/${cls.id}/invites`)).body.invites).toHaveLength(1);
    expect(invitesOf(cls.id).map((i) => i.email)).toEqual(['perm@school.org']);
  });

  it('deletes one invite of that class; a joined invite only loses its record', async () => {
    const cls = insertClass();
    const otherCls = insertClass();
    const kept = insertUser('student', { email: 'del.joined@school.org' });
    await importInvites(teacher, cls.id, [{ email: 'del.pending@school.org' }, { email: 'del.joined@school.org' }]);
    const [pending, joined] = invitesOf(cls.id);

    expect((await teacher.delete(`/classes/${otherCls.id}/invites/${pending!.id}`)).status).toBe(404);
    const res = await teacher.delete(`/classes/${cls.id}/invites/${pending!.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await teacher.delete(`/classes/${cls.id}/invites/${pending!.id}`)).status).toBe(404);

    expect((await admin.delete(`/classes/${cls.id}/invites/${joined!.id}`)).status).toBe(200);
    expect(invitesOf(cls.id)).toEqual([]);
    expect(isEnrolled(cls.id, kept.id)).toBe(true);

    // The removed invitation no longer lets anyone sign up.
    const signup = await register({ email: 'del.pending@school.org' });
    expect(signup.status).toBe(400);
    expect(signup.body.error.fieldErrors).toEqual({ email: NO_INVITE });
  });
});

describe('claiming invites', () => {
  it('registering with an invited email (no class code) joins every inviting class except archived ones', async () => {
    const alpha = insertClass({ name: 'Alpha' });
    const beta = insertClass({ name: 'Beta', joinEnabled: false });
    const old = insertClass({ name: 'Old', archived: true });
    const other = insertClass({ name: 'Other' });
    for (const cls of [beta, alpha]) await importInvites(teacher, cls.id, [{ email: 'Pat@School.org', name: 'Pat' }]);
    // Archived classes can't import (and an invitation to a class that is later archived isn't claimed).
    expect((await importInvites(teacher, old.id, [{ email: 'Pat@School.org' }])).status).toBe(409);
    db.prepare('UPDATE classes SET archived = 0 WHERE id = ?').run(old.id);
    await importInvites(teacher, old.id, [{ email: 'Pat@School.org', name: 'Pat' }]);
    db.prepare('UPDATE classes SET archived = 1 WHERE id = ?').run(old.id);

    const client = srv.client();
    const res = await register({ email: 'PAT@school.org', username: 'pat.p' }, client);
    expect(res.status).toBe(201);
    const userId: number = res.body.user.id;
    expect(res.body.user).toMatchObject({ username: 'pat.p', email: 'pat@school.org', role: 'student' });
    expect(res.body.joinedClasses).toEqual([
      { id: alpha.id, name: 'Alpha' },
      { id: beta.id, name: 'Beta' },
    ]);
    expect([alpha, beta, old, other].map((c) => isEnrolled(c.id, userId))).toEqual([true, true, false, false]);
    expect(invitesOf(alpha.id)[0]).toMatchObject({ claimed_by: userId, claimed_at: expect.any(String) });
    expect(invitesOf(old.id)[0]).toMatchObject({ claimed_by: null, claimed_at: null });
    expect((await client.get('/auth/me')).body.user.id).toBe(userId);

    const list = await teacher.get<InvitesResponse>(`/classes/${alpha.id}/invites`);
    expect(list.body.invites[0]).toMatchObject({ status: 'joined', joinedUser: { id: userId, username: 'pat.p' } });
  });

  it('registering with a class code and an email joins the code class and every inviting class', async () => {
    const coded = insertClass({ name: 'Coded' });
    const invited = insertClass({ name: 'Invited' });
    await importInvites(teacher, coded.id, [{ email: 'both@school.org' }]);
    await importInvites(teacher, invited.id, [{ email: 'both@school.org' }]);

    const res = await register({ joinCode: coded.code, email: 'both@school.org' });
    expect(res.status).toBe(201);
    expect(res.body.joinedClasses).toEqual([
      { id: coded.id, name: 'Coded' },
      { id: invited.id, name: 'Invited' },
    ]);
    // The code class's invite is marked as used too.
    expect(invitesOf(coded.id)[0]!.claimed_by).toBe(res.body.user.id);

    // An email nobody invited is fine with a code: it is just stored.
    const solo = await register({ joinCode: coded.code, email: 'Solo@School.org' });
    expect(solo.status).toBe(201);
    expect(solo.body.user.email).toBe('solo@school.org');
    expect(solo.body.joinedClasses).toEqual([{ id: coded.id, name: 'Coded' }]);

    // A bad code is still refused, even with an invited email.
    await importInvites(teacher, invited.id, [{ email: 'badcode@school.org' }]);
    const badCode = await register({ joinCode: 'QQQQQQ', email: 'badcode@school.org' });
    expect(badCode.status).toBe(400);
    expect(badCode.body.error.fieldErrors).toHaveProperty('joinCode');
  });

  it('refuses an email no class invited, and one that is already used', async () => {
    const cls = insertClass({ name: 'Archived only', archived: true });
    await importInvites(teacher, cls.id, [{ email: 'archived.only@school.org' }]);
    for (const email of ['nobody@school.org', 'archived.only@school.org']) {
      const res = await register({ email, username: 'no.invite' });
      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors).toEqual({ email: NO_INVITE });
    }
    expect(userByUsername('no.invite')).toBeUndefined();

    // Neither a code nor an email.
    const neither = await register({});
    expect(neither.status).toBe(400);
    expect(neither.body.error.fieldErrors).toHaveProperty('joinCode');

    const open = insertClass();
    insertUser('teacher', { email: 'taken.mail@school.org' });
    await importInvites(teacher, open.id, [{ email: 'taken.mail@school.org' }]);
    for (const body of [{ email: 'TAKEN.mail@school.org' }, { joinCode: open.code, email: 'taken.mail@school.org' }]) {
      const res = await register({ ...body, username: 'taker' });
      expect(res.status).toBe(409);
      expect(res.body.error.fieldErrors).toHaveProperty('email');
    }
    expect(userByUsername('taker')).toBeUndefined();
  });

  it('a student who sets an invited email on their profile joins those classes', async () => {
    const cls = insertClass({ name: 'Profile class' });
    await importInvites(teacher, cls.id, [{ email: 'later@school.org' }]);
    const student = insertUser('student');
    const client = clientAs(srv.base, student.id);

    const res = await client.patch('/auth/profile', { name: 'Later Student', email: 'Later@School.org' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('later@school.org');
    expect(res.body.joinedClasses).toEqual([{ id: cls.id, name: 'Profile class' }]);
    expect(isEnrolled(cls.id, student.id)).toBe(true);
    expect(invitesOf(cls.id)[0]!.claimed_by).toBe(student.id);

    const again = await client.patch('/auth/profile', { name: 'Later Student', email: 'later@school.org' });
    expect(again.body.joinedClasses).toEqual([]);

    // Staff accounts never claim invites.
    const staffCls = insertClass();
    await importInvites(teacher, staffCls.id, [{ email: 'teachy@school.org' }]);
    const staff = insertUser('teacher');
    const staffRes = await clientAs(srv.base, staff.id).patch('/auth/profile', { name: 'Teachy', email: 'teachy@school.org' });
    expect(staffRes.status).toBe(200);
    expect(staffRes.body.joinedClasses).toEqual([]);
    expect(isEnrolled(staffCls.id, staff.id)).toBe(false);
    expect(invitesOf(staffCls.id)[0]!.claimed_at).toBeNull();
  });

  it('an admin creating or editing a student with an invited email enrolls them', async () => {
    const cls = insertClass();
    await importInvites(teacher, cls.id, [
      { email: 'made@school.org' },
      { email: 'staffer@school.org' },
      { email: 'edited@school.org' },
    ]);

    const made = await admin.post('/admin/users', { name: 'Made', username: 'made.by.admin', email: 'MADE@school.org', role: 'student' });
    expect(made.status).toBe(201);
    expect(isEnrolled(cls.id, made.body.user.id)).toBe(true);

    const staffer = await admin.post('/admin/users', { name: 'Staffer', username: 'staffer', email: 'staffer@school.org', role: 'teacher' });
    expect(staffer.status).toBe(201);
    expect(isEnrolled(cls.id, staffer.body.user.id)).toBe(false);

    const edited = insertUser('student');
    expect((await admin.patch(`/admin/users/${edited.id}`, { email: 'Edited@school.org' })).status).toBe(200);
    expect(isEnrolled(cls.id, edited.id)).toBe(true);

    expect(invitesOf(cls.id).map((i) => i.claimed_by)).toEqual([made.body.user.id, null, edited.id]);
  });
});

// Last: this locks 127.0.0.1 out of registration for the rest of the file.
describe('re-opened invitations', () => {
  it("re-opens an invitation when the account that used it changes its email", async () => {
    const cls = insertClass({ name: 'Reopen' });
    await importInvites(teacher, cls.id, [{ email: 'real.kid@school.org' }]);
    const prober = insertUser('student', { email: 'prober@school.org' });
    const client = clientAs(srv.base, prober.id);
    const took = await client.patch('/auth/profile', { name: 'Prober', email: 'real.kid@school.org' });
    expect(took.body.joinedClasses).toEqual([{ id: cls.id, name: 'Reopen' }]);
    expect((await client.patch('/auth/profile', { name: 'Prober', email: 'prober@school.org' })).status).toBe(200);
    // The real student can still use the address; the teacher sees both in the roster and can remove the prober.
    const real = await register({ email: 'real.kid@school.org' });
    expect(real.status).toBe(201);
    expect(real.body.joinedClasses).toEqual([{ id: cls.id, name: 'Reopen' }]);
  });
});

describe('guessing invited emails', () => {
  it('counts unknown emails in the per-IP class-code limiter', async () => {
    const cls = insertClass();
    await importInvites(teacher, cls.id, [{ email: 'real.invite@school.org' }]);

    // 60 misses are allowed per 10 minutes; some were used earlier in this file.
    let locked = false;
    for (let i = 0; i < 60 && !locked; i++) {
      const res = await register({ email: `guess${i}@school.org` });
      if (res.status === 429) locked = true;
      else expect(res.status).toBe(400);
    }

    const invited = await register({ email: 'real.invite@school.org' });
    expect(invited.status).toBe(429);
    expect(invited.body.error.fieldErrors).toHaveProperty('email');
    // One budget with class codes.
    expect((await srv.client().get(`/join/${cls.code}`)).status).toBe(429);
    expect((await register({ joinCode: cls.code })).status).toBe(429);
  });
});
