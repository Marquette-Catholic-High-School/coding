import { notifications } from '@mantine/notifications';
import { errorMessage } from '../api/client';

export function notifySuccess(title: string, message?: string) {
  notifications.show({ color: 'teal', title, message: message ?? '' });
}

export function notifyError(err: unknown, title = 'Something went wrong') {
  notifications.show({ color: 'red', title, message: errorMessage(err) });
}
