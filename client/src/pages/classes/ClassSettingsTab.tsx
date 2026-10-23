import { Button, Card, Divider, Group, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { ClassSummary } from '@codeclass/shared';
import { IconArchive, IconArchiveOff, IconDeviceFloppy, IconRefresh, IconTrash } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useDeleteClass, useRegenerateJoinCode, useUpdateClass } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { useLanguages } from '../../api/languages';
import { CodeChip } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { QueryState } from '../../components/QueryState';
import { ClassLanguagesSelect } from './ClassLanguagesSelect';
import { confirmAction } from './confirmAction';

function DetailsCard({ cls }: { cls: ClassSummary }) {
  const update = useUpdateClass(cls.id);
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: cls.name, description: cls.description, languageIds: cls.languageIds },
    validate: {
      name: (value) => (value.trim() ? null : 'Give your class a name'),
    },
  });

  const submit = form.onSubmit(async (values) => {
    try {
      const { class: saved } = await update.mutateAsync(values);
      form.resetDirty({ name: saved.name, description: saved.description, languageIds: saved.languageIds });
      notifySuccess('Class details saved', 'Students will see the changes next time they open the class.');
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't save the class details");
    }
  });

  return (
    <Card>
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <Title order={3} fz="h4">
            Class details
          </Title>
          <TextInput
            required
            label="Class name"
            placeholder="e.g. Computer Science — Period 3"
            maxLength={80}
            key={form.key('name')}
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            description="Optional. Students see this on the class page."
            placeholder="e.g. Year 9 introduction to programming — Mondays and Thursdays"
            autosize
            minRows={3}
            maxRows={8}
            maxLength={500}
            key={form.key('description')}
            {...form.getInputProps('description')}
          />
          <ClassLanguagesSelect keepIds={cls.languageIds} key={form.key('languageIds')} {...form.getInputProps('languageIds')} />
          <Group justify="flex-end">
            <Button type="submit" loading={update.isPending} leftSection={<IconDeviceFloppy size={18} />}>
              Save changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

function JoiningCard({ cls }: { cls: ClassSummary }) {
  const update = useUpdateClass(cls.id);
  const regenerate = useRegenerateJoinCode(cls.id);
  // Show the new position straight away while the change is saving.
  const joinEnabled = update.isPending && update.variables?.joinEnabled !== undefined ? update.variables.joinEnabled : cls.joinEnabled;

  const setJoining = async (enabled: boolean) => {
    try {
      await update.mutateAsync({ joinEnabled: enabled });
      notifySuccess(
        enabled ? 'Joining turned on' : 'Joining turned off',
        enabled ? 'Students can join with the class code or link again.' : "The class code and link won't work until you turn joining back on.",
      );
    } catch (err) {
      notifyError(err, "Couldn't change joining");
    }
  };

  const confirmRegenerate = () =>
    confirmAction({
      title: 'Make a new class code',
      message: (
        <Text component="div" size="sm">
          The current code <CodeChip>{cls.joinCode}</CodeChip> and its join link will stop working. Students already in the
          class aren't affected.
        </Text>
      ),
      confirmLabel: 'Make new code',
      color: 'brand',
      errorTitle: "Couldn't make a new code",
      action: async () => {
        const { class: updated } = await regenerate.mutateAsync();
        notifySuccess(`New class code: ${updated.joinCode}`, 'Share the new code or join link with students who still need to join.');
      },
    });

  return (
    <Card>
      <Stack gap="md">
        <Title order={3} fz="h4">
          Joining
        </Title>
        <Switch
          checked={joinEnabled}
          disabled={update.isPending}
          onChange={(event) => void setJoining(event.currentTarget.checked)}
          label="Students can join with the class code"
          description={
            cls.archived
              ? 'This class is archived, so nobody can join until you unarchive it.'
              : 'Turn this off once everyone has joined, so nobody else can.'
          }
        />
        <Divider />
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <Group gap="xs">
              <Text fw={500} size="sm">
                Class code
              </Text>
              <CodeChip>{cls.joinCode}</CodeChip>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              Make a new code if the current one has been shared with people who shouldn't join.
            </Text>
          </div>
          <Button variant="default" leftSection={<IconRefresh size={18} />} onClick={confirmRegenerate}>
            Make new code
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function ArchiveCard({ cls }: { cls: ClassSummary }) {
  const update = useUpdateClass(cls.id);

  const setArchived = async (archived: boolean) => {
    await update.mutateAsync({ archived });
    notifySuccess(
      archived ? `${cls.name} archived` : `${cls.name} is active again`,
      archived ? "You'll find it under Archived on the Classes page." : 'It is back on your class list and dashboard.',
    );
  };

  const confirmArchive = () =>
    confirmAction({
      title: 'Archive class',
      message: `Archive ${cls.name}? It will be hidden from class lists and dashboards and nobody new can join. All assignments and work are kept, and you can unarchive it any time.`,
      confirmLabel: 'Archive class',
      color: 'brand',
      errorTitle: "Couldn't archive the class",
      action: () => setArchived(true),
    });

  const unarchive = async () => {
    try {
      await setArchived(false);
    } catch (err) {
      notifyError(err, "Couldn't unarchive the class");
    }
  };

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <Title order={3} fz="h4">
            {cls.archived ? 'Unarchive class' : 'Archive class'}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            {cls.archived
              ? 'Bring this class back to your class list and dashboard.'
              : 'When the course ends, archive the class to tidy it away. Everything is kept and you can unarchive it any time.'}
          </Text>
        </div>
        {cls.archived ? (
          <Button variant="default" leftSection={<IconArchiveOff size={18} />} loading={update.isPending} onClick={() => void unarchive()}>
            Unarchive
          </Button>
        ) : (
          <Button variant="default" leftSection={<IconArchive size={18} />} onClick={confirmArchive}>
            Archive class
          </Button>
        )}
      </Group>
    </Card>
  );
}

function DangerZoneCard({ cls }: { cls: ClassSummary }) {
  const navigate = useNavigate();
  const deleteClass = useDeleteClass();
  const assignments = `${cls.assignmentCount} assignment${cls.assignmentCount === 1 ? '' : 's'}`;

  const confirmDelete = () =>
    confirmAction({
      title: 'Delete class',
      message: (
        <Text size="sm">
          Delete <b>{cls.name}</b>? This permanently deletes the class, its {assignments} and all the work students have done
          for them. Student accounts are kept. This can't be undone.
        </Text>
      ),
      confirmLabel: 'Delete class',
      errorTitle: "Couldn't delete the class",
      action: async () => {
        await deleteClass.mutateAsync(cls.id);
        navigate('/classes', { replace: true });
        notifySuccess(`${cls.name} deleted`, 'The class and its work have been removed.');
      },
    });

  return (
    <Card style={{ borderColor: 'var(--mantine-color-red-outline)' }}>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div style={{ minWidth: 0, flex: '1 1 260px' }}>
          <Title order={3} fz="h4" c="red">
            Delete class
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            Permanently delete this class, its {assignments} and all student work. If you might need the work later, archive
            the class instead.
          </Text>
        </div>
        <Button color="red" leftSection={<IconTrash size={18} />} onClick={confirmDelete}>
          Delete class
        </Button>
      </Group>
    </Card>
  );
}

export function ClassSettingsTab({ cls }: { cls: ClassSummary }) {
  // The details form needs the language list before it mounts so the picker can show the saved languages.
  const languages = useLanguages();
  return (
    <Stack gap="lg" maw={760}>
      <QueryState query={languages}>{() => <DetailsCard cls={cls} />}</QueryState>
      <JoiningCard cls={cls} />
      <ArchiveCard cls={cls} />
      <DangerZoneCard cls={cls} />
    </Stack>
  );
}
