import { Alert, Avatar, Button, Card, Grid, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { changePasswordSchema, updateProfileSchema, type User } from '@codeclass/shared';
import { IconAlertTriangle, IconAt, IconDeviceFloppy, IconKey } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useChangePassword, useUpdateProfile } from '../../api/auth';
import { fieldErrors } from '../../api/client';
import { useAuth, useCurrentUser } from '../../auth/AuthProvider';
import { RoleBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { usePageTitle } from '../../hooks/usePageTitle';
import { withPasswordConfirm } from '../auth/formValidation';
import { profileJoinNotice } from '../auth/joinedClasses';

const validateProfile = schemaResolver(updateProfileSchema, { sync: true });
const validatePassword = withPasswordConfirm(
  schemaResolver(changePasswordSchema, { sync: true }),
  'newPassword',
  'confirmPassword',
);

export function AccountPage() {
  usePageTitle('Account settings');
  const user = useCurrentUser();
  // A teacher or admin using this student's account can look but not change it (the server refuses too).
  const studentView = useAuth().impersonator != null;

  return (
    <>
      <PageHeader title="Account settings" subtitle={studentView ? `${user.name}'s profile and password.` : 'Your profile and password.'} />
      {user.mustChangePassword && !studentView && (
        <Alert color="yellow" variant="light" mb="lg" icon={<IconAlertTriangle />} title="You're using a temporary password">
          <Text size="sm">Choose your own password below so only you can sign in.</Text>
        </Alert>
      )}
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <ProfileCard
            user={user}
            lockedReason={studentView ? `You're signed in as ${user.name}. Only they can change their name or email.` : undefined}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <PasswordCard
            temporary={user.mustChangePassword}
            lockedReason={studentView ? `You're signed in as ${user.name}. Only they can change their password.` : undefined}
          />
        </Grid.Col>
      </Grid>
    </>
  );
}

/** `lockedReason`: shown instead of letting the profile be edited. */
function ProfileCard({ user, lockedReason }: { user: User; lockedReason?: string }) {
  const updateProfile = useUpdateProfile();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: user.name, email: user.email ?? '' },
    validate: validateProfile,
  });

  // Re-seed untouched fields if the profile changes elsewhere (e.g. an admin edits their own row on the Users page),
  // so saving this form can't send the old name back.
  useEffect(() => {
    const current = { name: user.name, email: user.email ?? '' };
    if (form.isDirty()) return;
    form.setValues(current);
    form.resetDirty(current);
  }, [user.name, user.email]); // `form` is deliberately left out: only a change to the saved profile should re-seed.

  const handleSubmit = form.onSubmit((values) => {
    updateProfile.mutate(values, {
      onSuccess: ({ user: saved, joinedClasses }) => {
        form.setValues({ name: saved.name, email: saved.email ?? '' });
        form.resetDirty();
        notifySuccess('Profile saved');
        // A student who saves an email address a teacher added joins those classes.
        const joined = profileJoinNotice(joinedClasses);
        if (joined) notifySuccess(joined.title, joined.message);
      },
      onError: (err) => {
        const errors = fieldErrors(err);
        if (Object.keys(errors).length > 0) form.setErrors(errors);
        else notifyError(err, "Couldn't save your profile");
      },
    });
  });

  return (
    <Card h="100%">
      <Group justify="space-between" mb="sm">
        <Title order={3} fz="h4">
          Profile
        </Title>
      </Group>
      <Group gap="md" wrap="nowrap" mb="lg">
        <Avatar name={user.name} color="initials" radius="xl" size={48} />
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={600} truncate>
              {user.name}
            </Text>
            <RoleBadge role={user.role} />
          </Group>
          <Text size="sm" c="dimmed">
            Member since {dayjs(user.createdAt).format('MMMM YYYY')}
          </Text>
        </Stack>
      </Group>
      {lockedReason && (
        <Text size="sm" c="dimmed" mb="md">
          {lockedReason}
        </Text>
      )}
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Username"
            description="Used to sign in. Usernames can't be changed."
            value={user.username}
            readOnly
            leftSection={<IconAt size={16} />}
          />
          <TextInput
            label="Name"
            placeholder="e.g. Sam Patel"
            required
            autoComplete="name"
            disabled={!!lockedReason}
            key={form.key('name')}
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Email"
            description={
              user.role === 'student'
                ? "Optional. You can sign in with it instead of your username, and if a teacher added it to a class, you'll join that class."
                : 'Optional. You can sign in with it instead of your username.'
            }
            placeholder="e.g. sam.patel@school.org"
            type="email"
            autoComplete="email"
            disabled={!!lockedReason}
            key={form.key('email')}
            {...form.getInputProps('email')}
          />
          {!lockedReason && (
            <Group justify="flex-end">
              <Button type="submit" leftSection={<IconDeviceFloppy size={18} />} loading={updateProfile.isPending}>
                Save profile
              </Button>
            </Group>
          )}
        </Stack>
      </form>
    </Card>
  );
}

/** `lockedReason`: shown instead of the change-password form. */
function PasswordCard({ temporary, lockedReason }: { temporary: boolean; lockedReason?: string }) {
  return (
    <Card h="100%">
      <Group justify="space-between" mb="sm">
        <Title order={3} fz="h4">
          Password
        </Title>
      </Group>
      {lockedReason ? (
        <Text size="sm" c="dimmed">
          {lockedReason}
        </Text>
      ) : (
        <ChangePasswordForm temporary={temporary} />
      )}
    </Card>
  );
}

function ChangePasswordForm({ temporary }: { temporary: boolean }) {
  const changePassword = useChangePassword();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validate: validatePassword,
  });

  const handleSubmit = form.onSubmit(({ confirmPassword: _confirm, ...values }) => {
    changePassword.mutate(values, {
      onSuccess: () => {
        form.reset();
        notifySuccess('Password changed', "You've been signed out on your other devices.");
      },
      onError: (err) => {
        const errors = fieldErrors(err);
        if (Object.keys(errors).length > 0) form.setErrors(errors);
        else notifyError(err, "Couldn't change your password");
      },
    });
  });

  return (
    <>
      <Text size="sm" c="dimmed" mb="lg">
        Changing your password signs you out everywhere else.
      </Text>
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          <PasswordInput
            label="Current password"
            description={temporary ? 'The temporary password you were given' : undefined}
            required
            autoComplete="current-password"
            key={form.key('currentPassword')}
            {...form.getInputProps('currentPassword')}
          />
          <PasswordInput
            label="New password"
            description="At least 8 characters"
            required
            autoComplete="new-password"
            key={form.key('newPassword')}
            {...form.getInputProps('newPassword')}
          />
          <PasswordInput
            label="Confirm new password"
            required
            autoComplete="new-password"
            key={form.key('confirmPassword')}
            {...form.getInputProps('confirmPassword')}
          />
          <Group justify="flex-end">
            <Button type="submit" leftSection={<IconKey size={18} />} loading={changePassword.isPending}>
              Change password
            </Button>
          </Group>
        </Stack>
      </form>
    </>
  );
}
