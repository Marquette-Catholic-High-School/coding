// Class invitations by email (staff): list, import a spreadsheet or pasted list (with a dry run), delete.
// Existing student accounts are enrolled straight away; other emails wait until a student account gets them
// (see ../invites.ts). CodeClass doesn't verify emails, so joined invites record who used them and when.

import { Router } from 'express';
import { z } from 'zod';
import {
  importInvitesSchema,
  type ClassInvite,
  type InviteImportResponse,
  type InviteImportRow,
  type InviteOutcome,
  type InvitesResponse,
  type OkResponse,
} from '@codeclass/shared';
import { loadClassForStaff } from '../access';
import { currentUser, requireStaff } from '../auth';
import { db, nowIso, type ClassInviteRow, type UserRow } from '../db';
import { conflict, notFound, parseBody, parseId } from '../http';
import { INVITE_OPEN_SQL } from '../invites';

export const router = Router();

const OUTCOMES: readonly InviteOutcome[] = [
  'enrolled',
  'invited',
  'already_enrolled',
  'already_invited',
  'not_a_student',
  'invalid',
  'duplicate',
];

/** The same rule as optionalEmailSchema, applied per row so one bad row doesn't reject the whole list. */
const emailRule = z.email();

type InviteQueryRow = ClassInviteRow & {
  invited_by_name: string | null;
  joined_name: string | null;
  joined_username: string | null;
  is_open: 0 | 1;
};

/** Append `WHERE …` / `ORDER BY …` (table alias `i`). */
const INVITE_SELECT = `
  SELECT i.*, inviter.name AS invited_by_name, joined.name AS joined_name, joined.username AS joined_username,
    CASE WHEN ${INVITE_OPEN_SQL} THEN 1 ELSE 0 END AS is_open
  FROM class_invites i
  LEFT JOIN users inviter ON inviter.id = i.invited_by
  LEFT JOIN users joined ON joined.id = i.claimed_by`;

function toClassInvite(row: InviteQueryRow): ClassInvite {
  const joined = row.is_open === 0;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: joined ? 'joined' : 'pending',
    invitedAt: row.created_at,
    invitedByName: row.invited_by_name,
    joinedAt: joined ? row.claimed_at : null,
    joinedUser:
      joined && row.claimed_by !== null && row.joined_name !== null && row.joined_username !== null
        ? { id: row.claimed_by, name: row.joined_name, username: row.joined_username }
        : null,
  };
}

router.get('/classes/:id/invites', requireStaff, (req, res) => {
  const cls = loadClassForStaff(parseId(String(req.params.id)), currentUser(req));
  // Pending first (newest invitation first), then joined (most recently joined first).
  const rows = db
    .prepare(
      `${INVITE_SELECT} WHERE i.class_id = ?
       ORDER BY is_open DESC, CASE WHEN is_open = 1 THEN i.created_at ELSE i.claimed_at END DESC, i.id DESC`,
    )
    .all(cls.id) as InviteQueryRow[];
  res.json({ invites: rows.map(toClassInvite) } satisfies InvitesResponse);
});

router.post('/classes/:id/invites', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  const { entries, dryRun } = parseBody(importInvitesSchema, req.body);
  // Archived classes take nobody (invitations to them are never claimed), so there is nothing to import into.
  if (cls.archived === 1) throw conflict('This class is archived. Unarchive it to add students.');

  // Emails are stored lowercased and the columns are COLLATE NOCASE, so every lookup is case-insensitive.
  const findAccount = db.prepare('SELECT id, name, username, role FROM users WHERE email = ?');
  const findEnrollment = db.prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND user_id = ?');
  const findInvite = db.prepare('SELECT 1 FROM class_invites WHERE class_id = ? AND email = ?');
  // A dry run only names students the caller already teaches (admins: everyone), so it can't be used to look people up.
  const teaches = db.prepare(
    'SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.user_id = ? AND c.owner_id = ? LIMIT 1',
  );
  const reveal = (studentId: number) => !dryRun || user.role === 'admin' || !!teaches.get(studentId, user.id);
  const enroll = db.prepare('INSERT OR IGNORE INTO enrollments (class_id, user_id) VALUES (?, ?)');
  const insertInvite = db.prepare('INSERT INTO class_invites (class_id, email, name, invited_by) VALUES (?, ?, ?, ?)');
  // An existing student is enrolled now; the invite is kept as joined so the list shows who was added this way.
  const recordJoined = db.prepare(
    `INSERT INTO class_invites (class_id, email, name, invited_by, claimed_by, claimed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (class_id, email) DO UPDATE SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at`,
  );

  const rows = db.transaction(() => {
    const seen = new Set<string>();
    const now = nowIso();
    return entries.map((entry): InviteImportRow => {
      const result = (outcome: InviteOutcome, email: string, student: InviteImportRow['student'] = null): InviteImportRow => ({
        email,
        name: entry.name,
        outcome,
        student,
      });
      if (!emailRule.safeParse(entry.email).success) return result('invalid', entry.email);
      const email = entry.email.toLowerCase();
      if (seen.has(email)) return result('duplicate', email);
      seen.add(email);

      const account = findAccount.get(email) as Pick<UserRow, 'id' | 'name' | 'username' | 'role'> | undefined;
      if (account) {
        if (account.role !== 'student') return result('not_a_student', email);
        const student = reveal(account.id) ? { id: account.id, name: account.name, username: account.username } : null;
        if (findEnrollment.get(cls.id, account.id)) return result('already_enrolled', email, student);
        if (!dryRun) {
          enroll.run(cls.id, account.id);
          recordJoined.run(cls.id, email, entry.name, user.id, account.id, now);
        }
        return result('enrolled', email, student);
      }
      if (findInvite.get(cls.id, email)) return result('already_invited', email);
      if (!dryRun) insertInvite.run(cls.id, email, entry.name, user.id);
      return result('invited', email);
    });
  })();

  const counts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<InviteOutcome, number>;
  for (const row of rows) counts[row.outcome] += 1;
  res.json({ rows, counts } satisfies InviteImportResponse);
});

router.delete('/classes/:id/invites/:inviteId', requireStaff, (req, res) => {
  const cls = loadClassForStaff(parseId(String(req.params.id)), currentUser(req));
  const inviteId = parseId(String(req.params.inviteId));
  // A joined invite only loses its record: the student stays in the class.
  const info = db.prepare('DELETE FROM class_invites WHERE id = ? AND class_id = ?').run(inviteId, cls.id);
  if (info.changes === 0) throw notFound("That invitation isn't in this class");
  res.json({ ok: true } satisfies OkResponse);
});
