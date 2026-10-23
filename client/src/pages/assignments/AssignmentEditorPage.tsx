import { kindSupportsTests, type AssignmentResponse, type ClassSummary, type Language } from '@codeclass/shared';
import {
  Alert,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconDeviceFloppy, IconEye, IconRestore, IconSend, IconSettings } from '@tabler/icons-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router';
import { useAssignment, useCreateAssignment, useUpdateAssignment } from '../../api/assignments';
import { useClass } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { useLanguages } from '../../api/languages';
import classes from '../../components/cards.module.css';
import { LanguageIcon } from '../../components/LanguageIcon';
import { NotFoundCard } from '../../components/NotFoundCard';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CodeEditor } from '../../ide';
import { fingerprint, initialValues, toInput, type EditorForm, type EditorValues } from './editorForm';
import { MarkdownField } from './MarkdownField';
import { PreviewModal, type PreviewContent } from './PreviewModal';
import { TestsEditor } from './TestsEditor';

function validId(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/** /classes/:classId/assignments/new and /assignments/:assignmentId/edit */
export function AssignmentEditorPage() {
  const params = useParams();
  const editing = params.assignmentId !== undefined;
  usePageTitle(editing ? 'Edit assignment' : 'New assignment');

  if (editing) {
    const assignmentId = Number(params.assignmentId);
    if (!validId(assignmentId)) return <NotFoundCard />;
    return <EditExisting key={assignmentId} assignmentId={assignmentId} />;
  }
  const classId = Number(params.classId);
  if (!validId(classId)) return <NotFoundCard />;
  return <EditorData key={classId} classId={classId} existing={null} />;
}

function LoadingHeader({ isNew }: { isNew: boolean }) {
  return <PageHeader crumbs={[{ label: 'Classes', to: '/classes' }]} title={isNew ? 'New assignment' : 'Edit assignment'} />;
}

function EditExisting({ assignmentId }: { assignmentId: number }) {
  const query = useAssignment(assignmentId);
  // Once loaded, keep the editor mounted even if a background refetch fails, so unsaved work is never lost.
  if (query.data) return <EditorData classId={query.data.assignment.classId} existing={query.data} />;
  return (
    <>
      <LoadingHeader isNew={false} />
      <QueryState query={query}>{() => null}</QueryState>
    </>
  );
}

function EditorData({ classId, existing }: { classId: number; existing: AssignmentResponse | null }) {
  const classQuery = useClass(classId);
  const languagesQuery = useLanguages();
  if (classQuery.data && languagesQuery.data) {
    return <AssignmentEditor cls={classQuery.data.class} languages={languagesQuery.data.languages} existing={existing} />;
  }
  return (
    <>
      <LoadingHeader isNew={!existing} />
      {classQuery.data ? (
        <QueryState query={languagesQuery}>{() => null}</QueryState>
      ) : (
        <QueryState query={classQuery}>{() => null}</QueryState>
      )}
    </>
  );
}

function AssignmentEditor({ cls, languages, existing }: { cls: ClassSummary; languages: Language[]; existing: AssignmentResponse | null }) {
  const navigate = useNavigate();
  const isNew = existing == null;
  const originalLanguageId = existing?.assignment.languageId ?? null;

  const languageById = useMemo(() => {
    const map = new Map(languages.map((l) => [l.id, l]));
    if (existing && !map.has(existing.language.id)) map.set(existing.language.id, existing.language);
    return map;
  }, [languages, existing]);

  // The class's languages; an existing assignment may keep a language that was later turned off or removed.
  const languageOptions = useMemo(() => {
    const ids = [...cls.languageIds];
    if (originalLanguageId && !ids.includes(originalLanguageId)) ids.unshift(originalLanguageId);
    return ids.flatMap((id) => {
      const lang = languageById.get(id);
      if (!lang) return [];
      return [{ value: id, label: lang.enabled ? lang.name : `${lang.name} (turned off)`, disabled: !lang.enabled && id !== originalLanguageId }];
    });
  }, [cls.languageIds, originalLanguageId, languageById]);

  const [initial] = useState<EditorValues>(() => {
    const firstEnabled = cls.languageIds.map((id) => languageById.get(id)).find((l) => l?.enabled) ?? null;
    return initialValues(existing?.assignment ?? null, firstEnabled);
  });
  const form = useForm<EditorValues>({
    mode: 'uncontrolled',
    initialValues: initial,
    validate: {
      title: (v) => (v.trim() ? null : 'Required'),
      languageId: (v) => (v ? null : 'Choose a language'),
      points: (v) => (v === '' ? 'Required' : null),
    },
  });

  const savedRef = useRef(fingerprint(initial));
  const leavingRef = useRef(false);
  const getValues = form.getValues;
  const isDirty = useCallback(() => !leavingRef.current && fingerprint(getValues()) !== savedRef.current, [getValues]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && isDirty());
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (isDirty()) event.preventDefault();
      },
      [isDirty],
    ),
  );

  const languageId = form.useWatchValue('languageId');
  const language = languageId ? languageById.get(languageId) : undefined;
  const supportsTests = language ? kindSupportsTests(language.kind) : false;

  const create = useCreateAssignment(cls.id);
  const update = useUpdateAssignment(existing?.assignment.id ?? 0);

  const handleSubmit = form.onSubmit(
    async (values) => {
      const input = toInput(values, values.languageId ? languageById.get(values.languageId) : undefined);
      try {
        const res = isNew ? await create.mutateAsync(input) : await update.mutateAsync(input);
        savedRef.current = fingerprint(values);
        leavingRef.current = true;
        notifySuccess(
          isNew ? 'Assignment created' : 'Assignment saved',
          res.assignment.published
            ? isNew
              ? 'Your students can see it now.'
              : 'Students see the changes straight away.'
            : "It's a draft, so students can't see it yet. Publish it when you're ready.",
        );
        navigate(`/assignments/${res.assignment.id}`);
      } catch (err) {
        const errors = fieldErrors(err);
        if (Object.keys(errors).length > 0) form.setErrors(errors);
        notifyError(err, "Couldn't save the assignment");
      }
    },
    () => notifyError(new Error('Some fields need your attention.'), 'Check the highlighted fields'),
  );

  const languageInput = form.getInputProps('languageId');
  const onLanguageChange = (value: string | null) => {
    const prev = form.getValues();
    languageInput.onChange(value);
    // Swap in the new language's starter program unless the teacher already wrote their own.
    const prevDefault = prev.languageId ? languageById.get(prev.languageId)?.starterCode : undefined;
    const next = value ? languageById.get(value) : undefined;
    if (next && (!prev.starterCode.trim() || prev.starterCode === prevDefault)) {
      form.setFieldValue('starterCode', next.starterCode, { forceUpdate: false });
    }
  };

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewContent | null>(null);
  const openPreview = () => {
    const v = form.getValues();
    setPreview({
      title: v.title.trim(),
      instructions: v.instructions,
      starterCode: v.starterCode,
      tests: supportsTests ? v.tests : [],
      compareMode: v.compareMode,
    });
    setPreviewOpen(true);
  };

  const cancelTo = isNew ? `/classes/${cls.id}` : `/assignments/${existing.assignment.id}`;
  const droppedTests = !supportsTests && language ? form.getValues().tests.length : 0;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Classes', to: '/classes' },
          { label: cls.name, to: `/classes/${cls.id}` },
          ...(existing ? [{ label: existing.assignment.title, to: `/assignments/${existing.assignment.id}` }] : []),
          { label: isNew ? 'New assignment' : 'Edit' },
        ]}
        title={isNew ? 'New assignment' : 'Edit assignment'}
        actions={
          <Button variant="default" leftSection={<IconEye size={18} />} onClick={openPreview} disabled={!language}>
            Preview as student
          </Button>
        }
      />

      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="lg">
          {isNew && languageOptions.every((o) => o.disabled) && (
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title="This class has no languages to use">
              <Stack gap="sm" align="flex-start">
                <Text size="sm">
                  Choose which languages the class uses in its settings (they must be turned on), then come back to create the
                  assignment.
                </Text>
                <Button size="sm" variant="default" leftSection={<IconSettings size={18} />} component={Link} to={`/classes/${cls.id}?tab=settings`}>
                  Open class settings
                </Button>
              </Stack>
            </Alert>
          )}

          <Card>
            <Title order={3} fz="h4" mb="md">
              Details
            </Title>
            <Stack gap="md">
              <TextInput
                label="Title"
                placeholder="e.g. Times tables with a FOR loop"
                required
                key={form.key('title')}
                {...form.getInputProps('title')}
              />
              <MarkdownField
                label="Instructions"
                description="Optional. Markdown: **bold**, `code`, lists and headings work."
                placeholder={'e.g. Write a program that asks for a number and prints its times table from 1 to 10.'}
                key={form.key('instructions')}
                {...form.getInputProps('instructions')}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Select
                  label="Language"
                  placeholder="Choose a language"
                  required
                  data={languageOptions}
                  allowDeselect={false}
                  leftSection={language ? <LanguageIcon kind={language.kind} /> : undefined}
                  key={form.key('languageId')}
                  {...languageInput}
                  onChange={onLanguageChange}
                />
                <NumberInput
                  label="Points"
                  description="What the assignment is graded out of."
                  required
                  min={0}
                  max={1000}
                  allowDecimal={false}
                  key={form.key('points')}
                  {...form.getInputProps('points')}
                />
              </SimpleGrid>
              <DateTimePicker
                label="Due"
                description="Optional. Leave empty for no due date."
                placeholder="No due date"
                clearable
                valueFormat="ddd D MMM YYYY, h:mm A"
                defaultTimeValue="23:59"
                maw={360}
                key={form.key('dueAt')}
                {...form.getInputProps('dueAt')}
              />
              <Switch
                label="Accept late work"
                description="Students can still hand in after the due date; it's marked Late."
                key={form.key('allowLate')}
                {...form.getInputProps('allowLate', { type: 'checkbox' })}
              />
              <Switch
                label="Published"
                description="Students can see published assignments. Turn this off to save it as a draft."
                key={form.key('published')}
                {...form.getInputProps('published', { type: 'checkbox' })}
              />
            </Stack>
          </Card>

          <StarterCodeCard form={form} language={language} />

          {language && supportsTests && <TestsEditor form={form} language={language} />}
          {droppedTests > 0 && (
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} title={`${language?.name} can't have tests`}>
              <Text size="sm">
                The {droppedTests} test{droppedTests === 1 ? '' : 's'} on this assignment will be removed when you save. Switch back to
                another language to keep them.
              </Text>
            </Alert>
          )}

          <SaveBar form={form} isNew={isNew} saving={create.isPending || update.isPending} onCancel={() => navigate(cancelTo)} />
        </Stack>
      </form>

      <PreviewModal opened={previewOpen} onClose={() => setPreviewOpen(false)} language={language ?? null} content={preview} />

      <Modal opened={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Discard unsaved changes?" size="md">
        <Text size="sm">You've changed this assignment without saving. If you leave now, those changes are lost.</Text>
        <Group justify="flex-end" gap="sm" mt="lg">
          <Button variant="default" onClick={() => blocker.reset?.()} data-autofocus>
            Keep editing
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            Discard changes
          </Button>
        </Group>
      </Modal>
    </>
  );
}

function StarterCodeCard({ form, language }: { form: EditorForm; language: Language | undefined }) {
  const code = form.useWatchValue('starterCode');
  const setCode = (value: string) => form.setFieldValue('starterCode', value, { forceUpdate: false });

  const applyDefault = () => {
    if (!language) return;
    if (!code.trim()) return setCode(language.starterCode);
    modals.openConfirmModal({
      title: 'Replace starter code?',
      children: <Text size="sm">This replaces the starter code with the default {language.name} program.</Text>,
      labels: { confirm: 'Replace', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => setCode(language.starterCode),
    });
  };

  return (
    <Card>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="sm">
        <Title order={3} fz="h4">
          Starter code
        </Title>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconRestore size={16} />}
          onClick={applyDefault}
          disabled={!language || code === language.starterCode}
        >
          Use language default
        </Button>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Every student starts with this code. Leave it empty for a blank editor.
      </Text>
      {language ? (
        <CodeEditor value={code} onChange={setCode} language={language} height="auto" minHeight={200} maxHeight={480} ariaLabel="Starter code" />
      ) : (
        <Text size="sm" c="dimmed">
          Choose a language first.
        </Text>
      )}
    </Card>
  );
}

function SaveBar({ form, isNew, saving, onCancel }: { form: EditorForm; isNew: boolean; saving: boolean; onCancel: () => void }) {
  const published = form.useWatchValue('published');
  return (
    <Paper withBorder shadow="md" p="sm" className={classes.saveBar}>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text size="sm" c="dimmed">
          {published
            ? isNew
              ? 'Students see the assignment as soon as you publish it.'
              : 'Students can see this assignment.'
            : "Draft: students can't see it yet."}
        </Text>
        <Group gap="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} leftSection={published ? <IconSend size={18} /> : <IconDeviceFloppy size={18} />}>
            {published ? (isNew ? 'Publish assignment' : 'Save changes') : 'Save as draft'}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
