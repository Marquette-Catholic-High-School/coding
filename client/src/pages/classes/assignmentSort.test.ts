import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_SORTS, DEFAULT_ASSIGNMENT_SORT, isAssignmentSort, parseStoredSort, sortAssignments } from './assignmentSort';

let nextId = 1;
function item(title: string, createdAt: string, dueAt: string | null = null, id = nextId++) {
  return { id, title, createdAt, dueAt };
}

const titlesOf = (list: { title: string }[]) => list.map((a) => a.title);

describe('sortAssignments', () => {
  const lesson10 = item('Lesson 10', '2026-09-20T10:00:00.000Z', '2026-09-27T23:59:00.000Z');
  const lesson2 = item('Lesson 2', '2026-09-03T10:00:00.000Z', null);
  const arrays = item('arrays', '2026-09-10T10:00:00.000Z', '2026-09-12T23:59:00.000Z');
  const emile = item('Émile’s quiz', '2026-09-01T10:00:00.000Z', '2026-09-30T23:59:00.000Z');
  const list = [lesson10, lesson2, arrays, emile];

  it('sorts by name with numbers in order, ignoring case and accents', () => {
    expect(titlesOf(sortAssignments(list, 'name'))).toEqual(['arrays', 'Émile’s quiz', 'Lesson 2', 'Lesson 10']);
  });

  it('sorts by date created, either way', () => {
    expect(titlesOf(sortAssignments(list, 'newest'))).toEqual(['Lesson 10', 'arrays', 'Lesson 2', 'Émile’s quiz']);
    expect(titlesOf(sortAssignments(list, 'oldest'))).toEqual(['Émile’s quiz', 'Lesson 2', 'arrays', 'Lesson 10']);
  });

  it('sorts by due date, earliest first, with no due date last', () => {
    const undated = item('Bonus', '2026-09-05T10:00:00.000Z', null);
    expect(titlesOf(sortAssignments([...list, undated], 'due'))).toEqual([
      'arrays',
      'Lesson 10',
      'Émile’s quiz',
      'Bonus',
      'Lesson 2',
    ]);
  });

  it('orders the same due date by name', () => {
    const due = '2026-10-01T23:59:00.000Z';
    const b = item('Beta', '2026-09-01T00:00:00.000Z', due);
    const a = item('alpha', '2026-09-02T00:00:00.000Z', due);
    expect(titlesOf(sortAssignments([b, a], 'due'))).toEqual(['alpha', 'Beta']);
  });

  it('keeps copies made at the same moment in creation (id) order', () => {
    const at = '2026-10-01T12:00:00.000Z';
    const first = item('Copy', at, null, 101);
    const second = item('Copy', at, null, 102);
    const third = item('Another', at, null, 103);
    expect(sortAssignments([third, first, second], 'oldest').map((a) => a.id)).toEqual([101, 102, 103]);
    expect(sortAssignments([first, third, second], 'newest').map((a) => a.id)).toEqual([103, 102, 101]);
    // Same title: still creation order.
    expect(sortAssignments([second, first], 'name').map((a) => a.id)).toEqual([101, 102]);
  });

  it('compares times, not text, so other ISO spellings sort correctly', () => {
    const early = item('Early', '2026-09-01T09:00:00Z');
    const late = item('Late', '2026-09-01T08:30:00.000-05:00'); // 13:30 UTC
    expect(titlesOf(sortAssignments([late, early], 'oldest'))).toEqual(['Early', 'Late']);
  });

  it('returns a new array and leaves the list alone', () => {
    const original = [...list];
    const sorted = sortAssignments(list, 'name');
    expect(sorted).not.toBe(list);
    expect(list).toEqual(original);
  });
});

describe('the stored choice', () => {
  it('knows its own values only', () => {
    for (const option of ASSIGNMENT_SORTS) expect(isAssignmentSort(option.value)).toBe(true);
    expect(isAssignmentSort('title')).toBe(false);
    expect(isAssignmentSort(null)).toBe(false);
  });

  it('reads a stored value, and falls back to the default for anything else', () => {
    expect(DEFAULT_ASSIGNMENT_SORT).toBe('name');
    expect(parseStoredSort('"due"')).toBe('due');
    expect(parseStoredSort('"newest"')).toBe('newest');
    expect(parseStoredSort(undefined)).toBe('name');
    expect(parseStoredSort('')).toBe('name');
    expect(parseStoredSort('due')).toBe('name'); // not JSON
    expect(parseStoredSort('"title"')).toBe('name');
    expect(parseStoredSort('42')).toBe('name');
  });
});
