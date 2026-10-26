import {
  ActionIcon,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CopyButton,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import type { ClassInvite, ClassSummary } from '@codeclass/shared';
import { IconAlertTriangle, IconCheck, IconLink, IconMailCheck, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useDeleteInvite, useInvites } from '../../api/classes';
import { CountBadge } from '../../components/badges';
import { notifySuccess } from '../../components/notify';
import { ErrorAlert } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { confirmAction } from './confirmAction';

/** The join page's "my teacher added my email" mode (JoinPage reads `?email`). */
export function signUpLink(): string {
  return `${window.location.origin}/join?email=1`;
}

function CopySignUpLinkButton() {
  return (
    <CopyButton value={signUpLink()} timeout={1500}>
      {({ copied, copy }) => (
        <Button
          variant="light"
          color={copied ? 'teal' : undefined}
          leftSection={copied ? <IconCheck size={18} /> : <IconLink size={18} />}
          onClick={copy}
        >
          {copied ? 'Link copied' : 'Copy sign-up link'}
        </Button>
      )}
    </CopyButton>
  );
}

function PendingTable({ invites, onRemove }: { invites: ClassInvite[]; onRemove: (invite: ClassInvite) => void }) {
  if (invites.length === 0) {
    return (
      <Group gap="sm" py="md" wrap="nowrap">
        <ThemeIcon color="teal" variant="light" size={36} radius="xl">
          <IconMailCheck size={20} />
        </ThemeIcon>
        <div>
          <Text fw={600}>Everyone has joined</Text>
          <Text size="sm" c="dimmed">
            Every email address on the list now belongs to a student in this class.
          </Text>
        </div>
      </Group>
    );
  }
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={520} maxHeight={400}>
        <Table stickyHeader highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Invited</Table.Th>
              <Table.Th w={52}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invites.map((invite) => (
              <Table.Tr key={invite.id}>
                <Table.Td style={{ wordBreak: 'break-all' }}>
                  <Text size="sm">{invite.email}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={invite.name ? undefined : 'dimmed'}>
                    {invite.name || '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <RelativeTime date={invite.invitedAt} size="sm" />
                  {invite.invitedByName && (
                    <Text size="xs" c="dimmed">
                      by {invite.invitedByName}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Tooltip label="Remove invitation">
                    <ActionIcon variant="subtle" color="gray" aria-label={`Remove invitation for ${invite.email}`} onClick={() => onRemove(invite)}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

function JoinedTable({ invites }: { invites: ClassInvite[] }) {
  if (invites.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="md">
        Nobody has signed up with these email addresses yet.
      </Text>
    );
  }
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={520} maxHeight={400}>
        <Table stickyHeader highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Email</Table.Th>
              <Table.Th>Joined as</Table.Th>
              <Table.Th>Joined</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invites.map((invite) => (
              <Table.Tr key={invite.id}>
                <Table.Td style={{ wordBreak: 'break-all' }}>
                  <Text size="sm">{invite.email}</Text>
                  {invite.name && (
                    <Text size="xs" c="dimmed">
                      Listed as {invite.name}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {invite.joinedUser ? (
                    <Group gap="sm" wrap="nowrap">
                      <Avatar name={invite.joinedUser.name} color="initials" radius="xl" size={32} />
                      <div style={{ minWidth: 0 }}>
                        <Text fw={500} size="sm" truncate>
                          {invite.joinedUser.name}
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          @{invite.joinedUser.username}
                        </Text>
                      </div>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Account deleted
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <RelativeTime date={invite.joinedAt} size="sm" />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

function InviteList({ cls, invites }: { cls: ClassSummary; invites: ClassInvite[] }) {
  const deleteInvite = useDeleteInvite(cls.id);
  const pending = invites.filter((i) => i.status === 'pending');
  const joined = invites.filter((i) => i.status === 'joined');
  const [chosen, setChosen] = useState<'pending' | 'joined' | null>(null);
  const view = chosen ?? (pending.length > 0 ? 'pending' : 'joined');

  const confirmRemove = (invite: ClassInvite) =>
    confirmAction({
      title: 'Remove invitation',
      message: (
        <Text size="sm">
          Remove <b>{invite.email}</b> from the invite list? Whoever signs up with it won't join {cls.name}. You can import
          it again later.
        </Text>
      ),
      confirmLabel: 'Remove invitation',
      errorTitle: "Couldn't remove the invitation",
      action: async () => {
        await deleteInvite.mutateAsync(invite.id);
        notifySuccess('Invitation removed', `${invite.email} won't join ${cls.name} when they sign up.`);
      },
    });

  return (
    <Card mt="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div style={{ minWidth: 0, flex: '1 1 300px' }}>
            <Group gap="xs">
              <Title order={3} fz="h4">
                Invited by email
              </Title>
              <CountBadge count={pending.length} label="waiting" color="grape" />
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              Students join {cls.name} automatically when they sign up with exactly the email address on this list, or add
              it to their account. Send them the sign-up link — it asks for their email instead of a class code.
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              CodeClass can't check that people own the email address they sign up with, so check who joined with each one.
            </Text>
          </div>
          <CopySignUpLinkButton />
        </Group>
        {cls.archived && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
            <Text size="sm">This class is archived, so nobody on the list joins it until you unarchive it in Settings.</Text>
          </Alert>
        )}
        <SegmentedControl
          style={{ alignSelf: 'flex-start' }}
          value={view}
          onChange={(value) => setChosen(value === 'joined' ? 'joined' : 'pending')}
          data={[
            { value: 'pending', label: `Waiting to sign up (${pending.length})` },
            { value: 'joined', label: `Joined (${joined.length})` },
          ]}
        />
        {view === 'pending' ? <PendingTable invites={pending} onRemove={confirmRemove} /> : <JoinedTable invites={joined} />}
      </Stack>
    </Card>
  );
}

/**
 * Students tab: email addresses added from a spreadsheet — who is still to sign up (with a remove action) and which
 * account joined with each address, and when. Renders nothing until the class has invitations.
 */
export function InvitesCard({ cls }: { cls: ClassSummary }) {
  const invites = useInvites(cls.id);
  if (invites.isPending) return null;
  if (invites.isError) {
    return (
      <Box mt="lg">
        <ErrorAlert title="Couldn't load the invite list" error={invites.error} onRetry={() => void invites.refetch()} />
      </Box>
    );
  }
  return invites.data.invites.length === 0 ? null : <InviteList cls={cls} invites={invites.data.invites} />;
}
