import type { Assignment } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { fingerprint, initialValues, toInput, validateSolutionVisibility } from './editorForm';

const assignment: Assignment = {
  id: 7,
  classId: 3,
  title: 'Times tables',
  instructions: '',
  languageId: 'python',
  starterCode: 'n = int(input())\n',
  dueAt: '2026-11-02T17:00:00.000Z',
  points: 10,
  published: true,
  allowLate: false,
  tests: [],
  hiddenTestCount: 0,
  compareMode: 'trim',
  solutionCode: 'n = int(input())\nfor i in range(1, 11):\n    print(n * i)\n',
  solutionVisibility: 'after_due',
  hasSolution: true,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

describe('solution fields', () => {
  it('start empty and teachers-only for a new assignment', () => {
    const values = initialValues(null, null);
    expect(values.solutionCode).toBe('');
    expect(values.solutionVisibility).toBe('hidden');
  });

  it('load from an existing assignment and round-trip to the request body', () => {
    const values = initialValues(assignment, null);
    expect(values.solutionCode).toBe(assignment.solutionCode);
    expect(values.solutionVisibility).toBe('after_due');
    const input = toInput(values, { kind: 'python' });
    expect(input.solutionCode).toBe(assignment.solutionCode);
    expect(input.solutionVisibility).toBe('after_due');
  });

  it('treat a null solution as none', () => {
    expect(initialValues({ ...assignment, solutionCode: null }, null).solutionCode).toBe('');
  });

  it('send whitespace alone as no solution', () => {
    const values = { ...initialValues(assignment, null), solutionCode: '  \n\t' };
    expect(toInput(values, { kind: 'python' }).solutionCode).toBe('');
  });

  it('keep the solution for kinds without tests', () => {
    const values = { ...initialValues(assignment, null), solutionCode: '<h1>Hi</h1>' };
    expect(toInput(values, { kind: 'web' }).solutionCode).toBe('<h1>Hi</h1>');
  });

  it('count as unsaved changes', () => {
    const values = initialValues(assignment, null);
    const saved = fingerprint(values);
    expect(fingerprint({ ...values, solutionCode: `${values.solutionCode}# done\n` })).not.toBe(saved);
    expect(fingerprint({ ...values, solutionVisibility: 'visible' })).not.toBe(saved);
    expect(fingerprint({ ...values })).toBe(saved);
  });
});

describe('validateSolutionVisibility', () => {
  it('needs a due date for "after the due date"', () => {
    expect(validateSolutionVisibility('after_due', null)).toMatch(/due date/);
    expect(validateSolutionVisibility('after_due', '2026-11-02 17:00:00')).toBeNull();
  });

  it('accepts the other options without a due date', () => {
    for (const visibility of ['hidden', 'after_graded', 'visible'] as const) {
      expect(validateSolutionVisibility(visibility, null)).toBeNull();
    }
  });
});
