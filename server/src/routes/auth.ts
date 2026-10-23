// Sign in/out, the current user, student self-registration, the public join preview, password and profile.

import crypto from 'node:crypto';
import { Router } from 'express';
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
import { badRequest, conflict, HttpError, notFound, parseBody, unauthorized } from '../http';
import { toUser } from '../mappers';

export const router = Router();

// --- Login rate limiting (in memory, per IP + login) ------------------------------------------------

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_FAILURES = 10;
/** Upper bound on tracked keys so a flood of distinct logins can't grow the map without limit. */
const MAX_TRACKED_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

interface FailedAttempts {
  failures: number;
  resetAt: number;
}

const loginFailures = new Map<string, FailedAttempts>();
let lastSweep = 0;

function sweepLoginFailures(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS && loginFailures.size < MAX_TRACKED_KEYS) return;
  lastSweep = now;
  for (const [key, entry] of loginFailures) if (entry.resetAt <= now) loginFailures.delete(key);
  // Map iteration is insertion order, so this drops the oldest windows first.
  for (const key of loginFailures.keys()) {
    if (loginFailures.size < MAX_TRACKED_KEYS) break;
    loginFailures.delete(key);
  }
}

function activeFailures(key: string, now: number): FailedAttempts | undefined {
  const entry = loginFailures.get(key);
  if (entry && entry.resetAt <= now) {
    loginFailures.delete(key);
    return undefined;
  }
  return entry;
}

function recordLoginFailure(key: string, now: number): void {
  sweepLoginFailures(now);
  const entry = activeFailures(key, now);
  if (entry) entry.failures += 1;
  else loginFailures.set(key, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
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
  const now = Date.now();
  const key = `${req.ip ?? 'unknown'}|${input.login.toLowerCase()}`;

  const attempts = activeFailures(key, now);
  if (attempts && attempts.failures >= LOGIN_MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.ceil((attempts.resetAt - now) / 1000)));
    throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
  }

  // Both columns are COLLATE NOCASE. A username match wins over an email match.
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ? ORDER BY username = ? DESC LIMIT 1')
    .get(input.login, input.login, input.login) as UserRow | undefined;

  let valid = false;
  if (row) valid = verifyPassword(input.password, row.password_hash);
  else verifyDummyPassword(input.password);
  if (!row || !valid) {
    recordLoginFailure(key, now);
    throw unauthorized('Incorrect username or password');
  }

  loginFailures.delete(key);
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

  const cls = db.prepare('SELECT * FROM classes WHERE join_code = ?').get(input.joinCode) as ClassRow | undefined;
  if (!cls) {
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
  const code = String(req.params.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw notFound('No class uses that code');
  const row = db
    .prepare(
      `SELECT c.name AS class_name, c.join_enabled, c.archived, u.name AS teacher_name
       FROM classes c JOIN users u ON u.id = c.owner_id WHERE c.join_code = ?`,
    )
    .get(code) as { class_name: string; join_enabled: 0 | 1; archived: 0 | 1; teacher_name: string } | undefined;
  if (!row) throw notFound('No class uses that code');
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
