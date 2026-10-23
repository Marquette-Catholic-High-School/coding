import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { joinClassSchema, registerSchema, type User } from '@codeclass/shared';
import { IconArrowLeft, IconLayoutDashboard, IconLogout, IconSchool, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useRegister } from '../../api/auth';
import { useJoinClass } from '../../api/classes';
import { fieldErrors } from '../../api/client';
import { useAuth, useSignOut } from '../../auth/AuthProvider';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageLoader } from '../../components/QueryState';
import { ServerUnreachable } from '../../components/ServerUnreachable';
import { usePageTitle } from '../../hooks/usePageTitle';
import { AuthCard } from '../../layout/AuthLayout';
import { ClassCodeField, ClassPreviewCard, normalizeJoinCode, useClassCode } from './ClassCodeField';
import { withPasswordConfirm } from './formValidation';

const codeValidator = schemaResolver(joinClassSchema, { sync: true });
const accountValidator = withPasswordConfirm(
  schemaResolver(registerSchema.omit({ joinCode: true }), { sync: true }),
  'password',
  'confirmPassword',
);

function useCodeForm(initialCode: string) {
  return useForm({ mode: 'uncontrolled', initialValues: { joinCode: initialCode }, validate: codeValidator });
}

/**
 * /join and /join/:code. Not wrapped in an auth guard, so it handles every audience itself:
 * signed out → class code, then create a student account; student → join directly; staff → explanation.
 */
export function JoinPage() {
  usePageTitle('Join a class');
  const { user, isLoading, error, refresh } = useAuth();
  const { code } = useParams();
  const initialCode = normalizeJoinCode(code ?? '').slice(0, 6);
  // Registering signs the new student in; keep showing the sign-up flow until it navigates away.
  const [registering, setRegistering] = useState(false);

  if (isLoading) return <PageLoader label="Loading…" fullPage />;
  if (!user && error) return <ServerUnreachable onRetry={() => void refresh()} />;
  if (!user || registering) return <RegisterFlow initialCode={initialCode} onRegistering={setRegistering} />;
  if (user.role === 'student') return <StudentJoin user={user} initialCode={initialCode} />;
  return <StaffNotice user={user} initialCode={initialCode} />;
}

function RegisterFlow({ initialCode, onRegistering }: { initialCode: string; onRegistering: (active: boolean) => void }) {
  const navigate = useNavigate();
  const register = useRegister();
  const [step, setStep] = useState<'code' | 'account'>('code');
  const codeForm = useCodeForm(initialCode);
  const state = useClassCode(codeForm.useWatchValue('joinCode'));
  const accountForm = useForm({
    mode: 'uncontrolled',
    initialValues: { name: '', username: '', password: '', confirmPassword: '' },
    validate: accountValidator,
  });

  const loginHref = `/login?next=${encodeURIComponent(state.complete ? `/join/${state.code}` : '/join')}`;
  const footer = (
    <>
      Already have an account?{' '}
      <Anchor component={Link} to={loginHref} fw={600}>
        Sign in
      </Anchor>
    </>
  );

  const submitCode = codeForm.onSubmit(() => {
    if (state.joinable) setStep('account');
  });

  const submitAccount = accountForm.onSubmit(({ confirmPassword: _confirm, ...values }) => {
    const className = state.preview.data?.className ?? 'your class';
    onRegistering(true);
    register.mutate(
      { ...values, joinCode: state.code },
      {
        onSuccess: () => {
          notifySuccess(`Welcome to ${className}!`, 'Your account is ready. Your assignments will show up on your dashboard.');
          navigate('/dashboard', { replace: true });
        },
        onError: (err) => {
          onRegistering(false);
          const errors = fieldErrors(err);
          if (errors.joinCode) {
            setStep('code');
            codeForm.setFieldError('joinCode', errors.joinCode);
            void state.preview.refetch();
          } else if (Object.keys(errors).length > 0) {
            accountForm.setErrors(errors);
          } else {
            notifyError(err, "Couldn't create your account");
          }
        },
      },
    );
  });

  if (step === 'code') {
    return (
      <AuthCard title="Join your class" subtitle="Enter the class code your teacher gave you." footer={footer}>
        <form noValidate onSubmit={submitCode}>
          <Stack gap="md">
            <ClassCodeField key={codeForm.key('joinCode')} inputProps={codeForm.getInputProps('joinCode')} state={state} autoFocus />
            <Button type="submit" fullWidth size="md" leftSection={<IconUserPlus size={18} />} loading={state.checking}>
              Next: create your account
            </Button>
          </Stack>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="You'll use these details to sign in to CodeClass." footer={footer}>
      <Stack gap="md">
        <ClassPreviewCard
          state={state}
          action={
            <Button variant="subtle" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={() => setStep('code')}>
              Change
            </Button>
          }
        />
        <form noValidate onSubmit={submitAccount}>
          <Stack gap="md">
            <TextInput
              label="Your name"
              description="Your teacher will see this"
              placeholder="e.g. Sam Patel"
              required
              autoFocus
              autoComplete="name"
              key={accountForm.key('name')}
              {...accountForm.getInputProps('name')}
            />
            <TextInput
              label="Username"
              description="Letters, numbers, dots, dashes and underscores"
              placeholder="e.g. sam.patel"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              key={accountForm.key('username')}
              {...accountForm.getInputProps('username')}
            />
            <PasswordInput
              label="Password"
              description="At least 8 characters"
              required
              autoComplete="new-password"
              key={accountForm.key('password')}
              {...accountForm.getInputProps('password')}
            />
            <PasswordInput
              label="Confirm password"
              required
              autoComplete="new-password"
              key={accountForm.key('confirmPassword')}
              {...accountForm.getInputProps('confirmPassword')}
            />
            <Button type="submit" fullWidth size="md" leftSection={<IconUserPlus size={18} />} loading={register.isPending}>
              Create account and join
            </Button>
          </Stack>
        </form>
      </Stack>
    </AuthCard>
  );
}

function SignedInAs({ user }: { user: User }) {
  const signOut = useSignOut();
  return (
    <>
      Signed in as {user.name} (@{user.username}). Not you?{' '}
      <Anchor component="button" type="button" fw={600} onClick={() => void signOut()}>
        Sign out
      </Anchor>
    </>
  );
}

function StudentJoin({ user, initialCode }: { user: User; initialCode: string }) {
  const navigate = useNavigate();
  const join = useJoinClass();
  const form = useCodeForm(initialCode);
  const state = useClassCode(form.useWatchValue('joinCode'));

  const handleSubmit = form.onSubmit(() => {
    if (!state.joinable) return;
    join.mutate(state.code, {
      onSuccess: ({ class: cls }) => {
        notifySuccess(`You're in ${cls.name}`, "Your teacher's assignments will show up in the class.");
        navigate(`/classes/${cls.id}`, { replace: true });
      },
      onError: (err) => {
        const errors = fieldErrors(err);
        if (errors.joinCode) {
          form.setFieldError('joinCode', errors.joinCode);
          void state.preview.refetch();
        } else {
          notifyError(err, "Couldn't join the class");
        }
      },
    });
  });

  return (
    <AuthCard title="Join a class" subtitle="Enter the class code your teacher gave you." footer={<SignedInAs user={user} />}>
      <form noValidate onSubmit={handleSubmit}>
        <Stack gap="md">
          <ClassCodeField key={form.key('joinCode')} inputProps={form.getInputProps('joinCode')} state={state} autoFocus />
          <Button
            type="submit"
            fullWidth
            size="md"
            leftSection={<IconSchool size={18} />}
            loading={join.isPending || state.checking}
          >
            Join class
          </Button>
          <Button component={Link} to="/dashboard" variant="subtle" fullWidth leftSection={<IconLayoutDashboard size={18} />}>
            Back to dashboard
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}

function StaffNotice({ user, initialCode }: { user: User; initialCode: string }) {
  const signOut = useSignOut();
  const state = useClassCode(initialCode);
  return (
    <AuthCard title="Class codes are for students" subtitle="Teachers and admins can't join classes with a code." footer={<SignedInAs user={user} />}>
      <Stack gap="md">
        <ClassPreviewCard state={state} />
        <Text size="sm">
          Share the code with your students so they can join at{' '}
          <Text span ff="monospace" fw={500}>
            {window.location.origin}/join
          </Text>
          . To try a class as a student, sign out and create a student account with the code.
        </Text>
        <Button component={Link} to="/dashboard" fullWidth size="md" leftSection={<IconLayoutDashboard size={18} />}>
          Go to dashboard
        </Button>
        <Button variant="default" fullWidth size="md" leftSection={<IconLogout size={18} />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </Stack>
    </AuthCard>
  );
}
