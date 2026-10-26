import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconSwitchHorizontal } from '@tabler/icons-react';
import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useStopImpersonating } from '../api/auth';
import { ApiError } from '../api/client';
import { notifyError, notifySuccess } from '../components/notify';
import { useAuth } from './AuthProvider';
import { ACCOUNT_SWITCH_KEY, ACCOUNT_SWITCH_STATE, takeReturnPath, type Session } from './session';

/** "Maya Rivera's student view" or "Grace Hopper's account". */
function describe({ user, impersonator }: Session): string {
  return impersonator ? `${user.name}'s student view` : `${user.name}'s account`;
}

/**
 * Root route element: the pages, kept in step with the account signed in to the browser. Every tab shares the session
 * cookie, so another tab can switch it (e.g. "Sign in as student"). Until this tab matches it again, the server refuses
 * its calls, and this says why and offers to continue here as the other account. When this tab's student view stops
 * working (the student left the teacher's classes, or it expired), it goes back to the teacher's or admin's own
 * account, which needs no password.
 */
export function AccountSync() {
  const { user, impersonator, accountChange, switchAccount } = useAuth();
  const navigate = useNavigate();
  const stop = useStopImpersonating();
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // The tab still shows the student view that ended.
  const shownName = useRef(user?.name);
  shownName.current = user?.name;
  const viewEnded = accountChange?.kind === 'view-ended' ? accountChange : null;
  useEffect(() => {
    if (!viewEnded) return;
    const student = shownName.current;
    stopRef.current.mutate(undefined, {
      onSuccess: () => notifySuccess("You're back in your own account", student ? `The student view of ${student} has ended.` : undefined),
      onError: (err) => {
        // 401: there's no account to go back to (e.g. the student view expired), so the sign-in page shows.
        if (!(err instanceof ApiError && err.status === 401)) notifyError(err, "Couldn't go back to your account");
      },
    });
  }, [viewEnded]);

  const other = accountChange?.kind === 'other-tab' ? accountChange.session : null;
  const shown: Session | null = user ? { user, impersonator } : null;
  // This tab is switching accounts itself: the session briefly differs from the one shown.
  const switching = useIsMutating({ mutationKey: ACCOUNT_SWITCH_KEY }) > 0;
  const continueHere = () => {
    if (!other) return;
    // Back in the staff account whose student view this tab showed: return to the page they left, if known.
    const to = (!other.impersonator && takeReturnPath(other.user.id)) || '/dashboard';
    switchAccount(other.user, other.impersonator);
    navigate(to, { replace: true, state: ACCOUNT_SWITCH_STATE });
  };

  return (
    <>
      <Outlet />
      <Modal
        opened={other !== null && shown !== null && !switching}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title="You switched accounts in another tab"
        size="md"
        centered
      >
        {other && shown && (
          <Stack gap="sm">
            <Text size="sm">
              This tab shows {describe(shown)}, but another tab has since opened {describe(other)}. Until they match, nothing
              you do in this tab can be saved.
            </Text>
            <Text size="sm">
              To keep working here, go back to {describe(shown)} in the other tab. Or continue here as {other.user.name}:
              anything this tab hasn't saved will be lost.
            </Text>
            <Group justify="flex-end" gap="sm" mt="sm">
              <Button leftSection={<IconSwitchHorizontal size={18} />} onClick={continueHere}>
                Continue as {other.user.name}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
