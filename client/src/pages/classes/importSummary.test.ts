import type { InviteOutcome } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { importButtonLabel, importResultMessage, importTotals, isSkipped } from './importSummary';

const counts = (partial: Partial<Record<InviteOutcome, number>>): Record<InviteOutcome, number> => ({
  enrolled: 0,
  invited: 0,
  already_enrolled: 0,
  already_invited: 0,
  not_a_student: 0,
  invalid: 0,
  duplicate: 0,
  ...partial,
});

describe('importTotals', () => {
  it('groups outcomes into added now, join later, already there and skipped', () => {
    expect(
      importTotals(counts({ enrolled: 4, invited: 18, already_enrolled: 2, already_invited: 1, not_a_student: 1, invalid: 3, duplicate: 2 })),
    ).toEqual({ addedNow: 4, joinLater: 18, already: 3, skipped: 6, importable: 22 });
  });

  it('treats missing outcomes as zero', () => {
    expect(importTotals({ invited: 2 })).toEqual({ addedNow: 0, joinLater: 2, already: 0, skipped: 0, importable: 2 });
  });
});

describe('isSkipped', () => {
  it('is true only for rows the import leaves out', () => {
    expect(isSkipped('not_a_student')).toBe(true);
    expect(isSkipped('invalid')).toBe(true);
    expect(isSkipped('duplicate')).toBe(true);
    expect(isSkipped('enrolled')).toBe(false);
    expect(isSkipped('invited')).toBe(false);
    expect(isSkipped('already_enrolled')).toBe(false);
    expect(isSkipped('already_invited')).toBe(false);
  });
});

describe('importButtonLabel', () => {
  it('pluralizes and groups thousands', () => {
    expect(importButtonLabel(1)).toBe('Import 1 student');
    expect(importButtonLabel(22)).toBe('Import 22 students');
    expect(importButtonLabel(1000)).toBe('Import 1,000 students');
  });
});

describe('importResultMessage', () => {
  it('says who was added now and who joins later', () => {
    expect(importResultMessage(counts({ enrolled: 4, invited: 18, invalid: 2 }))).toBe('4 added now, 18 will join when they sign up.');
    expect(importResultMessage(counts({ enrolled: 1 }))).toBe('1 added now.');
    expect(importResultMessage(counts({ invited: 3, already_enrolled: 1 }))).toBe('3 will join when they sign up.');
  });

  it('explains an import that changed nothing', () => {
    expect(importResultMessage(counts({ already_enrolled: 2, already_invited: 1 }))).toBe(
      'Everyone on the list was already in the class or invited.',
    );
  });
});
