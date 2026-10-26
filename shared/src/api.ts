// HTTP API contract: request-body schemas (zod, used by the server to validate and by client forms) and
// response shapes. All routes are under /api. Errors are `ApiErrorBody` with a 4xx/5xx status.
//
// Auth: session cookie `sid` (httpOnly). Signed-in requests also send the readable `cc_csrf` cookie's value in an
// `x-codeclass-token` header (code runners in Web Workers can't read it). Roles: admin ⊇ teacher (admins can do
// everything teachers can, for every class); students only see classes they are enrolled in.

import { z } from 'zod';
import { pseudocodeConfigSchema } from './pseudocode/schema';
import type {
  Assignment,
  AssignmentListItem,
  ClassInvite,
  ClassSummary,
  Dashboard,
  InviteImportRow,
  InviteOutcome,
  Language,
  Project,
  RosterStudent,
  Submission,
  SubmissionRow,
  User,
  UserWithStats,
} from './types';
import type { LanguagePack } from './languages';

export interface ApiErrorBody {
  error: {
    message: string;
    /** Field name → message, for 400 validation errors (field names match the request schema keys). */
    fieldErrors?: Record<string, string>;
    /**
     * Machine-readable reason, when the client must react to it. `csrf`: the request lacked the session's
     * `x-codeclass-token` (read from the `cc_csrf` cookie); the response re-sets that cookie and the client retries once.
     */
    code?: string;
  };
}

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(32, 'At most 32 characters')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dots, dashes and underscores only');
export const passwordSchema = z.string().min(8, 'At least 8 characters').max(200);
export const personNameSchema = z.string().trim().min(1, 'Required').max(80);
export const optionalEmailSchema = z
  .union([z.literal(''), z.email('Enter a valid email')])
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null));
export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Class codes are 6 letters/numbers');
export const languageIdSchema = z.string().trim().min(1).max(60);

// ---------------------------------------------------------------------------
// Setup & auth
// ---------------------------------------------------------------------------

/** GET /api/setup */
export interface SetupStatusResponse { needsSetup: boolean }

/** POST /api/setup — creates the first admin account (only while no users exist) and signs in. */
export const setupSchema = z.object({
  name: personNameSchema,
  username: usernameSchema,
  email: optionalEmailSchema,
  password: passwordSchema,
});
export type SetupInput = z.input<typeof setupSchema>;

/** POST /api/auth/login — `login` is a username or email. */
export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Required').max(254, 'At most 254 characters'),
  password: z.string().min(1, 'Required').max(200, 'At most 200 characters'),
});
export type LoginInput = z.input<typeof loginSchema>;

/**
 * POST /api/auth/register — student self-registration. Needs a class code, or an email address a teacher invited
 * (then the student joins every class that invited it; with both, they join all of them).
 */
export const registerSchema = z
  .object({
    joinCode: joinCodeSchema.optional(),
    email: optionalEmailSchema,
    name: personNameSchema,
    username: usernameSchema,
    password: passwordSchema,
  })
  .refine((v) => v.joinCode || v.email, {
    message: 'Enter your class code, or the email address your teacher added',
    path: ['joinCode'],
  });
export type RegisterInput = z.input<typeof registerSchema>;

/** POST /api/auth/change-password */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

/** PATCH /api/auth/profile */
export const updateProfileSchema = z.object({
  name: personNameSchema,
  email: optionalEmailSchema,
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

/** GET /api/auth/me (401 when signed out), POST /api/setup, /login, /register, PATCH /profile */
export interface UserResponse {
  user: User;
  /** Register / profile update: classes just joined through email invitations or the class code. */
  joinedClasses?: { id: number; name: string }[];
}

/** GET /api/join/:code — public preview for the join page. 404 when the code is unknown. */
export interface JoinPreviewResponse { className: string; teacherName: string; joinEnabled: boolean }

export interface OkResponse { ok: true }

// ---------------------------------------------------------------------------
// Admin: users (admin only)
// ---------------------------------------------------------------------------

/** GET /api/admin/users?role=teacher|admin|student */
export interface UsersResponse { users: UserWithStats[] }

/** POST /api/admin/users — create a teacher/admin (or student) with a temporary password. */
export const createUserSchema = z.object({
  name: personNameSchema,
  username: usernameSchema,
  email: optionalEmailSchema,
  role: z.enum(['admin', 'teacher', 'student']),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

/** Returned when an account is created or a password reset by someone else. */
export interface TemporaryPasswordResponse { user: User; temporaryPassword: string }

/** PATCH /api/admin/users/:id — an admin cannot demote or delete themselves. */
export const updateUserSchema = z.object({
  name: personNameSchema.optional(),
  email: optionalEmailSchema.optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

// POST /api/admin/users/:id/reset-password → TemporaryPasswordResponse
// DELETE /api/admin/users/:id → OkResponse

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** GET /api/languages — teachers/admins: all installed; students: enabled only. */
export interface LanguagesResponse { languages: Language[] }

/** GET /api/languages/:id */
export interface LanguageResponse { language: Language }

/** GET /api/languages/catalog (teacher/admin) */
export interface CatalogResponse { packs: Array<LanguagePack & { installed: boolean }> }

/** POST /api/languages/install (admin) — install a built-in pack. 409 if already installed. */
export const installLanguageSchema = z.object({
  kind: z.enum(['javascript', 'typescript', 'python', 'lua', 'sql', 'web']),
});
export type InstallLanguageInput = z.input<typeof installLanguageSchema>;

/** POST /api/languages/pseudocode (teacher/admin) — create a pseudocode language from a preset (or copy of `copyFromId`). */
export const createPseudocodeSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(60),
  description: z.string().trim().max(500).default(''),
  presetId: z.string().trim().min(1).max(60).default('classroom'),
  copyFromId: languageIdSchema.optional(),
});
export type CreatePseudocodeInput = z.input<typeof createPseudocodeSchema>;

/** PATCH /api/languages/:id (admin, or the owner of a pseudocode language). */
export const updateLanguageSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(60).optional(),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
  starterCode: z.string().max(20000).optional(),
  pseudocode: pseudocodeConfigSchema.optional(),
});
export type UpdateLanguageInput = z.input<typeof updateLanguageSchema>;

// DELETE /api/languages/:id → OkResponse; 409 { message } when assignments use the language.

// ---------------------------------------------------------------------------
// Classes & roster
// ---------------------------------------------------------------------------

/** GET /api/classes?archived=1 — teacher: own classes (admin: all); student: enrolled classes. */
export interface ClassesResponse { classes: ClassSummary[] }

/** GET /api/classes/:id, POST /api/classes, PATCH /api/classes/:id, POST /api/classes/:id/regenerate-code, POST /api/classes/join */
export interface ClassResponse { class: ClassSummary }

export const createClassSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  description: z.string().trim().max(500).default(''),
  languageIds: z.array(languageIdSchema).max(50).default([]),
});
export type CreateClassInput = z.input<typeof createClassSchema>;

export const updateClassSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(80).optional(),
  description: z.string().trim().max(500).optional(),
  joinEnabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  languageIds: z.array(languageIdSchema).max(50).optional(),
});
export type UpdateClassInput = z.input<typeof updateClassSchema>;

/** POST /api/classes/join (student) */
export const joinClassSchema = z.object({ joinCode: joinCodeSchema });
export type JoinClassInput = z.input<typeof joinClassSchema>;

// DELETE /api/classes/:id → OkResponse (teacher owner/admin)

/** GET /api/classes/:id/students (teacher) */
export interface RosterResponse { students: RosterStudent[] }

/** POST /api/classes/:id/students (teacher) — create a student account (temporary password) and enroll it,
 *  or enroll an existing student when `username` matches an existing student account (temporaryPassword is then null). */
export const addStudentSchema = z.object({
  name: personNameSchema,
  username: usernameSchema,
});
export type AddStudentInput = z.input<typeof addStudentSchema>;
export interface AddStudentResponse { student: RosterStudent; temporaryPassword: string | null }

// DELETE /api/classes/:id/students/:userId → OkResponse (removes enrollment only)

/** GET /api/classes/:id/invites (staff) — pending first, then joined; newest first within each. */
export interface InvitesResponse { invites: ClassInvite[] }

export const inviteEntrySchema = z.object({
  email: z.string().trim().max(254),
  name: z.string().trim().max(80).default(''),
});

/**
 * POST /api/classes/:id/invites (staff) — add students by email (e.g. from a spreadsheet). Existing student accounts
 * with a matching email are enrolled now; other emails become pending invitations that are claimed when a student
 * signs up with (or changes their account to) that email. dryRun reports each row's outcome without changing anything.
 */
export const importInvitesSchema = z.object({
  entries: z.array(inviteEntrySchema).min(1, 'The list is empty').max(1000, 'At most 1,000 students at a time'),
  dryRun: z.boolean().default(false),
});
export type ImportInvitesInput = z.input<typeof importInvitesSchema>;
export interface InviteImportResponse {
  rows: InviteImportRow[];
  counts: Record<InviteOutcome, number>;
}

// DELETE /api/classes/:id/invites/:inviteId → OkResponse (a joined invite only loses its record; the student stays)
// POST /api/classes/:id/students/:userId/reset-password → TemporaryPasswordResponse (students only)

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const testCaseSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().max(80).default(''),
  input: z.string().max(20000).default(''),
  expectedOutput: z.string().max(20000),
  hidden: z.boolean().default(false),
  points: z.number().min(0).max(1000).default(1),
});

export const assignmentInputSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(120),
  instructions: z.string().max(50000).default(''),
  languageId: languageIdSchema,
  starterCode: z.string().max(50000).default(''),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  points: z.number().int().min(0).max(1000).default(100),
  published: z.boolean().default(true),
  allowLate: z.boolean().default(true),
  tests: z.array(testCaseSchema).max(50).default([]),
  compareMode: z.enum(['exact', 'trim', 'ignore-whitespace', 'ignore-case']).default('trim'),
  /** Reference solution (''= none). `after_due` needs a due date (400 fieldErrors.solutionVisibility). */
  solutionCode: z.string().max(50000).default(''),
  solutionVisibility: z.enum(['hidden', 'after_due', 'after_graded', 'visible']).default('hidden'),
});
export type AssignmentInput = z.input<typeof assignmentInputSchema>;
export const updateAssignmentSchema = assignmentInputSchema.partial();
export type UpdateAssignmentInput = z.input<typeof updateAssignmentSchema>;

/** GET /api/classes/:id/assignments — teacher: all with counts; student: published only with own status. */
export interface AssignmentsResponse { assignments: AssignmentListItem[] }

/**
 * GET /api/assignments/:id — students get hidden tests stripped and their own submission;
 * teachers get the full assignment and `submission: null`.
 * POST /api/classes/:id/assignments and PATCH /api/assignments/:id return the same shape.
 */
export interface AssignmentResponse {
  assignment: Assignment;
  class: { id: number; name: string };
  language: Language;
  submission: Submission | null;
}

// DELETE /api/assignments/:id → OkResponse

/**
 * POST /api/classes/:id/assignments/copy (staff) — copies assignments from any classes the caller manages (archived
 * ones included) into class :id, keeping order. Copies keep instructions, language, starter code, tests, points,
 * compare mode, late-work setting and the solution. Due dates are dropped unless keepDueDates (and a solution shown
 * "after the due date" then becomes "teachers only", reported in notes). Copies are drafts unless publish. A language
 * the class doesn't use yet is added to it when it is still installed and enabled; otherwise the assignment is
 * skipped. Copying within the same class appends " (copy)" to the title.
 */
export const copyAssignmentsSchema = z.object({
  assignmentIds: z.array(z.number().int().positive()).min(1, 'Pick at least one assignment').max(100),
  keepDueDates: z.boolean().default(false),
  publish: z.boolean().default(false),
});
export type CopyAssignmentsInput = z.input<typeof copyAssignmentsSchema>;
export interface CopyAssignmentsResponse {
  copied: { sourceId: number; id: number; title: string }[];
  /** Languages added to the class so the copies can use them. */
  addedLanguageIds: string[];
  skipped: { sourceId: number; title: string; reason: string }[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

/** GET /api/assignments/:id/submission (student) — returns a virtual not_started submission (code = starter code) if none exists. */
export interface SubmissionResponse { submission: Submission }

/** PUT /api/assignments/:id/submission (student autosave). 409 when already submitted or graded. */
export const saveSubmissionSchema = z.object({ code: z.string().max(200000) });
export type SaveSubmissionInput = z.input<typeof saveSubmissionSchema>;

export const testResultSchema = z.object({
  testId: z.string().min(1).max(40),
  passed: z.boolean(),
  actualOutput: z.string().max(50000),
  error: z.string().max(5000).nullable(),
  durationMs: z.number().min(0),
});

/** POST /api/assignments/:id/submit (student). 409 when past due and late work is not allowed, or already graded. */
export const submitSchema = z.object({
  code: z.string().max(200000),
  testResults: z.array(testResultSchema).max(50).nullable().default(null),
});
export type SubmitInput = z.input<typeof submitSchema>;

// POST /api/assignments/:id/unsubmit (student) → SubmissionResponse; 409 when graded.

/** GET /api/assignments/:id/submissions (teacher) — one row per enrolled student, name order. */
export interface SubmissionRowsResponse { rows: SubmissionRow[] }

/** GET /api/assignments/:id/submissions/:studentId (teacher) */
export interface SubmissionDetailResponse {
  assignment: Assignment;
  class: { id: number; name: string };
  language: Language;
  student: { id: number; name: string; username: string };
  submission: Submission;
  /** Neighbouring students (roster order) for prev/next navigation. */
  prevStudentId: number | null;
  nextStudentId: number | null;
}

/**
 * PATCH /api/assignments/:id/submissions/:studentId (teacher).
 * - `grade`/`feedback` set the grade; `status: 'graded'` marks graded (default when grade is provided).
 * - `status: 'in_progress'` returns the work to the student for revision (keeps feedback).
 * - `testResults` + `autoScore` store results of the teacher's test run (including hidden tests).
 */
export const gradeSubmissionSchema = z.object({
  grade: z.number().min(0).max(10000).nullable().optional(),
  feedback: z.string().max(20000).nullable().optional(),
  status: z.enum(['graded', 'in_progress', 'submitted']).optional(),
  testResults: z.array(testResultSchema).max(50).nullable().optional(),
  autoScore: z.number().min(0).max(100).nullable().optional(),
});
export type GradeSubmissionInput = z.input<typeof gradeSubmissionSchema>;

// ---------------------------------------------------------------------------
// Playground projects (any signed-in user; owner only)
// ---------------------------------------------------------------------------

/** GET /api/projects */
export interface ProjectsResponse { projects: Project[] }
/** GET/POST/PATCH /api/projects[/:id] */
export interface ProjectResponse { project: Project }

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(80),
  languageId: languageIdSchema,
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1, 'Required').max(80).optional(),
  code: z.string().max(200000).optional(),
});
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

// DELETE /api/projects/:id → OkResponse

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** GET /api/dashboard — shape depends on the viewer's role. */
export type DashboardResponse = Dashboard;
