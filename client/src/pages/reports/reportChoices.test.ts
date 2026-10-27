import type { ReportClassOption } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import {
  ALL_CLASSES,
  classOptionDetail,
  classReportChoices,
  classSelectData,
  effectiveClassReportKind,
  studentClassData,
  studentScopeChoices,
  studentSelectData,
} from './reportChoices';

const classes: ReportClassOption[] = [
  { id: 3, name: 'Year 8 Computing', teacherName: 'Ms Rivera', archived: false, studentCount: 24 },
  { id: 1, name: 'Robotics Club', teacherName: 'Mr Okafor', archived: false, studentCount: 1 },
  { id: 7, name: 'Year 7 Computing 2025', teacherName: 'Ms Rivera', archived: true, studentCount: 1500 },
];

describe('class options', () => {
  it('marks archived classes and keeps the order', () => {
    expect(classSelectData(classes)).toEqual([
      { value: '3', label: 'Year 8 Computing' },
      { value: '1', label: 'Robotics Club' },
      { value: '7', label: 'Year 7 Computing 2025 (archived)' },
    ]);
  });

  it('describes a class by its size, and by its teacher for admins', () => {
    expect(classOptionDetail(classes[0]!, false)).toBe('24 students');
    expect(classOptionDetail(classes[1]!, true)).toBe('Mr Okafor · 1 student');
    expect(classOptionDetail(classes[2]!, true)).toBe(`Ms Rivera · ${(1500).toLocaleString()} students`);
  });
});

describe('student options', () => {
  it('shows the username so either finds the student', () => {
    expect(studentSelectData([{ id: 5, name: 'Zoë Ng', username: 'zng', classIds: [3] }])).toEqual([
      { value: '5', label: 'Zoë Ng (@zng)' },
    ]);
  });

  it("offers all classes, then each of the student's classes in the options' order", () => {
    const student = { classIds: [3, 7] };
    expect(studentClassData(student, classes, false)).toEqual([
      { value: ALL_CLASSES, label: 'All your classes' },
      { value: '3', label: 'Year 8 Computing' },
      { value: '7', label: 'Year 7 Computing 2025 (archived)' },
    ]);
    expect(studentClassData(student, classes, true)[0]).toEqual({ value: ALL_CLASSES, label: 'All classes' });
  });

  it('offers just "all" before a student is chosen, and skips classes missing from the options', () => {
    expect(studentClassData(undefined, classes, false)).toEqual([{ value: ALL_CLASSES, label: 'All your classes' }]);
    expect(studentClassData({ classIds: [99, 1] }, classes, false).map((o) => o.value)).toEqual([ALL_CLASSES, '1']);
  });

  it('words the class-page choice for teachers and admins', () => {
    expect(studentScopeChoices('Robotics Club', false).map((o) => [o.value, o.label])).toEqual([
      ['class', 'This class'],
      ['all', 'All your classes'],
    ]);
    expect(studentScopeChoices('Robotics Club', false)[0]!.description).toContain('Robotics Club');
    expect(studentScopeChoices('Robotics Club', true)[1]!.label).toBe('All classes');
  });
});

describe('class report kinds', () => {
  it('offers student reports only for a class with students', () => {
    expect(classReportChoices(24).map((o) => [o.value, !!o.disabled])).toEqual([
      ['class', false],
      ['class-students', false],
    ]);
    expect(classReportChoices(undefined)[1]!.disabled).toBe(false); // no class chosen yet
    expect(classReportChoices(0)[1]!.disabled).toBe(true);
    expect(effectiveClassReportKind('class-students', 0)).toBe('class');
    expect(effectiveClassReportKind('class-students', 3)).toBe('class-students');
    expect(effectiveClassReportKind('class-students', undefined)).toBe('class-students');
    expect(effectiveClassReportKind('class', 0)).toBe('class');
  });
});
