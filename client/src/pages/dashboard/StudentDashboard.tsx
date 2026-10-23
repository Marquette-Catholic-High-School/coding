import { Badge, Button, Card, EmptyState, Grid, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { StudentAssignmentItem, StudentDashboard as StudentDashboardData } from '@codeclass/shared';
import {
  IconCalendarDue,
  IconChecks,
  IconChevronRight,
  IconClockExclamation,
  IconMoodSmile,
  IconPlus,
  IconRosetteDiscountCheck,
  IconSchool,
} from '@tabler/icons-react';
import { Link } from 'react-router';
import { useDashboard } from '../../api/dashboard';
import { useCurrentUser } from '../../auth/AuthProvider';
import { LateBadge, ScoreText, SubmissionStatusBadge } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { StatCard } from '../../components/StatCard';
import { usePageTitle } from '../../hooks/usePageTitle';
import { JoinClassModal } from '../student/JoinClassModal';

const RECENTLY_GRADED = 5;

function formatPoints(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <Group justify="space-between" mb="sm">
      <Title order={3} fz="h4">
        {title}
      </Title>
      {count != null && count > 0 && <Badge variant="light">{count}</Badge>}
    </Group>
  );
}

function StatGrid({ stats }: { stats: StudentDashboardData['stats'] | null }) {
  const loading = stats == null;
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="lg">
      <StatCard label="Classes" value={stats?.classCount} icon={<IconSchool size={22} />} loading={loading} />
      <StatCard
        label="Due this week"
        value={stats?.dueSoonCount}
        hint="Not handed in yet"
        icon={<IconCalendarDue size={22} />}
        color="orange"
        loading={loading}
      />
      <StatCard label="Late" value={stats?.lateCount} icon={<IconClockExclamation size={22} />} color="red" loading={loading} />
      <StatCard label="Graded" value={stats?.gradedCount} icon={<IconChecks size={22} />} color="teal" loading={loading} />
    </SimpleGrid>
  );
}

function TodoRow({ item }: { item: StudentAssignmentItem }) {
  return (
    <UnstyledButton component={Link} to={`/assignments/${item.assignmentId}`} className={classes.row}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} miw={0}>
          <Text fw={600} truncate>
            {item.title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {item.className} ·{' '}
            {item.dueAt ? <RelativeTime date={item.dueAt} prefix="Due" inherit /> : 'No due date'}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          {item.late && <LateBadge />}
          <SubmissionStatusBadge status={item.status} />
          <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function GradedRow({ item }: { item: StudentAssignmentItem }) {
  const percent = item.grade != null && item.points > 0 ? (item.grade / item.points) * 100 : null;
  return (
    <UnstyledButton component={Link} to={`/assignments/${item.assignmentId}`} className={classes.row}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} miw={0}>
          <Text fw={600} truncate>
            {item.title}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {item.className}
          </Text>
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Stack gap={0} align="flex-end">
            <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
              {item.grade != null ? formatPoints(item.grade) : '—'} / {item.points}
            </Text>
            <ScoreText percent={percent} size="xs" />
          </Stack>
          <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
        </Group>
      </Group>
    </UnstyledButton>
  );
}

function AllClear() {
  return (
    <Group gap="sm" py="md" wrap="nowrap">
      <ThemeIcon color="teal" variant="light" size={36} radius="xl">
        <IconMoodSmile size={20} />
      </ThemeIcon>
      <div>
        <Text fw={600}>You're all caught up</Text>
        <Text size="sm" c="dimmed">
          Nothing to hand in right now. New assignments will show up here.
        </Text>
      </div>
    </Group>
  );
}

function FirstRun({ onJoin }: { onJoin: () => void }) {
  return (
    <Card py={48}>
      <EmptyState
        variant="light"
        size="lg"
        icon={<IconSchool size={32} />}
        title="Join your first class"
        description="Ask your teacher for the 6-character class code, then enter it here to see your assignments."
      >
        <EmptyState.Actions>
          <Button size="md" leftSection={<IconPlus size={18} />} onClick={onJoin}>
            Join a class
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  );
}

function DashboardContent({ data, onJoin }: { data: StudentDashboardData; onJoin: () => void }) {
  if (data.classes.length === 0) return <FirstRun onJoin={onJoin} />;

  const todo = data.assignments.filter((a) => a.status === 'not_started' || a.status === 'in_progress');
  const graded = data.assignments.filter((a) => a.status === 'graded').slice(0, RECENTLY_GRADED);

  return (
    <>
      <StatGrid stats={data.stats} />
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card>
            <SectionHeader title="To do" count={todo.length} />
            {todo.length === 0 ? (
              <AllClear />
            ) : (
              <Stack gap={2} mx="-md">
                {todo.map((item) => (
                  <TodoRow key={item.assignmentId} item={item} />
                ))}
              </Stack>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card>
            <SectionHeader title="Recently graded" />
            {graded.length === 0 ? (
              <Group gap="sm" py="md" wrap="nowrap">
                <ThemeIcon color="gray" variant="light" size={36} radius="xl">
                  <IconRosetteDiscountCheck size={20} />
                </ThemeIcon>
                <Text size="sm" c="dimmed">
                  Nothing graded yet. Your grades and feedback will show up here.
                </Text>
              </Group>
            ) : (
              <Stack gap={2} mx="-md">
                {graded.map((item) => (
                  <GradedRow key={item.assignmentId} item={item} />
                ))}
              </Stack>
            )}
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <StatGrid stats={null} />
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card>
            <SectionHeader title="To do" />
            <Stack gap="sm">
              <Skeleton h={44} />
              <Skeleton h={44} />
              <Skeleton h={44} />
            </Stack>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card>
            <SectionHeader title="Recently graded" />
            <Stack gap="sm">
              <Skeleton h={44} />
              <Skeleton h={44} />
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}

export function StudentDashboard() {
  const user = useCurrentUser();
  const dashboard = useDashboard();
  const [joinOpened, join] = useDisclosure(false);
  usePageTitle('Dashboard');
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <>
      <PageHeader
        title={`Hi ${firstName}`}
        subtitle="Here's what's due and how your work is going."
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={join.open}>
            Join a class
          </Button>
        }
      />
      <QueryState query={dashboard} loader={<DashboardSkeleton />}>
        {(data) =>
          // DashboardPage only renders this for students; the union type still needs narrowing.
          data.role === 'student' ? <DashboardContent data={data} onJoin={join.open} /> : null
        }
      </QueryState>
      <JoinClassModal opened={joinOpened} onClose={join.close} />
    </>
  );
}
