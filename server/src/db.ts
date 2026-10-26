import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

// Row shapes exactly as stored (snake_case, 0/1 booleans, JSON in TEXT columns).
export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  name: string;
  role: 'admin' | 'teacher' | 'student';
  password_hash: string;
  must_change_password: 0 | 1;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: number;
  /** The teacher or admin signed in as this student ("sign in as student"); null for a normal session. */
  impersonator_id: number | null;
  /**
   * For a student view: when the teacher's or admin's own session (the one it replaced) would have ended. Going back
   * to their account restores a session ending then, so going in and back never extends it. Null otherwise, and for
   * student views started before this column existed.
   */
  return_expires_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface LanguageRow {
  id: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  enabled: 0 | 1;
  starter_code: string;
  /** JSON PseudocodeConfig for pseudocode languages, else null. */
  config: string | null;
  owner_id: number | null;
  installed_at: string;
  updated_at: string;
}

export interface ClassRow {
  id: number;
  name: string;
  description: string;
  join_code: string;
  join_enabled: 0 | 1;
  archived: 0 | 1;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: number;
  class_id: number;
  title: string;
  instructions: string;
  language_id: string;
  starter_code: string;
  due_at: string | null;
  points: number;
  published: 0 | 1;
  allow_late: 0 | 1;
  /** JSON TestCase[] */
  tests: string;
  compare_mode: 'exact' | 'trim' | 'ignore-whitespace' | 'ignore-case';
  /** Reference solution ('' = none). */
  solution_code: string;
  solution_visibility: 'hidden' | 'after_due' | 'after_graded' | 'visible';
  created_at: string;
  updated_at: string;
}

export interface SubmissionDbRow {
  id: number;
  assignment_id: number;
  student_id: number;
  code: string;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
  /** JSON TestResult[] or null */
  test_results: string | null;
  auto_score: number | null;
  grade: number | null;
  /** 1 = the grade was set by autograde and hasn't been changed by hand since (always 0 without a grade). */
  auto_graded: 0 | 1;
  feedback: string | null;
  graded_at: string | null;
  graded_by: number | null;
  /** Set when the teacher returns the work for revision; cleared only when the teacher sets it back to submitted. */
  returned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: number;
  owner_id: number;
  title: string;
  language_id: string;
  code: string;
  created_at: string;
  updated_at: string;
}

/** An email a teacher added to a class; pending until claimed (claimed_at set) by a student account with that email. */
export interface ClassInviteRow {
  id: number;
  class_id: number;
  /** Lowercased; the column is COLLATE NOCASE. */
  email: string;
  name: string;
  invited_by: number | null;
  created_at: string;
  /** The student who joined through it (null while pending, or once that account is deleted). */
  claimed_by: number | null;
  claimed_at: string | null;
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
/** Column definition shared by SCHEMA and migrate(). */
const SOLUTION_VISIBILITY_COLUMN =
  "TEXT NOT NULL DEFAULT 'hidden' CHECK (solution_visibility IN ('hidden','after_due','after_graded','visible'))";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  return_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS languages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  starter_code TEXT NOT NULL DEFAULT '',
  config TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  installed_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  join_code TEXT NOT NULL UNIQUE,
  join_enabled INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS class_languages (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  language_id TEXT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, language_id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS enrollments_user ON enrollments(user_id);

-- Students invited by email (spreadsheet import). claimed_at stays set when the claiming account is deleted, so a
-- joined invite is never re-opened.
CREATE TABLE IF NOT EXISTS class_invites (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TEXT,
  UNIQUE (class_id, email)
);
CREATE INDEX IF NOT EXISTS class_invites_email ON class_invites(email);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  language_id TEXT NOT NULL REFERENCES languages(id),
  starter_code TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  points INTEGER NOT NULL DEFAULT 100,
  published INTEGER NOT NULL DEFAULT 1,
  allow_late INTEGER NOT NULL DEFAULT 1,
  tests TEXT NOT NULL DEFAULT '[]',
  compare_mode TEXT NOT NULL DEFAULT 'trim',
  solution_code TEXT NOT NULL DEFAULT '',
  solution_visibility ${SOLUTION_VISIBILITY_COLUMN},
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS assignments_class ON assignments(class_id);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  submitted_at TEXT,
  test_results TEXT,
  auto_score REAL,
  grade REAL,
  auto_graded INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,
  graded_at TEXT,
  graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  returned_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS submissions_student ON submissions(student_id);

-- language_id intentionally has no foreign key: uninstalling a language must not delete students' projects.
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language_id TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
`;

/** Brings databases created by older versions up to SCHEMA (CREATE TABLE IF NOT EXISTS never adds columns). */
export function migrate(db: Database.Database): void {
  const submissionColumns = db.prepare('PRAGMA table_info(submissions)').all() as { name: string }[];
  if (!submissionColumns.some((c) => c.name === 'returned_at')) {
    db.transaction(() => {
      db.exec('ALTER TABLE submissions ADD COLUMN returned_at TEXT');
      // Before returned_at existed, returning work left it in progress with the teacher's feedback (students can't
      // write feedback), so mark those rows as returned.
      db.exec("UPDATE submissions SET returned_at = updated_at WHERE status = 'in_progress' AND feedback IS NOT NULL");
    })();
  }
  // Grades that existed before auto_graded count as entered by the teacher.
  if (!submissionColumns.some((c) => c.name === 'auto_graded')) {
    db.exec('ALTER TABLE submissions ADD COLUMN auto_graded INTEGER NOT NULL DEFAULT 0');
  }
  const assignmentColumns = db.prepare('PRAGMA table_info(assignments)').all() as { name: string }[];
  if (!assignmentColumns.some((c) => c.name === 'solution_code')) {
    db.transaction(() => {
      db.exec("ALTER TABLE assignments ADD COLUMN solution_code TEXT NOT NULL DEFAULT ''");
      db.exec(`ALTER TABLE assignments ADD COLUMN solution_visibility ${SOLUTION_VISIBILITY_COLUMN}`);
    })();
  }
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (sessionColumns.length > 0) {
    if (!sessionColumns.some((c) => c.name === 'impersonator_id')) {
      db.exec('ALTER TABLE sessions ADD COLUMN impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
    }
    if (!sessionColumns.some((c) => c.name === 'return_expires_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN return_expires_at TEXT');
    }
    // Here rather than in SCHEMA, which runs before that column exists on older databases.
    db.exec('CREATE INDEX IF NOT EXISTS sessions_impersonator ON sessions(impersonator_id)');
  }
}

function open(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const db = open(config.dbPath);

/** Current time as an ISO string, matching the column defaults. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Parses a JSON column, returning `fallback` when null or malformed. */
export function parseJson<T>(text: string | null, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
