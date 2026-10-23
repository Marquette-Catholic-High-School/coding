import { Alert, Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import { CopyIconButton } from './CopyIconButton';

/**
 * Shows a temporary password exactly once (after creating an account or resetting a password).
 * Render with `credentials = null` to keep it closed.
 */
export function TemporaryPasswordModal({
  credentials,
  onClose,
}: {
  credentials: { name: string; username: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Modal opened={!!credentials} onClose={onClose} title="Temporary password" size="md">
      {credentials && (
        <Stack gap="md">
          <Text size="sm">
            Give these sign-in details to <b>{credentials.name}</b>. They'll be asked to choose their own password after signing
            in.
          </Text>
          <Stack gap="xs">
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed" w={90}>
                Username
              </Text>
              <Badge size="xl" variant="light" color="gray" tt="none" fw={500} pr={4} ff="monospace" rightSection={<CopyIconButton value={credentials.username} label="Copy username" />}>
                {credentials.username}
              </Badge>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed" w={90}>
                Password
              </Text>
              <Badge size="xl" variant="light" color="gray" tt="none" fw={500} pr={4} ff="monospace" rightSection={<CopyIconButton value={credentials.password} label="Copy password" />}>
                {credentials.password}
              </Badge>
            </Group>
          </Stack>
          <Alert variant="light" color="yellow" icon={<IconKey size={18} />}>
            <Text size="sm">This password won't be shown again. You can always reset it later.</Text>
          </Alert>
          <Group justify="flex-end">
            <Button onClick={onClose}>Done</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
