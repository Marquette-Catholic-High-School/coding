// Class invitations by email: a student account that has (or gets) an invited email joins those classes.
// Called on registration, profile email changes and when an admin creates or edits a student.

import { db, nowIso, type UserRow } from './db';

export interface JoinedClass {
  id: number;
  name: string;
}

/**
 * SQL condition (invite alias `i`): the invitation is open. A joined invitation counts as open again once the account
 * that used it no longer has that email (it changed its email, or was deleted), so the real student can still use it.
 */
export const INVITE_OPEN_SQL = `(i.claimed_at IS NULL OR i.claimed_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM users holder WHERE holder.id = i.claimed_by AND holder.email = i.email))`;

/** Open invitations to classes that still take students (archived classes are left out). */
const PENDING_FOR_EMAIL = `
  FROM class_invites i JOIN classes c ON c.id = i.class_id
  WHERE i.email = ? AND ${INVITE_OPEN_SQL} AND c.archived = 0`;

/** True when some non-archived class has a pending invitation for this email (case-insensitive). */
export function hasPendingInvites(email: string): boolean {
  return !!db.prepare(`SELECT 1 ${PENDING_FOR_EMAIL} LIMIT 1`).get(email);
}

/**
 * Enrolls the student in every non-archived class with a pending invitation for `email` and marks those invitations
 * as joined by them. Join-enabled isn't required: the teacher chose this student. Returns the classes the student was
 * not already in (name order). Does nothing for staff accounts or a null email.
 */
export function claimInvites(userId: number, email: string | null): JoinedClass[] {
  if (!email) return [];
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as Pick<UserRow, 'role'> | undefined;
  if (user?.role !== 'student') return [];

  return db.transaction(() => {
    const invites = db
      .prepare(`SELECT i.id, c.id AS class_id, c.name AS class_name ${PENDING_FOR_EMAIL} ORDER BY c.name COLLATE NOCASE, c.id`)
      .all(email) as { id: number; class_id: number; class_name: string }[];
    const enroll = db.prepare('INSERT OR IGNORE INTO enrollments (class_id, user_id) VALUES (?, ?)');
    const claim = db.prepare('UPDATE class_invites SET claimed_by = ?, claimed_at = ? WHERE id = ?');
    const now = nowIso();
    const joined: JoinedClass[] = [];
    for (const invite of invites) {
      if (enroll.run(invite.class_id, userId).changes > 0) joined.push({ id: invite.class_id, name: invite.class_name });
      claim.run(userId, now, invite.id);
    }
    return joined;
  })();
}
