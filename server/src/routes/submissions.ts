// Student work (save/submit/unsubmit) and teacher grading (ARCHITECTURE §7.3).

import {
  computeAutoScore,
  gradeSubmissionSchema,
  saveSubmissionSchema,
  submitSchema,
  type SubmissionDetailResponse,
  type SubmissionResponse,
  type SubmissionRow,
  type SubmissionRowsResponse,
  type TestResult,
  type User,
} from '@codeclass/shared';
import { Router, type Request } from 'express';
import { isEnrolled, loadAssignmentForMember, loadAssignmentForStaff } from '../access';
import { currentUser, isStaff, requireAuth, requireStaff } from '../auth';
import { db, nowIso, type AssignmentRow, type SubmissionDbRow, type UserRow } from '../db';
import { badRequest, conflict, forbidden, notFound, parseBody, parseId } from '../http';
import { hideHiddenTestResults, LANGUAGE_SELECT, parseTests, toAssignment, toLanguage, toSubmission, type LanguageQueryRow } from '../mappers';

export const router = Router();

type StudentRef = Pick<UserRow, 'id' | 'name' | 'username'>;

function findSubmission(assignmentId: number, studentId: number): SubmissionDbRow | undefined {
  return db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?').get(assignmentId, studentId) as
    | SubmissionDbRow
    | undefined;
}

/** The signed-in student and an assignment they can see. Staff get 403: these endpoints are for students' own work. */
function loadForStudent(req: Request): { user: User; assignment: AssignmentRow } {
  const user = currentUser(req);
  if (isStaff(user)) throw forbidden('Only students have their own submissions');
  const { assignment } = loadAssignmentForMember(parseId(req.params.id as string), user);
  return { user, assignment };
}

/** Keeps only results for the given tests (one per test id, first wins). */
function resultsFor(testIds: Set<string>, results: TestResult[]): TestResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (!testIds.has(r.testId) || seen.has(r.testId)) return false;
    seen.add(r.testId);
    return true;
  });
}

function respond(assignment: AssignmentRow, studentId: number): SubmissionResponse {
  return { submission: toSubmission(findSubmission(assignment.id, studentId), assignment, studentId) };
}

/** Response for the student's own endpoints: hidden-test results are removed. */
function respondToStudent(assignment: AssignmentRow, studentId: number): SubmissionResponse {
  return { submission: hideHiddenTestResults(respond(assignment, studentId).submission, assignment) };
}

// --- Student work -----------------------------------------------------------------------------------

router.get('/assignments/:id/submission', requireAuth, (req, res) => {
  const { user, assignment } = loadForStudent(req);
  res.json(respondToStudent(assignment, user.id));
});

router.put('/assignments/:id/submission', requireAuth, (req, res) => {
  const { user, assignment } = loadForStudent(req);
  const { code } = parseBody(saveSubmissionSchema, req.body);
  const existing = findSubmission(assignment.id, user.id);
  if (existing?.status === 'submitted') throw conflict('This work has been handed in. Unsubmit to keep editing.');
  if (existing?.status === 'graded') throw conflict('This work has already been graded.');
  if (existing) {
    db.prepare('UPDATE submissions SET code = ?, updated_at = ? WHERE id = ?').run(code, nowIso(), existing.id);
  } else {
    db.prepare("INSERT INTO submissions (assignment_id, student_id, code, status) VALUES (?, ?, ?, 'in_progress')").run(
      assignment.id,
      user.id,
      code,
    );
  }
  res.json(respondToStudent(assignment, user.id));
});

router.post('/assignments/:id/submit', requireAuth, (req, res) => {
  const { user, assignment } = loadForStudent(req);
  const input = parseBody(submitSchema, req.body);
  const existing = findSubmission(assignment.id, user.id);
  if (existing?.status === 'graded') throw conflict('This work has already been graded.');
  if (assignment.allow_late !== 1 && assignment.due_at && Date.now() > Date.parse(assignment.due_at)) {
    throw conflict("The due date has passed and this assignment doesn't accept late work.");
  }

  // Students only ever run the visible tests; never store results for hidden or unknown tests.
  const visible = parseTests(assignment).filter((t) => !t.hidden);
  const results = input.testResults ? resultsFor(new Set(visible.map((t) => t.id)), input.testResults) : null;
  const autoScore = results ? computeAutoScore(visible, results) : null;
  const now = nowIso();
  const testResults = results ? JSON.stringify(results) : null;

  if (existing) {
    db.prepare(
      `UPDATE submissions SET code = ?, status = 'submitted', submitted_at = ?, test_results = ?, auto_score = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.code, now, testResults, autoScore, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO submissions (assignment_id, student_id, code, status, submitted_at, test_results, auto_score)
       VALUES (?, ?, ?, 'submitted', ?, ?, ?)`,
    ).run(assignment.id, user.id, input.code, now, testResults, autoScore);
  }
  res.json(respondToStudent(assignment, user.id));
});

router.post('/assignments/:id/unsubmit', requireAuth, (req, res) => {
  const { user, assignment } = loadForStudent(req);
  const existing = findSubmission(assignment.id, user.id);
  if (existing?.status === 'graded') throw conflict('This work has already been graded.');
  if (existing?.status !== 'submitted') throw conflict("This work hasn't been handed in.");
  db.prepare("UPDATE submissions SET status = 'in_progress', submitted_at = NULL, updated_at = ? WHERE id = ?").run(
    nowIso(),
    existing.id,
  );
  res.json(respondToStudent(assignment, user.id));
});

// --- Teacher grading --------------------------------------------------------------------------------

function enrolledStudents(classId: number): StudentRef[] {
  return db
    .prepare(
      `SELECT u.id, u.name, u.username FROM enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.class_id = ? ORDER BY u.name COLLATE NOCASE, u.username COLLATE NOCASE, u.id`,
    )
    .all(classId) as StudentRef[];
}

function loadStudent(classId: number, studentIdParam: string | undefined): StudentRef {
  const studentId = parseId(studentIdParam);
  const student = db.prepare('SELECT id, name, username FROM users WHERE id = ?').get(studentId) as StudentRef | undefined;
  if (!student || !isEnrolled(classId, studentId)) throw notFound('Student not found in this class');
  return student;
}

router.get('/assignments/:id/submissions', requireStaff, (req, res) => {
  const user = currentUser(req);
  const { assignment, cls } = loadAssignmentForStaff(parseId(req.params.id as string), user);
  const subs = db.prepare('SELECT * FROM submissions WHERE assignment_id = ?').all(assignment.id) as SubmissionDbRow[];
  const byStudent = new Map(subs.map((s) => [s.student_id, s]));
  const rows: SubmissionRow[] = enrolledStudents(cls.id).map((s) => ({
    student: { id: s.id, name: s.name, username: s.username },
    submission: toSubmission(byStudent.get(s.id), assignment, s.id),
  }));
  res.json({ rows } satisfies SubmissionRowsResponse);
});

router.get('/assignments/:id/submissions/:studentId', requireStaff, (req, res) => {
  const user = currentUser(req);
  const { assignment, cls } = loadAssignmentForStaff(parseId(req.params.id as string), user);
  const student = loadStudent(cls.id, req.params.studentId as string);
  const roster = enrolledStudents(cls.id);
  const index = roster.findIndex((s) => s.id === student.id);
  const language = db.prepare(`${LANGUAGE_SELECT} WHERE l.id = ?`).get(assignment.language_id) as LanguageQueryRow;
  res.json({
    assignment: toAssignment(assignment, user),
    class: { id: cls.id, name: cls.name },
    language: toLanguage(language, user),
    student: { id: student.id, name: student.name, username: student.username },
    submission: toSubmission(findSubmission(assignment.id, student.id), assignment, student.id),
    prevStudentId: index > 0 ? roster[index - 1]!.id : null,
    nextStudentId: index >= 0 && index < roster.length - 1 ? roster[index + 1]!.id : null,
  } satisfies SubmissionDetailResponse);
});

router.patch('/assignments/:id/submissions/:studentId', requireStaff, (req, res) => {
  const user = currentUser(req);
  const { assignment, cls } = loadAssignmentForStaff(parseId(req.params.id as string), user);
  const student = loadStudent(cls.id, req.params.studentId as string);
  const input = parseBody(gradeSubmissionSchema, req.body);

  if (input.grade != null && input.grade > assignment.points) {
    const msg = `The grade can be at most ${assignment.points}`;
    throw badRequest(msg, { grade: msg });
  }

  db.transaction(() => {
    let row = findSubmission(assignment.id, student.id);
    if (!row) {
      db.prepare("INSERT INTO submissions (assignment_id, student_id, code, status) VALUES (?, ?, ?, 'in_progress')").run(
        assignment.id,
        student.id,
        assignment.starter_code,
      );
      row = findSubmission(assignment.id, student.id)!;
    }

    const now = nowIso();
    const next = { ...row };
    if (input.feedback !== undefined) next.feedback = input.feedback;
    if (input.grade !== undefined) next.grade = input.grade;
    if (input.testResults !== undefined) {
      const tests = parseTests(assignment);
      const results = input.testResults ? resultsFor(new Set(tests.map((t) => t.id)), input.testResults) : null;
      next.test_results = results ? JSON.stringify(results) : null;
      next.auto_score = input.autoScore !== undefined ? input.autoScore : results ? computeAutoScore(tests, results) : null;
    } else if (input.autoScore !== undefined) {
      next.auto_score = input.autoScore;
    }

    // A non-null grade without an explicit status means "graded". Results-only patches leave the status alone.
    const status = input.status ?? (input.grade != null ? 'graded' : undefined);
    if (status === 'graded') {
      next.status = 'graded';
      next.graded_at = now;
      next.graded_by = user.id;
    } else if (status === 'in_progress') {
      // Returned for revision: the student can edit and hand in again. Feedback stays; the old grade goes.
      next.status = 'in_progress';
      next.submitted_at = null;
      next.grade = null;
      next.graded_at = null;
      next.graded_by = null;
    } else if (status === 'submitted') {
      next.status = 'submitted';
      next.submitted_at = row.submitted_at ?? now;
      next.grade = null;
      next.graded_at = null;
      next.graded_by = null;
    }
    if (next.status === 'graded' && next.grade == null) {
      const msg = 'Enter a grade';
      throw badRequest(msg, { grade: msg });
    }

    db.prepare(
      `UPDATE submissions SET status = ?, submitted_at = ?, test_results = ?, auto_score = ?, grade = ?, feedback = ?,
         graded_at = ?, graded_by = ?, updated_at = ? WHERE id = ?`,
    ).run(
      next.status,
      next.submitted_at,
      next.test_results,
      next.auto_score,
      next.grade,
      next.feedback,
      next.graded_at,
      next.graded_by,
      now,
      row.id,
    );
  })();

  res.json(respond(assignment, student.id) satisfies SubmissionResponse);
});
