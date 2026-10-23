import { Text, type MantineColor } from '@mantine/core';
import { modals } from '@mantine/modals';
import type { ReactNode } from 'react';
import { notifyError } from '../../components/notify';

/**
 * Confirm modal that stays open with a loading confirm button while `action` runs. It closes on success; on
 * failure it shows an error notification and stays open so the user can retry or cancel.
 */
export function confirmAction({
  title,
  message,
  confirmLabel,
  color = 'red',
  errorTitle,
  action,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Confirm button color; red for destructive actions (default). */
  color?: MantineColor;
  errorTitle?: string;
  action: () => Promise<unknown>;
}) {
  const confirmProps = { color };
  const modalId = modals.openConfirmModal({
    title,
    children: typeof message === 'string' ? <Text size="sm">{message}</Text> : message,
    labels: { confirm: confirmLabel, cancel: 'Cancel' },
    confirmProps,
    closeOnConfirm: false,
    onConfirm: async () => {
      modals.updateModal({ modalId, confirmProps: { ...confirmProps, loading: true } });
      try {
        await action();
        modals.close(modalId);
      } catch (err) {
        modals.updateModal({ modalId, confirmProps });
        notifyError(err, errorTitle);
      }
    },
  });
}
