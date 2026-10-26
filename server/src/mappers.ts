// Row → API object mappers and the SELECTs that produce the extra columns they need.

import {
  normalizePseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { solutionReleased } from '@codeclass/shared';
import type {
  Assignment,
  ClassSummary,
  Impersonator,
  Language,
  LanguageKind,
  Project,
  Submission,
  SubmissionStatus,
  TestCase,
  TestResult,
  User,
} from '@codeclass/shared';
import { parseJson, type AssignmentRow, type ClassRow, type LanguageRow, type ProjectRow, type SubmissionDbRow, type UserRow } from './db';

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

/** The teacher or admin signed in as a student. */
export function toImpersonator(user: User): Impersonator {
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

// --- Languages --------------------------------------------------------------------------------------

export type LanguageQueryRow = LanguageRow & { owner_name: string | null; assignment_count: number };

/** Append `WHERE …` / `ORDER BY …` as needed. */
export const LANGUAGE_SELECT = `
  SELECT l.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM assignments a WHERE a.language_id = l.id) AS assignment_count
  FROM languages l LEFT JOIN users u ON u.id = l.owner_id`;

export function canEditLanguage(row: Pick<LanguageRow, 'kind' | 'owner_id'>, viewer: User): boolean {
  return viewer.role === 'admin' || (row.kind === 'pseudocode' && row.owner_id === viewer.id);
}

export function toLanguage(row: LanguageQueryRow, viewer: User): Language {
  return {
    id: row.id,
    kind: row.kind as LanguageKind,
    name: row.name,
    description: row.description,
    version: row.version,
    enabled: row.enabled === 1,
    starterCode: row.starter_code,
    pseudocode: row.kind === 'pseudocode' ? normalizePseudocodeConfig(parseJson(row.config, null)) : null,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    canEdit: canEditLanguage(row, viewer),
    assignmentCount: row.assignment_count,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

// --- Classes ----------------------------------------------------------------------------------------

export type ClassQueryRow = ClassRow & {
  owner_name: string;
  student_count: number;
  assignment_count: number;
  published_count: number;
  /** Language ids joined with char(31), or null. */
  language_ids: string | null;
};

/** Append `WHERE …` / `ORDER BY …` as needed (table alias `c`). */
export const CLASS_SELECT = `
  SELECT c.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) AS student_count,
    (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id) AS assignment_count,
    (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id AND a.published = 1) AS published_count,
    (SELECT group_concat(cl.language_id, char(31)) FROM class_languages cl WHERE cl.class_id = c.id) AS language_ids
  FROM classes c JOIN users u ON u.id = c.owner_id`;

export function toClassSummary(row: ClassQueryRow, viewer: User): ClassSummary {
  const student = viewer.role === 'student';
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    joinCode: student ? null : row.join_code,
    joinEnabled: row.join_enabled === 1,
    archived: row.archived === 1,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    studentCount: row.student_count,
    assignmentCount: student ? row.published_count : row.assignment_count,
    languageIds: row.language_ids ? row.language_ids.split(String.fromCharCode(31)).sort() : [],
    createdAt: row.created_at,
  };
}

// --- Assignments & submissions ----------------------------------------------------------------------

export function parseTests(row: Pick<AssignmentRow, 'tests'>): TestCase[] {
  return parseJson<TestCase[]>(row.tests, []);
}

/**
 * Students never receive hidden tests, and get the solution only once `solutionReleased` allows it for their own
 * submission, so `ownSubmission` is required for students (staff pass null and always get the solution).
 */
export function toAssignment(
  row: AssignmentRow,
  viewer: User,
  ownSubmission: Pick<Submission, 'status' | 'returnedAt'> | null,
): Assignment {
  const student = viewer.role === 'student';
  if (student && !ownSubmission) throw new Error("A student's assignment needs their submission status");
  const tests = parseTests(row);
  const visible = student ? tests.filter((t) => !t.hidden) : tests;
  const rules = { dueAt: row.due_at, allowLate: row.allow_late === 1, solutionVisibility: row.solution_visibility };
  const hasSolution = row.solution_code.trim() !== '';
  const showSolution =
    !student || solutionReleased(rules, hasSolution, ownSubmission!.status, Date.now(), ownSubmission!.returnedAt != null);
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    instructions: row.instructions,
    languageId: row.language_id,
    starterCode: row.starter_code,
    dueAt: row.due_at,
    points: row.points,
    published: row.published === 1,
    allowLate: row.allow_late === 1,
    tests: visible,
    hiddenTestCount: tests.filter((t) => t.hidden).length,
    compareMode: row.compare_mode,
    solutionCode: showSolution ? row.solution_code : null,
    solutionVisibility: row.solution_visibility,
    hasSolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Late = submitted after the due date, or not (yet) submitted and the due date has passed. Work the teacher returned
 * for revision (`returnedAt` set) is never late, including once it has been handed in again and graded.
 */
export function isLate(
  dueAt: string | null,
  status: SubmissionStatus,
  submittedAt: string | null,
  returnedAt: string | null,
  now = Date.now(),
): boolean {
  if (!dueAt || returnedAt != null) return false;
  const due = Date.parse(dueAt);
  if (status === 'submitted' || status === 'graded') return submittedAt != null && Date.parse(submittedAt) > due;
  return now > due;
}

/** Maps a stored submission, or synthesizes a `not_started` one (code = starter code) when `row` is undefined. */
export function toSubmission(
  row: SubmissionDbRow | undefined,
  assignment: Pick<AssignmentRow, 'id' | 'due_at' | 'starter_code'>,
  studentId: number,
): Submission {
  if (!row) {
    return {
      id: null,
      assignmentId: assignment.id,
      studentId,
      code: assignment.starter_code,
      status: 'not_started',
      submittedAt: null,
      updatedAt: null,
      testResults: null,
      autoScore: null,
      grade: null,
      autoGraded: false,
      feedback: null,
      gradedAt: null,
      returnedAt: null,
      late: isLate(assignment.due_at, 'not_started', null, null),
    };
  }
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    studentId: row.student_id,
    code: row.code,
    status: row.status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    testResults: parseJson<TestResult[] | null>(row.test_results, null),
    autoScore: row.auto_score,
    grade: row.grade,
    autoGraded: row.auto_graded === 1 && row.grade != null,
    feedback: row.feedback,
    gradedAt: row.graded_at,
    returnedAt: row.returned_at,
    late: isLate(assignment.due_at, row.status, row.submitted_at, row.returned_at),
  };
}

/** Students only see results for visible tests (teacher autograde runs also store hidden-test results). */
export function hideHiddenTestResults(submission: Submission, assignment: Pick<AssignmentRow, 'tests'>): Submission {
  if (!submission.testResults) return submission;
  const visible = new Set(parseTests(assignment).filter((t) => !t.hidden).map((t) => t.id));
  return { ...submission, testResults: submission.testResults.filter((r) => visible.has(r.testId)) };
}

// --- Projects ---------------------------------------------------------------------------------------

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    languageId: row.language_id,
    code: row.code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
