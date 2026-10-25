import { SOLUTION_VISIBILITY_LABELS, type Language, type SolutionVisibility } from '@codeclass/shared';
import { Alert, Button, Card, Group, List, Radio, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy, IconInfoCircle, IconListCheck, IconPlayerStop } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import cards from '../../components/cards.module.css';
import { CodeEditor } from '../../ide';
import { runTests } from '../../runtime';
import type { EditorForm } from './editorForm';
import { summarizeSolutionCheck, type SolutionCheck } from './solutionView';

const VISIBILITY_OPTIONS: SolutionVisibility[] = ['hidden', 'after_due', 'after_graded', 'visible'];

/** Solution card of the assignment editor: the reference solution, who can see it, and a check against every test. */
export function SolutionEditor({ form, language, supportsTests }: { form: EditorForm; language: Language | undefined; supportsTests: boolean }) {
  const code = form.useWatchValue('solutionCode');
  const starterCode = form.useWatchValue('starterCode');
  const setCode = (value: string) => form.setFieldValue('solutionCode', value, { forceUpdate: false });
  const codeError = form.errors.solutionCode;

  return (
    <Card>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <Title order={3} fz="h4">
          Solution
        </Title>
        {language && !code.trim() && (
          <Button variant="default" size="xs" leftSection={<IconCopy size={16} />} onClick={() => setCode(starterCode)} disabled={!starterCode.trim()}>
            Copy starter code
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Optional. Your own answer to the assignment: you can open and run it while grading, and choose below when students
        see it.
      </Text>
      <Stack gap="lg">
        {language ? (
          <Stack gap="sm">
            <CodeEditor value={code} onChange={setCode} language={language} height="auto" minHeight={200} maxHeight={480} ariaLabel="Solution" />
            {codeError && (
              <Text size="xs" c="red">
                {codeError}
              </Text>
            )}
            {supportsTests && <SolutionCheckPanel form={form} language={language} code={code} />}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Choose a language first.
          </Text>
        )}
        <VisibilityField form={form} />
      </Stack>
    </Card>
  );
}

function VisibilityField({ form }: { form: EditorForm }) {
  const dueAt = form.useWatchValue('dueAt');
  // Set when clearing the due date switched "After the due date" to "Teachers only"; a new due date switches it back.
  const [autoHidden, setAutoHidden] = useState(false);
  const autoHiddenRef = useRef(autoHidden);
  autoHiddenRef.current = autoHidden;

  const { getValues, setFieldValue, clearFieldError } = form;
  const onDueChange = useCallback(
    ({ value }: { value: string | null }) => {
      const visibility = getValues().solutionVisibility;
      if (!value && visibility === 'after_due') {
        setFieldValue('solutionVisibility', 'hidden');
        setAutoHidden(true);
      } else if (value) {
        clearFieldError('solutionVisibility');
        if (autoHiddenRef.current && visibility === 'hidden') setFieldValue('solutionVisibility', 'after_due');
        setAutoHidden(false);
      }
    },
    [getValues, setFieldValue, clearFieldError],
  );
  form.watch('dueAt', onDueChange);

  const input = form.getInputProps('solutionVisibility');
  return (
    <Stack gap="sm">
      <Radio.Group
        label="Who can see it"
        description="Teachers can always see it. Students see it in a Solution tab next to their code."
        key={form.key('solutionVisibility')}
        {...input}
        onChange={(value) => {
          input.onChange(value);
          setAutoHidden(false);
        }}
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="xs">
          {VISIBILITY_OPTIONS.map((value) => {
            const { label, description } = SOLUTION_VISIBILITY_LABELS[value];
            const disabled = value === 'after_due' && !dueAt;
            return (
              <Radio.Card
                key={value}
                value={value}
                disabled={disabled}
                className={cards.modeCard}
                withBorder={false}
                radius="md"
                opacity={disabled ? 0.6 : undefined}
                style={disabled ? { cursor: 'not-allowed' } : undefined}
              >
                <Group wrap="nowrap" align="flex-start" gap="sm">
                  <Radio.Indicator mt={2} disabled={disabled} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={600} size="sm">
                      {label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {disabled ? 'Set a due date above to use this.' : description}
                    </Text>
                  </div>
                </Group>
              </Radio.Card>
            );
          })}
        </SimpleGrid>
      </Radio.Group>
      {autoHidden && (
        <Alert variant="light" color="yellow" icon={<IconInfoCircle size={18} />}>
          <Text size="sm">
            The due date was removed, so only teachers can see the solution now. Set a due date again to show it to students
            after the due date, or choose another option.
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

/** "Check solution": runs the solution against every test (hidden ones too) with the assignment's compare mode. */
function SolutionCheckPanel({ form, language, code }: { form: EditorForm; language: Language; code: string }) {
  const tests = form.useWatchValue('tests');
  const compareMode = form.useWatchValue('compareMode');
  const [check, setCheck] = useState<{ key: string; result: SolutionCheck } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the page stops a check that is still running.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Results only count for the code, tests and compare mode they were run with.
  const runKey = JSON.stringify([language.id, code, compareMode, tests.map((t) => [t.id, t.name, t.input, t.expectedOutput])]);
  const result = check?.key === runKey ? check.result : null;

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const ran = tests;
    const ranKey = runKey;
    setCheck(null);
    setProgress({ done: 0, total: ran.length });
    try {
      const results = await runTests({ kind: language.kind, pseudocode: language.pseudocode }, code, ran, {
        compareMode,
        signal: controller.signal,
        onProgress: ({ index }) => setProgress({ done: index + 1, total: ran.length }),
      });
      if (!controller.signal.aborted) setCheck({ key: ranKey, result: summarizeSolutionCheck(ran, results) });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setProgress(null);
      }
    }
  };

  if (tests.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Add tests below to check your solution against them.
      </Text>
    );
  }

  const summary = result && `${result.passed} of ${result.total} test${result.total === 1 ? '' : 's'} pass${result.total === 1 ? 'es' : ''}`;
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap">
        {progress ? (
          <Button variant="light" color="red" size="xs" leftSection={<IconPlayerStop size={16} />} onClick={() => controllerRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button variant="default" size="xs" leftSection={<IconListCheck size={16} />} disabled={!code.trim()} onClick={() => void run()}>
            Check solution
          </Button>
        )}
        <Text size="sm" c="dimmed">
          {progress
            ? `Running test ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : `Runs it against all ${tests.length} test${tests.length === 1 ? '' : 's'}, hidden ones included.`}
        </Text>
      </Group>
      {result &&
        (result.failing.length === 0 ? (
          <Alert variant="light" color="teal" icon={<IconCheck size={18} />} title={summary}>
            <Text size="sm">Your solution passes every test.</Text>
          </Alert>
        ) : (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title={summary}>
            <Stack gap="xs">
              <Text size="sm">
                {result.failing.length === 1 ? 'This test fails' : 'These tests fail'}. Fix the solution or the expected output.
              </Text>
              <List size="sm" spacing={4}>
                {result.failing.map((f) => (
                  <List.Item key={f.id}>
                    <Text size="sm" fw={600} span>
                      {f.label}
                    </Text>
                    <Text size="sm" c="dimmed" span>
                      {' '}
                      · {f.error ?? "the output doesn't match"}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </Stack>
          </Alert>
        ))}
    </Stack>
  );
}
