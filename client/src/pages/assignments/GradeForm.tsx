import { computeAutoScore, type Assignment, type Submission, type TestResult } from '@codeclass/shared';
import {
  Avatar,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Modal,
  NumberInput,
  RingProgress,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconArrowBackUp, IconCheck, IconDeviceFloppy, IconMathFunction } from '@tabler/icons-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { useGradeSubmission } from '../../api/assignments';
import { fieldErrors } from '../../api/client';
import { LateBadge, scoreColor, ScoreText, SubmissionStatusBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { RelativeTime } from '../../components/RelativeTime';

interface GradeValues {
  /** NumberInput yields '' while empty. */
  grade: number | string;
  feedback: string;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Group gap={6} wrap="nowrap">
        {children}
      </Group>
    </Group>
  );
}

/** Side card of the grading page: who, status, auto score, grade + feedback, save / return for revision. */
export function GradeForm({
  assignment,
  student,
  submission,
  rerunResults,
  onResultsSaved,
}: {
  assignment: Assignment;
  student: { id: number; name: string; username: string };
  submission: Submission;
  /** Results of tests the teacher re-ran in the workspace (not saved yet), or null. */
  rerunResults: TestResult[] | null;
  onResultsSaved: () => void;
}) {
  const mutation = useGradeSubmission(assignment.id);
  const [pending, setPending] = useState<'grade' | 'return' | 'results' | null>(null);
  const handedIn = submission.status === 'submitted' || submission.status === 'graded';

  const form = useForm<GradeValues>({
    mode: 'uncontrolled',
    initialValues: { grade: submission.grade ?? '', feedback: submission.feedback ?? '' },
    validate: {
      grade: (v) => {
        if (v === '' || v == null) return 'Enter a grade';
        const n = Number(v);
        return n < 0 || n > assignment.points ? `Enter a grade from 0 to ${assignment.points}` : null;
      },
    },
  });

  // Guard against losing a typed grade or feedback when moving to another student.
  const savedRef = useRef(JSON.stringify(form.getValues()));
  const getValues = form.getValues;
  const isDirty = useCallback(() => JSON.stringify(getValues()) !== savedRef.current, [getValues]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && isDirty());
  const markSaved = () => {
    savedRef.current = JSON.stringify(form.getValues());
  };

  const tests = assignment.tests;
  const results = rerunResults ?? submission.testResults;
  const autoScore = rerunResults ? computeAutoScore(tests, rerunResults) : submission.autoScore;
  const passed = results ? tests.filter((t) => results.some((r) => r.testId === t.id && r.passed)).length : 0;
  const hiddenNotRun = !!results && tests.some((t) => t.hidden && !results.some((r) => r.testId === t.id));
  const resultsPatch = rerunResults ? { testResults: rerunResults, autoScore } : {};

  const feedbackValue = () => form.getValues().feedback.trim() || null;

  const saveGrade = form.onSubmit(async ({ grade }) => {
    setPending('grade');
    try {
      await mutation.mutateAsync({ studentId: student.id, grade: Number(grade), feedback: feedbackValue(), status: 'graded', ...resultsPatch });
      markSaved();
      if (rerunResults) onResultsSaved();
      notifySuccess('Grade saved', `${student.name} can see their grade and feedback now.`);
    } catch (err) {
      form.setErrors(fieldErrors(err));
      notifyError(err, "Couldn't save the grade");
    } finally {
      setPending(null);
    }
  });

  const returnForRevision = async () => {
    setPending('return');
    try {
      await mutation.mutateAsync({ studentId: student.id, status: 'in_progress', feedback: feedbackValue(), ...resultsPatch });
      form.setFieldValue('grade', '');
      form.clearErrors();
      markSaved();
      if (rerunResults) onResultsSaved();
      notifySuccess('Returned for revision', `${student.name} can edit their code and hand it in again.`);
    } catch (err) {
      notifyError(err, "Couldn't return the work");
    } finally {
      setPending(null);
    }
  };

  const confirmReturn = () =>
    modals.openConfirmModal({
      title: 'Return for revision?',
      children: (
        <Text size="sm">
          {student.name} will be able to edit their code and hand it in again. Your feedback stays with the work
          {submission.grade != null ? ', and the current grade is removed until you grade it again' : ''}.
        </Text>
      ),
      labels: { confirm: 'Return for revision', cancel: 'Cancel' },
      onConfirm: () => void returnForRevision(),
    });

  const saveResults = async () => {
    if (!rerunResults) return;
    setPending('results');
    try {
      await mutation.mutateAsync({ studentId: student.id, testResults: rerunResults, autoScore });
      onResultsSaved();
      notifySuccess('Test results saved', 'The auto score now includes your latest test run.');
    } catch (err) {
      notifyError(err, "Couldn't save the test results");
    } finally {
      setPending(null);
    }
  };

  const applyAutoScore = () => {
    if (autoScore == null) return;
    form.setFieldValue('grade', Math.round((autoScore / 100) * assignment.points * 10) / 10);
    form.clearFieldError('grade');
  };

  return (
    <Card>
      <Group gap="sm" wrap="nowrap">
        <Avatar name={student.name} color="initials" radius="xl" size={34} />
        <div style={{ minWidth: 0 }}>
          <Text fw={600} truncate>
            {student.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {student.username}
          </Text>
        </div>
      </Group>

      <Divider my="md" />

      <Stack gap="xs">
        <InfoRow label="Status">
          <SubmissionStatusBadge status={submission.status} />
          {submission.late && <LateBadge missing={!handedIn} />}
        </InfoRow>
        <InfoRow label="Submitted">
          {submission.submittedAt ? (
            <RelativeTime date={submission.submittedAt} size="sm" />
          ) : (
            <Text size="sm" c="dimmed">
              Not handed in
            </Text>
          )}
        </InfoRow>
        {submission.updatedAt && (
          <InfoRow label="Last saved">
            <RelativeTime date={submission.updatedAt} size="sm" />
          </InfoRow>
        )}
      </Stack>

      <Divider my="md" />

      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb="xs">
        Auto score
      </Text>
      {tests.length === 0 ? (
        <Text size="sm" c="dimmed">
          This assignment has no tests, so there's no auto score.
        </Text>
      ) : (
        <Group gap="md" wrap="nowrap" align="center">
          <RingProgress
            size={76}
            thickness={7}
            roundCaps
            sections={autoScore != null ? [{ value: autoScore, color: scoreColor(autoScore) }] : []}
            label={
              <Center>
                <ScoreText percent={autoScore} />
              </Center>
            }
          />
          <Stack gap={4} style={{ minWidth: 0 }}>
            <Text size="sm">{results ? `${passed} of ${tests.length} tests passed` : "Tests haven't been run yet"}</Text>
            {rerunResults ? (
              <Text size="xs" c="dimmed">
                From your test run, not saved yet.
              </Text>
            ) : hiddenNotRun || !results ? (
              <Text size="xs" c="dimmed">
                Use Run tests to include the hidden tests.
              </Text>
            ) : null}
            <Group gap="xs" mt={4}>
              <Button size="xs" variant="light" leftSection={<IconMathFunction size={16} />} onClick={applyAutoScore} disabled={autoScore == null}>
                Use auto-score
              </Button>
              {rerunResults && (
                <Button size="xs" variant="default" leftSection={<IconDeviceFloppy size={16} />} loading={pending === 'results'} onClick={() => void saveResults()}>
                  Save test results
                </Button>
              )}
            </Group>
          </Stack>
        </Group>
      )}

      <Divider my="md" />

      <form noValidate onSubmit={saveGrade}>
        <Stack gap="md">
          <NumberInput
            label="Grade"
            description={`Out of ${assignment.points} point${assignment.points === 1 ? '' : 's'}.`}
            placeholder="e.g. 8"
            min={0}
            max={assignment.points}
            decimalScale={1}
            rightSection={
              <Text size="sm" c="dimmed">
                / {assignment.points}
              </Text>
            }
            rightSectionWidth={64}
            rightSectionPointerEvents="none"
            key={form.key('grade')}
            {...form.getInputProps('grade')}
          />
          <Textarea
            label="Feedback"
            description="Optional. The student sees this with their grade."
            placeholder="e.g. Great use of a loop! Next time, check what happens when the list is empty."
            autosize
            minRows={4}
            maxRows={12}
            key={form.key('feedback')}
            {...form.getInputProps('feedback')}
          />
          <Stack gap="xs">
            <Button type="submit" fullWidth leftSection={<IconCheck size={18} />} loading={pending === 'grade'} disabled={pending !== null && pending !== 'grade'}>
              Save grade
            </Button>
            <Button
              variant="default"
              fullWidth
              leftSection={<IconArrowBackUp size={18} />}
              onClick={confirmReturn}
              loading={pending === 'return'}
              disabled={!handedIn || (pending !== null && pending !== 'return')}
            >
              Return for revision
            </Button>
          </Stack>
        </Stack>
      </form>

      <Modal opened={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Discard unsaved grade?" size="md">
        <Text size="sm">You've changed the grade or feedback for {student.name} without saving.</Text>
        <Group justify="flex-end" gap="sm" mt="lg">
          <Button variant="default" onClick={() => blocker.reset?.()} data-autofocus>
            Keep grading
          </Button>
          <Button color="red" onClick={() => blocker.proceed?.()}>
            Discard changes
          </Button>
        </Group>
      </Modal>
    </Card>
  );
}
