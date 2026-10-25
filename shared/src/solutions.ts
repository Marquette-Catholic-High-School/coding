// When an assignment's solution is released to a student. Used by the server (to decide whether to send it) and by
// the client (to explain when it will be available).

import type { Assignment, SolutionVisibility, SubmissionStatus } from './types';

type SolutionRules = Pick<Assignment, 'dueAt' | 'allowLate' | 'solutionVisibility'>;

export const SOLUTION_VISIBILITY_LABELS: Record<SolutionVisibility, { label: string; description: string }> = {
  hidden: { label: 'Teachers only', description: 'Students never see the solution.' },
  after_due: {
    label: 'After the due date',
    description: 'Students see it once the due date has passed. While late work is still accepted, only students who have handed in see it.',
  },
  after_graded: { label: 'After grading', description: "Each student sees it once you've graded their work." },
  visible: { label: 'Now', description: 'Students can see the solution straight away.' },
};

const HANDED_IN: readonly SubmissionStatus[] = ['submitted', 'graded'];

/**
 * Whether a student whose work has `status` may see the solution (false when the assignment has none). `returned` is
 * true when the teacher returned the work for revision: such work can be handed in again even after the due date.
 *
 * After the due date the solution goes only to work that can't change any more: work that has been handed in (it then
 * can't be unsubmitted; see handingInRevealsSolution), or, when late work isn't accepted, work that can't be handed in.
 */
export function solutionReleased(
  rules: SolutionRules,
  hasSolution: boolean,
  status: SubmissionStatus,
  now: number = Date.now(),
  returned = false,
): boolean {
  if (!hasSolution) return false;
  switch (rules.solutionVisibility) {
    case 'visible':
      return true;
    case 'after_graded':
      return status === 'graded';
    case 'after_due':
      if (!rules.dueAt || now <= Date.parse(rules.dueAt)) return false;
      if (HANDED_IN.includes(status)) return true;
      return !rules.allowLate && !returned;
    case 'hidden':
    default:
      return false;
  }
}

/**
 * True when handing in releases the solution to this student (it isn't released to their open work, but would be to
 * handed-in work). Such work can't be unsubmitted afterwards, or the student could hand the solution in.
 */
export function handingInRevealsSolution(rules: SolutionRules, hasSolution: boolean, now: number = Date.now(), returned = false): boolean {
  return !solutionReleased(rules, hasSolution, 'in_progress', now, returned) && solutionReleased(rules, hasSolution, 'submitted', now, returned);
}

/** Student-facing sentence about a solution they can't see yet, or null when there's nothing to say. */
export function solutionPendingNote(
  rules: SolutionRules,
  hasSolution: boolean,
  status: SubmissionStatus,
  now: number = Date.now(),
  returned = false,
): string | null {
  if (!hasSolution || solutionReleased(rules, hasSolution, status, now, returned)) return null;
  switch (rules.solutionVisibility) {
    case 'after_graded':
      return "Your teacher's solution will appear here once your work is graded.";
    case 'after_due':
      if (rules.dueAt && now > Date.parse(rules.dueAt)) {
        return "You'll see your teacher's solution once you hand in your work (after that it can't be unsubmitted).";
      }
      return "Your teacher's solution will appear here after the due date.";
    default:
      return null;
  }
}
