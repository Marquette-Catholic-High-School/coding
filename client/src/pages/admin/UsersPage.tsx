import {
  ActionIcon,
  Avatar,
  Button,
  Card,
  EmptyState,
  Group,
  Menu,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import type { Role, User, UserWithStats } from '@codeclass/shared';
import {
  IconChalkboardTeacher,
  IconDots,
  IconKey,
  IconPencil,
  IconSearch,
  IconTrash,
  IconUserCircle,
  IconUserPlus,
  IconUserShare,
  IconUsers,
} from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useDeleteUser, useResetUserPassword, useUsers } from '../../api/users';
import { useCurrentUser } from '../../auth/AuthProvider';
import { RoleBadge, TabCountBadge, TemporaryPasswordBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { TemporaryPasswordModal } from '../../components/TemporaryPasswordModal';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSignInAsStudent } from '../../hooks/useSignInAsStudent';
import { UserFormModal, type Credentials } from './UserFormModal';

type Tab = 'staff' | 'students';

function matchesSearch(user: User, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [user.name, user.username, user.email ?? ''].some((field) => field.toLowerCase().includes(q));
}

export function UsersPage() {
  usePageTitle('Users');
  const me = useCurrentUser();
  const users = useUsers();
  const resetPassword = useResetUserPassword();
  const deleteUser = useDeleteUser();
  const signInAs = useSignInAsStudent();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'students' ? 'students' : 'staff';
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ opened: boolean; user: UserWithStats | null }>({ opened: false, user: null });
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const setTab = (value: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', value === 'students' ? 'students' : 'staff');
        return next;
      },
      { replace: true },
    );
  };

  const openCreate = () => setForm({ opened: true, user: null });
  const openEdit = (user: UserWithStats) => setForm({ opened: true, user });

  const confirmReset = (user: UserWithStats) => {
    const modalId = `reset-password-${user.id}`;
    modals.openConfirmModal({
      modalId,
      title: 'Reset password',
      children: (
        <Text size="sm">
          Give <b>{user.name}</b> a new temporary password? They'll be signed out everywhere and asked to choose their own
          password the next time they sign in.
        </Text>
      ),
      labels: { confirm: 'Reset password', cancel: 'Cancel' },
      closeOnConfirm: false,
      onConfirm: () => {
        modals.updateModal({ modalId, confirmProps: { loading: true } });
        resetPassword.mutate(user.id, {
          onSuccess: ({ user: updated, temporaryPassword }) => {
            modals.close(modalId);
            setCredentials({ name: updated.name, username: updated.username, password: temporaryPassword });
          },
          onError: (err) => {
            modals.close(modalId);
            notifyError(err, "Couldn't reset the password");
          },
        });
      },
    });
  };

  const confirmDelete = (user: UserWithStats) => {
    if (user.role !== 'student' && user.classCount > 0) {
      const modalId = `cannot-delete-${user.id}`;
      modals.open({
        modalId,
        title: `Can't delete ${user.name} yet`,
        children: (
          <>
            <Text size="sm">
              {user.name} still owns {user.classCount === 1 ? '1 class' : `${user.classCount} classes`}. Delete those
              classes first, then try again.
            </Text>
            <Group justify="flex-end" mt="md">
              <Button onClick={() => modals.close(modalId)}>OK</Button>
            </Group>
          </>
        ),
      });
      return;
    }
    const modalId = `delete-user-${user.id}`;
    modals.openConfirmModal({
      modalId,
      title: 'Delete user',
      children: (
        <Text size="sm">
          Delete <b>{user.name}</b> (@{user.username})?{' '}
          {user.role === 'student'
            ? 'Their submissions and playground projects will be deleted too.'
            : 'Their playground projects will be deleted too. Pseudocode languages they made stay installed.'}{' '}
          This can't be undone.
        </Text>
      ),
      labels: { confirm: 'Delete user', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      closeOnConfirm: false,
      onConfirm: () => {
        modals.updateModal({ modalId, confirmProps: { color: 'red', loading: true } });
        deleteUser.mutate(user.id, {
          onSuccess: () => {
            modals.close(modalId);
            notifySuccess('User deleted', `${user.name} can no longer sign in.`);
          },
          onError: (err) => {
            modals.close(modalId);
            notifyError(err, "Couldn't delete the user");
          },
        });
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Teacher, admin and student accounts for your school."
        actions={
          <Button leftSection={<IconUserPlus size={18} />} onClick={openCreate}>
            Add user
          </Button>
        }
      />
      <QueryState query={users}>
        {({ users: all }) => {
          const staff = all.filter((u) => u.role !== 'student');
          const students = all.filter((u) => u.role === 'student');
          const tableProps = { me, search, onEdit: openEdit, onSignInAs: signInAs, onReset: confirmReset, onDelete: confirmDelete };
          return (
            <Tabs value={tab} onChange={setTab} keepMounted={false}>
              <Tabs.List mb="lg">
                <Tabs.Tab
                  value="staff"
                  leftSection={<IconChalkboardTeacher size={16} />}
                  rightSection={<TabCountBadge count={staff.length} />}
                >
                  Teachers & admins
                </Tabs.Tab>
                <Tabs.Tab
                  value="students"
                  leftSection={<IconUsers size={16} />}
                  rightSection={<TabCountBadge count={students.length} />}
                >
                  Students
                </Tabs.Tab>
              </Tabs.List>
              {(tab === 'staff' ? staff : students).length > 0 && (
                <TextInput
                  leftSection={<IconSearch size={16} />}
                  placeholder="Search by name, username or email"
                  aria-label="Search users"
                  value={search}
                  onChange={(e) => setSearch(e.currentTarget.value)}
                  maw={360}
                  mb="md"
                />
              )}
              <Tabs.Panel value="staff">
                <UsersTable users={staff} {...tableProps} />
              </Tabs.Panel>
              <Tabs.Panel value="students">
                {students.length === 0 ? <NoStudents onAdd={openCreate} /> : <UsersTable users={students} {...tableProps} />}
              </Tabs.Panel>
            </Tabs>
          );
        }}
      </QueryState>

      <UserFormModal
        opened={form.opened}
        user={form.user}
        defaultRole={tab === 'students' ? 'student' : 'teacher'}
        isSelf={form.user?.id === me.id}
        onClose={() => setForm((f) => ({ ...f, opened: false }))}
        onCreated={setCredentials}
      />
      <TemporaryPasswordModal credentials={credentials} onClose={() => setCredentials(null)} />
    </>
  );
}

function NoStudents({ onAdd }: { onAdd: () => void }) {
  return (
    <Card py={48}>
      <EmptyState
        variant="light"
        color="gray"
        size="lg"
        icon={<IconUsers size={32} />}
        title="No students yet"
        description="Students appear here when they join a class with its code, or when a teacher adds them to a class."
      >
        <EmptyState.Actions>
          <Button leftSection={<IconUserPlus size={18} />} onClick={onAdd}>
            Add user
          </Button>
        </EmptyState.Actions>
      </EmptyState>
    </Card>
  );
}

function UsersTable({
  users,
  me,
  search,
  onEdit,
  onSignInAs,
  onReset,
  onDelete,
}: {
  users: UserWithStats[];
  me: User;
  search: string;
  onEdit: (user: UserWithStats) => void;
  onSignInAs: (user: UserWithStats) => void;
  onReset: (user: UserWithStats) => void;
  onDelete: (user: UserWithStats) => void;
}) {
  const rows = users.filter((u) => matchesSearch(u, search));
  if (rows.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="md">
        No one matches “{search.trim()}”.
      </Text>
    );
  }
  return (
    <Card padding={0}>
      <Table.ScrollContainer minWidth={620}>
        <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Classes</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th w={56}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isMe={user.id === me.id}
                onEdit={onEdit}
                onSignInAs={onSignInAs}
                onReset={onReset}
                onDelete={onDelete}
              />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

const ROLE_CLASSES_HINT: Record<Role, string> = {
  admin: 'Classes they own',
  teacher: 'Classes they own',
  student: 'Classes they have joined',
};

function UserRow({
  user,
  isMe,
  onEdit,
  onSignInAs,
  onReset,
  onDelete,
}: {
  user: UserWithStats;
  isMe: boolean;
  onEdit: (user: UserWithStats) => void;
  onSignInAs: (user: UserWithStats) => void;
  onReset: (user: UserWithStats) => void;
  onDelete: (user: UserWithStats) => void;
}) {
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap="sm" wrap="nowrap">
          <Avatar name={user.name} color="initials" radius="xl" size={32} />
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={500} size="sm" truncate>
                {user.name}
                {isMe && (
                  <Text span size="sm" c="dimmed" fw={400}>
                    {' '}
                    (you)
                  </Text>
                )}
              </Text>
              {user.mustChangePassword && <TemporaryPasswordBadge />}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              @{user.username}
            </Text>
          </div>
        </Group>
      </Table.Td>
      <Table.Td>
        {user.email ? (
          <Text size="sm">{user.email}</Text>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td>
        <RoleBadge role={user.role} />
      </Table.Td>
      <Table.Td>
        <Tooltip label={ROLE_CLASSES_HINT[user.role]}>
          <Text size="sm" span>
            {user.classCount}
          </Text>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <RelativeTime date={user.createdAt} size="sm" />
      </Table.Td>
      <Table.Td>
        <Menu position="bottom-end" withinPortal width={260}>
          <Menu.Target>
            <Tooltip label="Actions">
              <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${user.name}`}>
                <IconDots size={18} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => onEdit(user)}>
              Edit
            </Menu.Item>
            {user.role === 'student' && (
              <Menu.Item leftSection={<IconUserShare size={16} />} onClick={() => onSignInAs(user)}>
                Sign in as student
              </Menu.Item>
            )}
            {isMe ? (
              <Menu.Item leftSection={<IconUserCircle size={16} />} component={Link} to="/account">
                Change your password
              </Menu.Item>
            ) : (
              <>
                <Menu.Item leftSection={<IconKey size={16} />} onClick={() => onReset(user)}>
                  Reset password
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => onDelete(user)}>
                  Delete user
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </Table.Td>
    </Table.Tr>
  );
}
