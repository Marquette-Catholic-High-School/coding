// Grades typed straight into the assignment page's submissions table (GradeCell.tsx).

/**
 * The grade to save for what was typed in a grade cell (rounded to 1 decimal), or null when there's nothing to save:
 * the input is empty (a grade is removed with "Return for revision" on the grading page, not here), isn't a number,
 * is out of range, or is the grade the work already has.
 */
export function gradeToSave(typed: number | string, current: number | null, points: number): number | null {
  const n = typeof typed === 'number' ? typed : typed.trim() === '' ? Number.NaN : Number(typed);
  if (!Number.isFinite(n) || n < 0 || n > points) return null;
  const grade = Math.round(n * 10) / 10;
  return grade === current ? null : grade;
}

/**
 * Where a key in row `index` (of `count`) of the grade column sends focus, like moving down a spreadsheet: another
 * row's index, 'leave' (blur the input, which saves it), 'stay' (swallow the key), or null for a key that keeps its
 * usual meaning. Arrow keys only ever move between rows; they never step the grade up or down.
 */
export function gradeCellTarget(key: string, index: number, count: number): number | 'leave' | 'stay' | null {
  switch (key) {
    case 'Enter':
      return index + 1 < count ? index + 1 : 'leave';
    case 'ArrowDown':
      return index + 1 < count ? index + 1 : 'stay';
    case 'ArrowUp':
      return index > 0 ? index - 1 : 'stay';
    default:
      return null;
  }
}

/**
 * Rows the teacher is grading inline on a tab: they stay listed on that tab, even once they no longer match it
 * (graded work leaves "To grade"), until the tab changes.
 */
export interface PinnedRows<Tab> {
  tab: Tab;
  ids: ReadonlySet<number>;
}

const NO_IDS: ReadonlySet<number> = new Set();

export function noPinnedRows<Tab>(tab: Tab): PinnedRows<Tab> {
  return { tab, ids: NO_IDS };
}

/** The pinned rows on `tab`: rows pinned on another tab are forgotten (the same object when nothing changes). */
export function pinnedOn<Tab>(pinned: PinnedRows<Tab>, tab: Tab): PinnedRows<Tab> {
  return pinned.tab === tab ? pinned : noPinnedRows(tab);
}

/** Pins a row on `tab`. */
export function pinRow<Tab>(pinned: PinnedRows<Tab>, tab: Tab, id: number): PinnedRows<Tab> {
  const current = pinnedOn(pinned, tab);
  return current.ids.has(id) ? current : { tab, ids: new Set(current.ids).add(id) };
}
