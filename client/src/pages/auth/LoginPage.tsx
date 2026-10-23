import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { loginSchema } from '@codeclass/shared';
import { IconAlertCircle, IconLogin2 } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useLogin, useSetupStatus } from '../../api/auth';
import { errorMessage, fieldErrors, NetworkError } from '../../api/client';
import { PageLoader } from '../../components/QueryState';
import { ServerUnreachable } from '../../components/ServerUnreachable';
import { usePageTitle } from '../../hooks/usePageTitle';
import { AuthCard } from '../../layout/AuthLayout';

const validateLogin = schemaResolver(loginSchema, { sync: true });

/**
 * Sign in with username or email. On success the user is stored in the auth context and
 * GuestOnly (the parent route) redirects to `?next=` or the dashboard.
 */
export function LoginPage() {
  usePageTitle('Sign in');
  const status = useSetupStatus();
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { login: '', password: '' },
    validate: validateLogin,
  });

  if (status.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (status.isPending) return <PageLoader label="Loading…" fullPage />;
  if (status.error instanceof NetworkError) return <ServerUnreachable onRetry={() => void status.refetch()} />;

  const handleSubmit = form.onSubmit((values) => {
    setError(null);
    login.mutate(values, {
      onError: (err) => {
        const errors = fieldErrors(err);
        if (Object.keys(errors).length > 0) form.setErrors(errors);
        else setError(errorMessage(err));
      },
    });
  });

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back! Sign in to get coding."
      footer={
        <>
          Have a class code?{' '}
          <Anchor component={Link} to="/join" fw={600}>
            Join your class
          </Anchor>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          {error && (
            <Alert variant="light" color="red" icon={<IconAlertCircle size={18} />} title="Couldn't sign you in">
              <Text size="sm">{error}</Text>
            </Alert>
          )}
          <TextInput
            label="Username or email"
            placeholder="e.g. sam.patel"
            required
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            key={form.key('login')}
            {...form.getInputProps('login')}
          />
          <PasswordInput
            label="Password"
            required
            autoComplete="current-password"
            key={form.key('password')}
            {...form.getInputProps('password')}
          />
          <Button type="submit" fullWidth size="md" leftSection={<IconLogin2 size={18} />} loading={login.isPending}>
            Sign in
          </Button>
          <Text size="xs" c="dimmed" ta="center">
            Forgot your password? Ask your teacher or a CodeClass admin to reset it.
          </Text>
        </Stack>
      </form>
    </AuthCard>
  );
}
