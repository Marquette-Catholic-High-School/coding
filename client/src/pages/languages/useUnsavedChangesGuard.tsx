import { Text } from '@mantine/core';
import { useWindowEvent } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

/**
 * Asks before leaving the page (in-app navigation or closing the tab) while `dirty`. Changing only the query
 * string (e.g. switching `?tab=`) is never blocked. Returns a function that lets the next navigation through,
 * for leaving on purpose (e.g. after deleting the thing being edited).
 */
export function useUnsavedChangesGuard(dirty: boolean): () => void {
  const bypass = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let leaving = false;
    modals.openConfirmModal({
      title: 'Leave without saving?',
      children: <Text size="sm">You have changes that haven't been saved. If you leave now, they'll be lost.</Text>,
      labels: { confirm: 'Leave without saving', cancel: 'Keep editing' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
        leaving = true;
        blocker.proceed();
      },
      onClose: () => {
        if (!leaving) blocker.reset();
      },
    });
  }, [blocker]);

  useWindowEvent('beforeunload', (event) => {
    if (dirty && !bypass.current) event.preventDefault();
  });

  return useCallback(() => {
    bypass.current = true;
  }, []);
}
