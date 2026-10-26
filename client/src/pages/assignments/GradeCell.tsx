import type { Submission } from '@codeclass/shared';
import { Group, Loader, NumberInput, Table, Text, Tooltip, VisuallyHidden } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type Ref } from 'react';
import { useGradeSubmission } from '../../api/assignments';
import { ApiError, queryKeys } from '../../api/client';
import { AutoGradedBadge } from '../../components/badges';
import { notifyError } from '../../components/notify';
import { gradeToSave } from './inlineGrade';

/**
 * The input has no label, description or error, so it sets its accessible name and description itself: without
 * this, Mantine replaces aria-describedby with its own (empty) one and the not-handed-in warning is never announced.
 * NumberInput passes `withAria` on to Mantine's Input, but its props type leaves it out.
 */
const OWN_ARIA = { withAria: false } as const;

/** Keys that move between the rows' grades (see `gradeCellTarget`). */
const MOVE_KEYS = new Set(['Enter', 'ArrowDown', 'ArrowUp']);

/**
 * Grade column of the submissions table: the grade as a small input that saves on blur. Enter saves and moves to the
 * next row, the arrow keys move between rows (they never change the grade), Escape puts the saved grade back.
 * Saving from here is the teacher's own grade.
 */
export function GradeCell({
  assignmentId,
  points,
  student,
  submission,
  inputRef,
  onMove,
  onEdit,
}: {
  assignmentId: number;
  points: number;
  student: { id: number; name: string };
  submission: Submission;
  inputRef: Ref<HTMLInputElement>;
  /** Enter or an arrow key: move focus on (the blur that follows saves this grade). */
  onMove: (key: string, input: HTMLInputElement) => void;
  /** The teacher started on this grade, so the row stays in view even once it stops matching the tab. */
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useGradeSubmission(assignmentId);
  // What the teacher is typing; null shows the saved grade.
  const [draft, setDraft] = useState<number | string | null>(null);
  const [saving, setSaving] = useState(false);
  // The version of the work the teacher saw when they started on this grade: if it changes while they type (the
  // student unsubmits, say), the save is refused rather than applied to work they haven't seen.
  const seenVersion = useRef<{ updatedAt: string | null } | null>(null);
  const warningId = useId();
  const handedIn = submission.status === 'submitted' || submission.status === 'graded';
  const warning = `Not handed in. Grading it (for example a 0 for missing work) stops ${student.name} editing it.`;

  const save = async (expectedUpdatedAt: string | null) => {
    if (saving || draft === null) return;
    const grade = gradeToSave(draft, submission.grade, points);
    if (grade === null) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      // Refused (409) if the work changed since the teacher looked at it, e.g. the student unsubmitted it.
      await mutation.mutateAsync({ studentId: student.id, grade, status: 'graded', expectedUpdatedAt });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submissions(assignmentId) });
        notifications.show({
          color: 'yellow',
          icon: <IconAlertTriangle size={18} />,
          title: 'Grade not saved',
          message: `${student.name}'s work changed since this page loaded, so the list has been refreshed. Check it and enter the grade again.`,
        });
      } else {
        notifyError(err, `Couldn't save ${student.name}'s grade`);
      }
    } finally {
      setSaving(false);
      setDraft(null);
    }
  };

  return (
    // The row opens the student's work on click; typing or clicking in here must not.
    <Table.Td onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} style={{ cursor: 'default' }}>
      <Group gap={6} wrap="nowrap">
        {/* Always the same elements, whatever the status: a refetch that changes it mustn't remount the input mid-edit. */}
        <Tooltip label={warning} disabled={handedIn} multiline maw={280} events={{ hover: true, focus: true, touch: false }}>
          <NumberInput
            ref={inputRef}
            size="xs"
            w={76}
            hideControls
            // Arrow keys move between rows (onKeyDown), so they must not step the grade (an empty one would become 0).
            withKeyboardEvents={false}
            min={0}
            max={points}
            clampBehavior="strict"
            allowNegative={false}
            decimalScale={1}
            selectAllOnFocus
            placeholder="—"
            {...OWN_ARIA}
            aria-label={`Grade for ${student.name}, out of ${points}`}
            aria-describedby={handedIn ? undefined : warningId}
            value={draft ?? submission.grade ?? ''}
            onChange={setDraft}
            onFocus={() => {
              seenVersion.current ??= { updatedAt: submission.updatedAt };
              onEdit();
            }}
            onBlur={() => {
              const seen = seenVersion.current;
              seenVersion.current = null;
              void save(seen ? seen.updatedAt : submission.updatedAt);
            }}
            onKeyDown={(event) => {
              if (MOVE_KEYS.has(event.key)) {
                event.preventDefault();
                onMove(event.key, event.currentTarget);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(null);
              }
            }}
            readOnly={saving}
            rightSection={saving ? <Loader size={12} /> : null}
          />
        </Tooltip>
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          / {points}
        </Text>
        {!handedIn && <VisuallyHidden id={warningId}>{warning}</VisuallyHidden>}
        {submission.autoGraded && draft === null && <AutoGradedBadge />}
      </Group>
    </Table.Td>
  );
}
