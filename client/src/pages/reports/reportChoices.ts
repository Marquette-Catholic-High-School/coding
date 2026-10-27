// The choices on the Reports page and in the "Download report" dialog: classes and students from
// GET /api/reports/options as Select options, and which report to make.

import type { ReportClassOption, ReportStudentOption } from '@codeclass/shared';

export interface SelectItem {
  value: string;
  label: string;
}

/** An option card in a report choice (ReportFields.tsx). */
export interface ReportChoiceOption<T extends string> {
  value: T;
  label: string;
  description: string;
  disabled?: boolean;
}

/** The student report's "every class" choice. */
export const ALL_CLASSES = 'all';

export function classOptionLabel(cls: Pick<ReportClassOption, 'name' | 'archived'>): string {
  return cls.archived ? `${cls.name} (archived)` : cls.name;
}

export function classSelectData(classes: ReportClassOption[]): SelectItem[] {
  return classes.map((c) => ({ value: String(c.id), label: classOptionLabel(c) }));
}

export function studentCountLabel(count: number): string {
  return count === 1 ? '1 student' : `${count.toLocaleString()} students`;
}

/** The line under a class in the picker: its teacher (when the viewer sees other teachers' classes) and its size. */
export function classOptionDetail(cls: Pick<ReportClassOption, 'teacherName' | 'studentCount'>, showTeacher: boolean): string {
  return showTeacher ? `${cls.teacherName} · ${studentCountLabel(cls.studentCount)}` : studentCountLabel(cls.studentCount);
}

/** Name and username, so the picker finds a student by either. */
export function studentOptionLabel(student: Pick<ReportStudentOption, 'name' | 'username'>): string {
  return `${student.name} (@${student.username})`;
}

export function studentSelectData(students: ReportStudentOption[]): SelectItem[] {
  return students.map((s) => ({ value: String(s.id), label: studentOptionLabel(s) }));
}

/** A teacher's student reports cover only their own classes; an admin's cover every class. */
export function allClassesLabel(isAdmin: boolean): string {
  return isAdmin ? 'All classes' : 'All your classes';
}

/** The classes a student report can cover: all of them, or one of the student's classes (in the options' order). */
export function studentClassData(
  student: Pick<ReportStudentOption, 'classIds'> | undefined,
  classes: ReportClassOption[],
  isAdmin: boolean,
): SelectItem[] {
  const byId = new Map(classes.map((c) => [c.id, c]));
  const own = (student?.classIds ?? []).flatMap((id) => {
    const cls = byId.get(id);
    return cls ? [{ value: String(id), label: classOptionLabel(cls) }] : [];
  });
  return [{ value: ALL_CLASSES, label: allClassesLabel(isAdmin) }, ...own];
}

/** A student report from a class's page: just that class, or all the student's classes the viewer can see. */
export type StudentReportScope = 'class' | 'all';

export function studentScopeChoices(className: string, isAdmin: boolean): ReportChoiceOption<StudentReportScope>[] {
  return [
    { value: 'class', label: 'This class', description: `Only ${className}.` },
    {
      value: 'all',
      label: allClassesLabel(isAdmin),
      description: isAdmin ? "Every class they're in." : "Every one of your classes they're in.",
    },
  ];
}

/** What a class's download can be. */
export type ClassReportKind = 'class' | 'class-students';

/** The class download choices; "Student reports" is only offered when the class has students. */
export function classReportChoices(studentCount: number | undefined): ReportChoiceOption<ClassReportKind>[] {
  const noStudents = studentCount === 0;
  return [
    { value: 'class', label: 'Class report', description: 'Summary, assignments, students and every grade.' },
    {
      value: 'class-students',
      label: 'Student reports',
      description: noStudents
        ? 'This class has no students yet.'
        : 'One report per student, each on its own pages, with their grades and autograde results.',
      disabled: noStudents,
    },
  ];
}

/** The chosen class download, or the class report when the class has no students to make student reports for. */
export function effectiveClassReportKind(kind: ClassReportKind, studentCount: number | undefined): ClassReportKind {
  return kind === 'class-students' && studentCount === 0 ? 'class' : kind;
}

/** The note under a student report choice: what's in it, and what isn't. */
export const STUDENT_REPORT_CONTENTS =
  'Grades, autograde results (auto score and tests passed), and late and missing work for each assignment. Teacher feedback and code are not included.';
