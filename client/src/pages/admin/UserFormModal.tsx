// "Add user" / "Edit user" modal for the users admin page.

import { Button, Group, Modal, Select, Stack, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { createUserSchema, updateUserSchema, type Role, type UserWithStats } from '@codeclass/shared';
import { IconAt } from '@tabler/icons-react';
import { useCreateUser, useUpdateUser } from '../../api/users';
import { fieldErrors } from '../../api/client';
import { notifyError, notifySuccess } from '../../components/notify';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'teacher', label: 'Teacher' },
  { value: 'admin', label: 'Admin' },
  { value: 'student', label: 'Student' },
];

const ROLE_HELP: Record<Role, string> = {
  teacher: 'Creates classes and assignments, and designs pseudocode languages.',
  admin: 'Everything a teacher can do, plus managing users and installing languages.',
  student: 'Joins classes and does coding work.',
};

const validateCreate = schemaResolver(createUserSchema, { sync: true });
const validateUpdate = schemaResolver(updateUserSchema, { sync: true });

export interface Credentials {
  name: string;
  username: string;
  password: string;
}

/**
 * Keep `user` set while the modal animates closed (toggle `opened` only) so the title doesn't flip.
 * The form is re-created every time the modal opens.
 */
export function UserFormModal({
  opened,
  user,
  defaultRole,
  isSelf,
  onClose,
  onCreated,
}: {
  opened: boolean;
  /** Null to add a new user. */
  user: UserWithStats | null;
  defaultRole: Role;
  isSelf: boolean;
  onClose: () => void;
  onCreated: (credentials: Credentials) => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={user ? 'Edit user' : 'Add user'} size="md">
      {user ? (
        <EditUserForm key={user.id} user={user} isSelf={isSelf} onClose={onClose} />
      ) : (
        <CreateUserForm defaultRole={defaultRole} onClose={onClose} onCreated={onCreated} />
      )}
    </Modal>
  );
}

function CreateUserForm({
  defaultRole,
  onClose,
  onCreated,
}: {
  defaultRole: Role;
  onClose: () => void;
  onCreated: (credentials: Credentials) => void;
}) {
  const createUser = useCreateUser();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', username: '', email: '', role: defaultRole as string },
    validate: validateCreate,
  });
  const role = form.useWatchValue('role') as Role;

  const handleSubmit = form.onSubmit((values) => {
    createUser.mutate(
      { ...values, role: values.role as Role },
      {
        onSuccess: ({ user, temporaryPassword }) => {
          notifySuccess(`${user.name} added`, "Give them the temporary password — they'll choose their own when they sign in.");
          onClose();
          onCreated({ name: user.name, username: user.username, password: temporaryPassword });
        },
        onError: (err) => {
          const errors = fieldErrors(err);
          if (Object.keys(errors).length > 0) form.setErrors(errors);
          else notifyError(err, "Couldn't add the user");
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={handleSubmit}>
      <Stack gap="md">
        <TextInput
          label="Name"
          placeholder="e.g. Alex Morgan"
          required
          data-autofocus
          key={form.key('name')}
          {...form.getInputProps('name')}
        />
        <TextInput
          label="Username"
          description="Used to sign in"
          placeholder="e.g. amorgan"
          required
          autoCapitalize="none"
          spellCheck={false}
          key={form.key('username')}
          {...form.getInputProps('username')}
        />
        <TextInput
          label="Email"
          description="Optional. They can sign in with it too."
          placeholder="e.g. amorgan@school.org"
          type="email"
          key={form.key('email')}
          {...form.getInputProps('email')}
        />
        <Select
          label="Role"
          description={ROLE_HELP[role]}
          data={ROLE_OPTIONS}
          allowDeselect={false}
          required
          key={form.key('role')}
          {...form.getInputProps('role')}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={createUser.isPending}>
            Add user
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function EditUserForm({ user, isSelf, onClose }: { user: UserWithStats; isSelf: boolean; onClose: () => void }) {
  const updateUser = useUpdateUser();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: user.name, email: user.email ?? '', role: user.role as string },
    validate: validateUpdate,
  });
  const role = form.useWatchValue('role') as Role;

  const handleSubmit = form.onSubmit((values) => {
    updateUser.mutate(
      { id: user.id, name: values.name, email: values.email, ...(isSelf ? {} : { role: values.role as Role }) },
      {
        onSuccess: ({ user: saved }) => {
          notifySuccess('Changes saved', `${saved.name}'s account is up to date.`);
          onClose();
        },
        onError: (err) => {
          const errors = fieldErrors(err);
          if (Object.keys(errors).length > 0) form.setErrors(errors);
          else notifyError(err, "Couldn't save the changes");
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={handleSubmit}>
      <Stack gap="md">
        <TextInput label="Username" description="Usernames can't be changed" value={user.username} readOnly leftSection={<IconAt size={16} />} />
        <TextInput label="Name" required data-autofocus key={form.key('name')} {...form.getInputProps('name')} />
        <TextInput
          label="Email"
          description="Optional. They can sign in with it too."
          placeholder="e.g. amorgan@school.org"
          type="email"
          key={form.key('email')}
          {...form.getInputProps('email')}
        />
        <Select
          label="Role"
          description={isSelf ? "You can't change your own role." : ROLE_HELP[role]}
          data={ROLE_OPTIONS}
          allowDeselect={false}
          disabled={isSelf}
          required
          key={form.key('role')}
          {...form.getInputProps('role')}
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={updateUser.isPending}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
