// Sign in/out, the current user, signing in as a student (teachers and admins), student self-registration (class code
// or invited email), the public join preview, password and profile.

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  impersonateSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type JoinPreviewResponse,
  type LogoutResponse,
  type OkResponse,
  type UserResponse,
} from '@codeclass/shared';
import {
  currentUser,
  endOtherSessions,
  endSession,
  hasCsrfToken,
  hashPassword,
  inAnotherTeachersClass,
  isStaff,
  requireAuth,
  startImpersonation,
  startSession,
  stopImpersonation,
  teachesStudent,
  verifyPassword,
  wayBack,
  type WayBack,
} from '../auth';
import { db, type ClassRow, type UserRow } from '../db';
import { badRequest, conflict, csrfRefused, forbidden, HttpError, notFound, parseBody, unauthorized } from '../http';
import { claimInvites, hasPendingInvites, type JoinedClass } from '../invites';
import { toImpersonator, toUser } from '../mappers';
import { checkJoinCodeAttempts, FailureLimiter, recordJoinCodeMiss } from '../rateLimit';

export const router = Router();

// --- Login rate limiting (in memory, per IP + login) ------------------------------------------------

const loginFailures = new FailureLimiter(10 * 60_000, 10);

/** Limiter key: the login is hashed so every entry stays small, however long the submitted login. */
function loginKey(req: Request, login: string): string {
  return `${req.ip ?? 'unknown'}|${crypto.createHash('sha256').update(login.toLowerCase()).digest('base64url')}`;
}

// Verifying against a throwaway hash when the account doesn't exist keeps response times the same,
// so timing can't reveal which usernames exist.
let dummyHash: string | undefined;
function verifyDummyPassword(password: string): void {
  dummyHash ??= hashPassword(crypto.randomUUID());
  verifyPassword(password, dummyHash);
}

/** Case-insensitive (the column is COLLATE NOCASE). */
export function usernameTaken(username: string, exceptId?: number): boolean {
  return !!db.prepare('SELECT 1 FROM users WHERE username = ? AND id IS NOT ?').get(username, exceptId ?? null);
}

export function emailTaken(email: string, exceptId?: number): boolean {
  return !!db.prepare('SELECT 1 FROM users WHERE email = ? AND id IS NOT ?').get(email, exceptId ?? null);
}

const EMAIL_TAKEN_MESSAGE = 'Another account already uses this email';

/**
 * Registering without a class code: an email that no class invited counts as a wrong class code (one budget of misses
 * per IP), so invited addresses can't be probed endlessly. Same check as checkJoinCodeAttempts, worded for the email.
 */
function checkInvitedEmailAttempts(req: Request, res: Response): void {
  try {
    checkJoinCodeAttempts(req, res, 'email');
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 429) throw err;
    const message = 'Too many tries. Please wait a few minutes and try again.';
    throw new HttpError(429, message, { email: message });
  }
}

function loadUserRow(id: number): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) throw unauthorized();
  return row;
}

/**
 * The way back from the request's student view (see wayBack). When the view no longer reaches the student, the request
 * has no `req.user` and requireCsrfToken let it through without the anti-CSRF token, so that is checked here.
 */
function wayBackFrom(req: Request, res: Response): WayBack | undefined {
  const back = wayBack(req);
  if (back && !req.user && !hasCsrfToken(req, res)) throw csrfRefused();
  return back;
}

/** A teacher or admin signed in as a student uses their work, not their account details. */
function refuseWhileImpersonating(req: Request, what: string): void {
  if (req.impersonator) throw forbidden(`You're signed in as ${currentUser(req).name}. Only they can change ${what}.`);
}

// --- Routes -----------------------------------------------------------------------------------------

router.post('/auth/login', (req, res) => {
  const input = parseBody(loginSchema, req.body);
  const key = loginKey(req, input.login);
  loginFailures.check(key, res, 'Too many sign-in attempts. Please wait a few minutes and try again.');

  // Both columns are COLLATE NOCASE. A username match wins over an email match.
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ? ORDER BY username = ? DESC LIMIT 1')
    .get(input.login, input.login, input.login) as UserRow | undefined;

  let valid = false;
  if (row) valid = verifyPassword(input.password, row.password_hash);
  else verifyDummyPassword(input.password);
  if (!row || !valid) {
    loginFailures.recordFailure(key);
    throw unauthorized('Incorrect username or password');
  }

  loginFailures.clear(key);
  startSession(res, row.id);
  res.json({ user: toUser(row) } satisfies UserResponse);
});

router.post('/auth/logout', (req, res) => {
  // Signing out of a student view goes back to the teacher's or admin's own account, unless their own session would
  // have ended by now (then it just signs out).
  const back = wayBackFrom(req, res);
  if (back) {
    res.json((stopImpersonation(req, res, back) ? { ok: true, user: back.staff } : { ok: true }) satisfies LogoutResponse);
    return;
  }
  endSession(req, res);
  res.json({ ok: true } satisfies LogoutResponse);
});

router.get('/auth/me', requireAuth, (req, res) => {
  const impersonator = req.impersonator ? toImpersonator(req.impersonator) : null;
  res.json({ user: currentUser(req), impersonator } satisfies UserResponse);
});

router.post('/auth/impersonate', requireAuth, (req, res) => {
  const me = currentUser(req);
  if (req.impersonator) throw forbidden(`You're signed in as ${me.name}. Go back to your own account first.`);
  if (!isStaff(me)) throw forbidden();
  const input = parseBody(impersonateSchema, req.body);

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(input.userId) as UserRow | undefined;
  if (me.role === 'admin') {
    if (!target) throw notFound("We couldn't find that student");
    if (target.role !== 'student') {
      throw forbidden(`${target.name} is ${target.role === 'admin' ? 'an admin' : 'a teacher'}. You can only sign in as a student.`);
    }
  } else {
    // Same answer for accounts outside the teacher's classes as for missing ones.
    if (!target || target.role !== 'student' || !teachesStudent(me.id, target.id)) {
      throw notFound("That student isn't in any of your classes");
    }
    // Same rule as resetting their password (see canImpersonate).
    if (inAnotherTeachersClass(me.id, target.id)) {
      throw forbidden(`${target.name} is also in another teacher's class — ask an admin to sign in as them`);
    }
  }

  startImpersonation(req, res, target.id, me.id);
  res.json({ user: toUser(target), impersonator: toImpersonator(me) } satisfies UserResponse);
});

router.post('/auth/stop-impersonating', (req, res) => {
  const back = wayBackFrom(req, res);
  if (!back) {
    if (req.user) throw badRequest("You're already using your own account");
    // Signed out, or a student view whose teacher or admin is no longer staff (loadUser ended it).
    endSession(req, res);
    throw unauthorized();
  }
  // Their own session would have ended by now: sign in again.
  if (!stopImpersonation(req, res, back)) throw unauthorized();
  res.json({ user: back.staff, impersonator: null } satisfies UserResponse);
});

router.post('/auth/register', (req, res) => {
  const input = parseBody(registerSchema, req.body);

  let cls: ClassRow | undefined;
  if (input.joinCode) {
    checkJoinCodeAttempts(req, res, 'joinCode');
    cls = db.prepare('SELECT * FROM classes WHERE join_code = ?').get(input.joinCode) as ClassRow | undefined;
    if (!cls) {
      recordJoinCodeMiss(req);
      const message = "We couldn't find a class with that code. Check it with your teacher.";
      throw badRequest(message, { joinCode: message });
    }
    if (cls.archived === 1 || cls.join_enabled === 0) {
      const message = "This class isn't accepting new students right now. Ask your teacher.";
      throw badRequest(message, { joinCode: message });
    }
  }
  // Every email check counts towards the per-IP limit, so sign-up can't be used to find out which emails have
  // accounts or invitations.
  if (input.email || !cls) checkInvitedEmailAttempts(req, res);
  if (input.email && emailTaken(input.email)) {
    recordJoinCodeMiss(req);
    throw conflict('That email is already used by another account', { email: EMAIL_TAKEN_MESSAGE });
  }
  // Without a class code, the email is what puts the student in a class, so a teacher must have invited it.
  if (!cls && (!input.email || !hasPendingInvites(input.email))) {
    recordJoinCodeMiss(req);
    const message = 'No class has invited this email yet. Check the spelling, or use the class code from your teacher.';
    throw badRequest(message, { email: message });
  }

  const passwordHash = hashPassword(input.password);
  const { user, joinedClasses } = db.transaction(() => {
    if (usernameTaken(input.username)) {
      throw conflict('That username is already taken', { username: 'That username is already taken — try another' });
    }
    const info = db
      .prepare("INSERT INTO users (username, email, name, role, password_hash) VALUES (?, ?, ?, 'student', ?)")
      .run(input.username, input.email, input.name, passwordHash);
    const userId = Number(info.lastInsertRowid);
    const joined: JoinedClass[] = [];
    if (cls) {
      db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, userId);
      joined.push({ id: cls.id, name: cls.name });
    }
    // Every class that invited this email (including the code's class, whose invite is marked as joined).
    joined.push(...claimInvites(userId, input.email));
    return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow, joinedClasses: joined };
  })();

  startSession(res, user.id);
  res.status(201).json({ user: toUser(user), joinedClasses } satisfies UserResponse);
});

router.get('/join/:code', (req, res) => {
  checkJoinCodeAttempts(req, res);
  const code = String(req.params.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw notFound('No class uses that code');
  const row = db
    .prepare(
      `SELECT c.name AS class_name, c.join_enabled, c.archived, u.name AS teacher_name
       FROM classes c JOIN users u ON u.id = c.owner_id WHERE c.join_code = ?`,
    )
    .get(code) as { class_name: string; join_enabled: 0 | 1; archived: 0 | 1; teacher_name: string } | undefined;
  if (!row) {
    recordJoinCodeMiss(req);
    throw notFound('No class uses that code');
  }
  res.json({
    className: row.class_name,
    teacherName: row.teacher_name,
    joinEnabled: row.join_enabled === 1 && row.archived === 0,
  } satisfies JoinPreviewResponse);
});

router.post('/auth/change-password', requireAuth, (req, res) => {
  const user = currentUser(req);
  refuseWhileImpersonating(req, 'their password');
  const input = parseBody(changePasswordSchema, req.body);
  const row = loadUserRow(user.id);

  if (!verifyPassword(input.currentPassword, row.password_hash)) {
    throw badRequest('Your current password is incorrect', { currentPassword: 'This is not your current password' });
  }
  if (input.newPassword === input.currentPassword) {
    throw badRequest('Choose a new password', { newPassword: 'Choose a different password from your current one' });
  }

  const passwordHash = hashPassword(input.newPassword);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(passwordHash, user.id);
    endOtherSessions(user.id, req);
  })();
  res.json({ ok: true } satisfies OkResponse);
});

router.patch('/auth/profile', requireAuth, (req, res) => {
  const user = currentUser(req);
  refuseWhileImpersonating(req, 'their name or email');
  const input = parseBody(updateProfileSchema, req.body);
  // The schema maps a missing email to null; only clear it when the client actually sent an empty value.
  const email = (req.body as { email?: unknown } | undefined)?.email === undefined ? user.email : input.email;

  const emailChanged = email !== null && email.toLowerCase() !== user.email?.toLowerCase();
  // A student trying out emails could find accounts and invitations: count those changes like sign-up attempts.
  const limited = emailChanged && user.role === 'student';
  if (limited) checkInvitedEmailAttempts(req, res);
  if (email && emailTaken(email, user.id)) {
    if (limited) recordJoinCodeMiss(req);
    throw conflict('That email is already used by another account', { email: EMAIL_TAKEN_MESSAGE });
  }
  const { row, joinedClasses } = db.transaction(() => {
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(input.name, email, user.id);
    // A student who takes an invited email joins those classes (claimInvites skips staff accounts).
    return { row: loadUserRow(user.id), joinedClasses: emailChanged ? claimInvites(user.id, email) : [] };
  })();
  if (limited && joinedClasses.length === 0) recordJoinCodeMiss(req);
  res.json({ user: toUser(row), joinedClasses } satisfies UserResponse);
});
