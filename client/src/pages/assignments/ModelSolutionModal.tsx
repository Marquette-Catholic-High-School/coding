import type { CompareMode, Language, TestCase, TestResult } from '@codeclass/shared';
import { Alert, Button, Code, Group, Modal, Paper, Progress, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEyeOff, IconPlayerPlay, IconWand, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../../ide';
import { runTests } from '../../runtime';
import { expectedFromOutput } from './editorForm';

/**
 * Runs a pasted model solution once per test input and offers its output as each test's expected output.
 * `onApply` receives test id → expected output for every test that ran without an error.
 */
export function ModelSolutionModal({
  opened,
  onClose,
  language,
  tests,
  compareMode,
  initialCode,
  onApply,
}: {
  opened: boolean;
  onClose: () => void;
  language: Language;
  tests: TestCase[];
  compareMode: CompareMode;
  initialCode: string;
  onApply: (outputs: Map<string, string>) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Fill expected outputs from a model solution" size="xl">
      <ModelSolutionBody
        language={language}
        tests={tests}
        compareMode={compareMode}
        initialCode={initialCode}
        onCancel={onClose}
        onApply={(outputs) => {
          onApply(outputs);
          onClose();
        }}
      />
    </Modal>
  );
}

function ModelSolutionBody({
  language,
  tests,
  compareMode,
  initialCode,
  onCancel,
  onApply,
}: {
  language: Language;
  tests: TestCase[];
  compareMode: CompareMode;
  initialCode: string;
  onCancel: () => void;
  onApply: (outputs: Map<string, string>) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(0);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Closing the modal stops a run that is still going.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setResults(null);
    setFinished(0);
    try {
      const out = await runTests({ kind: language.kind, pseudocode: language.pseudocode }, code, tests, {
        compareMode,
        signal: controller.signal,
        onProgress: ({ index }) => setFinished(index + 1),
      });
      if (!controller.signal.aborted) setResults(out);
    } finally {
      if (controllerRef.current === controller) setRunning(false);
    }
  };

  const byId = new Map((results ?? []).map((r) => [r.testId, r]));
  const usable = (results ?? []).filter((r) => r.error == null);
  const failed = results ? tests.length - usable.length : 0;

  const apply = () => {
    onApply(new Map(usable.map((r) => [r.testId, expectedFromOutput(r.actualOutput, compareMode)])));
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Paste or write a working solution. It runs once for each test's input, and what it prints becomes that test's expected
        output. The solution itself isn't saved.
      </Text>
      <CodeEditor
        value={code}
        onChange={(value) => {
          setCode(value);
          setResults(null);
        }}
        language={language}
        height="auto"
        minHeight={180}
        maxHeight={320}
        onRun={() => void run()}
        ariaLabel="Model solution"
        autoFocus
      />

      {running && (
        <Stack gap={4}>
          <Progress value={(finished / Math.max(tests.length, 1)) * 100} animated />
          <Text size="xs" c="dimmed">
            Running test {Math.min(finished + 1, tests.length)} of {tests.length}…
          </Text>
        </Stack>
      )}

      {results && (
        <>
          {failed > 0 && (
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title={`${failed} test${failed === 1 ? '' : 's'} had an error`}>
              <Text size="sm">Those expected outputs won't be changed. Fix the solution and run it again, or fill them in by hand.</Text>
            </Alert>
          )}
          <ScrollArea.Autosize mah={320} type="auto">
            <Stack gap="xs">
              {tests.map((test, i) => {
                const result = byId.get(test.id);
                const ok = result != null && result.error == null;
                return (
                  <Paper key={test.id} withBorder p="sm">
                    <Group gap="sm" wrap="nowrap" mb={6}>
                      <ThemeIcon variant="light" color={ok ? 'teal' : 'red'} size={22} radius="xl">
                        {ok ? <IconCheck size={14} /> : <IconX size={14} />}
                      </ThemeIcon>
                      <Text size="sm" fw={600} truncate>
                        Test {i + 1}
                        {test.name ? `: ${test.name}` : ''}
                      </Text>
                      {test.hidden && (
                        <Group gap={4} wrap="nowrap" c="dimmed">
                          <IconEyeOff size={14} />
                          <Text size="xs">Hidden</Text>
                        </Group>
                      )}
                    </Group>
                    {ok ? (
                      <Code block>{expectedFromOutput(result.actualOutput, compareMode) || '(no output)'}</Code>
                    ) : (
                      <Text size="sm" c="red">
                        {result?.error ?? 'This test did not run.'}
                      </Text>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        </>
      )}

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant={results ? 'default' : 'filled'}
          leftSection={<IconPlayerPlay size={18} />}
          loading={running}
          disabled={!code.trim()}
          onClick={() => void run()}
        >
          {results ? 'Run again' : 'Run solution'}
        </Button>
        {results && (
          <Button leftSection={<IconWand size={18} />} disabled={usable.length === 0} onClick={apply}>
            Fill {usable.length} expected output{usable.length === 1 ? '' : 's'}
          </Button>
        )}
      </Group>
    </Stack>
  );
}
