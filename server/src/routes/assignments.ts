// Assignments: class assignment lists, create/read/update/delete (ARCHITECTURE §7.3).

import {
  assignmentInputSchema,
  kindSupportsTests,
  updateAssignmentSchema,
  type AssignmentListItem,
  type AssignmentResponse,
  type AssignmentsResponse,
  type LanguageKind,
  type OkResponse,
  type SubmissionStatus,
  type TestCase,
  type User,
} from '@codeclass/shared';
import { Router } from 'express';
import { canManageClass, loadAssignmentForMember, loadAssignmentForStaff, loadClassForMember, loadClassForStaff } from '../access';
import { currentUser, isStaff, requireAuth, requireStaff } from '../auth';
import { db, nowIso, type AssignmentRow, type ClassRow, type LanguageRow, type SubmissionDbRow } from '../db';
import { badRequest, parseBody, parseId } from '../http';
import { hideHiddenTestResults, isLate, LANGUAGE_SELECT, parseTests, toAssignment, toLanguage, toSubmission, type LanguageQueryRow } from '../mappers';

export const router = Router();

/** Assignment row → the full response shape (language, class, and the viewer's own submission for students). */
export function assignmentResponse(row: AssignmentRow, cls: Pick<ClassRow, 'id' | 'name'>, viewer: User): AssignmentResponse {
  const language = db.prepare(`${LANGUAGE_SELECT} WHERE l.id = ?`).get(row.language_id) as LanguageQueryRow;
  let submission = null;
  if (!isStaff(viewer)) {
    const sub = db
      .prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?')
      .get(row.id, viewer.id) as SubmissionDbRow | undefined;
    submission = hideHiddenTestResults(toSubmission(sub, row, viewer.id), row);
  }
  return {
    assignment: toAssignment(row, viewer),
    class: { id: cls.id, name: cls.name },
    language: toLanguage(language, viewer),
    submission,
  };
}

/** Normalizes a due date to a UTC ISO string so due dates sort correctly as text. */
function normalizeDue(dueAt: string | null): string | null {
  return dueAt == null ? null : new Date(dueAt).toISOString();
}

/** A language the assignment may switch to: one of the class's languages, installed and enabled. */
function requireClassLanguage(classId: number, languageId: string): LanguageRow {
  const inClass = db.prepare('SELECT 1 FROM class_languages WHERE class_id = ? AND language_id = ?').get(classId, languageId);
  const language = db.prepare('SELECT * FROM languages WHERE id = ?').get(languageId) as LanguageRow | undefined;
  if (!inClass || !language) {
    const msg = "Choose one of this class's languages";
    throw badRequest(msg, { languageId: msg });
  }
  if (language.enabled !== 1) {
    const msg = `${language.name} is turned off. Choose another language.`;
    throw badRequest(msg, { languageId: msg });
  }
  return language;
}

function validateTests(kind: LanguageKind, tests: TestCase[]): void {
  if (tests.length > 0 && !kindSupportsTests(kind)) {
    const msg = "This language can't have tests. Remove the tests first.";
    throw badRequest(msg, { tests: msg });
  }
  const ids = new Set<string>();
  for (const t of tests) {
    if (ids.has(t.id)) {
      const msg = 'Each test needs a unique id';
      throw badRequest(msg, { tests: msg });
    }
    ids.add(t.id);
  }
}

// --- List -------------------------------------------------------------------------------------------

router.get('/classes/:id/assignments', requireAuth, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForMember(parseId(req.params.id as string), user);
  const manager = canManageClass(cls, user);

  const rows = db
    .prepare(
      `SELECT * FROM assignments WHERE class_id = ? ${manager ? '' : 'AND published = 1'}
       ORDER BY due_at IS NULL, due_at, created_at DESC, id DESC`,
    )
    .all(cls.id) as AssignmentRow[];
  const studentIds = (db.prepare('SELECT user_id FROM enrollments WHERE class_id = ?').all(cls.id) as { user_id: number }[]).map(
    (e) => e.user_id,
  );

  let assignments: AssignmentListItem[];
  if (manager) {
    // Submissions of currently enrolled students, grouped by assignment.
    const subs = db
      .prepare(
        `SELECT s.assignment_id, s.student_id, s.status, s.submitted_at, s.returned_at FROM submissions s
         JOIN assignments a ON a.id = s.assignment_id
         JOIN enrollments e ON e.class_id = a.class_id AND e.user_id = s.student_id
         WHERE a.class_id = ?`,
      )
      .all(cls.id) as Pick<SubmissionDbRow, 'assignment_id' | 'student_id' | 'status' | 'submitted_at' | 'returned_at'>[];
    const byAssignment = new Map<number, Map<number, (typeof subs)[number]>>();
    for (const s of subs) {
      let m = byAssignment.get(s.assignment_id);
      if (!m) byAssignment.set(s.assignment_id, (m = new Map()));
      m.set(s.student_id, s);
    }
    const now = Date.now();
    assignments = rows.map((a) => {
      const mine = byAssignment.get(a.id) ?? new Map();
      let submittedCount = 0;
      let gradedCount = 0;
      let lateCount = 0;
      for (const studentId of studentIds) {
        const s = mine.get(studentId);
        const status: SubmissionStatus = s?.status ?? 'not_started';
        if (status === 'submitted' || status === 'graded') submittedCount += 1;
        if (status === 'graded') gradedCount += 1;
        // Students can't see drafts, so nobody is late for one (matches the roster/dashboard counts).
        if (a.published === 1 && isLate(a.due_at, status, s?.submitted_at ?? null, s?.returned_at ?? null, now)) lateCount += 1;
      }
      return {
        ...listBase(a),
        submittedCount,
        gradedCount,
        lateCount,
        studentCount: studentIds.length,
        myStatus: null,
        myLate: false,
        myGrade: null,
      };
    });
  } else {
    const subs = db
      .prepare(
        `SELECT s.* FROM submissions s JOIN assignments a ON a.id = s.assignment_id
         WHERE a.class_id = ? AND s.student_id = ?`,
      )
      .all(cls.id, user.id) as SubmissionDbRow[];
    const byAssignment = new Map(subs.map((s) => [s.assignment_id, s]));
    assignments = rows.map((a) => {
      const sub = toSubmission(byAssignment.get(a.id), a, user.id);
      return {
        ...listBase(a),
        submittedCount: 0,
        gradedCount: 0,
        lateCount: 0,
        studentCount: studentIds.length,
        myStatus: sub.status,
        myLate: sub.late,
        myGrade: sub.status === 'graded' ? sub.grade : null,
      };
    });
  }
  res.json({ assignments } satisfies AssignmentsResponse);
});

function listBase(a: AssignmentRow) {
  return {
    id: a.id,
    classId: a.class_id,
    title: a.title,
    languageId: a.language_id,
    dueAt: a.due_at,
    points: a.points,
    published: a.published === 1,
    createdAt: a.created_at,
  };
}

// --- Create / read / update / delete ----------------------------------------------------------------

router.post('/classes/:id/assignments', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(req.params.id as string), user);
  const input = parseBody(assignmentInputSchema, req.body);
  const language = requireClassLanguage(cls.id, input.languageId);
  validateTests(language.kind as LanguageKind, input.tests);

  const info = db
    .prepare(
      `INSERT INTO assignments
        (class_id, title, instructions, language_id, starter_code, due_at, points, published, allow_late, tests, compare_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cls.id,
      input.title,
      input.instructions,
      input.languageId,
      input.starterCode,
      normalizeDue(input.dueAt),
      input.points,
      input.published ? 1 : 0,
      input.allowLate ? 1 : 0,
      JSON.stringify(input.tests),
      input.compareMode,
    );
  const row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(info.lastInsertRowid) as AssignmentRow;
  res.status(201).json(assignmentResponse(row, cls, user));
});

router.get('/assignments/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const { assignment, cls } = loadAssignmentForMember(parseId(req.params.id as string), user);
  res.json(assignmentResponse(assignment, cls, user));
});

router.patch('/assignments/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const { assignment, cls } = loadAssignmentForStaff(parseId(req.params.id as string), user);
  const parsed = parseBody(updateAssignmentSchema, req.body);
  // zod's partial() still fills in defaults, so only apply keys the client actually sent.
  const body = (req.body ?? {}) as object;
  const sent = (key: keyof typeof parsed) => Object.hasOwn(body, key) && parsed[key] !== undefined;

  let kind: LanguageKind;
  if (sent('languageId') && parsed.languageId !== assignment.language_id) {
    kind = requireClassLanguage(cls.id, parsed.languageId!).kind as LanguageKind;
  } else {
    // An existing assignment may keep its language even if it was later disabled.
    kind = (db.prepare('SELECT kind FROM languages WHERE id = ?').get(assignment.language_id) as { kind: LanguageKind }).kind;
  }
  const tests = sent('tests') ? parsed.tests! : parseTests(assignment);
  validateTests(kind, tests);
  if (sent('points')) {
    // Grades must stay within 0..points; existing grades are never rescaled.
    const maxGrade = db
      .prepare('SELECT MAX(grade) FROM submissions WHERE assignment_id = ? AND grade IS NOT NULL')
      .pluck()
      .get(assignment.id) as number | null;
    if (maxGrade != null && maxGrade > parsed.points!) {
      const msg = `Some students already have grades up to ${maxGrade}. Lower those grades first, or keep at least ${maxGrade} points.`;
      throw badRequest(msg, { points: msg });
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (sent('title')) set('title', parsed.title);
  if (sent('instructions')) set('instructions', parsed.instructions);
  if (sent('languageId')) set('language_id', parsed.languageId);
  if (sent('starterCode')) set('starter_code', parsed.starterCode);
  if (sent('dueAt')) set('due_at', normalizeDue(parsed.dueAt ?? null));
  if (sent('points')) set('points', parsed.points);
  if (sent('published')) set('published', parsed.published ? 1 : 0);
  if (sent('allowLate')) set('allow_late', parsed.allowLate ? 1 : 0);
  if (sent('tests')) set('tests', JSON.stringify(parsed.tests));
  if (sent('compareMode')) set('compare_mode', parsed.compareMode);
  set('updated_at', nowIso());
  db.prepare(`UPDATE assignments SET ${sets.join(', ')} WHERE id = ?`).run(...values, assignment.id);

  const row = db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignment.id) as AssignmentRow;
  res.json(assignmentResponse(row, cls, user));
});

router.delete('/assignments/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const { assignment } = loadAssignmentForStaff(parseId(req.params.id as string), user);
  db.prepare('DELETE FROM assignments WHERE id = ?').run(assignment.id);
  res.json({ ok: true } satisfies OkResponse);
});
