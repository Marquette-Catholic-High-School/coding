// The order a class's assignments are listed in (the teacher's Assignments tab, a student's class page and the copy
// dialog). Each browser remembers the last choice, for every class.

import type { AssignmentListItem } from '@codeclass/shared';
import { useLocalStorage } from '@mantine/hooks';

export const ASSIGNMENT_SORTS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'due', label: 'Due date' },
] as const;

export type AssignmentSort = (typeof ASSIGNMENT_SORTS)[number]['value'];

export const DEFAULT_ASSIGNMENT_SORT: AssignmentSort = 'name';

export function isAssignmentSort(value: unknown): value is AssignmentSort {
  return ASSIGNMENT_SORTS.some((option) => option.value === value);
}

type Sortable = Pick<AssignmentListItem, 'id' | 'title' | 'createdAt' | 'dueAt'>;

/** Case- and accent-insensitive, with numbers in order: "Lesson 2" before "Lesson 10". */
const titles = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Ids break ties in creation order: copies made together share a creation time.
const byName = (a: Sortable, b: Sortable) => titles.compare(a.title, b.title) || a.id - b.id;
const byCreated = (a: Sortable, b: Sortable) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id;
/** Earliest due first; no due date last. */
const byDue = (a: Sortable, b: Sortable) =>
  a.dueAt == null || b.dueAt == null
    ? Number(a.dueAt == null) - Number(b.dueAt == null)
    : Date.parse(a.dueAt) - Date.parse(b.dueAt);

/** A sorted copy of `list`. */
export function sortAssignments<T extends Sortable>(list: readonly T[], sort: AssignmentSort): T[] {
  const sorted = [...list];
  switch (sort) {
    case 'name':
      return sorted.sort(byName);
    case 'newest':
      return sorted.sort((a, b) => byCreated(b, a));
    case 'oldest':
      return sorted.sort(byCreated);
    case 'due':
      return sorted.sort((a, b) => byDue(a, b) || byName(a, b));
  }
}

/** A stored choice, or the default when there is none or it isn't one of ours. */
export function parseStoredSort(raw: string | undefined): AssignmentSort {
  try {
    const value: unknown = raw == null ? null : JSON.parse(raw);
    return isAssignmentSort(value) ? value : DEFAULT_ASSIGNMENT_SORT;
  } catch {
    return DEFAULT_ASSIGNMENT_SORT;
  }
}

/** The remembered order (kept in step across the page and other tabs), and a setter that remembers a new one. */
export function useAssignmentSort() {
  return useLocalStorage<AssignmentSort>({
    key: 'codeclass.assignmentSort',
    defaultValue: DEFAULT_ASSIGNMENT_SORT,
    getInitialValueInEffect: false,
    deserialize: parseStoredSort,
  });
}
