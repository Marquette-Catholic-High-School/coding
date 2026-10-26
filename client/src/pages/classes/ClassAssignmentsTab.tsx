import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  EmptyState,
  Group,
  Menu,
  Paper,
  Progress,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { AssignmentListItem, ClassSummary } from '@codeclass/shared';
import {
  IconChecklist,
  IconClipboardList,
  IconClockExclamation,
  IconCopy,
  IconDots,
  IconEye,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router';
import { useClassAssignments, useDeleteAssignment } from '../../api/assignments';
import { useLanguageMap } from '../../api/languages';
import { CountBadge, DraftBadge, LanguageBadge } from '../../components/badges';
import { notifySuccess } from '../../components/notify';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { confirmAction } from './confirmAction';
import { CopyAssignmentsModal } from './CopyAssignmentsModal';

function SubmittedProgress({ submitted, students }: { submitted: number; students: number }) {
  const percent = students > 0 ? (submitted / students) * 100 : 0;
  return (
    <Stack gap={4} w={130}>
      <Progress value={percent} size="sm" aria-label={`${submitted} of ${students} handed in`} />
      <Text size="xs" c="dimmed">
        {submitted}/{students} in
      </Text>
    </Stack>
  );
}

export function ClassAssignmentsTab({ cls }: { cls: ClassSummary }) {
  const navigate = useNavigate();
  const assignments = useClassAssignments(cls.id);
  const languages = useLanguageMap();
  const deleteAssignment = useDeleteAssignment();
  const [copyOpened, copyModal] = useDisclosure(false);

  const confirmDelete = (a: AssignmentListItem) =>
    confirmAction({
      title: 'Delete assignment',
      message: (
        <Text size="sm">
          Delete <b>{a.title}</b>?{' '}
          {a.submittedCount > 0
            ? `The work ${a.submittedCount === 1 ? '1 student has' : `${a.submittedCount} students have`} handed in will be deleted too.`
            : "Any work students have started on it will be deleted too."}{' '}
          This can't be undone.
        </Text>
      ),
      confirmLabel: 'Delete assignment',
      errorTitle: "Couldn't delete the assignment",
      action: async () => {
        await deleteAssignment.mutateAsync(a.id);
        notifySuccess('Assignment deleted', `${a.title} has been removed from ${cls.name}.`);
      },
    });

  return (
    <>
      <Group justify="space-between" mb="sm">
        <Title order={3} fz="h4">
          Assignments
        </Title>
        <Button variant="light" leftSection={<IconCopy size={18} />} onClick={copyModal.open}>
          Copy from another class
        </Button>
      </Group>
      <QueryState query={assignments}>
        {({ assignments: list }) =>
          list.length === 0 ? (
            <Card py={48}>
              <EmptyState
                variant="light"
                color="gray"
                size="lg"
                icon={<IconClipboardList size={32} />}
                title="No assignments yet"
                description="Write instructions, give students some starter code and add tests that check their output automatically."
              >
                <EmptyState.Actions>
                  <Button component={Link} to={`/classes/${cls.id}/assignments/new`} leftSection={<IconPlus size={18} />}>
                    New assignment
                  </Button>
                  <Button variant="default" leftSection={<IconCopy size={18} />} onClick={copyModal.open}>
                    Copy from another class
                  </Button>
                </EmptyState.Actions>
              </EmptyState>
            </Card>
          ) : (
            <Paper withBorder>
              <Table.ScrollContainer minWidth={620}>
                <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Assignment</Table.Th>
                      <Table.Th>Due</Table.Th>
                      <Table.Th>Handed in</Table.Th>
                      <Table.Th>Needs attention</Table.Th>
                      <Table.Th w={52}>
                        <VisuallyHidden>Actions</VisuallyHidden>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {list.map((a) => {
                      const language = languages.get(a.languageId);
                      const toGrade = a.submittedCount - a.gradedCount;
                      return (
                        <Table.Tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/assignments/${a.id}`)}>
                          <Table.Td>
                            <Stack gap={6} align="flex-start">
                              <Anchor
                                component={Link}
                                to={`/assignments/${a.id}`}
                                fw={600}
                                size="sm"
                                c="inherit"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {a.title}
                              </Anchor>
                              <Group gap={6}>
                                {language && <LanguageBadge kind={language.kind} name={language.name} />}
                                {!a.published && <DraftBadge />}
                              </Group>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            {a.dueAt ? (
                              <RelativeTime date={a.dueAt} size="sm" />
                            ) : (
                              <Text size="sm" c="dimmed">
                                No due date
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <SubmittedProgress submitted={a.submittedCount} students={a.studentCount} />
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6}>
                              <CountBadge count={toGrade} label="to grade" color="orange" icon={<IconChecklist size={12} />} />
                              <CountBadge count={a.lateCount} label="late" color="red" icon={<IconClockExclamation size={12} />} />
                              {toGrade === 0 && a.lateCount === 0 && (
                                <Text size="sm" c="dimmed">
                                  —
                                </Text>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td onClick={(e) => e.stopPropagation()}>
                            <Menu position="bottom-end" withinPortal width={260}>
                              <Menu.Target>
                                <Tooltip label="Assignment actions">
                                  <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${a.title}`}>
                                    <IconDots size={18} />
                                  </ActionIcon>
                                </Tooltip>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item component={Link} to={`/assignments/${a.id}`} leftSection={<IconEye size={16} />}>
                                  Open
                                </Menu.Item>
                                <Menu.Item component={Link} to={`/assignments/${a.id}/edit`} leftSection={<IconPencil size={16} />}>
                                  Edit
                                </Menu.Item>
                                <Menu.Divider />
                                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(a)}>
                                  Delete
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )
        }
      </QueryState>
      <CopyAssignmentsModal cls={cls} opened={copyOpened} onClose={copyModal.close} />
    </>
  );
}
