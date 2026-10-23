import { Badge, Button, Code, Group, Loader, Paper, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import type { TestCase, TestResult } from '@codeclass/shared';
import { IconCheck, IconEyeOff, IconMinus, IconPlayerPlay, IconPlayerStop, IconX } from '@tabler/icons-react';
import { BADGE_NO_SHRINK, scoreTextColor } from '../components/badges';
import classes from './ide.module.css';
import { formatDuration, plural, summarizeTests, testName } from './ideUtils';

export interface TestsPanelProps {
  tests: TestCase[];
  results: TestResult[] | null;
  hiddenTestCount: number;
  running: boolean;
  /** Index of the test currently running. */
  currentTestIndex: number | null;
  /** False while the program itself is running. */
  canRun: boolean;
  onRunTests: () => void;
  /** Stops a test run; shown in place of Run tests while tests run. */
  onStop: () => void;
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      {text === '' ? (
        <Text size="xs" c="dimmed" fs="italic">
          (nothing)
        </Text>
      ) : (
        <Code block className={classes.codeBlock} fz="xs" mah={160} style={{ overflow: 'auto' }}>
          {text}
        </Code>
      )}
    </Stack>
  );
}

function StatusIcon({ result, running }: { result: TestResult | undefined; running: boolean }) {
  if (running) {
    return (
      <ThemeIcon variant="light" color="blue" size={24} radius="xl" aria-label="Running">
        <Loader size={12} />
      </ThemeIcon>
    );
  }
  if (!result) {
    return (
      <ThemeIcon variant="light" color="gray" size={24} radius="xl" aria-label="Not run yet">
        <IconMinus size={14} />
      </ThemeIcon>
    );
  }
  return (
    <ThemeIcon variant="light" color={result.passed ? 'teal' : 'red'} size={24} radius="xl" aria-label={result.passed ? 'Passed' : 'Failed'}>
      {result.passed ? <IconCheck size={14} /> : <IconX size={14} />}
    </ThemeIcon>
  );
}

function TestCard({ test, index, result, running }: { test: TestCase; index: number; result: TestResult | undefined; running: boolean }) {
  const failed = result != null && !result.passed;
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" justify="space-between">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <StatusIcon result={result} running={running} />
            <Text fw={600} size="sm" truncate>
              {testName(test, index)}
            </Text>
            {test.hidden && (
              <Tooltip label="Students can't see this test. It runs when you grade.">
                <Badge variant="light" color="gray" size="xs" leftSection={<IconEyeOff size={12} />} {...BADGE_NO_SHRINK}>
                  Hidden
                </Badge>
              </Tooltip>
            )}
          </Group>
          {result && !running && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatDuration(result.durationMs)}
            </Text>
          )}
        </Group>
        {test.input !== '' && <Block label="Input" text={test.input} />}
        <Block label="Expected output" text={test.expectedOutput} />
        {failed && <Block label="Your output" text={result.actualOutput} />}
        {failed && result.error && (
          <Text size="sm" c="red">
            {result.error}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** Test list with pass/fail status, expected vs actual output and a Run tests button. */
export function TestsPanel({ tests, results, hiddenTestCount, running, currentTestIndex, canRun, onRunTests, onStop }: TestsPanelProps) {
  const byId = new Map((results ?? []).map((r) => [r.testId, r]));
  const summary = summarizeTests(tests, results);
  const hiddenNote = hiddenTestCount > 0 ? `+ ${plural(hiddenTestCount, 'hidden test')} your teacher will run` : null;

  if (tests.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {hiddenTestCount > 0
          ? `Your teacher will check your program with ${plural(hiddenTestCount, 'hidden test')} when grading.`
          : 'There are no tests for this one.'}
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Stack gap={2}>
          {summary ? (
            <Text fw={700} size="sm" style={{ color: scoreTextColor((summary.passed / summary.total) * 100) }} aria-live="polite">
              {summary.passed} / {summary.total} passed
            </Text>
          ) : (
            <Text fw={600} size="sm">
              {running ? 'Running tests…' : `${plural(tests.length, 'test')} — not run yet`}
            </Text>
          )}
          {summary && !running && summary.ran < summary.total && (
            <Text size="xs" c="dimmed">
              {summary.ran} of {plural(summary.total, 'test')} ran
            </Text>
          )}
          {hiddenNote && (
            <Text size="xs" c="dimmed">
              {hiddenNote}
            </Text>
          )}
        </Stack>
        {running ? (
          <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />} onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} disabled={!canRun} onClick={onRunTests}>
            Run tests
          </Button>
        )}
      </Group>
      {tests.map((test, i) => (
        <TestCard key={test.id} test={test} index={i} result={byId.get(test.id)} running={running && currentTestIndex === i} />
      ))}
    </Stack>
  );
}
