// Form model for the assignment editor: values, conversion to/from the API shape, and test helpers.

import {
  kindSupportsTests,
  type Assignment,
  type AssignmentInput,
  type CompareMode,
  type Language,
  type SolutionVisibility,
  type TestCase,
} from '@codeclass/shared';
import type { UseFormReturnType } from '@mantine/form';
import dayjs from 'dayjs';

export interface EditorValues {
  title: string;
  instructions: string;
  languageId: string | null;
  /** NumberInput yields '' while empty. */
  points: number | string;
  /** Local date-time as Mantine dates use it: "YYYY-MM-DD HH:mm:ss". */
  dueAt: string | null;
  allowLate: boolean;
  published: boolean;
  starterCode: string;
  compareMode: CompareMode;
  tests: TestCase[];
  /** Reference solution ('' = none). */
  solutionCode: string;
  solutionVisibility: SolutionVisibility;
}

export type EditorForm = UseFormReturnType<EditorValues>;

const PICKER_FORMAT = 'YYYY-MM-DD HH:mm:ss';

export function newTestId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `t-${random.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
}

export function emptyTest(): TestCase {
  return { id: newTestId(), name: '', input: '', expectedOutput: '', hidden: false, points: 1 };
}

export function initialValues(assignment: Assignment | null, defaultLanguage: Language | null): EditorValues {
  if (!assignment) {
    return {
      title: '',
      instructions: '',
      languageId: defaultLanguage?.id ?? null,
      points: 100,
      dueAt: null,
      allowLate: true,
      published: true,
      starterCode: defaultLanguage?.starterCode ?? '',
      compareMode: 'trim',
      tests: [],
      solutionCode: '',
      solutionVisibility: 'hidden',
    };
  }
  return {
    title: assignment.title,
    instructions: assignment.instructions,
    languageId: assignment.languageId,
    points: assignment.points,
    dueAt: assignment.dueAt ? dayjs(assignment.dueAt).format(PICKER_FORMAT) : null,
    allowLate: assignment.allowLate,
    published: assignment.published,
    starterCode: assignment.starterCode,
    compareMode: assignment.compareMode,
    tests: assignment.tests,
    solutionCode: assignment.solutionCode ?? '',
    solutionVisibility: assignment.solutionVisibility,
  };
}

/** The picker's local date-time as the API wants it: local time with its UTC offset, e.g. 2026-10-24T17:00:00+01:00. */
export function dueAtToApi(value: string | null): string | null {
  return value ? dayjs(value).format() : null;
}

function toNumber(value: number | string, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return value === '' || !Number.isFinite(n) ? fallback : n;
}

/** The request body for create/update. Tests are dropped for languages that can't have them. */
export function toInput(values: EditorValues, language: Pick<Language, 'kind'> | undefined): AssignmentInput {
  const withTests = language ? kindSupportsTests(language.kind) : true;
  return {
    title: values.title.trim(),
    instructions: values.instructions,
    languageId: values.languageId ?? '',
    starterCode: values.starterCode,
    dueAt: dueAtToApi(values.dueAt),
    points: Math.round(toNumber(values.points, 0)),
    published: values.published,
    allowLate: values.allowLate,
    compareMode: values.compareMode,
    tests: withTests
      ? values.tests.map((t) => ({
          id: t.id,
          name: t.name.trim(),
          input: t.input,
          expectedOutput: t.expectedOutput,
          hidden: t.hidden,
          points: toNumber(t.points, 1),
        }))
      : [],
    // Whitespace alone is no solution.
    solutionCode: values.solutionCode.trim() ? values.solutionCode : '',
    solutionVisibility: values.solutionVisibility,
  };
}

/** Students only see an `after_due` solution once the due date passes, so it needs one (the server says the same). */
export function validateSolutionVisibility(visibility: SolutionVisibility, dueAt: string | null): string | null {
  return visibility === 'after_due' && !dueAt ? 'This needs a due date. Set one above, or choose another option.' : null;
}

/** Stable fingerprint used to detect unsaved changes. */
export function fingerprint(values: EditorValues): string {
  return JSON.stringify(toInput(values, undefined));
}

/** Expected output from a program's stdout: a single trailing newline is dropped unless matching is exact. */
export function expectedFromOutput(stdout: string, compareMode: CompareMode): string {
  return compareMode === 'exact' ? stdout : stdout.replace(/\r?\n$/, '');
}
