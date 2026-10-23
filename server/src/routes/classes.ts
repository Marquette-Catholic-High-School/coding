import { Router } from 'express';
import {
  createClassSchema,
  joinClassSchema,
  updateClassSchema,
  type ClassResponse,
  type ClassesResponse,
  type OkResponse,
  type User,
} from '@codeclass/shared';
import { generateJoinCode, isEnrolled, loadClassForMember, loadClassForStaff } from '../access';
import { currentUser, isStaff, requireAuth, requireStaff } from '../auth';
import { db, nowIso, type ClassRow } from '../db';
import { badRequest, notFound, parseBody, parseId } from '../http';
import { CLASS_SELECT, toClassSummary, type ClassQueryRow } from '../mappers';
import { checkJoinCodeAttempts, recordJoinCodeMiss } from '../rateLimit';

export const router = Router();

/** The API shape of one class, as seen by `viewer`. */
function getClassSummary(classId: number, viewer: User) {
  const row = db.prepare(`${CLASS_SELECT} WHERE c.id = ?`).get(classId) as ClassQueryRow | undefined;
  if (!row) throw notFound('Class not found');
  return toClassSummary(row, viewer);
}

/**
 * Checks the requested class languages. Every id must be an installed, enabled language, except ids in `keep`
 * (languages the class already has, which may stay even after being disabled). Returns the de-duplicated ids.
 */
function validateLanguageIds(ids: string[], keep: ReadonlySet<string> = new Set()): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return unique;
  const rows = db
    .prepare(`SELECT id, enabled FROM languages WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .all(...unique) as Array<{ id: string; enabled: 0 | 1 }>;
  const enabled = new Map(rows.map((r) => [r.id, r.enabled === 1]));
  for (const id of unique) {
    if (!enabled.has(id)) {
      const msg = `"${id}" isn't an installed language`;
      throw badRequest(msg, { languageIds: msg });
    }
    if (!enabled.get(id) && !keep.has(id)) {
      const msg = `"${id}" is turned off — ask an admin to enable it first`;
      throw badRequest(msg, { languageIds: msg });
    }
  }
  return unique;
}

function setClassLanguages(classId: number, languageIds: string[]) {
  db.prepare('DELETE FROM class_languages WHERE class_id = ?').run(classId);
  const insert = db.prepare('INSERT INTO class_languages (class_id, language_id) VALUES (?, ?)');
  for (const id of languageIds) insert.run(classId, id);
}

router.get('/classes', requireAuth, (req, res) => {
  const user = currentUser(req);
  const archived = req.query.archived === '1' || req.query.archived === 'true' ? 1 : 0;
  const order = 'ORDER BY c.name COLLATE NOCASE, c.id';
  let rows: ClassQueryRow[];
  if (user.role === 'admin') {
    rows = db.prepare(`${CLASS_SELECT} WHERE c.archived = ? ${order}`).all(archived) as ClassQueryRow[];
  } else if (user.role === 'teacher') {
    rows = db.prepare(`${CLASS_SELECT} WHERE c.archived = ? AND c.owner_id = ? ${order}`).all(archived, user.id) as ClassQueryRow[];
  } else {
    rows = db
      .prepare(
        `${CLASS_SELECT} WHERE c.archived = ? AND c.id IN (SELECT class_id FROM enrollments WHERE user_id = ?) ${order}`,
      )
      .all(archived, user.id) as ClassQueryRow[];
  }
  const body: ClassesResponse = { classes: rows.map((r) => toClassSummary(r, user)) };
  res.json(body);
});

router.post('/classes', requireStaff, (req, res) => {
  const user = currentUser(req);
  const input = parseBody(createClassSchema, req.body);
  const languageIds = validateLanguageIds(input.languageIds);
  const classId = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO classes (name, description, join_code, owner_id) VALUES (?, ?, ?, ?)')
      .run(input.name, input.description, generateJoinCode(), user.id);
    const id = Number(info.lastInsertRowid);
    setClassLanguages(id, languageIds);
    return id;
  })();
  const body: ClassResponse = { class: getClassSummary(classId, user) };
  res.status(201).json(body);
});

router.post('/classes/join', requireAuth, (req, res) => {
  const user = currentUser(req);
  if (isStaff(user)) throw badRequest("Teachers and admins can't join classes as students");
  const { joinCode } = parseBody(joinClassSchema, req.body);
  checkJoinCodeAttempts(req, res, 'joinCode');
  const cls = db.prepare('SELECT * FROM classes WHERE join_code = ?').get(joinCode) as ClassRow | undefined;
  if (!cls) {
    recordJoinCodeMiss(req);
    const msg = "We couldn't find a class with that code. Check it with your teacher.";
    throw badRequest(msg, { joinCode: msg });
  }
  // Re-entering the code of a class you're already in just takes you there.
  if (!isEnrolled(cls.id, user.id)) {
    if (cls.archived === 1) {
      const msg = 'That class has been archived and is no longer taking students.';
      throw badRequest(msg, { joinCode: msg });
    }
    if (cls.join_enabled !== 1) {
      const msg = "That class isn't accepting new students right now. Ask your teacher to turn joining on.";
      throw badRequest(msg, { joinCode: msg });
    }
    db.prepare('INSERT OR IGNORE INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, user.id);
  }
  const body: ClassResponse = { class: getClassSummary(cls.id, user) };
  res.json(body);
});

router.get('/classes/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForMember(parseId(String(req.params.id)), user);
  const body: ClassResponse = { class: getClassSummary(cls.id, user) };
  res.json(body);
});

router.patch('/classes/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  const input = parseBody(updateClassSchema, req.body);

  let languageIds: string[] | undefined;
  if (input.languageIds) {
    const current = db.prepare('SELECT language_id FROM class_languages WHERE class_id = ?').pluck().all(cls.id) as string[];
    languageIds = validateLanguageIds(input.languageIds, new Set(current));
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE classes SET name = ?, description = ?, join_enabled = ?, archived = ?, updated_at = ? WHERE id = ?`,
    ).run(
      input.name ?? cls.name,
      input.description ?? cls.description,
      input.joinEnabled === undefined ? cls.join_enabled : input.joinEnabled ? 1 : 0,
      input.archived === undefined ? cls.archived : input.archived ? 1 : 0,
      nowIso(),
      cls.id,
    );
    if (languageIds) setClassLanguages(cls.id, languageIds);
  })();

  const body: ClassResponse = { class: getClassSummary(cls.id, user) };
  res.json(body);
});

router.post('/classes/:id/regenerate-code', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  db.prepare('UPDATE classes SET join_code = ?, updated_at = ? WHERE id = ?').run(generateJoinCode(), nowIso(), cls.id);
  const body: ClassResponse = { class: getClassSummary(cls.id, user) };
  res.json(body);
});

router.delete('/classes/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  // Enrollments, class languages, assignments and their submissions cascade.
  db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id);
  const body: OkResponse = { ok: true };
  res.json(body);
});
