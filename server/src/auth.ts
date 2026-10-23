import crypto from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { Role, User } from '@codeclass/shared';
import { config } from './config';
import { db, type UserRow } from './db';
import { forbidden, unauthorized } from './http';
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

/** Stores a new session and returns its raw token (the cookie value). */
export function createSessionToken(userId: number, expires = new Date(Date.now() + config.sessionDays * 86_400_000)): string {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires.toISOString());
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

/** Creates a session for the user and sets the session cookie plus its readable anti-CSRF cookie. */
export function startSession(res: Response, userId: number): void {
  const expires = new Date(Date.now() + config.sessionDays * 86_400_000);
  const token = createSessionToken(userId, expires);
  res.cookie(COOKIE, token, cookieOptions(expires, true));
  res.cookie(CSRF_COOKIE, csrfTokenFor(token), cookieOptions(expires, false));
}

export function endSession(req: Request, res: Response): void {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
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

/** Signs a user out everywhere except (optionally) the current session — used after password changes/resets. */
export function endOtherSessions(userId: number, req?: Request): void {
  const token = req?.cookies?.[COOKIE];
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, hashToken(token));
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Global middleware: attaches `req.user` when a valid session cookie is present. */
export const loadUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string' && token.length > 0) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .get(hashToken(token)) as UserRow | undefined;
    if (row) req.user = toUser(row);
  }
  next();
};

// --- Guards -----------------------------------------------------------------------------------------

/** The signed-in user, or throws 401. Use inside handlers. */
export function currentUser(req: Request): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function isStaff(user: User): boolean {
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
