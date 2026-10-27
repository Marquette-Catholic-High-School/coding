import type { Assignment, SubmissionRow } from '@codeclass/shared';
import { Alert, Button, Checkbox, Group, List, Loader, Modal, Radio, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPencil, IconRobot } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router';
import cards from '../../components/cards.module.css';
import type { RunTarget } from '../../runtime';
import {
  autogradeButtonLabel,
  autogradeRules,
  autogradeScopeOptions,
  autogradeTargets,
  autogradeWarning,
  DEFAULT_AUTOGRADE_OPTIONS,
  effectiveScope,
  runsSolution,
  type AutogradeMethod,
  type AutogradeOptions,
  type AutogradeScope,
  type PreparedAutograde,
} from './autograde';
import { useAutogradePreparation } from './useAutograde';

interface AutogradeModalProps {
  assignment: Assignment;
  language: RunTarget;
  method: AutogradeMethod;
  rows: SubmissionRow[];
  /**
   * Starts autograding with the chosen options (the modal closes), from the run the modal got ready when it finished
   * in time (null = the run gets ready itself).
   */
  onStart: (options: AutogradeOptions, prepared: PreparedAutograde | null) => void;
}

/**
 * "Autograde": explains how scores are worked out for this assignment, warns about a solution autograde can't use
 * (it runs the solution when the modal opens) and asks which work to grade.
 */
export function AutogradeModal({ opened, onClose, onStart, ...props }: AutogradeModalProps & { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Autograde" size="lg">
      <AutogradeOptionsForm
        {...props}
        onCancel={onClose}
        onStart={(options, prepared) => {
          onClose();
          onStart(options, prepared);
        }}
      />
    </Modal>
  );
}

function AutogradeOptionsForm({ assignment, language, method, rows, onCancel, onStart }: AutogradeModalProps & { onCancel: () => void }) {
  const [chosenScope, setScope] = useState<AutogradeScope>(DEFAULT_AUTOGRADE_OPTIONS.scope);
  const [setGrades, setSetGrades] = useState(DEFAULT_AUTOGRADE_OPTIONS.setGrades);
  // The solution runs as soon as the modal opens, so what's wrong with it shows before anything is graded.
  const prepared = useAutogradePreparation(assignment, language, method);
  const warning = prepared && autogradeWarning(prepared, setGrades);
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
          {autogradeRules(method, language.kind, assignment.points, setGrades, assignment.compareMode).map((rule) => (
            <List.Item key={rule}>{rule}</List.Item>
          ))}
        </List>
      </div>

      {!prepared && runsSolution(method) && (
        <Group gap="xs" wrap="nowrap">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Checking your solution…
          </Text>
        </Group>
      )}

      {warning && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title={warning.title}>
          <Stack gap="sm" align="flex-start">
            <Text size="sm">{warning.sentences.join(' ')}</Text>
            {warning.editAssignment && (
              <Button component={Link} to={`/assignments/${assignment.id}/edit`} size="sm" variant="default" leftSection={<IconPencil size={18} />}>
                Edit assignment
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {method.solution && assignment.solutionVisibility === 'visible' && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title="Students can see your solution">
          <Text size="sm">Work that's the same program as it doesn't show a student wrote it themselves.</Text>
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
        <Button leftSection={<IconRobot size={18} />} disabled={count === 0} onClick={() => onStart({ scope, setGrades }, prepared)}>
          {autogradeButtonLabel(count)}
        </Button>
      </Group>
    </Stack>
  );
}
