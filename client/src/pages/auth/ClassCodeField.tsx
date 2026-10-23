// Class code input with a live preview of the class (name + teacher) for the join page.

import { Alert, Button, Group, Loader, Paper, Skeleton, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import type { GetInputPropsReturnType } from '@mantine/form';
import { IconAlertCircle, IconCircleCheck, IconSchool, IconSchoolOff } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useJoinPreview } from '../../api/auth';
import { ApiError, errorMessage } from '../../api/client';

const CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Preview state for a (possibly incomplete) class code. */
export function useClassCode(code: string) {
  const normalized = normalizeJoinCode(code);
  const preview = useJoinPreview(normalized);
  const complete = CODE_PATTERN.test(normalized);
  const notFound = complete && preview.error instanceof ApiError && preview.error.status === 404;
  return {
    code: normalized,
    complete,
    preview,
    notFound,
    checking: complete && preview.isFetching,
    joinable: complete && preview.data?.joinEnabled === true,
  };
}

export type ClassCodeState = ReturnType<typeof useClassCode>;

const NOT_FOUND_MESSAGE = "We couldn't find a class with that code. Check it with your teacher.";

/** Summary of the class a code belongs to. */
export function ClassPreviewCard({ state, action }: { state: ClassCodeState; action?: ReactNode }) {
  const { preview } = state;
  if (!state.complete || state.notFound) return null;
  if (preview.isPending) return <Skeleton h={66} radius="md" />;
  if (preview.isError) {
    return (
      <Alert variant="light" color="red" icon={<IconAlertCircle size={18} />} title="Couldn't check that code">
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{errorMessage(preview.error)}</Text>
          <Button size="xs" variant="white" color="red" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        </Stack>
      </Alert>
    );
  }
  const { className, teacherName, joinEnabled } = preview.data;
  if (!joinEnabled) {
    return (
      <Alert variant="light" color="yellow" icon={<IconSchoolOff size={18} />} title={className}>
        <Text size="sm">
          This class isn't accepting new students right now. Ask {teacherName} to turn joining on.
        </Text>
      </Alert>
    );
  }
  return (
    <Paper withBorder p="sm">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" size={40} radius="md">
          <IconSchool size={22} />
        </ThemeIcon>
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text fw={600} truncate>
            {className}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            Teacher: {teacherName}
          </Text>
        </Stack>
        {action}
      </Group>
    </Paper>
  );
}

/** Text input for a class code plus the live preview card. Pass `key={form.key('joinCode')}` on this element. */
export function ClassCodeField({
  inputProps,
  state,
  autoFocus,
}: {
  inputProps: GetInputPropsReturnType;
  state: ClassCodeState;
  autoFocus?: boolean;
}) {
  const status = state.checking ? (
    <Loader size="xs" />
  ) : state.joinable ? (
    <IconCircleCheck size={18} color="var(--mantine-color-teal-filled)" aria-label="Class found" />
  ) : null;

  return (
    <Stack gap="sm">
      <TextInput
        label="Class code"
        description="6 letters and numbers, from your teacher"
        placeholder="e.g. K7M2QX"
        required
        size="md"
        maxLength={6}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        rightSection={status}
        styles={{
          input: {
            fontFamily: 'var(--mantine-font-family-monospace)',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          },
        }}
        {...inputProps}
        error={inputProps.error ?? (state.notFound ? NOT_FOUND_MESSAGE : undefined)}
      />
      <ClassPreviewCard state={state} />
    </Stack>
  );
}
