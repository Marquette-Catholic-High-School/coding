import { Router } from 'express';
import {
  addStudentSchema,
  type AddStudentResponse,
  type OkResponse,
  type RosterResponse,
  type RosterStudent,
  type SubmissionStatus,
  type TemporaryPasswordResponse,
} from '@codeclass/shared';
import { isEnrolled, loadClassForStaff } from '../access';
import {
  currentUser,
  endOtherSessions,
  generateTemporaryPassword,
  hashPassword,
  inAnotherTeachersClass,
  requireStaff,
  teachesStudent,
} from '../auth';
import { db, type UserRow } from '../db';
import { conflict, forbidden, notFound, parseBody, parseId } from '../http';
import { isLate, toUser } from '../mappers';

export const router = Router();

interface EnrolledRow {
  id: number;
  name: string;
  username: string;
  email: string | null;
  must_change_password: 0 | 1;
  joined_at: string;
}

interface StatAssignmentRow {
  id: number;
  due_at: string | null;
  points: number;
  published: 0 | 1;
}

interface StatSubmissionRow {
  assignment_id: number;
  student_id: number;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
  returned_at: string | null;
  grade: number | null;
}

/** Enrolled students (name order) with their stats in this class; `onlyStudentId` limits it to one student. */
function rosterStudents(classId: number, onlyStudentId?: number): RosterStudent[] {
  const studentFilter = onlyStudentId === undefined ? '' : 'AND u.id = ?';
  const studentArgs = onlyStudentId === undefined ? [] : [onlyStudentId];
  const students = db
    .prepare(
      `SELECT u.id, u.name, u.username, u.email, u.must_change_password, e.joined_at
       FROM enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.class_id = ? ${studentFilter}
       ORDER BY u.name COLLATE NOCASE, u.id`,
    )
    .all(classId, ...studentArgs) as EnrolledRow[];
  if (students.length === 0) return [];

  const assignments = db
    .prepare('SELECT id, due_at, points, published FROM assignments WHERE class_id = ?')
    .all(classId) as StatAssignmentRow[];
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const published = assignments.filter((a) => a.published === 1);

  const submissions = db
    .prepare(
      `SELECT s.assignment_id, s.student_id, s.status, s.submitted_at, s.returned_at, s.grade
       FROM submissions s JOIN assignments a ON a.id = s.assignment_id
       WHERE a.class_id = ? ${onlyStudentId === undefined ? '' : 'AND s.student_id = ?'}`,
    )
    .all(classId, ...studentArgs) as StatSubmissionRow[];
  const byStudent = new Map<number, Map<number, StatSubmissionRow>>();
  for (const s of submissions) {
    let mine = byStudent.get(s.student_id);
    if (!mine) byStudent.set(s.student_id, (mine = new Map()));
    mine.set(s.assignment_id, s);
  }

  const now = Date.now();
  return students.map((u) => {
    const mine = byStudent.get(u.id) ?? new Map<number, StatSubmissionRow>();
    let submittedCount = 0;
    const percents: number[] = [];
    for (const s of mine.values()) {
      if (s.status === 'submitted' || s.status === 'graded') submittedCount += 1;
      const points = assignmentById.get(s.assignment_id)?.points ?? 0;
      if (s.status === 'graded' && s.grade != null && points > 0) percents.push((s.grade / points) * 100);
    }
    let lateCount = 0;
    for (const a of published) {
      const s = mine.get(a.id);
      const status: SubmissionStatus = s?.status ?? 'not_started';
      if (isLate(a.due_at, status, s?.submitted_at ?? null, s?.returned_at ?? null, now)) lateCount += 1;
    }
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      mustChangePassword: u.must_change_password === 1,
      joinedAt: u.joined_at,
      submittedCount,
      lateCount,
      averagePercent: percents.length ? percents.reduce((sum, p) => sum + p, 0) / percents.length : null,
    };
  });
}

router.get('/classes/:id/students', requireStaff, (req, res) => {
  const cls = loadClassForStaff(parseId(String(req.params.id)), currentUser(req));
  const body: RosterResponse = { students: rosterStudents(cls.id) };
  res.json(body);
});

router.post('/classes/:id/students', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  const input = parseBody(addStudentSchema, req.body);

  // usernames are COLLATE NOCASE, so this lookup is case-insensitive.
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username) as UserRow | undefined;
  let studentId: number;
  let temporaryPassword: string | null = null;
  // An existing student's email is only shown to staff who already teach them (or admins).
  let hideEmail = false;
  if (existing) {
    if (existing.role !== 'student') {
      const msg = `@${existing.username} is a staff account — choose a different username`;
      throw conflict(msg, { username: msg });
    }
    if (isEnrolled(cls.id, existing.id)) {
      const msg = `${existing.name} (@${existing.username}) is already in this class`;
      throw conflict(msg, { username: msg });
    }
    hideEmail = user.role !== 'admin' && !teachesStudent(user.id, existing.id);
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, existing.id);
    studentId = existing.id;
  } else {
    const password = generateTemporaryPassword();
    temporaryPassword = password;
    studentId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO users (username, name, role, password_hash, must_change_password) VALUES (?, ?, 'student', ?, 1)`,
        )
        .run(input.username, input.name, hashPassword(password));
      const id = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(cls.id, id);
      return id;
    })();
  }

  const [student] = rosterStudents(cls.id, studentId);
  const body: AddStudentResponse = { student: { ...student!, ...(hideEmail ? { email: null } : {}) }, temporaryPassword };
  res.status(201).json(body);
});

router.delete('/classes/:id/students/:userId', requireStaff, (req, res) => {
  const cls = loadClassForStaff(parseId(String(req.params.id)), currentUser(req));
  const studentId = parseId(String(req.params.userId));
  // Only the enrollment goes; the student's account and work are kept.
  const info = db.prepare('DELETE FROM enrollments WHERE class_id = ? AND user_id = ?').run(cls.id, studentId);
  if (info.changes === 0) throw notFound("That student isn't in this class");
  const body: OkResponse = { ok: true };
  res.json(body);
});

router.post('/classes/:id/students/:userId/reset-password', requireStaff, (req, res) => {
  const user = currentUser(req);
  const cls = loadClassForStaff(parseId(String(req.params.id)), user);
  const studentId = parseId(String(req.params.userId));
  const student = db
    .prepare('SELECT u.* FROM users u JOIN enrollments e ON e.user_id = u.id WHERE e.class_id = ? AND u.id = ?')
    .get(cls.id, studentId) as UserRow | undefined;
  if (!student) throw notFound("That student isn't in this class");
  if (student.role !== 'student') throw forbidden('You can only reset passwords for students');
  // One password guards all of a student's classes, so a teacher may only reset it when every class is theirs.
  if (user.role !== 'admin' && inAnotherTeachersClass(user.id, student.id)) {
    throw forbidden("This student is also in another teacher's class — ask an admin to reset their password");
  }

  const temporaryPassword = generateTemporaryPassword();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
      hashPassword(temporaryPassword),
      student.id,
    );
    endOtherSessions(student.id);
  })();
  const body: TemporaryPasswordResponse = {
    user: toUser({ ...student, must_change_password: 1 }),
    temporaryPassword,
  };
  res.json(body);
});
