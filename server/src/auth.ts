import crypto from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { Role, User } from '@codeclass/shared';
import { config } from './config';
import { db, type UserRow } from './db';
import { forbidden, HttpError, unauthorized } from './http';
import { toUser } from './mappers';

const COOKIE = 'sid';
/** Readable (not httpOnly) cookie holding the session's anti-CSRF token, for the client to echo in CSRF_HEADER. */
export const CSRF_COOKIE = 'cc_csrf';
export const CSRF_HEADER = 'x-codeclass-token';

// --- Passwords (scrypt, no native deps) -------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const WORDS = [
  'apple', 'river', 'maple', 'tiger', 'cloud', 'pixel', 'comet', 'otter', 'lemon', 'piano', 'rocket', 'cactus',
  'galaxy', 'harbor', 'island', 'jungle', 'koala', 'meadow', 'nectar', 'orbit', 'panda', 'quartz', 'robin', 'sunny',
  'tulip', 'violet', 'walrus', 'zebra', 'banjo', 'cobalt', 'dragon', 'ember', 'falcon', 'gecko', 'hazel', 'igloo',
];

/** Easy-to-read temporary password like "river-maple-42" (shown once to the teacher). */
export function generateTemporaryPassword(): string {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)]!;
  return `${pick()}-${pick()}-${crypto.randomInt(10, 100)}`;
}

// --- Sessions -----------------------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Longest a teacher or admin stays signed in as a student before they're returned to the sign-in page. */
const IMPERSONATION_MS = 8 * 3_600_000;

function sessionExpiry(): Date {
  return new Date(Date.now() + config.sessionDays * 86_400_000);
}

/** What a student view's session also stores ("Sign in as student", see startImpersonation). */
interface StudentViewOf {
  /** The teacher or admin signed in as this student. */
  impersonatorId: number;
  /** When their own session, which the student view replaced, would have ended. */
  returnExpires: Date;
}

/** Stores a new session and returns its raw token (the cookie value). `view`: set for a student view. */
export function createSessionToken(userId: number, expires = sessionExpiry(), view: StudentViewOf | null = null): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, impersonator_id, return_expires_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    view?.impersonatorId ?? null,
    view?.returnExpires.toISOString() ?? null,
    expires.toISOString(),
  );
  return token;
}

/**
 * The anti-CSRF token of a session, derived from its raw token so nothing extra is stored. The page's main thread reads
 * it from the `cc_csrf` cookie and sends it as `x-codeclass-token`. Student code runs in Web Workers on our origin:
 * their requests carry the session cookie, but workers can't read cookies, so they can't send this token.
 */
export function csrfTokenFor(sessionToken: string): string {
  return crypto.createHash('sha256').update(`csrf:${sessionToken}`).digest('base64url');
}

function cookieOptions(expires: Date, httpOnly: boolean): CookieOptions {
  return { httpOnly, sameSite: 'lax', secure: config.cookieSecure, expires, path: '/' };
}

function setSessionCookies(res: Response, token: string, expires: Date): void {
  res.cookie(COOKIE, token, cookieOptions(expires, true));
  res.cookie(CSRF_COOKIE, csrfTokenFor(token), cookieOptions(expires, false));
}

/** Creates a session for the user and sets the session cookie plus its readable anti-CSRF cookie. */
export function startSession(res: Response, userId: number): void {
  const expires = sessionExpiry();
  setSessionCookies(res, createSessionToken(userId, expires), expires);
}

/** Hash of the request's session cookie (the `sessions.id`), if it sent one. */
function sessionId(req: Request): string | undefined {
  const token = req.cookies?.[COOKIE];
  return typeof token === 'string' && token.length > 0 ? hashToken(token) : undefined;
}

export function endSession(req: Request, res: Response): void {
  const id = sessionId(req);
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  res.clearCookie(COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Ends the request's session and signs the browser in with a new one in its place. */
function replaceSession(req: Request, res: Response, userId: number, expires: Date, view: StudentViewOf | null): void {
  const id = sessionId(req);
  const token = db.transaction(() => {
    if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return createSessionToken(userId, expires, view);
  })();
  setSessionCookies(res, token, expires);
}

// --- Signing in as a student ------------------------------------------------------------------------

/** True when the student is enrolled in a class (archived ones included) that `staffId` owns. */
export function teachesStudent(staffId: number, studentId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ? AND c.owner_id = ? LIMIT 1')
    .get(studentId, staffId);
}

/** True when the student is enrolled in a class (archived ones included) that someone other than `staffId` owns. */
export function inAnotherTeachersClass(staffId: number, studentId: number): boolean {
  return !!db
    .prepare('SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ? AND c.owner_id <> ? LIMIT 1')
    .get(studentId, staffId);
}

/**
 * Admins may sign in as any student. Teachers only as students whose classes are all theirs (archived classes
 * included), the same rule as resetting a student's password: the student view reaches every class the student is in
 * and their playground, so it must not open another teacher's class. Checked when the teacher or admin starts, and
 * again on every request of that session.
 */
export function canImpersonate(staff: Pick<User, 'id' | 'role'>, target: Pick<User, 'id' | 'role'>): boolean {
  if (target.role !== 'student') return false;
  if (staff.role === 'admin') return true;
  if (staff.role !== 'teacher') return false;
  return teachesStudent(staff.id, target.id) && !inAnotherTeachersClass(staff.id, target.id);
}

/**
 * Swaps the staff member's session for one signed in as the student. It never outlives the staff session it
 * replaced, and lasts at most IMPERSONATION_MS. The staff session's expiry is kept for going back (stopImpersonation).
 */
export function startImpersonation(req: Request, res: Response, studentId: number, staffId: number): void {
  const id = sessionId(req);
  const current = id
    ? (db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as { expires_at: string } | undefined)
    : undefined;
  // Only when the session ended since this request was authenticated (e.g. signed out in another tab).
  if (!current) throw unauthorized();
  const returnExpires = new Date(current.expires_at);
  const expires = new Date(Math.min(returnExpires.getTime(), Date.now() + IMPERSONATION_MS));
  replaceSession(req, res, studentId, expires, { impersonatorId: staffId, returnExpires });
}

/** The way out of a student view: the teacher or admin to go back to, and when their own session ends. */
export interface WayBack {
  staff: User;
  expires: Date;
}

/**
 * The way back from the request's student view, read from its session. Also found when the view no longer reaches
 * the student (the student left the teacher's classes, or joined another teacher's: loadUser then leaves `req.user`
 * unset), so the teacher can still go back without a password. Undefined when the request has no unexpired student
 * view, or its teacher or admin is gone or no longer staff (loadUser has ended it).
 */
export function wayBack(req: Request): WayBack | undefined {
  const id = sessionId(req);
  if (!id) return undefined;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at AS view_expires_at, s.return_expires_at FROM sessions s JOIN users u ON u.id = s.impersonator_id
       WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .get(id) as (UserRow & { view_expires_at: string; return_expires_at: string | null }) | undefined;
  if (!row || !isStaff(row)) return undefined;
  // Student views started before return_expires_at existed go back until the view itself would have ended.
  return { staff: toUser(row), expires: new Date(row.return_expires_at ?? row.view_expires_at) };
}

/**
 * Ends a student view and signs the browser back in to the teacher's or admin's own account, until their own session
 * would have ended (going in and back never extends it). False when that time has passed: the browser is then signed
 * out.
 */
export function stopImpersonation(req: Request, res: Response, back: WayBack): boolean {
  if (back.expires.getTime() <= Date.now()) {
    endSession(req, res);
    return false;
  }
  replaceSession(req, res, back.staff.id, back.expires, null);
  return true;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * For a request with a valid session: true when it carries the session's anti-CSRF token. When it doesn't and the
 * `cc_csrf` cookie is missing or stale (sessions started before the cookie existed), sets that cookie again on `res`
 * so the client can read it and retry.
 */
export function hasCsrfToken(req: Request, res: Response): boolean {
  const token = req.cookies?.[COOKIE];
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = csrfTokenFor(token);
  const sent = req.get(CSRF_HEADER);
  if (typeof sent === 'string' && safeEqual(sent, expected)) return true;
  if (req.cookies?.[CSRF_COOKIE] !== expected) {
    const session = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(hashToken(token)) as
      | { expires_at: string }
      | undefined;
    if (session) res.cookie(CSRF_COOKIE, expected, cookieOptions(new Date(session.expires_at), false));
  }
  return false;
}

/**
 * Signs a user out everywhere except (optionally) the current session — used after password changes/resets. Also ends
 * the student views they signed in to as a teacher or admin.
 */
export function endOtherSessions(userId: number, req?: Request): void {
  const id = req ? sessionId(req) : undefined;
  db.prepare('DELETE FROM sessions WHERE (user_id = ? OR impersonator_id = ?) AND id IS NOT ?').run(userId, userId, id ?? null);
}

/**
 * Global middleware: attaches `req.user` when a valid session cookie is present, and `req.impersonator` when it is a
 * teacher or admin signed in as a student. A student view whose teacher or admin is gone or no longer staff is ended.
 * One whose student is no longer theirs (see canImpersonate) reaches nothing but the way back (`wayBack`): going back
 * to their own account needs no password.
 */
export const loadUser: RequestHandler = (req, _res, next) => {
  const id = sessionId(req);
  if (id) {
    const row = db
      .prepare(
        `SELECT u.*, s.impersonator_id FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .get(id) as (UserRow & { impersonator_id: number | null }) | undefined;
    if (row && row.impersonator_id === null) {
      req.user = toUser(row);
    } else if (row) {
      const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(row.impersonator_id) as UserRow | undefined;
      if (!staff || !isStaff(staff)) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      } else if (canImpersonate(staff, row)) {
        req.user = toUser(row);
        req.impersonator = toUser(staff);
      }
    }
  }
  next();
};

/** Request header: the id of the user the page thinks is signed in. The client sends it on every call but GET /auth/me. */
export const ACCOUNT_HEADER = 'x-codeclass-user';

/**
 * Refuses (409, code `account-changed`) a call made for another account than the session's: a tab still showing the
 * account that was signed in before another tab switched (e.g. to "Sign in as student"). All tabs share the session
 * cookie, so without this such a tab's autosave could save one student's code as another's work. GET /auth/me always
 * answers: it is how a tab finds out who is signed in.
 */
export const requireSameAccount: RequestHandler = (req, _res, next) => {
  const expected = req.get(ACCOUNT_HEADER);
  const isMe = req.method === 'GET' && req.path === '/auth/me';
  if (expected && req.user && !isMe && expected !== String(req.user.id)) {
    throw new HttpError(
      409,
      "You're using a different account in another tab, so this page can't save anything. Reload it to continue.",
      undefined,
      'account-changed',
    );
  }
  next();
};

// --- Guards -----------------------------------------------------------------------------------------

/** The signed-in user, or throws 401. Use inside handlers. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function isStaff(user: Pick<User, 'role'>): boolean {
  return user.role === 'teacher' || user.role === 'admin';
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = currentUser(req);
    if (!roles.includes(user.role)) throw forbidden();
    next();
  };
}

/** Teachers and admins. */
export const requireStaff = requireRole('teacher', 'admin');
export const requireAdmin = requireRole('admin');

/** Purges expired sessions (called at startup and daily). */
export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
}
