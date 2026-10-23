import { Router } from 'express';
import type {
  DashboardResponse,
  StudentAssignmentItem,
  StudentDashboard,
  SubmissionStatus,
  TeacherDashboard,
  ToGradeItem,
  UpcomingItem,
  User,
} from '@codeclass/shared';
import { currentUser, isStaff, requireAuth } from '../auth';
import { db } from '../db';
import { CLASS_SELECT, isLate, toClassSummary, type ClassQueryRow } from '../mappers';

export const router = Router();

const DAY_MS = 86_400_000;
const CLASS_ORDER = 'ORDER BY c.name COLLATE NOCASE, c.id';

/** Sort key for an optional due date: soonest first, no due date last. */
const dueKey = (dueAt: string | null) => (dueAt ? Date.parse(dueAt) : Number.POSITIVE_INFINITY);

function teacherDashboard(user: User): TeacherDashboard {
  const now = Date.now();
  // Teachers see their own classes, admins every class; archived classes are left out everywhere.
  const scope = user.role === 'admin' ? 'c.archived = 0' : 'c.archived = 0 AND c.owner_id = ?';
  const args = user.role === 'admin' ? [] : [user.id];

  const classes = (db.prepare(`${CLASS_SELECT} WHERE ${scope} ${CLASS_ORDER}`).all(...args) as ClassQueryRow[]).map((r) =>
    toClassSummary(r, user),
  );

  const studentCount = db
    .prepare(`SELECT COUNT(DISTINCT e.user_id) FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE ${scope}`)
    .pluck()
    .get(...args) as number;

  // Handed-in work from students who are still in the class.
  const toGradeFrom = `
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN classes c ON c.id = a.class_id
    JOIN enrollments e ON e.class_id = a.class_id AND e.user_id = s.student_id
    JOIN users u ON u.id = s.student_id
    WHERE s.status = 'submitted' AND ${scope}`;
  const toGradeCount = db.prepare(`SELECT COUNT(*) ${toGradeFrom}`).pluck().get(...args) as number;
  const toGradeRows = db
    .prepare(
      `SELECT s.assignment_id, a.title, a.class_id, c.name AS class_name, a.due_at, u.id AS student_id,
              u.name AS student_name, COALESCE(s.submitted_at, s.updated_at) AS handed_in_at, s.returned_at
       ${toGradeFrom}
       ORDER BY handed_in_at ASC, s.id ASC
       LIMIT 10`,
    )
    .all(...args) as Array<{
    assignment_id: number;
    title: string;
    class_id: number;
    class_name: string;
    due_at: string | null;
    student_id: number;
    student_name: string;
    handed_in_at: string;
    returned_at: string | null;
  }>;
  const toGrade: ToGradeItem[] = toGradeRows.map((r) => ({
    assignmentId: r.assignment_id,
    assignmentTitle: r.title,
    classId: r.class_id,
    className: r.class_name,
    student: { id: r.student_id, name: r.student_name },
    submittedAt: r.handed_in_at,
    late: isLate(r.due_at, 'submitted', r.handed_in_at, r.returned_at, now),
  }));

  // Late or missing: every (enrolled student, published assignment with a due date) pair that is late.
  const pairs = db
    .prepare(
      `SELECT a.due_at, s.status, s.submitted_at, s.returned_at
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN enrollments e ON e.class_id = a.class_id
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.user_id
       WHERE a.published = 1 AND a.due_at IS NOT NULL AND ${scope}`,
    )
    .all(...args) as Array<{ due_at: string; status: SubmissionStatus | null; submitted_at: string | null; returned_at: string | null }>;
  const lateCount = pairs.filter((p) => isLate(p.due_at, p.status ?? 'not_started', p.submitted_at, p.returned_at, now)).length;

  // Due in the next 14 days. The SQL range is a coarse pre-filter (with a day of slack for timezone offsets in
  // the stored strings); the exact window is checked on parsed dates.
  const horizon = now + 14 * DAY_MS;
  const upcomingRows = db
    .prepare(
      `SELECT a.id, a.title, a.class_id, c.name AS class_name, a.due_at,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = a.class_id) AS student_count,
         (SELECT COUNT(*) FROM submissions s
            JOIN enrollments e ON e.class_id = a.class_id AND e.user_id = s.student_id
            WHERE s.assignment_id = a.id AND s.status IN ('submitted', 'graded')) AS submitted_count
       FROM assignments a JOIN classes c ON c.id = a.class_id
       WHERE a.published = 1 AND a.due_at IS NOT NULL AND a.due_at >= ? AND a.due_at <= ? AND ${scope}`,
    )
    .all(new Date(now - DAY_MS).toISOString(), new Date(horizon + DAY_MS).toISOString(), ...args) as Array<{
    id: number;
    title: string;
    class_id: number;
    class_name: string;
    due_at: string;
    student_count: number;
    submitted_count: number;
  }>;
  const upcoming: UpcomingItem[] = upcomingRows
    .map((r) => ({ row: r, due: Date.parse(r.due_at) }))
    .filter(({ due }) => due > now && due <= horizon)
    .sort((a, b) => a.due - b.due || a.row.id - b.row.id)
    .slice(0, 8)
    .map(({ row: r }) => ({
      assignmentId: r.id,
      assignmentTitle: r.title,
      classId: r.class_id,
      className: r.class_name,
      dueAt: r.due_at,
      submittedCount: r.submitted_count,
      studentCount: r.student_count,
    }));

  return {
    role: user.role === 'admin' ? 'admin' : 'teacher',
    stats: { classCount: classes.length, studentCount, toGradeCount, lateCount },
    toGrade,
    upcoming,
    classes,
  };
}

function studentDashboard(user: User): StudentDashboard {
  const now = Date.now();
  const classes = (
    db
      .prepare(
        `${CLASS_SELECT} WHERE c.archived = 0 AND c.id IN (SELECT class_id FROM enrollments WHERE user_id = ?) ${CLASS_ORDER}`,
      )
      .all(user.id) as ClassQueryRow[]
  ).map((r) => toClassSummary(r, user));

  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.class_id, c.name AS class_name, a.language_id, a.due_at, a.points,
              s.status, s.submitted_at, s.returned_at, s.grade, s.graded_at
       FROM assignments a
       JOIN classes c ON c.id = a.class_id
       JOIN enrollments e ON e.class_id = a.class_id AND e.user_id = ?
       LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.user_id
       WHERE a.published = 1 AND c.archived = 0`,
    )
    .all(user.id) as Array<{
    id: number;
    title: string;
    class_id: number;
    class_name: string;
    language_id: string;
    due_at: string | null;
    points: number;
    status: Exclude<SubmissionStatus, 'not_started'> | null;
    submitted_at: string | null;
    returned_at: string | null;
    grade: number | null;
    graded_at: string | null;
  }>;

  const items = rows.map((r) => {
    const status: SubmissionStatus = r.status ?? 'not_started';
    const item: StudentAssignmentItem = {
      assignmentId: r.id,
      title: r.title,
      classId: r.class_id,
      className: r.class_name,
      languageId: r.language_id,
      dueAt: r.due_at,
      points: r.points,
      status,
      late: isLate(r.due_at, status, r.submitted_at, r.returned_at, now),
      grade: status === 'graded' ? r.grade : null,
    };
    return { item, gradedAt: r.graded_at ? Date.parse(r.graded_at) : 0 };
  });

  // Still to do (by due date, no due date last), then submitted (same order), then graded (most recent first).
  const group = (s: SubmissionStatus) => (s === 'graded' ? 2 : s === 'submitted' ? 1 : 0);
  items.sort((a, b) => {
    const g = group(a.item.status) - group(b.item.status);
    if (g !== 0) return g;
    if (a.item.status === 'graded') return b.gradedAt - a.gradedAt || b.item.assignmentId - a.item.assignmentId;
    const da = dueKey(a.item.dueAt);
    const dbk = dueKey(b.item.dueAt);
    if (da !== dbk) return da < dbk ? -1 : 1;
    return b.item.assignmentId - a.item.assignmentId;
  });
  const assignments = items.map((i) => i.item);

  const weekAhead = now + 7 * DAY_MS;
  const dueSoonCount = assignments.filter((a) => {
    if (!a.dueAt || a.status === 'submitted' || a.status === 'graded') return false;
    const due = Date.parse(a.dueAt);
    return due >= now && due <= weekAhead;
  }).length;

  return {
    role: 'student',
    stats: {
      classCount: classes.length,
      dueSoonCount,
      lateCount: assignments.filter((a) => a.late).length,
      gradedCount: assignments.filter((a) => a.status === 'graded').length,
    },
    classes,
    assignments,
  };
}

router.get('/dashboard', requireAuth, (req, res) => {
  const user = currentUser(req);
  const body: DashboardResponse = isStaff(user) ? teacherDashboard(user) : studentDashboard(user);
  res.json(body);
});
