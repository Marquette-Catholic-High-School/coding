import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { joinClassSchema, type User } from '@codeclass/shared';
import { IconArrowLeft, IconLayoutDashboard, IconLogout, IconMail, IconSchool, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
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
import { EMAIL_REQUIRED_MESSAGE, validateJoinAccount, type JoinAccountValues } from './formValidation';
import { pathAfterSignUp, signUpNotice } from './joinedClasses';

const codeValidator = schemaResolver(joinClassSchema, { sync: true });

function useCodeForm(initialCode: string) {
  return useForm({ mode: 'uncontrolled', initialValues: { joinCode: initialCode }, validate: codeValidator });
}

/** `/join?email=1` opens the sign-up for students whose teacher added their email address (InvitesCard links to it). */
function useEmailMode(): boolean {
  const [params] = useSearchParams();
  return params.has('email') && params.get('email') !== '0';
}

/**
 * /join and /join/:code. Not wrapped in an auth guard, so it handles every audience itself:
 * signed out → class code (or the email address a teacher added), then create a student account; student → join
 * directly; staff → explanation.
 */
export function JoinPage() {
  usePageTitle('Join a class');
  const { user, isLoading, error, refresh } = useAuth();
  const { code } = useParams();
  const initialCode = normalizeJoinCode(code ?? '').slice(0, 6);
  // A class code in the link wins over ?email.
  const emailMode = useEmailMode() && !initialCode;
  // Registering signs the new student in; keep showing the sign-up flow until it navigates away.
  const [registering, setRegistering] = useState(false);

  if (isLoading) return <PageLoader label="Loading…" fullPage />;
  if (!user && error) return <ServerUnreachable onRetry={() => void refresh()} />;
  if (!user || registering) return <RegisterFlow initialCode={initialCode} emailMode={emailMode} onRegistering={setRegistering} />;
  if (user.role === 'student') return <StudentJoin user={user} initialCode={initialCode} emailMode={emailMode} />;
  return <StaffNotice user={user} initialCode={initialCode} />;
}

const EMPTY_ACCOUNT: JoinAccountValues = { name: '', username: '', email: '', password: '', confirmPassword: '' };

/**
 * Signed-out sign-up. Two ways in: a class code (an optional school email then also joins any classes that added it),
 * or "My teacher added my email instead" — no code and a required email, which joins every class that added it.
 */
function RegisterFlow({
  initialCode,
  emailMode,
  onRegistering,
}: {
  initialCode: string;
  emailMode: boolean;
  onRegistering: (active: boolean) => void;
}) {
  const navigate = useNavigate();
  const register = useRegister();
  const [step, setStep] = useState<'code' | 'account'>(emailMode ? 'account' : 'code');
  // Signing up without a class code, with the email address a teacher added.
  const [byEmail, setByEmail] = useState(emailMode);
  const codeForm = useCodeForm(initialCode);
  const state = useClassCode(codeForm.useWatchValue('joinCode'));
  const joinCode = byEmail ? null : state.code;
  const accountForm = useForm({
    mode: 'uncontrolled',
    initialValues: EMPTY_ACCOUNT,
    validate: (values) => validateJoinAccount(values, joinCode),
  });

  const switchToEmail = () => {
    accountForm.clearErrors();
    setByEmail(true);
    setStep('account');
  };
  const switchToCode = () => {
    accountForm.clearErrors();
    setByEmail(false);
    setStep('code');
  };

  // Students who already have an account add the email on their account page instead.
  const loginNext = byEmail ? '/account' : state.complete ? `/join/${state.code}` : '/join';
  const footer = (
    <>
      Already have an account?{' '}
      <Anchor component={Link} to={`/login?next=${encodeURIComponent(loginNext)}`} fw={600}>
        Sign in
      </Anchor>
      {byEmail && ' and add your email on your account page.'}
    </>
  );

  const submitCode = codeForm.onSubmit(() => {
    if (state.joinable) setStep('account');
  });

  const submitAccount = accountForm.onSubmit(({ confirmPassword: _confirm, ...values }) => {
    const codeClassName = byEmail ? null : (state.preview.data?.className ?? 'your class');
    onRegistering(true);
    register.mutate(
      { ...values, email: values.email.trim(), joinCode: joinCode ?? undefined },
      {
        onSuccess: ({ joinedClasses }) => {
          const notice = signUpNotice(joinedClasses, codeClassName);
          notifySuccess(notice.title, notice.message);
          navigate(pathAfterSignUp(joinedClasses), { replace: true });
        },
        onError: (err) => {
          onRegistering(false);
          const { joinCode: codeError, ...errors } = fieldErrors(err);
          if (codeError && byEmail) {
            // Without a code, the server's "class code or email" error is about the email.
            accountForm.setErrors({ ...errors, email: errors.email ?? EMAIL_REQUIRED_MESSAGE });
          } else if (codeError) {
            accountForm.setErrors(errors);
            setStep('code');
            codeForm.setFieldError('joinCode', codeError);
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
            <Text size="sm" ta="center" c="dimmed">
              No class code?{' '}
              <Anchor component="button" type="button" size="sm" fw={600} onClick={switchToEmail}>
                My teacher added my email instead
              </Anchor>
            </Text>
          </Stack>
        </form>
      </AuthCard>
    );
  }

  const emailField = (
    <TextInput
      label="School email"
      description={
        byEmail
          ? 'Exactly the address your teacher added — usually your school email'
          : "Optional — if your teacher added your email to other classes, you'll join those too"
      }
      placeholder="e.g. sam.patel@school.org"
      type="email"
      required={byEmail}
      autoFocus={byEmail}
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
      key={accountForm.key('email')}
      {...accountForm.getInputProps('email')}
    />
  );

  return (
    <AuthCard
      title="Create your account"
      subtitle={byEmail ? 'Sign up with the email address your teacher added to your class.' : "You'll use these details to sign in to CodeClass."}
      footer={footer}
    >
      <Stack gap="md">
        {byEmail ? (
          <Alert variant="light" color="grape" icon={<IconMail size={18} />}>
            <Stack gap={4} align="flex-start">
              <Text size="sm">You'll join every class your teacher added this email address to.</Text>
              <Anchor component="button" type="button" size="sm" fw={600} onClick={switchToCode}>
                I have a class code instead
              </Anchor>
            </Stack>
          </Alert>
        ) : (
          <ClassPreviewCard
            state={state}
            action={
              <Button variant="subtle" size="xs" leftSection={<IconArrowLeft size={14} />} onClick={() => setStep('code')}>
                Change
              </Button>
            }
          />
        )}
        <form noValidate onSubmit={submitAccount}>
          <Stack gap="md">
            {byEmail && emailField}
            <TextInput
              label="Your name"
              description="Your teacher will see this"
              placeholder="e.g. Sam Patel"
              required
              autoFocus={!byEmail}
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
            {!byEmail && emailField}
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
              {byEmail ? 'Create account' : 'Create account and join'}
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

/** Signed-in student who opened the "my teacher added my email" link: joining by email happens on the account page. */
function EmailJoinHint({ user }: { user: User }) {
  const accountLink = (
    <Anchor component={Link} to="/account" inherit fw={600}>
      account page
    </Anchor>
  );
  return (
    <Alert variant="light" color="grape" icon={<IconMail size={18} />} title="Did your teacher add your email?">
      <Text size="sm">
        {user.email ? (
          <>
            Classes that add <b>{user.email}</b> show up on your dashboard automatically. If your teacher used a different
            address, change it on your {accountLink}.
          </>
        ) : (
          <>Add that email address on your {accountLink} and you'll join their classes automatically.</>
        )}
      </Text>
    </Alert>
  );
}

function StudentJoin({ user, initialCode, emailMode }: { user: User; initialCode: string; emailMode: boolean }) {
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
          {emailMode && <EmailJoinHint user={user} />}
          <ClassCodeField key={form.key('joinCode')} inputProps={form.getInputProps('joinCode')} state={state} autoFocus={!emailMode} />
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
