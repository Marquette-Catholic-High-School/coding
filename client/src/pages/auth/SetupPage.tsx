import { Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { setupSchema } from '@codeclass/shared';
import { IconRocket } from '@tabler/icons-react';
import { Navigate } from 'react-router';
import { useSetup, useSetupStatus } from '../../api/auth';
import { ApiError, fieldErrors } from '../../api/client';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageLoader } from '../../components/QueryState';
import { ServerUnreachable } from '../../components/ServerUnreachable';
import { usePageTitle } from '../../hooks/usePageTitle';
import { AuthCard } from '../../layout/AuthLayout';
import { withPasswordConfirm } from './formValidation';

const validateSetup = withPasswordConfirm(schemaResolver(setupSchema, { sync: true }), 'password', 'confirmPassword');

/** First run: create the admin account (GuestOnly sends signed-in users away). */
export function SetupPage() {
  usePageTitle('Set up');
  const status = useSetupStatus();
  const setup = useSetup();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', username: '', email: '', password: '', confirmPassword: '' },
    validate: validateSetup,
  });

  if (status.isPending) return <PageLoader label="Loading…" fullPage />;
  if (status.isError) return <ServerUnreachable onRetry={() => void status.refetch()} />;
  if (!status.data.needsSetup) return <Navigate to="/login" replace />;

  const handleSubmit = form.onSubmit(({ confirmPassword: _confirm, ...values }) => {
    setup.mutate(values, {
      onSuccess: () =>
        notifySuccess('Welcome to CodeClass!', 'JavaScript, Python and Classroom Pseudocode are ready. Create your first class next.'),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          notifyError(err, 'Already set up');
          void status.refetch();
          return;
        }
        const errors = fieldErrors(err);
        if (Object.keys(errors).length > 0) form.setErrors(errors);
        else notifyError(err, "Couldn't create the admin account");
      },
    });
  });

  return (
    <AuthCard title="Welcome to CodeClass" subtitle="Create the admin account for your school">
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Your name"
            placeholder="e.g. Alex Morgan"
            required
            autoFocus
            autoComplete="name"
            key={form.key('name')}
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Username"
            description="You'll use this to sign in"
            placeholder="e.g. amorgan"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            key={form.key('username')}
            {...form.getInputProps('username')}
          />
          <TextInput
            label="Email"
            description="Optional. You can sign in with it too."
            placeholder="e.g. amorgan@school.org"
            type="email"
            autoComplete="email"
            key={form.key('email')}
            {...form.getInputProps('email')}
          />
          <PasswordInput
            label="Password"
            description="At least 8 characters"
            required
            autoComplete="new-password"
            key={form.key('password')}
            {...form.getInputProps('password')}
          />
          <PasswordInput
            label="Confirm password"
            required
            autoComplete="new-password"
            key={form.key('confirmPassword')}
            {...form.getInputProps('confirmPassword')}
          />
          <Text size="sm" c="dimmed">
            We'll also install JavaScript, Python and a Classroom Pseudocode language so your classes can start coding
            straight away. You can add more languages later.
          </Text>
          <Button type="submit" fullWidth size="md" leftSection={<IconRocket size={18} />} loading={setup.isPending}>
            Create admin account
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
