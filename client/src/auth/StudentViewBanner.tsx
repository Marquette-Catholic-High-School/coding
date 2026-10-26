import { Alert, Button, Stack, Text, type MantineSpacing } from '@mantine/core';
import type { User } from '@codeclass/shared';
import { IconArrowBackUp, IconUserShare } from '@tabler/icons-react';
import { useStopImpersonating } from '../api/auth';
import { notifyError } from '../components/notify';

/** "Back to my account" from a student view (`useStopImpersonating`), for the banner, the account menu and the join page. */
export interface BackToMyAccount {
  run: () => void;
  pending: boolean;
}

export function useBackToMyAccount(): BackToMyAccount {
  const stop = useStopImpersonating();
  return {
    run: () => stop.mutate(undefined, { onError: (err) => notifyError(err, "Couldn't go back to your account") }),
    pending: stop.isPending,
  };
}

/** Shown above every page while a teacher or admin is using a student's account ("Sign in as student"). */
export function StudentViewBanner({ user, back, mb = 'lg' }: { user: User; back: BackToMyAccount; mb?: MantineSpacing | 0 }) {
  return (
    <Alert color="grape" mb={mb} icon={<IconUserShare />} title="Student view">
      <Stack gap="sm" align="flex-start">
        <Text size="sm">
          You're signed in as <b>{user.name}</b> (@{user.username}). Anything you do is saved as their work.
        </Text>
        <Button size="sm" color="grape" leftSection={<IconArrowBackUp size={18} />} loading={back.pending} onClick={back.run}>
          Back to my account
        </Button>
      </Stack>
    </Alert>
  );
}
