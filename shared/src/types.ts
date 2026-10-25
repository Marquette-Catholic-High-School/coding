// Domain types shared by server and client. Dates are ISO-8601 strings (UTC).

import type { PseudocodeConfig } from './pseudocode/types';

export type Role = 'admin' | 'teacher' | 'student';

export interface User {
  id: number;
  username: string;
  email: string | null;
  name: string;
  role: Role;
  /** True after an admin/teacher set a temporary password; the UI nags until it is changed. */
  mustChangePassword: boolean;
  createdAt: string;
}

/** Admin user list row. */
export interface UserWithStats extends User {
  classCount: number;
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export type LanguageKind = 'javascript' | 'typescript' | 'python' | 'lua' | 'sql' | 'web' | 'pseudocode';

/** An installed language. Built-in packs have `ownerId === null`; pseudocode languages are owned by their creator. */
export interface Language {
  /** Slug, e.g. "python" or "pseudo-year-7". */
  id: string;
  kind: LanguageKind;
  name: string;
  description: string;
  /** Runtime version label, e.g. "Python 3.14 (Pyodide 314.0.7)". */
  version: string;
  /** Disabled languages stay installed but cannot be picked for new classes/assignments/projects. */
  enabled: boolean;
  /** Default code for a new file in this language. */
  starterCode: string;
  /** Only for kind === 'pseudocode'. */
  pseudocode: PseudocodeConfig | null;
  ownerId: number | null;
  ownerName: string | null;
  /** Whether the current viewer may edit/uninstall this language. */
  canEdit: boolean;
  /** Number of assignments that use this language (uninstall is blocked while > 0). */
  assignmentCount: number;
  installedAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export interface ClassSummary {
  id: number;
  name: string;
  description: string;
  /** Null when the viewer is a student. */
  joinCode: string | null;
  joinEnabled: boolean;
  archived: boolean;
  ownerId: number;
  ownerName: string;
  studentCount: number;
  assignmentCount: number;
  /** Languages enabled for this class. */
  languageIds: string[];
  createdAt: string;
}

export interface RosterStudent {
  id: number;
  name: string;
  username: string;
  email: string | null;
  mustChangePassword: boolean;
  joinedAt: string;
  submittedCount: number;
  lateCount: number;
  /** Average of graded percentages (0–100) or null when nothing is graded. */
  averagePercent: number | null;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export type CompareMode = 'exact' | 'trim' | 'ignore-whitespace' | 'ignore-case';

export interface TestCase {
  /** Client-generated stable id (e.g. nanoid-ish). */
  id: string;
  name: string;
  /** Program input, one line per `INPUT`/`input()` call. */
  input: string;
  expectedOutput: string;
  /** Hidden tests are never sent to students; teachers run them while grading. */
  hidden: boolean;
  /** Relative weight of this test in the auto-score. */
  points: number;
}

/**
 * When students may see an assignment's solution:
 * - `hidden`: never (teachers only);
 * - `after_due`: once the due date has passed; while late work is still accepted, only to students who have handed in;
 * - `after_graded`: once the student's own work is graded;
 * - `visible`: always.
 */
export type SolutionVisibility = 'hidden' | 'after_due' | 'after_graded' | 'visible';

export interface Assignment {
  id: number;
  classId: number;
  title: string;
  /** Markdown. */
  instructions: string;
  languageId: string;
  starterCode: string;
  dueAt: string | null;
  points: number;
  published: boolean;
  allowLate: boolean;
  /** For students only visible (non-hidden) tests are included. */
  tests: TestCase[];
  /** Number of hidden tests (lets students know more tests exist). */
  hiddenTestCount: number;
  compareMode: CompareMode;
  /**
   * The teacher's reference solution ('' when there is none). Students get it only once it is released to them
   * (see `solutionReleased` in shared/src/solutions.ts); until then it is null.
   */
  solutionCode: string | null;
  solutionVisibility: SolutionVisibility;
  /** Whether the assignment has a solution at all, so students can be told when they'll see it. */
  hasSolution: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SubmissionStatus = 'not_started' | 'in_progress' | 'submitted' | 'graded';

export interface TestResult {
  testId: string;
  passed: boolean;
  actualOutput: string;
  error: string | null;
  durationMs: number;
}

export interface Submission {
  /** Null when the student has not opened the assignment yet (status 'not_started'). */
  id: number | null;
  assignmentId: number;
  studentId: number;
  code: string;
  status: SubmissionStatus;
  submittedAt: string | null;
  updatedAt: string | null;
  testResults: TestResult[] | null;
  /** Percentage 0–100 of weighted tests passed, or null if never run. */
  autoScore: number | null;
  /** Points awarded by the teacher (0..assignment.points) or null if not graded. */
  grade: number | null;
  feedback: string | null;
  gradedAt: string | null;
  /**
   * When the teacher last returned the work for revision (stays set after the student hands it in again), or null.
   * Returned work can be handed in after the due date even when late work is off, and is never late.
   */
  returnedAt: string | null;
  /** Submitted after the due date, or not submitted and the due date has passed (never for returned work). */
  late: boolean;
}

/** Teacher list row: one per enrolled student for an assignment list. */
export interface AssignmentListItem {
  id: number;
  classId: number;
  title: string;
  languageId: string;
  dueAt: string | null;
  points: number;
  published: boolean;
  createdAt: string;
  /** Teacher view: counts across the class. */
  submittedCount: number;
  gradedCount: number;
  lateCount: number;
  studentCount: number;
  /** Student view: this student's status (teacher view: null). */
  myStatus: SubmissionStatus | null;
  myLate: boolean;
  myGrade: number | null;
}

export interface SubmissionRow {
  student: { id: number; name: string; username: string };
  submission: Submission;
}

// ---------------------------------------------------------------------------
// Playground projects
// ---------------------------------------------------------------------------

export interface Project {
  id: number;
  ownerId: number;
  title: string;
  languageId: string;
  code: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface ToGradeItem {
  assignmentId: number;
  assignmentTitle: string;
  classId: number;
  className: string;
  student: { id: number; name: string };
  submittedAt: string;
  late: boolean;
}

export interface UpcomingItem {
  assignmentId: number;
  assignmentTitle: string;
  classId: number;
  className: string;
  dueAt: string;
  submittedCount: number;
  studentCount: number;
}

export interface TeacherDashboard {
  role: 'teacher' | 'admin';
  stats: { classCount: number; studentCount: number; toGradeCount: number; lateCount: number };
  toGrade: ToGradeItem[];
  upcoming: UpcomingItem[];
  classes: ClassSummary[];
}

export interface StudentAssignmentItem {
  assignmentId: number;
  title: string;
  classId: number;
  className: string;
  languageId: string;
  dueAt: string | null;
  points: number;
  status: SubmissionStatus;
  late: boolean;
  grade: number | null;
}

export interface StudentDashboard {
  role: 'student';
  stats: { classCount: number; dueSoonCount: number; lateCount: number; gradedCount: number };
  classes: ClassSummary[];
  /** Published assignments across all classes, soonest due first; graded ones last. */
  assignments: StudentAssignmentItem[];
}

export type Dashboard = TeacherDashboard | StudentDashboard;
