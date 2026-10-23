import { Alert, Button, Group, Loader, Modal, Paper, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { useForm } from '@mantine/form';
import { joinCodeSchema } from '@codeclass/shared';
import { IconAlertCircle, IconAlertTriangle, IconSchool } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { useJoinPreview } from '../../api/auth';
import { useJoinClass } from '../../api/classes';
import { ApiError, fieldErrors } from '../../api/client';
import { notifyError, notifySuccess } from '../../components/notify';

function ClassPreview({ code }: { code: string }) {
  const preview = useJoinPreview(code);
  if (!preview.isFetching && !preview.data && !preview.isError) return null;

  if (preview.isPending && preview.isFetching) {
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Looking up the class…
        </Text>
      </Group>
    );
  }
  if (preview.isError) {
    const unknown = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <Alert variant="light" color="red" icon={<IconAlertCircle />} title={unknown ? 'No class has that code' : "Couldn't check that code"}>
        <Text size="sm">{unknown ? 'Check the code with your teacher — it is 6 letters and numbers.' : preview.error.message}</Text>
      </Alert>
    );
  }
  if (!preview.data) return null;
  const { className, teacherName, joinEnabled } = preview.data;
  if (!joinEnabled) {
    return (
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle />} title={`${className} isn't taking new students`}>
        <Text size="sm">Ask {teacherName} to turn joining back on.</Text>
      </Alert>
    );
  }
  return (
    <Paper withBorder p="sm">
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" size={36} radius="xl">
          <IconSchool size={20} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text fw={600} truncate>
            {className}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            Teacher: {teacherName}
          </Text>
        </div>
      </Group>
    </Paper>
  );
}

/** Students enter a class code, see which class it is, and join it. */
export function JoinClassModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const join = useJoinClass();
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: { joinCode: '' },
    validate: {
      joinCode: (value) => {
        const result = joinCodeSchema.safeParse(value);
        return result.success ? null : (result.error.issues[0]?.message ?? 'Enter the code from your teacher');
      },
    },
  });
  const code = form.useWatchValue('joinCode');

  const close = () => {
    onClose();
    form.reset();
    join.reset();
  };

  const submit = form.onSubmit(async ({ joinCode }) => {
    try {
      const { class: cls } = await join.mutateAsync(joinCode.trim().toUpperCase());
      notifySuccess(`You joined ${cls.name}`, 'Its assignments will show up on your dashboard.');
      close();
      navigate(`/classes/${cls.id}`);
    } catch (err) {
      const errors = fieldErrors(err);
      if (Object.keys(errors).length > 0) form.setErrors(errors);
      else notifyError(err, "Couldn't join the class");
    }
  });

  return (
    <Modal opened={opened} onClose={close} title="Join a class" size="md">
      <form noValidate onSubmit={submit}>
        <Stack gap="md">
          <TextInput
            data-autofocus
            required
            label="Class code"
            description="Your teacher will give you a 6-character code."
            placeholder="e.g. K7Q2MX"
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            styles={{ input: { textTransform: 'uppercase', fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.12em' } }}
            key={form.key('joinCode')}
            {...form.getInputProps('joinCode')}
          />
          <ClassPreview code={code} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={join.isPending}>
              Join class
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
