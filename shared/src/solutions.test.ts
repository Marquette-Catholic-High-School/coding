import { describe, expect, it } from 'vitest';
import { handingInRevealsSolution, solutionPendingNote, solutionReleased } from './solutions';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const PAST = '2026-10-20T12:00:00Z';
const FUTURE = '2026-11-01T12:00:00Z';

describe('solutionReleased', () => {
  it('never releases a missing or hidden solution', () => {
    expect(solutionReleased({ solutionVisibility: 'visible', dueAt: null, allowLate: true }, false, 'graded', NOW)).toBe(false);
    expect(solutionReleased({ solutionVisibility: 'hidden', dueAt: PAST, allowLate: false }, true, 'graded', NOW)).toBe(false);
  });

  it('releases a visible solution to everyone', () => {
    expect(solutionReleased({ solutionVisibility: 'visible', dueAt: null, allowLate: true }, true, 'not_started', NOW)).toBe(true);
  });

  it('releases after grading only to graded work', () => {
    const rules = { solutionVisibility: 'after_graded' as const, dueAt: null, allowLate: true };
    expect(solutionReleased(rules, true, 'submitted', NOW)).toBe(false);
    expect(solutionReleased(rules, true, 'in_progress', NOW)).toBe(false);
    expect(solutionReleased(rules, true, 'graded', NOW)).toBe(true);
  });

  it('releases after the due date, but only to students who handed in while late work is accepted', () => {
    const late = { solutionVisibility: 'after_due' as const, dueAt: PAST, allowLate: true };
    expect(solutionReleased(late, true, 'in_progress', NOW)).toBe(false);
    expect(solutionReleased(late, true, 'not_started', NOW)).toBe(false);
    expect(solutionReleased(late, true, 'submitted', NOW)).toBe(true);
    const closed = { ...late, allowLate: false };
    expect(solutionReleased(closed, true, 'not_started', NOW)).toBe(true);
    expect(solutionReleased({ ...late, dueAt: FUTURE }, true, 'graded', NOW)).toBe(false);
    expect(solutionReleased({ ...late, dueAt: null }, true, 'graded', NOW)).toBe(false);
  });
});

describe('solutionPendingNote', () => {
  it('explains when the solution will appear', () => {
    expect(solutionPendingNote({ solutionVisibility: 'after_due', dueAt: FUTURE, allowLate: true }, true, 'in_progress', NOW)).toMatch(/after the due date/);
    expect(solutionPendingNote({ solutionVisibility: 'after_due', dueAt: PAST, allowLate: true }, true, 'in_progress', NOW)).toMatch(/once you hand in/);
    expect(solutionPendingNote({ solutionVisibility: 'after_graded', dueAt: null, allowLate: true }, true, 'submitted', NOW)).toMatch(/graded/);
  });

  it('says nothing when there is no solution, it is hidden, or it is already released', () => {
    expect(solutionPendingNote({ solutionVisibility: 'after_due', dueAt: FUTURE, allowLate: true }, false, 'in_progress', NOW)).toBeNull();
    expect(solutionPendingNote({ solutionVisibility: 'hidden', dueAt: FUTURE, allowLate: true }, true, 'in_progress', NOW)).toBeNull();
    expect(solutionPendingNote({ solutionVisibility: 'visible', dueAt: null, allowLate: true }, true, 'in_progress', NOW)).toBeNull();
  });
});

describe('work that can still change never sees the solution after the due date', () => {
  const closed = { solutionVisibility: 'after_due' as const, dueAt: PAST, allowLate: false };
  const open = { ...closed, allowLate: true };

  it('keeps it from work returned for revision, which can be handed in again', () => {
    expect(solutionReleased(closed, true, 'in_progress', NOW, true)).toBe(false);
    expect(solutionReleased(closed, true, 'in_progress', NOW, false)).toBe(true);
    expect(solutionReleased(closed, true, 'submitted', NOW, true)).toBe(true);
    expect(solutionPendingNote(closed, true, 'in_progress', NOW, true)).toMatch(/once you hand in/);
  });

  it('says when handing in is what reveals it (so unsubmitting must be refused)', () => {
    expect(handingInRevealsSolution(open, true, NOW)).toBe(true);
    expect(handingInRevealsSolution(closed, true, NOW, true)).toBe(true);
    expect(handingInRevealsSolution(closed, true, NOW, false)).toBe(false);
    expect(handingInRevealsSolution({ ...open, dueAt: FUTURE }, true, NOW)).toBe(false);
    expect(handingInRevealsSolution({ ...open, solutionVisibility: 'after_graded' }, true, NOW)).toBe(false);
    expect(handingInRevealsSolution(open, false, NOW)).toBe(false);
  });
});
