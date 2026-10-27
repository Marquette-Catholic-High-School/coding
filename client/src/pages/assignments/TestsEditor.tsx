import { COMPARE_MODE_DESCRIPTIONS, COMPARE_MODE_LABELS, type CompareMode, type Language } from '@codeclass/shared';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconFlask, IconPlus, IconTrash, IconWand } from '@tabler/icons-react';
import { useState } from 'react';
import { ModelSolutionModal } from './ModelSolutionModal';
import { emptyTest, promptExample, type EditorForm } from './editorForm';

const COMPARE_OPTIONS = (Object.keys(COMPARE_MODE_LABELS) as CompareMode[]).map((value) => ({ value, label: COMPARE_MODE_LABELS[value] }));

const NO_TESTS_NOTE = "Also used to compare students' output with your solution's when there are no tests.";

const MONO = { input: { fontFamily: 'var(--mantine-font-family-monospace)' } };

/** Tests card of the assignment editor (input / expected output pairs, hidden flag and weight). */
export function TestsEditor({ form, language }: { form: EditorForm; language: Language }) {
  const [solutionOpen, setSolutionOpen] = useState(false);
  // Re-renders come from the editor page: list edits and setValues update the form's state.
  const { tests, starterCode, solutionCode } = form.getValues();
  const compareMode = form.useWatchValue('compareMode');
  const error = form.errors.tests;
  const prompt = promptExample(language);

  return (
    <Card>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <Group gap="sm">
          <Title order={3} fz="h4">
            Tests
          </Title>
          {tests.length > 0 && <Badge variant="light">{tests.length}</Badge>}
        </Group>
        {tests.length > 0 && (
          <Button variant="default" size="xs" leftSection={<IconWand size={16} />} onClick={() => setSolutionOpen(true)}>
            Fill expected outputs from a model solution
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Each test runs the program with the given input and compares what it prints with the expected output. Students can
        run visible tests; hidden tests only run when you grade. Points set each test's weight in the auto-score.
        {tests.length > 0 && prompt && (
          <>
            {' '}
            Filling expected outputs from a model solution leaves out input prompts such as {prompt}, so students can word
            those their own way. A prompt printed on a line of its own stays in, so students' prompts have to match it.
          </>
        )}
      </Text>

      <Stack gap="md">
        <Select
          label="How to compare output"
          description={`${COMPARE_MODE_DESCRIPTIONS[compareMode]} ${NO_TESTS_NOTE}`}
          data={COMPARE_OPTIONS}
          allowDeselect={false}
          maw={560}
          key={form.key('compareMode')}
          {...form.getInputProps('compareMode')}
        />

        {error && (
          <Alert variant="light" color="red" icon={<IconAlertCircle size={18} />}>
            <Text size="sm">{error}</Text>
          </Alert>
        )}

        {tests.length === 0 ? (
          <Group gap="sm" py="md" wrap="nowrap">
            <ThemeIcon color="gray" variant="light" size={36} radius="xl">
              <IconFlask size={20} />
            </ThemeIcon>
            <div>
              <Text fw={600}>No tests yet</Text>
              <Text size="sm" c="dimmed">
                Add tests so students can check their work and you get an auto-score for every submission.
              </Text>
            </div>
          </Group>
        ) : (
          tests.map((test, index) => (
            // Keyed by the test id so removing a test remounts the uncontrolled inputs below it.
            <Paper key={test.id} withBorder p="md">
              <Group justify="space-between" mb="sm" wrap="nowrap">
                <Text fw={600}>Test {index + 1}</Text>
                <Tooltip label="Remove test">
                  <ActionIcon variant="subtle" color="gray" aria-label={`Remove test ${index + 1}`} onClick={() => form.removeListItem('tests', index)}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Stack gap="sm">
                <TextInput
                  label="Name"
                  description="Optional. Shown to students next to the result."
                  placeholder="e.g. Works when the list is empty"
                  key={form.key(`tests.${index}.name`)}
                  {...form.getInputProps(`tests.${index}.name`)}
                />
                <Grid gap="sm">
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Textarea
                      label="Input"
                      description="One line for each time the program asks for input."
                      placeholder={'e.g.\nAda\n12'}
                      autosize
                      minRows={3}
                      maxRows={10}
                      styles={MONO}
                      key={form.key(`tests.${index}.input`)}
                      {...form.getInputProps(`tests.${index}.input`)}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, sm: 6 }}>
                    <Textarea
                      label="Expected output"
                      description={`What the program should print.${prompt ? ` Input prompts such as ${prompt} can be left out.` : ''}`}
                      placeholder={'e.g.\nHello, Ada!'}
                      autosize
                      minRows={3}
                      maxRows={10}
                      styles={MONO}
                      key={form.key(`tests.${index}.expectedOutput`)}
                      {...form.getInputProps(`tests.${index}.expectedOutput`)}
                    />
                  </Grid.Col>
                </Grid>
                <Group gap="lg" align="center" wrap="wrap">
                  <Switch
                    label="Hidden"
                    description="Students can't see or run it."
                    key={form.key(`tests.${index}.hidden`)}
                    {...form.getInputProps(`tests.${index}.hidden`, { type: 'checkbox' })}
                  />
                  <NumberInput
                    label="Points"
                    min={0}
                    max={1000}
                    w={120}
                    key={form.key(`tests.${index}.points`)}
                    {...form.getInputProps(`tests.${index}.points`)}
                  />
                </Group>
              </Stack>
            </Paper>
          ))
        )}

        <Group>
          <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => form.insertListItem('tests', emptyTest())} disabled={tests.length >= 50}>
            Add test
          </Button>
        </Group>
      </Stack>

      <ModelSolutionModal
        opened={solutionOpen}
        onClose={() => setSolutionOpen(false)}
        language={language}
        tests={tests}
        compareMode={compareMode}
        solutionCode={solutionCode}
        starterCode={starterCode}
        onApply={(outputs, solution) => {
          const current = form.getValues().tests;
          form.setValues({
            tests: current.map((t) => (outputs.has(t.id) ? { ...t, expectedOutput: outputs.get(t.id)! } : t)),
            ...(solution != null && { solutionCode: solution }),
          });
        }}
      />
    </Card>
  );
}
