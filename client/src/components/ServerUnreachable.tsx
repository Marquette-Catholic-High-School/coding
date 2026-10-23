import { Button, Center, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconPlugConnectedX, IconRefresh } from '@tabler/icons-react';

export function ServerUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <Center mih="100vh" px="md" py="xl">
      <Paper withBorder shadow="sm" maw={440} p="xl" w="100%">
        <Stack align="center" gap="sm" ta="center">
          <ThemeIcon size={52} radius="xl" variant="light" color="orange">
            <IconPlugConnectedX size={28} />
          </ThemeIcon>
          <Title order={2} fz="h3">
            Can't reach CodeClass
          </Title>
          <Text c="dimmed" size="sm">
            The server isn't responding. Check your internet connection, or ask your teacher whether CodeClass is running.
          </Text>
          <Button leftSection={<IconRefresh size={18} />} onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
