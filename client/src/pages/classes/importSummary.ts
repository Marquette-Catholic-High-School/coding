// Wording and totals for the "Import from spreadsheet" preview and result.

import type { InviteOutcome } from '@codeclass/shared';

/** Rows that are left out of the import (shown under "Skipped" in the preview). */
const SKIPPED: ReadonlySet<InviteOutcome> = new Set(['not_a_student', 'invalid', 'duplicate']);

export function isSkipped(outcome: InviteOutcome): boolean {
  return SKIPPED.has(outcome);
}

export interface ImportTotals {
  /** Existing student accounts added to the class now. */
  addedNow: number;
  /** Emails without an account yet: they join when they sign up. */
  joinLater: number;
  /** Already in the class or already invited — nothing to do. */
  already: number;
  /** Teacher/admin accounts, things that aren't emails, and repeats. */
  skipped: number;
  /** Students the import adds or invites (`addedNow + joinLater`). */
  importable: number;
}

export function importTotals(counts: Partial<Record<InviteOutcome, number>>): ImportTotals {
  const n = (outcome: InviteOutcome) => counts[outcome] ?? 0;
  const addedNow = n('enrolled');
  const joinLater = n('invited');
  return {
    addedNow,
    joinLater,
    already: n('already_enrolled') + n('already_invited'),
    skipped: n('not_a_student') + n('invalid') + n('duplicate'),
    importable: addedNow + joinLater,
  };
}

/** "Import 1 student" / "Import 22 students". */
export function importButtonLabel(count: number): string {
  return `Import ${count.toLocaleString('en-US')} ${count === 1 ? 'student' : 'students'}`;
}

/** Success message after a real import: "4 added now, 18 will join when they sign up." */
export function importResultMessage(counts: Partial<Record<InviteOutcome, number>>): string {
  const { addedNow, joinLater } = importTotals(counts);
  const parts = [
    addedNow > 0 ? `${addedNow.toLocaleString('en-US')} added now` : null,
    joinLater > 0 ? `${joinLater.toLocaleString('en-US')} will join when they sign up` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `${parts.join(', ')}.` : 'Everyone on the list was already in the class or invited.';
}
