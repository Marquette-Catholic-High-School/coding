import {
  computeAutoScore,
  kindSupportsTests,
  type Assignment,
  type AssignmentResponse,
  type Language,
  type SubmissionRow,
} from '@codeclass/shared';
import {
  Accordion,
  ActionIcon,
  Avatar,
  Button,
  Card,
  EmptyState,
  Group,
  Menu,
  SimpleGrid,
  Skeleton,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconChartBar,
  IconCheck,
  IconChecklist,
  IconChevronRight,
  IconClockExclamation,
  IconDots,
  IconEye,
  IconFileText,
  IconInbox,
  IconPencil,
  IconPlayerStop,
  IconRobot,
  IconSend,
  IconTrash,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAssignment, useDeleteAssignment, useGradeSubmission, useSubmissionRows } from '../../api/assignments';
import { DraftBadge, DueBadge, LanguageBadge, LateBadge, ScoreText, SubmissionStatusBadge, TabCountBadge } from '../../components/badges';
import classes from '../../components/cards.module.css';
import { Markdown } from '../../components/Markdown';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { PageLoader, QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { StatCard } from '../../components/StatCard';
import { usePageTitle } from '../../hooks/usePageTitle';
import { runTests } from '../../runtime';
import { PreviewModal } from './PreviewModal';

type Filter = 'all' | 'to-grade' | 'missing';

function parseFilter(value: string | null): Filter {
  return value === 'to-grade' || value === 'missing' ? value : 'all';
}

const handedIn = (row: SubmissionRow) => row.submission.status === 'submitted' || row.submission.status === 'graded';

export function formatGrade(grade: number): string {
  return String(Math.round(grade * 10) / 10);
}

/** Teacher view of /assignments/:id — submissions, stats and bulk autograding. */
export function AssignmentOverviewPage({ assignmentId }: { assignmentId: number }) {
  const query = useAssignment(assignmentId);
  usePageTitle(query.data?.assignment.title ?? 'Assignment');
  return (
    <QueryState
      query={query}
      loader={
        <>
          <PageHeader crumbs={[{ label: 'Classes', to: '/classes' }]} title={<Skeleton h={30} w={260} />} />
          <PageLoader />
        </>
      }
    >
      {(data) => <Overview data={data} />}
    </QueryState>
  );
}

function Overview({ data }: { data: AssignmentResponse }) {
  const { assignment, class: cls, language } = data;
  const navigate = useNavigate();
  const rowsQuery = useSubmissionRows(assignment.id);
  const rows = useMemo(() => rowsQuery.data?.rows ?? [], [rowsQuery.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get('tab'));
  const [previewOpen, setPreviewOpen] = useState(false);
  const autograde = useAutogradeAll(assignment, language);
  const deleteAssignment = useDeleteAssignment();

  const stats = useMemo(() => {
    const graded = rows.filter((r) => r.submission.status === 'graded');
    const scored = graded.filter((r) => r.submission.grade != null);
    return {
      students: rows.length,
      handedIn: rows.filter(handedIn).length,
      graded: graded.length,
      toGrade: rows.filter((r) => r.submission.status === 'submitted').length,
      missing: rows.filter((r) => !handedIn(r)).length,
      late: rows.filter((r) => r.submission.late).length,
      average:
        scored.length > 0 && assignment.points > 0
          ? scored.reduce((sum, r) => sum + (r.submission.grade! / assignment.points) * 100, 0) / scored.length
          : null,
    };
  }, [rows, assignment.points]);

  const visibleRows = rows.filter((r) =>
    filter === 'to-grade' ? r.submission.status === 'submitted' : filter === 'missing' ? !handedIn(r) : true,
  );
  const canAutograde = kindSupportsTests(language.kind) && assignment.tests.length > 0;

  const setFilter = (value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === 'all') next.delete('tab');
        else next.set('tab', value);
        return next;
      },
      { replace: true },
    );

  const confirmDelete = () => {
    const modalId = modals.openConfirmModal({
      title: 'Delete assignment?',
      children: (
        <Text size="sm">
          This permanently deletes "{assignment.title}" and every student's work for it
          {stats.handedIn > 0 ? `, including ${stats.handedIn} handed-in submission${stats.handedIn === 1 ? '' : 's'}` : ''}. This
          can't be undone.
        </Text>
      ),
      labels: { confirm: 'Delete assignment', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      closeOnConfirm: false,
      onConfirm: async () => {
        modals.updateModal({ modalId, confirmProps: { color: 'red', loading: true } });
        try {
          await deleteAssignment.mutateAsync(assignment.id);
          modals.close(modalId);
          notifySuccess('Assignment deleted', `"${assignment.title}" has been removed from ${cls.name}.`);
          navigate(`/classes/${cls.id}`, { replace: true });
        } catch (err) {
          modals.updateModal({ modalId, confirmProps: { color: 'red', loading: false } });
          notifyError(err, "Couldn't delete the assignment");
        }
      },
    });
  };

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Classes', to: '/classes' },
          { label: cls.name, to: `/classes/${cls.id}` },
          { label: assignment.title },
        ]}
        title={assignment.title}
        badges={
          <>
            <LanguageBadge kind={language.kind} name={language.name} />
            {!assignment.published && <DraftBadge />}
            <DueBadge dueAt={assignment.dueAt} allowLate={assignment.allowLate} />
          </>
        }
        actions={
          <>
            <Button component={Link} to={`/assignments/${assignment.id}/edit`} variant="default" leftSection={<IconPencil size={18} />}>
              Edit
            </Button>
            <Button variant="default" leftSection={<IconEye size={18} />} onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
            {canAutograde &&
              (autograde.running ? (
                <Button color="red" variant="light" leftSection={<IconPlayerStop size={18} />} onClick={autograde.stop}>
                  Stop autograding
                </Button>
              ) : (
                <Tooltip label="Runs every test, including hidden ones, on each handed-in submission in your browser." multiline maw={280}>
                  <Button leftSection={<IconRobot size={18} />} onClick={() => void autograde.start(rows)} disabled={stats.handedIn === 0}>
                    Autograde all
                  </Button>
                </Tooltip>
              ))}
            <Menu position="bottom-end" withinPortal width={220}>
              <Menu.Target>
                <Tooltip label="More actions">
                  <ActionIcon variant="default" size="lg" aria-label="More actions">
                    <IconDots size={18} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={confirmDelete}>
                  Delete assignment
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="lg">
        <StatCard
          label="Submitted"
          value={stats.handedIn}
          hint={`of ${stats.students} student${stats.students === 1 ? '' : 's'}`}
          icon={<IconSend size={22} />}
          color="blue"
          loading={rowsQuery.isPending}
        />
        <StatCard
          label="Graded"
          value={stats.graded}
          hint={stats.toGrade > 0 ? `${stats.toGrade} to grade` : 'Nothing waiting'}
          icon={<IconChecklist size={22} />}
          color="teal"
          loading={rowsQuery.isPending}
        />
        <StatCard
          label="Late / missing"
          value={stats.late}
          hint={assignment.dueAt ? 'Late, or not in after the due date' : 'No due date'}
          icon={<IconClockExclamation size={22} />}
          color="red"
          loading={rowsQuery.isPending}
        />
        <StatCard
          label="Average"
          value={stats.average == null ? '—' : `${Math.round(stats.average)}%`}
          hint={stats.graded > 0 ? `across ${stats.graded} graded` : 'Nothing graded yet'}
          icon={<IconChartBar size={22} />}
          color="grape"
          loading={rowsQuery.isPending}
        />
      </SimpleGrid>

      <Accordion variant="separated" mb="lg">
        <Accordion.Item value="instructions">
          <Accordion.Control icon={<IconFileText size={18} />}>Instructions</Accordion.Control>
          <Accordion.Panel>
            {assignment.instructions.trim() ? (
              <Markdown source={assignment.instructions} />
            ) : (
              <Text size="sm" c="dimmed">
                No instructions. Add some from Edit.
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Card>
        <Tabs value={filter} onChange={setFilter} keepMounted={false}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="all" leftSection={<IconUsers size={16} />} rightSection={<TabCountBadge count={stats.students} />}>
              All
            </Tabs.Tab>
            <Tabs.Tab value="to-grade" leftSection={<IconChecklist size={16} />} rightSection={<TabCountBadge count={stats.toGrade} />}>
              To grade
            </Tabs.Tab>
            <Tabs.Tab value="missing" leftSection={<IconInbox size={16} />} rightSection={<TabCountBadge count={stats.missing} />}>
              Missing
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <QueryState query={rowsQuery}>
          {() =>
            rows.length === 0 ? (
              <EmptyState
                variant="light"
                color="gray"
                size="lg"
                py="xl"
                icon={<IconUsers size={32} />}
                title="No students yet"
                description={`Students show up here once they join ${cls.name}.`}
              >
                <EmptyState.Actions>
                  <Button component={Link} to={`/classes/${cls.id}?tab=students`} leftSection={<IconUserPlus size={18} />}>
                    Add students
                  </Button>
                </EmptyState.Actions>
              </EmptyState>
            ) : visibleRows.length === 0 ? (
              <Group gap="sm" py="md" wrap="nowrap">
                <ThemeIcon color="teal" variant="light" size={36} radius="xl">
                  <IconCheck size={20} />
                </ThemeIcon>
                <div>
                  <Text fw={600}>{filter === 'to-grade' ? 'All caught up' : 'Everyone has handed in'}</Text>
                  <Text size="sm" c="dimmed">
                    {filter === 'to-grade' ? 'No submissions are waiting to be graded.' : 'Every student has submitted this assignment.'}
                  </Text>
                </div>
              </Group>
            ) : (
              <SubmissionsTable rows={visibleRows} assignment={assignment} />
            )
          }
        </QueryState>
      </Card>

      <PreviewModal
        opened={previewOpen}
        onClose={() => setPreviewOpen(false)}
        language={language}
        content={{
          title: assignment.title,
          instructions: assignment.instructions,
          starterCode: assignment.starterCode,
          tests: assignment.tests,
          compareMode: assignment.compareMode,
        }}
      />
    </>
  );
}

function SubmissionsTable({ rows, assignment }: { rows: SubmissionRow[]; assignment: Assignment }) {
  const navigate = useNavigate();
  return (
    <Table.ScrollContainer minWidth={620}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Student</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Submitted</Table.Th>
            <Table.Th>Auto score</Table.Th>
            <Table.Th>Grade</Table.Th>
            <Table.Th>
              <VisuallyHidden>Open</VisuallyHidden>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ student, submission }) => {
            const to = `/assignments/${assignment.id}/submissions/${student.id}`;
            // The accessible name starts with the visible word so voice control ("click Grade") finds it.
            const action = submission.status === 'submitted' ? 'Grade' : 'Open';
            return (
              <Table.Tr
                key={student.id}
                className={submission.late ? classes.flaggedRow : undefined}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(to)}
              >
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <Avatar name={student.name} color="initials" radius="xl" size={32} />
                    <div style={{ minWidth: 0 }}>
                      <Text fw={500} size="sm" truncate>
                        {student.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {student.username}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <SubmissionStatusBadge status={submission.status} />
                    {submission.late && (
                      <LateBadge missing={submission.status !== 'submitted' && submission.status !== 'graded'} />
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <RelativeTime date={submission.submittedAt} size="sm" />
                </Table.Td>
                <Table.Td>
                  <ScoreText percent={submission.autoScore} />
                </Table.Td>
                <Table.Td>
                  {submission.grade != null ? (
                    <Text size="sm" fw={500}>
                      {formatGrade(submission.grade)} / {assignment.points}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right">
                  <Button
                    component={Link}
                    to={to}
                    variant="subtle"
                    size="xs"
                    rightSection={<IconChevronRight size={14} />}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${action} ${student.name}'s work`}
                  >
                    {action}
                  </Button>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/**
 * Runs every test (hidden ones included) against each handed-in submission, one at a time in this browser,
 * and stores the results and auto-score. Progress is shown in a single updating notification.
 */
function useAutogradeAll(assignment: Assignment, language: Language) {
  const grade = useGradeSubmission(assignment.id);
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the page stops the run.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async (rows: SubmissionRow[]) => {
    const targets = rows.filter(handedIn);
    if (targets.length === 0 || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    const id = notifications.show({
      loading: true,
      title: `Autograding 1 of ${targets.length}`,
      message: 'Getting the language ready…',
      autoClose: false,
      withCloseButton: false,
    });
    let saved = 0;
    let failed = 0;
    try {
      for (const [index, row] of targets.entries()) {
        if (controller.signal.aborted) break;
        notifications.update({
          id,
          loading: true,
          title: `Autograding ${index + 1} of ${targets.length}`,
          message: `Running tests on ${row.student.name}'s code…`,
          autoClose: false,
          withCloseButton: false,
        });
        const results = await runTests({ kind: language.kind, pseudocode: language.pseudocode }, row.submission.code, assignment.tests, {
          compareMode: assignment.compareMode,
          signal: controller.signal,
          // A new worker per submission, so one student's code can't affect the next one's results.
          freshWorker: true,
        });
        if (controller.signal.aborted) break;
        try {
          await grade.mutateAsync({
            studentId: row.student.id,
            testResults: results,
            autoScore: computeAutoScore(assignment.tests, results),
          });
          saved += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      const stopped = controller.signal.aborted;
      controllerRef.current = null;
      setRunning(false);
      const done = `${saved} of ${targets.length} submission${targets.length === 1 ? '' : 's'} autograded`;
      notifications.update({
        id,
        loading: false,
        autoClose: 6000,
        withCloseButton: true,
        color: failed > 0 ? 'red' : stopped ? 'yellow' : 'teal',
        icon: failed > 0 || stopped ? <IconAlertTriangle size={18} /> : <IconCheck size={18} />,
        title: stopped ? 'Autograding stopped' : failed > 0 ? 'Some results could not be saved' : 'Autograding finished',
        message: failed > 0 ? `${done}. ${failed} could not be saved; try again.` : stopped ? `${done} before stopping.` : `${done}. Auto scores are up to date.`,
      });
    }
  };

  return { running, start, stop: () => controllerRef.current?.abort() };
}
