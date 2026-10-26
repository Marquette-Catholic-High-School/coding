import { describe, expect, it } from 'vitest';
import { gradeCellTarget, gradeToSave, noPinnedRows, pinnedOn, pinRow } from './inlineGrade';

describe('gradeToSave', () => {
  it('saves a new grade, rounded to 1 decimal', () => {
    expect(gradeToSave(8, null, 10)).toBe(8);
    expect(gradeToSave('7.5', 8, 10)).toBe(7.5);
    expect(gradeToSave(6.25, null, 10)).toBe(6.3);
    expect(gradeToSave(0, null, 10)).toBe(0);
  });

  it("doesn't save an unchanged grade", () => {
    expect(gradeToSave(8, 8, 10)).toBeNull();
    expect(gradeToSave('8.0', 8, 10)).toBeNull();
  });

  it("doesn't save an empty input (the grade stays as it was)", () => {
    expect(gradeToSave('', 8, 10)).toBeNull();
    expect(gradeToSave('  ', null, 10)).toBeNull();
  });

  it("doesn't save something that isn't a grade for this assignment", () => {
    expect(gradeToSave('abc', null, 10)).toBeNull();
    expect(gradeToSave(-1, null, 10)).toBeNull();
    expect(gradeToSave(10.5, null, 10)).toBeNull();
  });
});

describe('gradeCellTarget', () => {
  it('moves down a row on Enter, and leaves the last row (saving it)', () => {
    expect(gradeCellTarget('Enter', 0, 3)).toBe(1);
    expect(gradeCellTarget('Enter', 2, 3)).toBe('leave');
  });

  it('moves between rows with the arrow keys instead of changing the grade', () => {
    expect(gradeCellTarget('ArrowDown', 1, 3)).toBe(2);
    expect(gradeCellTarget('ArrowUp', 1, 3)).toBe(0);
    // At the ends the key does nothing, rather than stepping the grade (an empty grade would become 0).
    expect(gradeCellTarget('ArrowDown', 2, 3)).toBe('stay');
    expect(gradeCellTarget('ArrowUp', 0, 3)).toBe('stay');
  });

  it('leaves other keys alone', () => {
    expect(gradeCellTarget('7', 0, 3)).toBeNull();
    expect(gradeCellTarget('Tab', 0, 3)).toBeNull();
  });
});

describe('pinned rows', () => {
  it('keeps rows graded on a tab listed there', () => {
    let pinned = noPinnedRows<string>('to-grade');
    pinned = pinRow(pinned, 'to-grade', 1);
    pinned = pinRow(pinned, 'to-grade', 2);
    expect([...pinnedOn(pinned, 'to-grade').ids]).toEqual([1, 2]);
    expect(pinRow(pinned, 'to-grade', 2)).toBe(pinned);
  });

  it('forgets them once the tab changes, even when coming back to it', () => {
    let pinned = pinRow(noPinnedRows<string>('to-grade'), 'to-grade', 1);
    pinned = pinnedOn(pinned, 'all');
    expect(pinned.ids.size).toBe(0);
    pinned = pinnedOn(pinned, 'to-grade');
    expect(pinned.ids.size).toBe(0);
  });

  it('only pins on the tab the row was graded on', () => {
    const pinned = pinRow(pinRow(noPinnedRows<string>('to-grade'), 'to-grade', 1), 'missing', 4);
    expect(pinned).toEqual({ tab: 'missing', ids: new Set([4]) });
  });
});
