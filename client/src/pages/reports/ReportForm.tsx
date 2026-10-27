import { Button, Group, Stack, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useCurrentUser } from '../../auth/AuthProvider';
import {
  classReportChoices,
  effectiveClassReportKind,
  STUDENT_REPORT_CONTENTS,
  studentScopeChoices,
  type ClassReportKind,
  type StudentReportScope,
} from './reportChoices';
import { ReportChoice, ReportDateRange } from './ReportFields';
import type { ReportModalTarget } from './ReportModal';
import { ALL_DATES, type DayRange, type ReportTarget } from './reportParams';
import { useReportDownload } from './useReportDownload';

/** The body of the "Download report" dialog (ReportModal.tsx). */
export function ReportForm({ target, onClose }: { target: ReportModalTarget; onClose: () => void }) {
  const user = useCurrentUser();
  const isAdmin = user.role === 'admin';
  const { download, isPending } = useReportDownload();
  const [classKind, setClassKind] = useState<ClassReportKind>('class');
  const [scope, setScope] = useState<StudentReportScope>('class');
  const [range, setRange] = useState<DayRange>(ALL_DATES);
  const kind = target.kind === 'class' ? effectiveClassReportKind(classKind, target.cls.studentCount) : null;

  const reportTarget = (): ReportTarget => {
    if (target.kind === 'class') return { kind: kind ?? 'class', classId: target.cls.id };
    return { kind: 'student', studentId: target.student.id, classId: target.cls && scope === 'class' ? target.cls.id : null };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    download(reportTarget(), range, onClose);
  };

  return (
    <form noValidate onSubmit={submit}>
      <Stack gap="md">
        {target.kind === 'class' ? (
          <>
            <Text size="sm">
              For <b>{target.cls.name}</b>.
            </Text>
            <ReportChoice
              label="What to download"
              value={kind ?? 'class'}
              options={classReportChoices(target.cls.studentCount)}
              onChange={setClassKind}
              autoFocus
            />
          </>
        ) : (
          <>
            <Text size="sm">
              For <b>{target.student.name}</b> (@{target.student.username}).
            </Text>
            {target.cls && (
              <ReportChoice
                label="Classes"
                value={scope}
                options={studentScopeChoices(target.cls.name, isAdmin)}
                onChange={setScope}
                autoFocus
              />
            )}
          </>
        )}
        {/* The first field gets focus when the dialog opens: the choice above, or the dates when there is none. */}
        <ReportDateRange value={range} onChange={setRange} autoFocus={target.kind === 'student' && !target.cls} />
        {kind !== 'class' && (
          <Text size="xs" c="dimmed">
            {STUDENT_REPORT_CONTENTS}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending} leftSection={<IconDownload size={18} />}>
            Download PDF
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
