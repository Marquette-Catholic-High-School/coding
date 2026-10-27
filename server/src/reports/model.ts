// What each PDF report shows: `data.ts` works these out from the database (after the route has checked access) and
// `pdf.ts` draws them. Dates are ISO strings; pdf.ts writes them in `ReportContext.timeZone`.
//
// Counting rules (the same in every report, and as on the Students tab and assignment pages, with one difference: the
// app's "late" badges also count missing work, while reports count it once, as Missing; so a badge's "late" equals a
// report's Late + Missing):
// - Only published assignments in the date range count (see `reportQuerySchema`); students are current students.
// - A piece of work is one (student, assignment) pair; `WorkStatus` says where it stands, decided as of
//   `ReportContext.generatedAt`.
// - Late: handed in after the due date (work returned for revision is never late). Missing: not handed in, not
//   returned, and the due date has passed. A grade on work that wasn't handed in (e.g. 0 for missing work) makes it
//   graded, not missing.
// - Percent: grade / points × 100 for graded work on assignments worth more than 0 points.
// - Average: the mean of the percents of the graded work in scope — each piece of graded work counts equally, so a
//   student's average is the mean of their graded assignments' percents. Null when nothing in scope is graded.

import type { PaperSize } from '@codeclass/shared';

/**
 * Where one student's work on one assignment stands:
 * - `graded`: it has a grade (status graded with a grade);
 * - `handed-in`: handed in and waiting to be graded;
 * - `returned`: sent back for revision and not handed in again;
 * - `missing`: not handed in, and the due date has passed;
 * - `not-handed-in`: not handed in, and not due yet (or no due date).
 */
export type WorkStatus = 'graded' | 'handed-in' | 'returned' | 'missing' | 'not-handed-in';

export interface ReportContext {
  /** "Class report", "Student report", "Student reports", "School report". */
  title: string;
  /** When the report was made; also "now" for deciding what is missing. */
  generatedAt: string;
  /** The name of the teacher or admin who downloaded it. */
  generatedBy: string;
  /** IANA time zone for every date and time in the PDF ('UTC' when the request didn't say). */
  timeZone: string;
  paper: PaperSize;
  /** The requested date range (null ends are open). */
  range: { from: string | null; to: string | null };
}

export interface ReportClass {
  id: number;
  name: string;
  teacherName: string;
  archived: boolean;
}

export interface ReportStudent {
  id: number;
  name: string;
  username: string;
}

export interface ReportAssignment {
  id: number;
  /** 1-based position in its class's list (due date, then created date, then title), used as the grade grid's key. */
  number: number;
  title: string;
  languageName: string;
  dueAt: string | null;
  createdAt: string;
  points: number;
  /** Tests including hidden ones. */
  testCount: number;
}

/** One student's work on one assignment. */
export interface WorkCell {
  status: WorkStatus;
  /** Handed in after the due date (see the counting rules). */
  late: boolean;
  /** Set when `status` is 'graded'. */
  grade: number | null;
  /** See the counting rules; null unless graded and the assignment is worth more than 0 points. */
  percent: number | null;
  /** When it was (last) handed in; null if never. */
  submittedAt: string | null;
  /** The stored auto score (0–100), if autograde or the student's own test run produced one. */
  autoScore: number | null;
  /** The grade was set by autograde. */
  autoGraded: boolean;
  /** From the stored test results: how many passed out of how many ran (null when none are stored). */
  testsPassed: number | null;
  testsRun: number | null;
}

/** Counts over some set of work (a student's, an assignment's, a class's, a teacher's or the school's). */
export interface WorkTotals {
  /** See the counting rules. */
  average: number | null;
  /** Pieces of work in scope (students × assignments). */
  workCount: number;
  /** Handed in or graded. */
  handedInCount: number;
  gradedCount: number;
  /** Handed in and waiting to be graded. */
  toGradeCount: number;
  lateCount: number;
  missingCount: number;
}

export interface ClassReportAssignment extends ReportAssignment {
  /** Over the class's students. */
  totals: WorkTotals;
}

export interface ClassReportStudent extends ReportStudent {
  /** Over the report's assignments. */
  totals: WorkTotals;
  /** One per assignment, in `ClassReport.assignments` order. */
  work: WorkCell[];
}

export interface ClassReport {
  kind: 'class';
  context: ReportContext;
  cls: ReportClass;
  /** In order (see `ReportAssignment.number`). */
  assignments: ClassReportAssignment[];
  /** By name. */
  students: ClassReportStudent[];
  totals: WorkTotals;
}

export interface StudentReportClass {
  cls: ReportClass;
  /** The student's work in this class. */
  totals: WorkTotals;
  /** One per assignment of the class in the range, in order. */
  rows: { assignment: ReportAssignment; work: WorkCell }[];
}

export interface StudentReport {
  kind: 'student';
  context: ReportContext;
  student: ReportStudent;
  /** Active classes first, then by name. Empty when the student is in none of the viewer's classes' ranges. */
  classes: StudentReportClass[];
  /** Over every class in the report. */
  totals: WorkTotals;
}

/** One student report per student of a class, in one PDF (each starts on a new page). */
export interface StudentReportSet {
  kind: 'students';
  context: ReportContext;
  cls: ReportClass;
  /** By student name; each covers only `cls`. */
  reports: StudentReport[];
}

export interface SchoolReportClass extends ReportClass {
  studentCount: number;
  assignmentCount: number;
  totals: WorkTotals;
}

export interface SchoolReportTeacher {
  id: number;
  name: string;
  classCount: number;
  /** Distinct students across their classes. */
  studentCount: number;
  assignmentCount: number;
  totals: WorkTotals;
}

/** A student with missing work in one class. */
export interface SchoolReportMissing {
  student: ReportStudent;
  cls: ReportClass;
  missingCount: number;
  lateCount: number;
  average: number | null;
}

export interface SchoolReport {
  kind: 'school';
  context: ReportContext;
  includesArchived: boolean;
  /** Distinct counts over the classes in the report. */
  classCount: number;
  teacherCount: number;
  studentCount: number;
  assignmentCount: number;
  totals: WorkTotals;
  /** By teacher name, then class name. */
  classes: SchoolReportClass[];
  /** Teachers who own at least one class in the report, by name. */
  teachers: SchoolReportTeacher[];
  /** Most missing first, then student name, then class name. Every student with at least one missing piece. */
  missingWork: SchoolReportMissing[];
}

export type Report = ClassReport | StudentReport | StudentReportSet | SchoolReport;
