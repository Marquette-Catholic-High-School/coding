import { Alert, Button, Center, Loader, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { NotFoundCard } from './NotFoundCard';

export function PageLoader({ label, fullPage }: { label?: string; fullPage?: boolean }) {
  return (
    <Center py="xl" mih={fullPage ? '100vh' : undefined}>
      <Stack align="center" gap="xs">
        <Loader />
        {label && (
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}

export function ErrorAlert({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert color="red" icon={<IconAlertCircle />} title={title}>
      <Stack gap="sm" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry && (
          <Button size="xs" variant="white" color="red" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

/** Renders loader / error / not-found / children(data) for a TanStack query. */
export function QueryState<T>({
  query,
  children,
  loader,
  notFound,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loader?: ReactNode;
  /** Rendered for 404 responses (default: NotFoundCard). */
  notFound?: ReactNode;
}) {
  if (query.isPending) return <>{loader ?? <PageLoader />}</>;
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)) {
      return <>{notFound ?? <NotFoundCard />}</>;
    }
    return <ErrorAlert error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}
