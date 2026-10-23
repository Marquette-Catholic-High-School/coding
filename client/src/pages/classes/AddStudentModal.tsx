import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { usernameSchema, type AddStudentResponse } from '@codeclass/shared';
import { useAddStudent } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { notifyError } from '../../components/notify';

/** "sam smith" → "sam.smith" (a suggestion the teacher can change). */
function suggestUsername(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
}

/**
 * Adds a student to the class: creates an account with a temporary password, or enrolls an existing student
 * when the username matches one. `onAdded` receives the server response (temporaryPassword is null for
 * existing accounts).
 */
export function AddStudentModal({
  classId,
  className,
  opened,
  onClose,
  onAdded,
}: {
  classId: number;
  className: string;
  opened: boolean;
  onClose: () => void;
  onAdded: (result: AddStudentResponse) => void;
}) {
  const add = useAddStudent(classId);
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', username: '' },
    validate: {
      name: (value) => (value.trim() ? null : "Enter the student's name"),
      username: (value) => {
        const result = usernameSchema.safeParse(value);
        return result.success ? null : (result.error.issues[0]?.message ?? 'Enter a username');
      },
    },
  });

  const close = () => {
    onClose();
    form.reset();
    add.reset();
  };

  const submit = form.onSubmit(async (values) => {
    try {
      const result = await add.mutateAsync(values);
      close();
      onAdded(result);
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't add the student");
    }
  });

  const nameProps = form.getInputProps('name');

  return (
    <Modal opened={opened} onClose={close} title="Add student" size="md">
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Add a student to {className}. New students get a temporary password to sign in with; they choose their own
            afterwards.
          </Text>
          <TextInput
            data-autofocus
            required
            label="Full name"
            placeholder="e.g. Sam Smith"
            maxLength={80}
            key={form.key('name')}
            {...nameProps}
            onBlur={(event) => {
              nameProps.onBlur?.(event);
              const { name, username } = form.getValues();
              if (!username.trim() && name.trim()) form.setFieldValue('username', suggestUsername(name));
            }}
          />
          <TextInput
            required
            label="Username"
            description="Letters, numbers, dots, dashes and underscores. If the student already has a CodeClass account, enter their username to add them to this class."
            placeholder="e.g. sam.smith"
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            key={form.key('username')}
            {...form.getInputProps('username')}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={add.isPending}>
              Add student
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
