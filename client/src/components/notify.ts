import { notifications } from '@mantine/notifications';
import { AccountChangedError, errorMessage } from '../api/client';

export function notifySuccess(title: string, message?: string) {
  notifications.show({ color: 'teal', title, message: message ?? '' });
}

export function notifyError(err: unknown, title = 'Something went wrong') {
  // Refused because another tab switched accounts: the page already says so (AccountSync).
  if (err instanceof AccountChangedError) return;
  notifications.show({ color: 'red', title, message: errorMessage(err) });
}
