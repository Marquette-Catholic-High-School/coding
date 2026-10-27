import { Modal } from '@mantine/core';
import { useState } from 'react';
import { ReportForm } from './ReportForm';

export interface ReportClassRef {
  id: number;
  name: string;
  /** When 0, "Student reports" isn't offered. */
  studentCount?: number;
}

export interface ReportStudentRef {
  id: number;
  name: string;
  username: string;
}

/** What the "Download report" dialog is for. */
export type ReportModalTarget =
  | { kind: 'class'; cls: ReportClassRef }
  /** With `cls`, offers "This class" or all the student's classes; without, it covers all of them. */
  | { kind: 'student'; student: ReportStudentRef; cls?: ReportClassRef };

function targetKey(target: ReportModalTarget): string {
  return target.kind === 'class' ? `class-${target.cls.id}` : `student-${target.student.id}-${target.cls?.id ?? 'all'}`;
}

/**
 * "Download report" for a class (class report or student reports) or a student: the choices, a date range and
 * "Download PDF". Render with `target = null` to keep it closed; it closes itself once the PDF is saved.
 */
export function ReportModal({ target, onClose }: { target: ReportModalTarget | null; onClose: () => void }) {
  // Keeps the last target on screen while the dialog closes.
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);

  return (
    <Modal opened={target !== null} onClose={onClose} title="Download report" size="md">
      {shown && <ReportForm key={targetKey(shown)} target={shown} onClose={onClose} />}
    </Modal>
  );
}
