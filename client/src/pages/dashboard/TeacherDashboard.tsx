import {
  Anchor,
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  Group,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { TeacherDashboard as TeacherDashboardData } from '@codeclass/shared';
import {
  IconChecklist,
  IconChevronRight,
  IconCircleCheck,
  IconClockExclamation,
  IconPlus,
  IconSchool,
  IconUsers,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDashboard } from '../../api/dashboard';
import { useCurrentUser } from '../../auth/AuthProvider';
import { LateBadge } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { StatCard } from '../../components/StatCard';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ClassCardGrid } from '../classes/ClassCard';
import { CreateClassModal } from '../classes/CreateClassModal';

const STAT_GRID = { cols: { base: 2, md: 4 }, spacing: 'md', mb: 'lg' } as const;

function StatCards({ stats, loading }: { stats?: TeacherDashboardData['stats']; loading?: boolean }) {
  return (
    <SimpleGrid {...STAT_GRID}>
      <StatCard label="Classes" value={stats?.classCount} hint="active" icon={<IconSchool size={22} />} loading={loading} />
      <StatCard label="Students" value={stats?.studentCount} hint="across your classes" color="blue" icon={<IconUsers size={22} />} loading={loading} />
      <StatCard label="To grade" value={stats?.toGradeCount} hint="handed in, not graded" color="orange" icon={<IconChecklist size={22} />} loading={loading} />
      <StatCard
        label="Late or missing"
        value={stats?.lateCount}
        hint="past the due date"
        color="red"
        icon={<IconClockExclamation size={22} />}
        loading={loading}
      />
    </SimpleGrid>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <StatCards loading />
      <Grid mb="lg">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Skeleton h={260} radius="md" />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Skeleton h={260} radius="md" />
        </Grid.Col>
      </Grid>
    </>
  );
}

function SectionHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <Group justify="space-between" mb="sm" wrap="nowrap">
      <Title order={3} fz="h4">
        {title}
      </Title>
      {aside}
    </Group>
  );
}

function AllClear({ title, text }: { title: string; text: string }) {
  return (
    <Group gap="sm" py="md" wrap="nowrap">
      <ThemeIcon color="teal" variant="light" size={36} radius="xl">
        <IconCircleCheck size={20} />
      </ThemeIcon>
      <div>
        <Text fw={600}>{title}</Text>
        <Text size="sm" c="dimmed">
          {text}
        </Text>
      </div>
    </Group>
  );
}

function NeedsGradingCard({ data }: { data: TeacherDashboardData }) {
  const { toGrade, stats } = data;
  return (
    <Card h="100%">
      <SectionHeader
        title="Needs grading"
        aside={
          stats.toGradeCount > 0 && (
            <Badge variant="light" color="orange">
              {stats.toGradeCount}
            </Badge>
          )
        }
      />
      {toGrade.length === 0 ? (
        <AllClear title="All caught up" text="Nothing is waiting to be graded." />
      ) : (
        <>
          <Stack gap={2} mx="-md">
            {toGrade.map((item) => (
              <UnstyledButton
                key={`${item.assignmentId}-${item.student.id}`}
                component={Link}
                to={`/assignments/${item.assignmentId}/submissions/${item.student.id}`}
                className={classes.row}
              >
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <div style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>
                      {item.student.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {item.assignmentTitle} · {item.className} · <RelativeTime date={item.submittedAt} prefix="handed in" inherit />
                    </Text>
                  </div>
                  <Group gap="xs" wrap="nowrap">
                    {item.late && <LateBadge />}
                    <IconChevronRight size={16} color="var(--mantine-color-dimmed)" />
                  </Group>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
          {stats.toGradeCount > toGrade.length && (
            <Text size="xs" c="dimmed" mt="sm">
              Showing the {toGrade.length} oldest of {stats.toGradeCount}. Open an assignment to see the rest.
            </Text>
          )}
        </>
      )}
    </Card>
  );
}

function DueSoonCard({ data }: { data: TeacherDashboardData }) {
  return (
    <Card h="100%">
      <SectionHeader
        title="Due soon"
        aside={
          <Text size="sm" c="dimmed">
            Next 14 days
          </Text>
        }
      />
      {data.upcoming.length === 0 ? (
        <AllClear title="Nothing due soon" text="No published assignments are due in the next two weeks." />
      ) : (
        <Stack gap={2} mx="-md">
          {data.upcoming.map((item) => {
            const percent = item.studentCount > 0 ? (item.submittedCount / item.studentCount) * 100 : 0;
            return (
              <UnstyledButton key={item.assignmentId} component={Link} to={`/assignments/${item.assignmentId}`} className={classes.row}>
                <Group justify="space-between" wrap="nowrap" gap="sm" mb={2}>
                  <Text fw={600} truncate>
                    {item.assignmentTitle}
                  </Text>
                  <RelativeTime date={item.dueAt} prefix="due" size="xs" c="dimmed" style={{ flexShrink: 0 }} />
                </Group>
                <Text size="xs" c="dimmed" truncate mb={6}>
                  {item.className}
                </Text>
                <Group gap="sm" wrap="nowrap">
                  <Progress value={percent} size="sm" style={{ flex: 1 }} aria-label={`${item.submittedCount} of ${item.studentCount} handed in`} />
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {item.submittedCount}/{item.studentCount} in
                  </Text>
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}

function FirstRun({ onCreate }: { onCreate: () => void }) {
  return (
    <Card py={48}>
      <EmptyState
        variant="light"
        size="lg"
        icon={<IconSchool size={32} />}
        title="Create your first class"
        description="Pick the languages your students will code in, then share the class code so they can join. Work to grade and upcoming deadlines will show up here."
      >
        <EmptyState.Actions>
          <Button size="md" leftSection={<IconPlus size={18} />} onClick={onCreate}>
            Create your first class
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  );
}

function DashboardView({ data, onCreate }: { data: TeacherDashboardData; onCreate: () => void }) {
  if (data.classes.length === 0) return <FirstRun onCreate={onCreate} />;
  return (
    <>
      <StatCards stats={data.stats} />
      <Grid mb="lg">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <NeedsGradingCard data={data} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <DueSoonCard data={data} />
        </Grid.Col>
      </Grid>
      <SectionHeader
        title={data.role === 'admin' ? 'All classes' : 'Your classes'}
        aside={
          <Anchor component={Link} to="/classes" size="sm">
            Manage classes
          </Anchor>
        }
      />
      <ClassCardGrid classes={data.classes} />
    </>
  );
}

export function TeacherDashboard() {
  usePageTitle('Dashboard');
  const user = useCurrentUser();
  const dashboard = useDashboard();
  const [createOpened, createModal] = useDisclosure(false);
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Here's what needs your attention across your classes."
        actions={
          <Button leftSection={<IconPlus size={18} />} onClick={createModal.open}>
            New class
          </Button>
        }
      />
      <QueryState query={dashboard} loader={<DashboardSkeleton />}>
        {(data) =>
          // Staff always receive the teacher shape; the check narrows the union.
          data.role === 'student' ? null : <DashboardView data={data} onCreate={createModal.open} />
        }
      </QueryState>
      <CreateClassModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}
