import type { Assignment, LanguageKind, SubmissionRow } from '@codeclass/shared';
import { Alert, Button, Checkbox, Group, List, Modal, Radio, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconRobot } from '@tabler/icons-react';
import { useState } from 'react';
import cards from '../../components/cards.module.css';
import {
  autogradeButtonLabel,
  autogradeRules,
  autogradeScopeOptions,
  autogradeTargets,
  DEFAULT_AUTOGRADE_OPTIONS,
  effectiveScope,
  type AutogradeMethod,
  type AutogradeOptions,
  type AutogradeScope,
} from './autograde';

interface AutogradeModalProps {
  assignment: Assignment;
  kind: LanguageKind;
  method: AutogradeMethod;
  rows: SubmissionRow[];
  /** Starts autograding with the chosen options (the modal closes). */
  onStart: (options: AutogradeOptions) => void;
}

/** "Autograde": explains how scores are worked out for this assignment and asks which work to grade. */
export function AutogradeModal({ opened, onClose, onStart, ...props }: AutogradeModalProps & { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Autograde" size="lg">
      <AutogradeOptionsForm
        {...props}
        onCancel={onClose}
        onStart={(options) => {
          onClose();
          onStart(options);
        }}
      />
    </Modal>
  );
}

function AutogradeOptionsForm({ assignment, kind, method, rows, onCancel, onStart }: AutogradeModalProps & { onCancel: () => void }) {
  const [chosenScope, setScope] = useState<AutogradeScope>(DEFAULT_AUTOGRADE_OPTIONS.scope);
  const [setGrades, setSetGrades] = useState(DEFAULT_AUTOGRADE_OPTIONS.setGrades);
  // Without grades being set, "replacing every grade" isn't offered (it would do the same as all handed-in work).
  const scope = effectiveScope(chosenScope, setGrades);
  const waiting = autogradeTargets(rows, 'waiting').length;
  const handedIn = autogradeTargets(rows, 'handed-in').length;
  const count = scope === 'waiting' ? waiting : handedIn;
  const scopes = autogradeScopeOptions(setGrades).map((option) => ({ ...option, count: option.value === 'waiting' ? waiting : handedIn }));

  return (
    <Stack gap="md">
      <div>
        <Text size="sm" fw={600} mb={6}>
          How scores are worked out
        </Text>
        <List size="sm" spacing={4}>
          {autogradeRules(method, kind, assignment.points, setGrades).map((rule) => (
            <List.Item key={rule}>{rule}</List.Item>
          ))}
        </List>
      </div>

      {method.solution && assignment.solutionVisibility === 'visible' && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title="Students can see your solution">
          <Text size="sm">Work that matches it doesn't show a student wrote it themselves.</Text>
        </Alert>
      )}

      <Radio.Group label="Which work" value={scope} onChange={(value) => setScope(value as AutogradeScope)}>
        <Stack gap="sm" mt="xs">
          {scopes.map((option) => {
            const disabled = option.count === 0;
            return (
              <Radio.Card
                key={option.value}
                value={option.value}
                disabled={disabled}
                className={cards.modeCard}
                withBorder={false}
                radius="md"
                opacity={disabled ? 0.6 : undefined}
                style={disabled ? { cursor: 'not-allowed' } : undefined}
                // Focus starts on the chosen work (the first field), so a stray Enter doesn't start grading.
                data-autofocus={option.value === DEFAULT_AUTOGRADE_OPTIONS.scope || undefined}
              >
                <Group wrap="nowrap" align="flex-start" gap="sm">
                  <Radio.Indicator mt={2} disabled={disabled} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text fw={600} size="sm">
                      {option.label} ({option.count})
                    </Text>
                    <Text size="xs" c="dimmed">
                      {option.description}
                    </Text>
                  </div>
                </Group>
              </Radio.Card>
            );
          })}
        </Stack>
      </Radio.Group>

      <Checkbox
        label="Set grades from the scores"
        description={
          setGrades
            ? "Students see their grade as soon as it's saved. Work autograde can't score is left for you to grade."
            : 'Only the auto scores are updated; grades stay as they are.'
        }
        checked={setGrades}
        onChange={(event) => setSetGrades(event.currentTarget.checked)}
      />

      <Text size="xs" c="dimmed">
        Autograding runs in this browser, one submission at a time. Stay on this page until it finishes.
      </Text>

      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button leftSection={<IconRobot size={18} />} disabled={count === 0} onClick={() => onStart({ scope, setGrades })}>
          {autogradeButtonLabel(count)}
        </Button>
      </Group>
    </Stack>
  );
}
