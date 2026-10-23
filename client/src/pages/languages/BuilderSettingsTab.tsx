import { Box, Button, Card, Group, Input, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { starterProgram, type PseudocodeConfig } from '@codeclass/shared/pseudocode';
import type { Language } from '@codeclass/shared';
import { IconWand } from '@tabler/icons-react';
import { useMemo } from 'react';
import { CodeEditor } from '../../ide';
import { LIMITS, type LanguageDraft } from './builderModel';
import { LanguageDangerZone } from './languageParts';

function generatedStarter(config: PseudocodeConfig): string {
  try {
    return starterProgram(config);
  } catch {
    return '';
  }
}

/** "Settings" tab of the builder: name, description, enabled, starter code and the danger zone. */
export function BuilderSettingsTab({
  language,
  draft,
  readOnly,
  nameError,
  onEdit,
  onDeleted,
}: {
  /** The saved language (for the danger zone and the editor's language). */
  language: Language;
  draft: LanguageDraft;
  readOnly: boolean;
  nameError: string | null;
  onEdit: (patch: Partial<LanguageDraft>) => void;
  onDeleted: () => void;
}) {
  const generated = generatedStarter(draft.pseudocode);
  const editorLanguage = useMemo(() => ({ kind: language.kind, pseudocode: draft.pseudocode }), [language.kind, draft.pseudocode]);

  return (
    <Stack gap="lg">
      <Card>
        <Title order={3} fz="h4" mb="sm">
          Settings
        </Title>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="e.g. Year 7 Pseudocode"
            required
            maxLength={LIMITS.nameLength}
            value={draft.name}
            onChange={(e) => onEdit({ name: e.currentTarget.value })}
            error={nameError ?? (draft.name.trim() ? undefined : 'Give the language a name')}
            disabled={readOnly}
          />
          <Textarea
            label="Description"
            description="Optional. Helps other teachers know who it's for."
            placeholder="e.g. The words we use in Year 7 computing lessons"
            autosize
            minRows={2}
            maxRows={6}
            maxLength={LIMITS.descriptionLength}
            value={draft.description}
            onChange={(e) => onEdit({ description: e.currentTarget.value })}
            disabled={readOnly}
          />
          <Switch
            label="Enabled"
            description="When off, it can't be chosen for new classes, assignments or projects. Existing assignments keep working."
            checked={draft.enabled}
            onChange={(e) => onEdit({ enabled: e.currentTarget.checked })}
            disabled={readOnly}
          />
          <Input.Wrapper
            label="Starter code"
            description="The code new playground projects in this language start with. Use only words your class has learned."
          >
            <Box mt={6}>
              <CodeEditor
                value={draft.starterCode}
                onChange={readOnly ? undefined : (v) => onEdit({ starterCode: v })}
                language={editorLanguage}
                readOnly={readOnly}
                height="auto"
                minHeight={140}
                maxHeight={360}
                ariaLabel="Starter code"
              />
            </Box>
          </Input.Wrapper>
          {!readOnly && (
            <Group gap="sm">
              <Button
                variant="default"
                leftSection={<IconWand size={18} />}
                onClick={() => onEdit({ starterCode: generated })}
                disabled={!generated || generated === draft.starterCode}
              >
                Generate from words
              </Button>
              <Text size="xs" c="dimmed" style={{ flex: '1 1 220px' }}>
                Writes a short program that only uses the topics marked as learned.
              </Text>
            </Group>
          )}
        </Stack>
      </Card>

      {!readOnly && <LanguageDangerZone language={language} onDeleted={onDeleted} />}
    </Stack>
  );
}
