import {
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Card,
  EmptyState,
  Group,
  Menu,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { ClassSummary, RosterStudent } from '@codeclass/shared';
import {
  IconAlertTriangle,
  IconClockExclamation,
  IconDots,
  IconFileDownload,
  IconFileSpreadsheet,
  IconKey,
  IconUserMinus,
  IconUserPlus,
  IconUserShare,
  IconUsers,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useRemoveStudent, useResetStudentPassword, useRoster } from '../../api/classes';
import { CopyIconButton } from '../../components/CopyIconButton';
import { CodeChip, CountBadge, ScoreText, TemporaryPasswordBadge } from '../../components/badges';
import { notifySuccess } from '../../components/notify';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { TemporaryPasswordModal } from '../../components/TemporaryPasswordModal';
import { useSignInAsStudent } from '../../hooks/useSignInAsStudent';
import { ReportModal, type ReportModalTarget } from '../reports/ReportModal';
import { AddStudentModal } from './AddStudentModal';
import { confirmAction } from './confirmAction';
import { ImportStudentsModal } from './ImportStudentsModal';
import { InvitesCard } from './InvitesCard';

type Credentials = { name: string; username: string; password: string };

function JoinInstructions({ cls }: { cls: ClassSummary }) {
  const code = cls.joinCode ?? '';
  const link = `${window.location.origin}/join/${code}`;
  const closedReason = cls.archived
    ? 'This class is archived, so nobody can join it. Unarchive it in Settings to take new students.'
    : !cls.joinEnabled
      ? "Joining is turned off, so this link and code won't work. Turn joining on in Settings when you're ready."
      : null;

  return (
    <Card mb="lg">
      <Stack gap="sm">
        <div>
          <Title order={3} fz="h4">
            Invite students
          </Title>
          <Text component="div" size="sm" c="dimmed" mt={4}>
            Share this link — students open it and create their own account. Students who already have an account can
            sign in and join with the class code <CodeChip>{code}</CodeChip>
          </Text>
        </div>
        <TextInput
          readOnly
          aria-label="Join link"
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          rightSection={<CopyIconButton value={link} label="Copy join link" />}
        />
        {closedReason && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
            <Text size="sm">{closedReason}</Text>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

export function ClassStudentsTab({ cls }: { cls: ClassSummary }) {
  const roster = useRoster(cls.id);
  const resetPassword = useResetStudentPassword(cls.id);
  const removeStudent = useRemoveStudent(cls.id);
  const signInAs = useSignInAsStudent();
  const [addOpened, addModal] = useDisclosure(false);
  const [importOpened, importModal] = useDisclosure(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [report, setReport] = useState<ReportModalTarget | null>(null);

  const confirmReset = (s: RosterStudent) =>
    confirmAction({
      title: 'Reset password',
      message: `Give ${s.name} a new temporary password? They'll be signed out everywhere and need the new password to sign in.`,
      confirmLabel: 'Reset password',
      color: 'brand',
      errorTitle: "Couldn't reset the password",
      action: async () => {
        const { temporaryPassword } = await resetPassword.mutateAsync(s.id);
        setCredentials({ name: s.name, username: s.username, password: temporaryPassword });
      },
    });

  const confirmRemove = (s: RosterStudent) =>
    confirmAction({
      title: 'Remove student',
      message: (
        <Text size="sm">
          Remove <b>{s.name}</b> from {cls.name}? They'll lose access to this class. Their account and work are kept, so
          adding them again brings everything back.
        </Text>
      ),
      confirmLabel: 'Remove from class',
      errorTitle: "Couldn't remove the student",
      action: async () => {
        await removeStudent.mutateAsync(s.id);
        notifySuccess(`${s.name} removed`, `They no longer have access to ${cls.name}.`);
      },
    });

  return (
    <>
      <JoinInstructions cls={cls} />
      <Group justify="space-between" mb="sm" gap="sm">
        <Title order={3} fz="h4">
          Students
        </Title>
        <Group gap="sm">
          <Button variant="default" leftSection={<IconFileSpreadsheet size={18} />} onClick={importModal.open}>
            Import from spreadsheet
          </Button>
          <Button variant="light" leftSection={<IconUserPlus size={18} />} onClick={addModal.open}>
            Add student
          </Button>
        </Group>
      </Group>
      <QueryState query={roster}>
        {({ students }) =>
          students.length === 0 ? (
            <Card py={48}>
              <EmptyState
                variant="light"
                color="gray"
                size="lg"
                icon={<IconUsers size={32} />}
                title="No students yet"
                description="Share the join link above, import a spreadsheet of their email addresses, or add students yourself and hand out their temporary passwords."
              >
                <EmptyState.Actions>
                  <Button leftSection={<IconUserPlus size={18} />} onClick={addModal.open}>
                    Add student
                  </Button>
                  <Button variant="default" leftSection={<IconFileSpreadsheet size={18} />} onClick={importModal.open}>
                    Import from spreadsheet
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
                      <Table.Th>Student</Table.Th>
                      <Table.Th>Joined</Table.Th>
                      <Table.Th>Handed in</Table.Th>
                      <Table.Th>Late</Table.Th>
                      <Table.Th>Average</Table.Th>
                      <Table.Th w={52}>
                        <VisuallyHidden>Actions</VisuallyHidden>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {students.map((s) => (
                      <Table.Tr key={s.id}>
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <Avatar name={s.name} color="initials" radius="xl" size={32} />
                            <div style={{ minWidth: 0 }}>
                              <Group gap={6} wrap="nowrap">
                                <Text fw={500} size="sm" truncate>
                                  {s.name}
                                </Text>
                                {s.mustChangePassword && <TemporaryPasswordBadge />}
                              </Group>
                              <Text size="xs" c="dimmed" truncate>
                                @{s.username}
                              </Text>
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <RelativeTime date={s.joinedAt} size="sm" />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{s.submittedCount}</Text>
                        </Table.Td>
                        <Table.Td>
                          {s.lateCount > 0 ? (
                            <CountBadge count={s.lateCount} label="late" color="red" icon={<IconClockExclamation size={12} />} />
                          ) : (
                            <Text size="sm" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <ScoreText percent={s.averagePercent} />
                        </Table.Td>
                        <Table.Td>
                          <Menu position="bottom-end" withinPortal width={260}>
                            <Menu.Target>
                              <Tooltip label="Student actions">
                                <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${s.name}`}>
                                  <IconDots size={18} />
                                </ActionIcon>
                              </Tooltip>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item leftSection={<IconUserShare size={16} />} onClick={() => signInAs(s)}>
                                Sign in as student
                              </Menu.Item>
                              <Menu.Item
                                leftSection={<IconFileDownload size={16} />}
                                onClick={() => setReport({ kind: 'student', student: s, cls: { id: cls.id, name: cls.name } })}
                              >
                                Download report
                              </Menu.Item>
                              <Menu.Item leftSection={<IconKey size={16} />} onClick={() => confirmReset(s)}>
                                Reset password
                              </Menu.Item>
                              <Menu.Divider />
                              <Menu.Item color="red" leftSection={<IconUserMinus size={16} />} onClick={() => confirmRemove(s)}>
                                Remove from class
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          )
        }
      </QueryState>
      <InvitesCard cls={cls} />
      <ImportStudentsModal cls={cls} opened={importOpened} onClose={importModal.close} />
      <AddStudentModal
        classId={cls.id}
        className={cls.name}
        opened={addOpened}
        onClose={addModal.close}
        onAdded={({ student, temporaryPassword }) => {
          if (temporaryPassword) {
            notifySuccess(`${student.name} added`, 'Give them the sign-in details below — the password is only shown once.');
            setCredentials({ name: student.name, username: student.username, password: temporaryPassword });
          } else {
            notifySuccess(
              `${student.name} added`,
              `They already have an account, so they can sign in as usual and will find ${cls.name} on their dashboard.`,
            );
          }
        }}
      />
      <TemporaryPasswordModal credentials={credentials} onClose={() => setCredentials(null)} />
      <ReportModal target={report} onClose={() => setReport(null)} />
    </>
  );
}
