import { Button, Group, Loader, Text, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconCloudCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import type { Autosave } from '../../hooks/useAutosave';

/** Re-renders every `ms` so relative times stay fresh. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function savedLabel(date: Date): string {
  return Date.now() - date.getTime() < 45_000 ? 'Saved just now' : `Saved ${dayjs(date).fromNow()}`;
}

/** "Saving… / Saved just now / Couldn't save — Retry" for the IDE toolbar. */
export function SaveStatus({ autosave }: { autosave: Pick<Autosave<never>, 'status' | 'dirty' | 'lastSavedAt' | 'retry'> }) {
  useTick(20_000);
  const { status, dirty, lastSavedAt, retry } = autosave;

  let content = null;
  if (status === 'error') {
    content = (
      <>
        <IconAlertCircle size={16} color="var(--mantine-color-error)" />
        <Text size="sm" c="red">
          Couldn't save
        </Text>
        <Button variant="subtle" color="red" size="compact-sm" onClick={retry}>
          Retry
        </Button>
      </>
    );
  } else if (status === 'saving' || dirty) {
    content = (
      <>
        <Loader size={14} />
        <Text size="sm" c="dimmed">
          Saving…
        </Text>
      </>
    );
  } else if (lastSavedAt) {
    content = (
      <Tooltip label={dayjs(lastSavedAt).format('ddd D MMM YYYY, h:mm A')}>
        <Group gap={6} wrap="nowrap">
          <IconCloudCheck size={16} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed" visibleFrom="xs">
            {savedLabel(lastSavedAt)}
          </Text>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Group gap={6} wrap="nowrap" aria-live="polite" miw={0}>
      {content}
    </Group>
  );
}
