import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import type { Language, Project } from '@codeclass/shared';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { fieldErrors } from '../../api/client';
import { useLanguages } from '../../api/languages';
import { useCreateProject, useDeleteProject, useUpdateProject } from '../../api/projects';
import { LanguageIcon } from '../../components/LanguageIcon';
import { notifyError, notifySuccess } from '../../components/notify';

const validateTitle = (value: string) => {
  const title = value.trim();
  if (!title) return 'Give your project a name';
  if (title.length > 80) return 'At most 80 characters';
  return null;
};

function languageOptions(languages: Language[]) {
  const enabled = languages.filter((l) => l.enabled).sort((a, b) => a.name.localeCompare(b.name));
  const packs = enabled.filter((l) => l.kind !== 'pseudocode');
  const pseudo = enabled.filter((l) => l.kind === 'pseudocode');
  const toItem = (l: Language) => ({ value: l.id, label: l.name });
  return {
    count: enabled.length,
    byId: new Map(enabled.map((l) => [l.id, l])),
    data: [
      ...(packs.length ? [{ group: 'Programming languages', items: packs.map(toItem) }] : []),
      ...(pseudo.length ? [{ group: 'Pseudocode', items: pseudo.map(toItem) }] : []),
    ],
  };
}

/** "New project": title + an enabled language; opens the project when created. */
export function NewProjectModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const languages = useLanguages();
  const options = useMemo(() => languageOptions(languages.data?.languages ?? []), [languages.data]);
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { title: '', languageId: null as string | null },
    validate: {
      title: validateTitle,
      languageId: (value) => (value ? null : 'Pick a language'),
    },
  });
  const languageId = form.useWatchValue('languageId');
  const selected = languageId ? options.byId.get(languageId) : undefined;

  const close = () => {
    onClose();
    form.reset();
    create.reset();
  };

  const submit = form.onSubmit(async ({ title, languageId: id }) => {
    try {
      const { project } = await create.mutateAsync({ title: title.trim(), languageId: id ?? '' });
      notifySuccess('Project created', 'Write some code and press Run — it saves as you type.');
      close();
      navigate(`/playground/${project.id}`);
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't create the project");
    }
  });

  const noLanguages = languages.isSuccess && options.count === 0;

  return (
    <Modal opened={opened} onClose={close} title="New project" size="md">
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            data-autofocus
            required
            label="Project name"
            placeholder="e.g. Guess the number"
            maxLength={80}
            key={form.key('title')}
            {...form.getInputProps('title')}
          />
          {languages.isError ? (
            <Alert variant="light" color="red" icon={<IconAlertCircle />} title="Couldn't load the languages">
              <Button size="xs" variant="white" color="red" onClick={() => void languages.refetch()}>
                Try again
              </Button>
            </Alert>
          ) : noLanguages ? (
            <Alert variant="light" color="yellow" icon={<IconAlertCircle />} title="No languages are installed yet">
              Ask an admin to install a language pack first.
            </Alert>
          ) : (
            <Select
              required
              label="Language"
              placeholder={languages.isPending ? 'Loading languages…' : 'Pick a language'}
              disabled={languages.isPending}
              data={options.data}
              searchable
              nothingFoundMessage="No language with that name"
              leftSection={selected ? <LanguageIcon kind={selected.kind} size={16} /> : undefined}
              renderOption={({ option }) => {
                const lang = options.byId.get(option.value);
                return (
                  <Group gap="xs" wrap="nowrap">
                    {lang && <LanguageIcon kind={lang.kind} size={16} />}
                    {option.label}
                  </Group>
                );
              }}
              key={form.key('languageId')}
              {...form.getInputProps('languageId')}
            />
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={noLanguages || languages.isError}>
              Create project
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Rename a project. Mount it only while renaming (it is always open). */
export function RenameProjectModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const update = useUpdateProject(project.id);
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { title: project.title },
    validate: { title: validateTitle },
  });

  const submit = form.onSubmit(async ({ title }) => {
    try {
      await update.mutateAsync({ title: title.trim() });
      notifySuccess('Project renamed');
      onClose();
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't rename the project");
    }
  });

  return (
    <Modal opened onClose={onClose} title="Rename project" size="md">
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <TextInput data-autofocus required label="Project name" maxLength={80} key={form.key('title')} {...form.getInputProps('title')} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Confirms and deletes a project; `onDeleted` runs after it is gone. */
export function useConfirmDeleteProject() {
  const remove = useDeleteProject();
  return (project: Project, onDeleted?: () => void) => {
    const modalId = modals.openConfirmModal({
      title: 'Delete project?',
      children: <Text size="sm">"{project.title}" and its code will be deleted for good.</Text>,
      labels: { confirm: 'Delete project', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      closeOnConfirm: false,
      onConfirm: async () => {
        modals.updateModal({ modalId, confirmProps: { color: 'red', loading: true } });
        try {
          await remove.mutateAsync(project.id);
          notifySuccess('Project deleted');
          onDeleted?.();
        } catch (err) {
          notifyError(err, "Couldn't delete the project");
        } finally {
          modals.close(modalId);
        }
      },
    });
  };
}
