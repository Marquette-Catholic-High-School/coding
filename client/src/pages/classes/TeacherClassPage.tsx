import { Badge, Button, Tabs, Text } from '@mantine/core';
import type { ClassSummary } from '@codeclass/shared';
import { IconClipboardList, IconPlus, IconReportAnalytics, IconSettings, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useClass } from '../../api/classes';
import { useCurrentUser } from '../../auth/AuthProvider';
import { ArchivedBadge, BADGE_NO_SHRINK, JoiningOffBadge, TabCountBadge } from '../../components/badges';
import { CopyIconButton } from '../../components/CopyIconButton';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ReportModal, type ReportModalTarget } from '../reports/ReportModal';
import { ClassAssignmentsTab } from './ClassAssignmentsTab';
import { ClassSettingsTab } from './ClassSettingsTab';
import { ClassStudentsTab } from './ClassStudentsTab';

const TABS = ['assignments', 'students', 'settings'] as const;
type Tab = (typeof TABS)[number];

/** Big header chip with the class code and a copy button. */
function JoinCodeChip({ code }: { code: string }) {
  return (
    <Badge
      size="xl"
      variant="light"
      color="gray"
      tt="none"
      fw={500}
      pr={4}
      rightSection={<CopyIconButton value={code} label="Copy class code" />}
      {...BADGE_NO_SHRINK}
    >
      <Text span inherit c="dimmed" mr={8}>
        Code
      </Text>
      <Text span inherit ff="monospace" fw={700}>
        {code}
      </Text>
    </Badge>
  );
}

function ClassView({ cls }: { cls: ClassSummary }) {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.find((t) => t === requested) ?? 'assignments';
  const [report, setReport] = useState<ReportModalTarget | null>(null);

  const setTab = (next: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (!next || next === 'assignments') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );

  const subtitle = [cls.description, cls.ownerId !== user.id ? `Teacher: ${cls.ownerName}` : null].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Classes', to: '/classes' }, { label: cls.name }]}
        title={cls.name}
        subtitle={subtitle || undefined}
        badges={cls.archived ? <ArchivedBadge /> : !cls.joinEnabled ? <JoiningOffBadge /> : null}
        actions={
          <>
            {cls.joinCode && <JoinCodeChip code={cls.joinCode} />}
            <Button
              variant="default"
              leftSection={<IconReportAnalytics size={18} />}
              onClick={() => setReport({ kind: 'class', cls: { id: cls.id, name: cls.name, studentCount: cls.studentCount } })}
            >
              Reports
            </Button>
            <Button component={Link} to={`/classes/${cls.id}/assignments/new`} leftSection={<IconPlus size={18} />}>
              New assignment
            </Button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="assignments" leftSection={<IconClipboardList size={16} />} rightSection={<TabCountBadge count={cls.assignmentCount} />}>
            Assignments
          </Tabs.Tab>
          <Tabs.Tab value="students" leftSection={<IconUsers size={16} />} rightSection={<TabCountBadge count={cls.studentCount} />}>
            Students
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>
            Settings
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="assignments">
          <ClassAssignmentsTab cls={cls} />
        </Tabs.Panel>
        <Tabs.Panel value="students">
          <ClassStudentsTab cls={cls} />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <ClassSettingsTab cls={cls} />
        </Tabs.Panel>
      </Tabs>
      <ReportModal target={report} onClose={() => setReport(null)} />
    </>
  );
}

export function TeacherClassPage({ classId }: { classId: number }) {
  const query = useClass(classId);
  usePageTitle(query.data?.class.name ?? 'Class');
  return <QueryState query={query}>{({ class: cls }) => <ClassView cls={cls} />}</QueryState>;
}
