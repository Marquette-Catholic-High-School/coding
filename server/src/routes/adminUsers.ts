// Users admin (admins only): list, create with a temporary password, edit, reset password, delete.

import { Router, type Request } from 'express';
import {
  createUserSchema,
  updateUserSchema,
  type OkResponse,
  type Role,
  type TemporaryPasswordResponse,
  type UserResponse,
  type UsersResponse,
  type UserWithStats,
} from '@codeclass/shared';
import { currentUser, endOtherSessions, generateTemporaryPassword, hashPassword, requireAdmin } from '../auth';
import { db, type UserRow } from '../db';
import { badRequest, conflict, notFound, parseBody, parseId } from '../http';
import { toUser } from '../mappers';
import { emailTaken, usernameTaken } from './auth';

export const router = Router();

const ROLES: readonly Role[] = ['admin', 'teacher', 'student'];

type UserStatsRow = UserRow & { class_count: number };

/** classCount = classes owned for staff, classes enrolled in for students. Append WHERE / ORDER BY (alias `u`). */
const USER_SELECT = `
  SELECT u.*,
    CASE WHEN u.role = 'student'
      THEN (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id)
      ELSE (SELECT COUNT(*) FROM classes c WHERE c.owner_id = u.id)
    END AS class_count
  FROM users u`;

function toUserWithStats(row: UserStatsRow): UserWithStats {
  return { ...toUser(row), classCount: row.class_count };
}

function loadTarget(req: Request): UserRow {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(parseId(String(req.params.id))) as UserRow | undefined;
  if (!row) throw notFound('User not found');
  return row;
}

function countOwnedClasses(userId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM classes WHERE owner_id = ?').get(userId) as { n: number }).n;
}

function countEnrollments(userId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE user_id = ?').get(userId) as { n: number }).n;
}

function countAdmins(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
}

const classesText = (n: number) => `${n} ${n === 1 ? 'class' : 'classes'}`;

router.get('/admin/users', requireAdmin, (req, res) => {
  const role = typeof req.query.role === 'string' && req.query.role !== '' ? req.query.role : undefined;
  if (role !== undefined && !ROLES.includes(role as Role)) throw badRequest('Unknown role', { role: 'Unknown role' });
  const rows = (
    role
      ? db.prepare(`${USER_SELECT} WHERE u.role = ? ORDER BY u.name COLLATE NOCASE, u.username COLLATE NOCASE`).all(role)
      : db.prepare(`${USER_SELECT} ORDER BY u.name COLLATE NOCASE, u.username COLLATE NOCASE`).all()
  ) as UserStatsRow[];
  res.json({ users: rows.map(toUserWithStats) } satisfies UsersResponse);
});

router.post('/admin/users', requireAdmin, (req, res) => {
  const input = parseBody(createUserSchema, req.body);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = hashPassword(temporaryPassword);

  const row = db.transaction(() => {
    if (usernameTaken(input.username)) {
      throw conflict('That username is already taken', { username: 'That username is already taken' });
    }
    if (input.email && emailTaken(input.email)) {
      throw conflict('That email is already used by another account', { email: 'Another account already uses this email' });
    }
    const info = db
      .prepare(
        'INSERT INTO users (username, email, name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)',
      )
      .run(input.username, input.email, input.name, input.role, passwordHash);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid)) as UserRow;
  })();

  res.status(201).json({ user: toUser(row), temporaryPassword } satisfies TemporaryPasswordResponse);
});

router.patch('/admin/users/:id', requireAdmin, (req, res) => {
  const me = currentUser(req);
  const target = loadTarget(req);
  const input = parseBody(updateUserSchema, req.body);
  const newRole = input.role ?? target.role;

  const row = db.transaction(() => {
    if (newRole !== target.role) {
      if (target.id === me.id) {
        throw badRequest("You can't change your own role", { role: "You can't change your own role" });
      }
      if (target.role === 'admin' && countAdmins() <= 1) {
        throw badRequest('CodeClass needs at least one admin', { role: 'CodeClass needs at least one admin' });
      }
      if (newRole === 'student') {
        const owned = countOwnedClasses(target.id);
        if (owned > 0) {
          const message = `${target.name} still owns ${classesText(owned)}. Delete them first.`;
          throw conflict(message, { role: message });
        }
      }
      if (target.role === 'student') {
        const enrolled = countEnrollments(target.id);
        if (enrolled > 0) {
          const message = `${target.name} is a student in ${classesText(enrolled)}. Remove them from those classes first.`;
          throw conflict(message, { role: message });
        }
      }
    }
    if (input.email && emailTaken(input.email, target.id)) {
      throw conflict('That email is already used by another account', { email: 'Another account already uses this email' });
    }
    db.prepare('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?').run(
      input.name ?? target.name,
      input.email === undefined ? target.email : input.email,
      newRole,
      target.id,
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow;
  })();

  res.json({ user: toUser(row) } satisfies UserResponse);
});

router.post('/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const me = currentUser(req);
  const target = loadTarget(req);
  if (target.id === me.id) {
    throw badRequest('Use Account settings to change your own password');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = hashPassword(temporaryPassword);
  const row = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(passwordHash, target.id);
    endOtherSessions(target.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow;
  })();

  res.json({ user: toUser(row), temporaryPassword } satisfies TemporaryPasswordResponse);
});

router.delete('/admin/users/:id', requireAdmin, (req, res) => {
  const me = currentUser(req);
  const target = loadTarget(req);
  if (target.id === me.id) throw badRequest("You can't delete your own account");

  db.transaction(() => {
    if (target.role === 'admin' && countAdmins() <= 1) throw badRequest('CodeClass needs at least one admin');
    const owned = countOwnedClasses(target.id);
    if (owned > 0) {
      throw conflict(`${target.name} still owns ${classesText(owned)}. Delete those classes first.`);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  })();

  res.json({ ok: true } satisfies OkResponse);
});
