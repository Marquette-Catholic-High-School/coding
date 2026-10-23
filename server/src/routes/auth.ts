// Sign in/out, the current user, student self-registration, the public join preview, password and profile.

import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  type JoinPreviewResponse,
  type OkResponse,
  type UserResponse,
} from '@codeclass/shared';
import { currentUser, endOtherSessions, endSession, hashPassword, requireAuth, startSession, verifyPassword } from '../auth';
import { db, type ClassRow, type UserRow } from '../db';
import { badRequest, conflict, notFound, parseBody, unauthorized } from '../http';
import { toUser } from '../mappers';
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

function loadUserRow(id: number): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) throw unauthorized();
  return row;
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
  endSession(req, res);
  res.json({ ok: true } satisfies OkResponse);
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) } satisfies UserResponse);
});

router.post('/auth/register', (req, res) => {
  const input = parseBody(registerSchema, req.body);

  checkJoinCodeAttempts(req, res, 'joinCode');
  const cls = db.prepare('SELECT * FROM classes WHERE join_code = ?').get(input.joinCode) as ClassRow | undefined;
  if (!cls) {
    recordJoinCodeMiss(req);
    const message = "We couldn't find a class with that code. Check it with your teacher.";
    throw badRequest(message, { joinCode: message });
  }
  if (cls.archived === 1 || cls.join_enabled === 0) {
    const message = "This class isn't accepting new students right now. Ask your teacher.";
    throw badRequest(message, { joinCode: message });
  }

  const passwordHash = hashPassword(input.password);
  const user = db.transaction(() => {
    if (usernameTaken(input.username)) {
      throw conflict('That username is already taken', { username: 'That username is already taken — try another' });
    }
    const info = db
      .prepare("INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, 'student', ?)")
      .run(input.username, input.name, passwordHash);
    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, userId);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
  })();

  startSession(res, user.id);
  res.status(201).json({ user: toUser(user) } satisfies UserResponse);
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
  const input = parseBody(updateProfileSchema, req.body);
  // The schema maps a missing email to null; only clear it when the client actually sent an empty value.
  const email = (req.body as { email?: unknown } | undefined)?.email === undefined ? user.email : input.email;

  const row = db.transaction(() => {
    if (email && emailTaken(email, user.id)) {
      throw conflict('That email is already used by another account', { email: 'Another account already uses this email' });
    }
    db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(input.name, email, user.id);
    return loadUserRow(user.id);
  })();
  res.json({ user: toUser(row) } satisfies UserResponse);
});
