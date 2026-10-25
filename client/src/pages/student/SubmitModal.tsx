import { Alert, Button, Group, Modal, Progress, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core';
import type { CompareMode, TestCase, TestResult } from '@codeclass/shared';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconClockExclamation, IconSend } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { runTests, type RunTarget } from '../../runtime';

export interface SubmitRequest {
  target: RunTarget;
  code: string;
  tests: TestCase[];
  compareMode: CompareMode;
  hiddenTestCount: number;
  dueAt: string | null;
  /** Submitting now is after the due date. */
  late: boolean;
  /** Handing in shows this student the teacher's solution, after which the work can't be unsubmitted. */
  revealsSolution: boolean;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function HiddenTestsNote({ count, afterVisible }: { count: number; afterVisible: boolean }) {
  if (count === 0) return null;
  return (
    <Text size="sm" c="dimmed">
      Your teacher will {afterVisible ? 'also ' : ''}run {plural(count, 'hidden test')} when grading.
    </Text>
  );
}

function TestSummary({ request, results }: { request: SubmitRequest; results: TestResult[] | null }) {
  const { tests, hiddenTestCount } = request;
  if (tests.length === 0 || !results) {
    return (
      <Stack gap={4}>
        <Text size="sm">There are no tests to check before you hand this in{hiddenTestCount ? '.' : ' — your teacher will look at your code.'}</Text>
        <HiddenTestsNote count={hiddenTestCount} afterVisible={false} />
      </Stack>
    );
  }
  const byId = new Map(results.map((r) => [r.testId, r]));
  const passed = results.filter((r) => r.passed).length;
  const allPassed = passed === tests.length;
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" color={allPassed ? 'teal' : 'orange'} size={36} radius="xl">
          {allPassed ? <IconCircleCheck size={20} /> : <IconAlertTriangle size={20} />}
        </ThemeIcon>
        <div>
          <Text fw={600}>
            {passed} of {plural(tests.length, 'test')} passed
          </Text>
          <HiddenTestsNote count={hiddenTestCount} afterVisible />
        </div>
      </Group>
      <ScrollArea.Autosize mah={200} type="auto">
        <Stack gap={4}>
          {tests.map((test, i) => {
            const ok = byId.get(test.id)?.passed ?? false;
            return (
              <Group key={test.id} gap="xs" wrap="nowrap">
                {ok ? (
                  <IconCircleCheck size={16} color="var(--mantine-color-teal-filled)" aria-label="Passed" />
                ) : (
                  <IconCircleX size={16} color="var(--mantine-color-red-filled)" aria-label="Failed" />
                )}
                <Text size="sm" truncate>
                  {test.name || `Test ${i + 1}`}
                </Text>
              </Group>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
      {!allPassed && (
        <Text size="sm" c="dimmed">
          You can still hand it in, or cancel and use the Tests tab to see what went wrong.
        </Text>
      )}
    </Stack>
  );
}

function SubmitFlow({
  request,
  submitting,
  onCancel,
  onSubmit,
}: {
  request: SubmitRequest;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (results: TestResult[] | null) => void;
}) {
  // The request is fixed for the lifetime of this flow (it remounts for every submit attempt).
  const [snapshot] = useState(request);
  const total = snapshot.tests.length;
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [runFailed, setRunFailed] = useState(false);
  const [finished, setFinished] = useState(0);
  const testing = total > 0 && results === null && !runFailed;

  useEffect(() => {
    if (snapshot.tests.length === 0) return;
    const controller = new AbortController();
    void runTests(snapshot.target, snapshot.code, snapshot.tests, {
      compareMode: snapshot.compareMode,
      signal: controller.signal,
      onProgress: ({ index }) => {
        if (!controller.signal.aborted) setFinished((n) => Math.max(n, index + 1));
      },
    }).then(
      (r) => {
        if (!controller.signal.aborted) setResults(r);
      },
      () => {
        if (!controller.signal.aborted) setRunFailed(true);
      },
    );
    return () => controller.abort();
  }, [snapshot]);

  return (
    <Stack gap="md">
      {testing ? (
        <Stack gap="xs">
          <Text size="sm">Checking your code against the tests before you hand it in…</Text>
          <Progress value={(finished / total) * 100} animated size="lg" aria-label="Tests finished" />
          <Text size="xs" c="dimmed">
            {finished} of {plural(total, 'test')} finished
          </Text>
        </Stack>
      ) : runFailed ? (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle />} title="Couldn't run the tests">
          <Text size="sm">You can still submit — your teacher will run the tests when grading.</Text>
        </Alert>
      ) : (
        <TestSummary request={snapshot} results={results} />
      )}

      {snapshot.late && (
        <Alert variant="filled" color="red" icon={<IconClockExclamation />} title="Late submission">
          <Text size="sm">
            {snapshot.dueAt ? `This was due ${dayjs(snapshot.dueAt).format('ddd D MMM YYYY, h:mm A')}, so it` : 'It'} will be marked
            late.
          </Text>
        </Alert>
      )}

      {snapshot.revealsSolution && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle />} title="This shows you the solution">
          <Text size="sm">
            Once you hand in, you'll see your teacher's solution, so you won't be able to unsubmit and change your work.
          </Text>
        </Alert>
      )}

      {!testing && !snapshot.revealsSolution && (
        <Text size="sm" c="dimmed">
          After you submit, your code is locked. You can unsubmit to change it until your teacher grades it.
        </Text>
      )}

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onCancel} disabled={submitting}>
          {testing ? 'Stop' : 'Cancel'}
        </Button>
        <Button leftSection={<IconSend size={18} />} disabled={testing} loading={submitting} onClick={() => onSubmit(results)}>
          Submit
        </Button>
      </Group>
    </Stack>
  );
}

/** Runs the visible tests, shows the summary, and confirms the submission. Open it by passing a request. */
export function SubmitModal({
  request,
  attempt,
  submitting,
  onClose,
  onSubmit,
}: {
  /** null = closed. */
  request: SubmitRequest | null;
  /** Bump for every new submit attempt so the tests run again. */
  attempt: number;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (results: TestResult[] | null) => void;
}) {
  // Keep showing the last request while the modal animates closed.
  const shown = useRef(request);
  if (request) shown.current = request;
  return (
    <Modal
      opened={request !== null}
      onClose={onClose}
      title="Submit assignment"
      size="md"
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      withCloseButton={!submitting}
    >
      {shown.current && (
        <SubmitFlow key={attempt} request={shown.current} submitting={submitting} onCancel={onClose} onSubmit={onSubmit} />
      )}
    </Modal>
  );
}
