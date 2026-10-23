import { Badge, Card, EmptyState, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import type { AssignmentListItem, Language } from '@codeclass/shared';
import { IconChevronRight, IconClipboardList } from '@tabler/icons-react';
import { Link } from 'react-router';
import { useClassAssignments } from '../../api/assignments';
import { useClass } from '../../api/classes';
import { useLanguageMap } from '../../api/languages';
import { LanguageBadge, LateBadge, SubmissionStatusBadge } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { usePageTitle } from '../../hooks/usePageTitle';

function formatPoints(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function AssignmentRow({ item, language }: { item: AssignmentListItem; language: Language | undefined }) {
  const status = item.myStatus ?? 'not_started';
  return (
    <UnstyledButton component={Link} to={`/assignments/${item.id}`} className={classes.row}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} miw={0}>
          <Text fw={600} truncate>
            {item.title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {item.dueAt ? <RelativeTime date={item.dueAt} prefix="Due" inherit /> : 'No due date'} · {item.points} point
            {item.points === 1 ? '' : 's'}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {language && (
            <Group visibleFrom="sm">
              <LanguageBadge kind={language.kind} name={language.name} />
            </Group>
          )}
          {item.myLate && <LateBadge />}
          <SubmissionStatusBadge status={status} />
          {status === 'graded' && item.myGrade != null && (
            <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
              {formatPoints(item.myGrade)} / {item.points}
            </Text>
          )}
          <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function AssignmentList({ classId }: { classId: number }) {
  const query = useClassAssignments(classId);
  const languages = useLanguageMap();
  return (
    <Card>
      <QueryState query={query}>
        {({ assignments }) => (
          <>
            <Group justify="space-between" mb="sm">
              <Title order={3} fz="h4">
                Assignments
              </Title>
              {assignments.length > 0 && <Badge variant="light">{assignments.length}</Badge>}
            </Group>
            {assignments.length === 0 ? (
              <EmptyState
                variant="light"
                color="gray"
                py="lg"
                icon={<IconClipboardList size={28} />}
                title="No assignments yet"
                description="Your teacher hasn't posted any work in this class. Check back later."
              />
            ) : (
              <Stack gap={2} mx="-md">
                {assignments.map((item) => (
                  <AssignmentRow key={item.id} item={item} language={languages.get(item.languageId)} />
                ))}
              </Stack>
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
}

export function StudentClassPage({ classId }: { classId: number }) {
  const query = useClass(classId);
  usePageTitle(query.data?.class.name ?? 'Class');

  return (
    <QueryState query={query}>
      {({ class: cls }) => (
        <>
          <PageHeader
            crumbs={[{ label: 'My classes', to: '/classes' }, { label: cls.name }]}
            title={cls.name}
            subtitle={
              <>
                Teacher: {cls.ownerName}
                {cls.description && (
                  <>
                    <br />
                    {cls.description}
                  </>
                )}
              </>
            }
          />
          <AssignmentList classId={cls.id} />
        </>
      )}
    </QueryState>
  );
}
