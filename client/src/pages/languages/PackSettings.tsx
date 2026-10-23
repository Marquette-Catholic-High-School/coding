import { Alert, Box, Button, Card, Group, Input, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { findPack, LANGUAGE_KIND_LABELS, type Language } from '@codeclass/shared';
import { IconDeviceFloppy, IconExternalLink, IconLock, IconRestore } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { fieldErrors } from '../../api/client';
import { useUpdateLanguage } from '../../api/languages';
import { LanguageBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { CodeEditor, CodeWorkspace } from '../../ide';
import { DisabledBadge, LanguageDangerZone, usageLabel } from './languageParts';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

interface SettingsValues {
  name: string;
  description: string;
  enabled: boolean;
  starterCode: string;
}

function settingsOf(language: Language): SettingsValues {
  return {
    name: language.name,
    description: language.description,
    enabled: language.enabled,
    starterCode: language.starterCode,
  };
}

function sameSettings(a: SettingsValues, b: SettingsValues): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.enabled === b.enabled &&
    a.starterCode === b.starterCode
  );
}

/** Settings page for an installed language pack (Python, JavaScript, …). Only admins can change packs. */
export function PackSettings({ language }: { language: Language }) {
  const navigate = useNavigate();
  const update = useUpdateLanguage();
  const readOnly = !language.canEdit;
  const pack = findPack(language.kind);

  const saved = useRef(settingsOf(language));
  const [dirty, setDirty] = useState(false);
  const form = useForm<SettingsValues>({
    mode: 'uncontrolled',
    initialValues: saved.current,
    validate: { name: (v) => (v.trim() ? null : 'Give the language a name') },
    onValuesChange: (values) => setDirty(!sameSettings(values, saved.current)),
  });
  const starterCode = form.useWatchValue('starterCode');
  const [tryCode, setTryCode] = useState(language.starterCode);
  const allowLeave = useUnsavedChangesGuard(dirty);

  const discard = () => {
    form.reset();
    setDirty(false);
  };

  const handleSubmit = form.onSubmit(async (values) => {
    try {
      const { language: next } = await update.mutateAsync({
        id: language.id,
        name: values.name,
        description: values.description,
        enabled: values.enabled,
        starterCode: values.starterCode,
      });
      saved.current = settingsOf(next);
      form.setInitialValues(saved.current);
      form.reset();
      setDirty(false);
      notifySuccess(
        `${next.name} saved`,
        next.enabled ? 'Teachers and students see the changes straight away.' : "It's switched off for new work until you enable it again.",
      );
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't save the language");
    }
  });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Languages', to: '/languages' }, { label: language.name }]}
        title={language.name}
        badges={
          <>
            <LanguageBadge kind={language.kind} name={LANGUAGE_KIND_LABELS[language.kind]} />
            {!language.enabled && <DisabledBadge />}
          </>
        }
        subtitle={`${language.version} · ${usageLabel(language.assignmentCount)}`}
        actions={
          pack && (
            <Button
              variant="default"
              component="a"
              href={pack.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              leftSection={<IconExternalLink size={18} />}
            >
              Language guide
            </Button>
          )
        }
      />

      {readOnly && (
        <Alert variant="light" color="blue" icon={<IconLock size={20} />} title="View only" mb="lg">
          <Text size="sm">Only admins can change language packs. You can still try the language out below.</Text>
        </Alert>
      )}

      <Stack gap="lg">
        <Card>
          <form noValidate onSubmit={handleSubmit}>
            <Title order={3} fz="h4" mb="sm">
              Settings
            </Title>
            <Stack gap="md">
              <TextInput
                label="Name"
                placeholder={`e.g. ${pack?.name ?? 'Python'}`}
                required
                maxLength={60}
                disabled={readOnly}
                key={form.key('name')}
                {...form.getInputProps('name')}
              />
              <Textarea
                label="Description"
                description="Optional. Shown on the language card."
                autosize
                minRows={2}
                maxRows={6}
                maxLength={500}
                disabled={readOnly}
                key={form.key('description')}
                {...form.getInputProps('description')}
              />
              <Switch
                label="Enabled"
                description="When off, it can't be chosen for new classes, assignments or projects. Existing assignments keep working."
                disabled={readOnly}
                key={form.key('enabled')}
                {...form.getInputProps('enabled', { type: 'checkbox' })}
              />
              <Input.Wrapper
                label="Starter code"
                description="The code new playground projects in this language start with."
                error={form.errors.starterCode}
              >
                <Box mt={6}>
                  <CodeEditor
                    value={starterCode}
                    onChange={readOnly ? undefined : (v) => form.setFieldValue('starterCode', v)}
                    language={language}
                    readOnly={readOnly}
                    height="auto"
                    minHeight={140}
                    maxHeight={360}
                    ariaLabel="Starter code"
                  />
                </Box>
              </Input.Wrapper>
              {!readOnly && (
                <Group justify="flex-end" gap="sm">
                  <Button variant="default" onClick={discard} disabled={!dirty || update.isPending}>
                    Discard changes
                  </Button>
                  <Button type="submit" loading={update.isPending} disabled={!dirty} leftSection={<IconDeviceFloppy size={18} />}>
                    Save changes
                  </Button>
                </Group>
              )}
            </Stack>
          </form>
        </Card>

        <Card>
          <Title order={3} fz="h4">
            Try it
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            Runs in your browser exactly as it will for students.
          </Text>
          <CodeWorkspace
            language={language}
            code={tryCode}
            onCodeChange={setTryCode}
            height="max(520px, calc(100dvh - 320px))"
            storageKey="language-try"
            toolbarRight={
              <Button
                size="xs"
                variant="default"
                leftSection={<IconRestore size={14} />}
                onClick={() => setTryCode(starterCode)}
              >
                Reset to starter code
              </Button>
            }
          />
        </Card>

        {!readOnly && (
          <LanguageDangerZone
            language={language}
            onDeleted={() => {
              allowLeave();
              navigate('/languages?tab=catalog', { replace: true });
            }}
          />
        )}
      </Stack>
    </>
  );
}
