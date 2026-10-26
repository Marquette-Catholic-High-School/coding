import { Alert, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useImpersonate } from '../api/auth';
import { notifyError } from '../components/notify';

export interface StudentAccount {
  id: number;
  name: string;
  username: string;
}

export interface SignInAsOptions {
  /** Page to open as the student (default: their dashboard). */
  to?: string;
  /** Shown first in the confirm, e.g. that leaving this page loses unsaved changes (the switch doesn't ask again). */
  warning?: string;
}

/**
 * "Sign in as student" for teachers (students whose classes are all theirs) and admins (any student): asks first, then
 * switches to the student's account and opens `to` as them. The confirm modal stays open with a loading button while
 * switching; on failure it shows why and stays open.
 */
export function useSignInAsStudent(): (student: StudentAccount, options?: SignInAsOptions) => void {
  const impersonate = useImpersonate();
  return (student, { to, warning } = {}) => {
    const modalId = `sign-in-as-${student.id}`;
    modals.openConfirmModal({
      modalId,
      title: 'Sign in as student',
      children: (
        <Stack gap="xs">
          {warning && (
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
              <Text size="sm">{warning}</Text>
            </Alert>
          )}
          <Text size="sm">
            You'll use <b>{student.name}</b>'s account (@{student.username}) and see everything the way they do.
          </Text>
          <Text size="sm">Anything you do there, like saving code or handing in work, is saved as their work.</Text>
          <Text size="sm">
            Choose <b>Back to my account</b> at the top of any page to return to your own account. You won't need your
            password.
          </Text>
        </Stack>
      ),
      labels: { confirm: 'Sign in as student', cancel: 'Cancel' },
      closeOnConfirm: false,
      onConfirm: async () => {
        modals.updateModal({ modalId, confirmProps: { loading: true } });
        try {
          await impersonate.mutateAsync({ userId: student.id, to });
          modals.close(modalId);
        } catch (err) {
          modals.updateModal({ modalId, confirmProps: { loading: false } });
          notifyError(err, `Couldn't sign in as ${student.name}`);
        }
      },
    });
  };
}
