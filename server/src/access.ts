// Authorization helpers shared by route modules. Each throws 404/403 HttpErrors so handlers stay linear.

import crypto from 'node:crypto';
import type { User } from '@codeclass/shared';
import { isStaff } from './auth';
import { db, type AssignmentRow, type ClassRow, type LanguageRow } from './db';
import { forbidden, notFound } from './http';

export function isEnrolled(classId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?').get(classId, userId);
}

/** Teachers may manage their own classes; admins may manage every class. */
export function canManageClass(cls: ClassRow, user: User): boolean {
  return user.role === 'admin' || (user.role === 'teacher' && cls.owner_id === user.id);
}

/** Class the user may manage (owner teacher or admin). */
export function loadClassForStaff(classId: number, user: User): ClassRow {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId) as ClassRow | undefined;
  if (!cls) throw notFound('Class not found');
  if (!canManageClass(cls, user)) throw user.role === 'student' ? notFound('Class not found') : forbidden();
  return cls;
}

/** Class the user may view: managers, or enrolled students. */
export function loadClassForMember(classId: number, user: User): ClassRow {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId) as ClassRow | undefined;
  if (!cls) throw notFound('Class not found');
  if (canManageClass(cls, user)) return cls;
  if (user.role === 'student' && isEnrolled(classId, user.id)) return cls;
  throw isStaff(user) ? forbidden() : notFound('Class not found');
}

export function loadAssignmentForStaff(assignmentId: number, user: User): { assignment: AssignmentRow; cls: ClassRow } {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as AssignmentRow | undefined;
  if (!assignment) throw notFound('Assignment not found');
  const cls = loadClassForStaff(assignment.class_id, user);
  return { assignment, cls };
}

/** Managers see every assignment; enrolled students only published ones. */
export function loadAssignmentForMember(assignmentId: number, user: User): { assignment: AssignmentRow; cls: ClassRow } {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as AssignmentRow | undefined;
  if (!assignment) throw notFound('Assignment not found');
  const cls = loadClassForMember(assignment.class_id, user);
  if (!canManageClass(cls, user) && assignment.published !== 1) throw notFound('Assignment not found');
  return { assignment, cls };
}

export function loadLanguageRow(id: string): LanguageRow {
  const row = db.prepare('SELECT * FROM languages WHERE id = ?').get(id) as LanguageRow | undefined;
  if (!row) throw notFound('Language not found');
  return row;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

/** A fresh 6-character class join code not used by any class. */
export function generateJoinCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM classes WHERE join_code = ?').get(code)) return code;
  }
}

/** URL-safe slug, e.g. "Year 7 Pseudocode!" → "year-7-pseudocode". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'language'
  );
}
