import { Button, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useNavigate } from 'react-router';
import { useCreateClass } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { notifyError, notifySuccess } from '../../components/notify';
import { ClassLanguagesSelect } from './ClassLanguagesSelect';
import { validateClassLanguages } from './classForm';

/** "Create class" modal; on success it opens the new class on its Students tab. */
export function CreateClassModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateClass();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', description: '', languageIds: [] as string[] },
    validate: {
      name: (value) => (value.trim() ? null : 'Give your class a name'),
      languageIds: validateClassLanguages,
    },
  });

  const close = () => {
    onClose();
    form.reset();
    create.reset();
  };

  const submit = form.onSubmit(async (values) => {
    try {
      const { class: cls } = await create.mutateAsync(values);
      notifySuccess(
        `${cls.name} is ready`,
        `Next, add your students: share the class code ${cls.joinCode} or the join link, or add them yourself.`,
      );
      close();
      navigate(`/classes/${cls.id}?tab=students`);
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't create the class");
    }
  });

  return (
    <Modal opened={opened} onClose={close} title="Create class" size="md">
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            data-autofocus
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
          <ClassLanguagesSelect required key={form.key('languageIds')} {...form.getInputProps('languageIds')} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create class
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
