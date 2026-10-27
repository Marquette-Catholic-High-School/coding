import type { CompareMode, Language, TestCase, TestResult } from '@codeclass/shared';
import { Alert, Button, Checkbox, Code, Group, Modal, Paper, Progress, ScrollArea, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconEyeOff, IconPlayerPlay, IconWand, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { CodeEditor } from '../../ide';
import { runTests } from '../../runtime';
import { expectedFromOutput, promptExample } from './editorForm';

interface ModelSolutionProps {
  language: Language;
  tests: TestCase[];
  compareMode: CompareMode;
  /** The assignment's solution ('' = none): the code to start from, and what keeping the code as the solution replaces. */
  solutionCode: string;
  /** Starting code when there is no solution yet. */
  starterCode: string;
  /**
   * Receives test id → expected output for every test that ran without an error, and the code that ran when the
   * teacher chose to keep it as the assignment's solution (null otherwise).
   */
  onApply: (outputs: Map<string, string>, solutionCode: string | null) => void;
}

/** Runs a model solution once per test input and offers its output as each test's expected output. */
export function ModelSolutionModal({ opened, onClose, onApply, ...props }: ModelSolutionProps & { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Fill expected outputs from a model solution" size="xl">
      <ModelSolutionBody
        {...props}
        onCancel={onClose}
        onApply={(outputs, solutionCode) => {
          onApply(outputs, solutionCode);
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
  solutionCode,
  starterCode,
  onCancel,
  onApply,
}: ModelSolutionProps & { onCancel: () => void }) {
  const hasSolution = solutionCode.trim() !== '';
  const prompt = promptExample(language);
  const [code, setCode] = useState(hasSolution ? solutionCode : starterCode);
  // Keeping the code as the solution is the default only when there isn't one to replace.
  const [keepAsSolution, setKeepAsSolution] = useState(!hasSolution);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(0);
  const [results, setResults] = useState<TestResult[] | null>(null);
  // Test id → what the solution printed for it without its input prompts.
  const [outputs, setOutputs] = useState(new Map<string, string>());
  // The code that produced `results` (it may have been edited while the tests ran).
  const [ranCode, setRanCode] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  // Closing the modal stops a run that is still going.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const runCode = code;
    setRunning(true);
    setResults(null);
    setFinished(0);
    try {
      const promptless = new Map<string, string>();
      const out = await runTests({ kind: language.kind, pseudocode: language.pseudocode }, runCode, tests, {
        compareMode,
        signal: controller.signal,
        onProgress: ({ index, result, promptlessOutput }) => {
          promptless.set(result.testId, promptlessOutput);
          setFinished(index + 1);
        },
      });
      if (!controller.signal.aborted) {
        setResults(out);
        setOutputs(promptless);
        setRanCode(runCode);
      }
    } finally {
      if (controllerRef.current === controller) setRunning(false);
    }
  };

  const byId = new Map((results ?? []).map((r) => [r.testId, r]));
  const usable = (results ?? []).filter((r) => r.error == null);
  const failed = results ? tests.length - usable.length : 0;
  const expected = (result: TestResult) => expectedFromOutput(outputs.get(result.testId) ?? result.actualOutput, compareMode);

  // Unchanged starter code is never a solution worth keeping.
  const offerKeep = ranCode.trim() !== '' && ranCode !== solutionCode && ranCode !== starterCode;
  const apply = () => {
    onApply(
      new Map(usable.map((r) => [r.testId, expected(r)])),
      offerKeep && keepAsSolution ? ranCode : null,
    );
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {hasSolution ? "This is the assignment's solution; change it if you need to. " : 'Paste or write a working solution. '}
        It runs once for each test's input, and what it prints becomes that test's expected output
        {prompt ? `, leaving out input prompts such as ${prompt}` : ''}.
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
                      <Code block>{expected(result) || '(no output)'}</Code>
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
          {offerKeep && (
            <Checkbox
              label={hasSolution ? "Replace the assignment's solution with this code" : "Use this code as the assignment's solution"}
              description="It goes in the Solution section and is saved when you save the assignment."
              checked={keepAsSolution}
              onChange={(event) => setKeepAsSolution(event.currentTarget.checked)}
            />
          )}
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
