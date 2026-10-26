import { gradeFromAutoScore, matchesSolution, solutionReleased, type Assignment, type Submission, type TestResult } from '@codeclass/shared';
import {
  Alert,
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
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconDeviceFloppy, IconMathFunction, IconRobot } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { useGradeSubmission, useSubmissionDetail } from '../../api/assignments';
import { fieldErrors } from '../../api/client';
import { isAccountSwitch } from '../../auth/session';
import { LateBadge, scoreColor, ScoreText, SolutionMatchBadge, SubmissionStatusBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { RelativeTime } from '../../components/RelativeTime';
import { autogradeMethod, autogradeOneBlocker } from './autograde';
import { autoScoreView } from './autoScoreView';
import { useAutograde } from './useAutograde';

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

/**
 * Side card of the grading page: who, status, auto score (with Autograde for this work), grade + feedback, save /
 * return for revision. Saving here is a hand grade.
 */
export function GradeForm({
  assignment,
  student,
  submission,
  rerunResults,
  onResultsSaved,
  hasUnsavedRef,
}: {
  assignment: Assignment;
  student: { id: number; name: string; username: string };
  submission: Submission;
  /** Results of tests the teacher re-ran in the workspace (not saved yet), or null. */
  rerunResults: TestResult[] | null;
  onResultsSaved: () => void;
  /** Set to a check for a grade or feedback typed here but not saved (e.g. to warn before "View as student"). */
  hasUnsavedRef?: MutableRefObject<() => boolean>;
}) {
  const mutation = useGradeSubmission(assignment.id);
  const [pending, setPending] = useState<'grade' | 'return' | 'results' | null>(null);
  // The grading page loaded the language with the work; this reads it from the same (cached) query.
  const language = useSubmissionDetail(assignment.id, student.id).data?.language ?? null;
  const method = language ? autogradeMethod(language.kind, assignment) : null;
  const autograde = useAutograde(assignment, language, method);
  const autograding = autograde.activity !== null;
  const handedIn = submission.status === 'submitted' || submission.status === 'graded';
  // Not-started work shows the starter code, which isn't the student's.
  const matchesYourSolution = submission.status !== 'not_started' && matchesSolution(submission.code, assignment.solutionCode);

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
  const savedRef = useRef<GradeValues>({ ...form.getValues() });
  const getValues = form.getValues;
  const isDirty = useCallback(() => JSON.stringify(getValues()) !== JSON.stringify(savedRef.current), [getValues]);
  // Not when switching accounts ("View as student"): that has already happened, and its confirm warned about this.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && !isAccountSwitch(nextLocation) && isDirty(),
  );
  useEffect(() => {
    if (hasUnsavedRef) hasUnsavedRef.current = isDirty;
  }, [hasUnsavedRef, isDirty]);
  const markSaved = (values: GradeValues = form.getValues()) => {
    savedRef.current = { ...values };
  };

  const auto = autoScoreView({
    tests: assignment.tests,
    testResults: submission.testResults,
    autoScore: submission.autoScore,
    rerunResults,
    matchesSolution: matchesYourSolution,
  });
  const autoScore = auto.score;
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
      notifySuccess('Returned for revision', `${student.name} can edit their code and hand it in again. It won't be marked late.`);
    } catch (err) {
      notifyError(err, "Couldn't return the work");
    } finally {
      setPending(null);
    }
  };

  // The student may already have seen the solution (it was released to their handed-in or graded work).
  const sawSolution = solutionReleased(assignment, assignment.hasSolution, submission.status, Date.now(), submission.returnedAt != null);
  const confirmReturn = () =>
    modals.openConfirmModal({
      title: 'Return for revision?',
      children: (
        <Stack gap="sm">
          <Text size="sm">
            {student.name} will be able to edit their code and hand it in again, even after the due date, and it won't be marked
            late. Your feedback stays with the work
            {submission.grade != null ? ', and the current grade is removed until you grade it again' : ''}.
          </Text>
          {sawSolution && (
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
              <Text size="sm">{student.name} has already been able to see the solution to this assignment.</Text>
            </Alert>
          )}
        </Stack>
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
    form.setFieldValue('grade', gradeFromAutoScore(autoScore, assignment.points));
    form.clearFieldError('grade');
  };

  // Autograde this work on its own: it replaces the grade (after confirming one the teacher entered or has typed).
  const autogradeBlocked = autograding ? null : autogradeOneBlocker(submission, null);
  const runAutograde = async () => {
    const unsavedGrade = String(form.getValues().grade) !== String(savedRef.current.grade);
    const step = await autograde.autogradeOne({ student, submission }, { unsavedGrade });
    if (!step?.saved) return;
    // It stored fresh results of every test, so an unsaved re-run here is out of date.
    if (step.result.testResults) onResultsSaved();
    if (step.outcome === 'graded' || step.outcome === 'cleared') {
      // Show the saved grade, and count it as saved. Autograde doesn't change feedback, so the feedback last saved
      // from this form stays the baseline (feedback typed since stays unsaved).
      const grade = step.saved.grade ?? '';
      form.setFieldValue('grade', grade);
      form.clearFieldError('grade');
      markSaved({ ...savedRef.current, grade });
    }
  };
  const autogradeButton = method && (
    <Tooltip label={autogradeBlocked} disabled={!autogradeBlocked} multiline maw={260}>
      <Button
        size="xs"
        variant="light"
        leftSection={<IconRobot size={16} />}
        loading={autograding}
        disabled={pending !== null}
        data-disabled={autogradeBlocked !== null || undefined}
        aria-disabled={autogradeBlocked !== null}
        onClick={(e) => {
          if (autogradeBlocked) {
            e.preventDefault();
            return;
          }
          void runAutograde();
        }}
      >
        Autograde
      </Button>
    </Tooltip>
  );

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
        {matchesYourSolution && (
          <InfoRow label="Code">
            <SolutionMatchBadge />
          </InfoRow>
        )}
        {submission.returnedAt && (
          <InfoRow label="Returned">
            <RelativeTime date={submission.returnedAt} size="sm" />
          </InfoRow>
        )}
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
      {auto.empty ? (
        <Stack gap="xs" align="flex-start">
          <Text size="sm" c="dimmed">
            This assignment has no tests, so there's no auto score
            {assignment.hasSolution ? '. Autograde can still give full marks to work that matches your solution.' : '.'}
          </Text>
          {autogradeButton}
        </Stack>
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
            <Text size="sm">{auto.summary}</Text>
            {auto.notes.map((note) => (
              <Text key={note} size="xs" c="dimmed">
                {note}
              </Text>
            ))}
            <Group gap="xs" mt={4}>
              {autogradeButton}
              <Button
                size="xs"
                variant="light"
                leftSection={<IconMathFunction size={16} />}
                onClick={applyAutoScore}
                disabled={autoScore == null || autograding}
              >
                Use auto-score
              </Button>
              {rerunResults && (
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconDeviceFloppy size={16} />}
                  loading={pending === 'results'}
                  disabled={autograding}
                  onClick={() => void saveResults()}
                >
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
            description={`Out of ${assignment.points} point${assignment.points === 1 ? '' : 's'}.${
              submission.autoGraded ? ' Set by autograde; saving it here makes it your own grade.' : ''
            }`}
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
            // Autograde sets the grade when it finishes.
            readOnly={autograding}
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
            <Button
              type="submit"
              fullWidth
              leftSection={<IconCheck size={18} />}
              loading={pending === 'grade'}
              disabled={autograding || (pending !== null && pending !== 'grade')}
            >
              Save grade
            </Button>
            <Button
              variant="default"
              fullWidth
              leftSection={<IconArrowBackUp size={18} />}
              onClick={confirmReturn}
              loading={pending === 'return'}
              disabled={!handedIn || autograding || (pending !== null && pending !== 'return')}
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
