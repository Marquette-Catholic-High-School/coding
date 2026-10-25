import { Alert, Button, Group, Spoiler, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  kindSupportsTests,
  handingInRevealsSolution,
  solutionPendingNote,
  solutionReleased,
  type AssignmentResponse,
  type Submission,
  type TestResult,
} from '@codeclass/shared';
import { IconArrowBackUp, IconLock, IconMessageCircle, IconRosetteDiscountCheck, IconSend } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssignment, useMySubmission, useSaveSubmission, useSubmitAssignment, useUnsubmitAssignment } from '../../api/assignments';
import { ApiError, queryKeys } from '../../api/client';
import { DueBadge, LateBadge, ScoreText, SubmissionStatusBadge } from '../../components/badges';
import { Markdown } from '../../components/Markdown';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageHeader } from '../../components/PageHeader';
import { PageLoader, QueryState } from '../../components/QueryState';
import { RelativeTime } from '../../components/RelativeTime';
import { useAutosave } from '../../hooks/useAutosave';
import { usePageTitle } from '../../hooks/usePageTitle';
import { CodeWorkspace } from '../../ide';
import { SaveStatus } from '../student/SaveStatus';
import { SubmitModal, type SubmitRequest } from '../student/SubmitModal';

/** Current time, refreshed every `ms` (so "closed"/"late" flip when the due date passes). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function formatPoints(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatDate(iso: string): string {
  return dayjs(iso).format('ddd D MMM YYYY, h:mm A');
}

function Feedback({ source }: { source: string }) {
  return (
    <Spoiler maxHeight={140} showLabel="Show more" hideLabel="Show less">
      <Markdown source={source} />
    </Spoiler>
  );
}

function AssignmentWorkspace({ data, submission }: { data: AssignmentResponse; submission: Submission }) {
  const { assignment, language } = data;
  const qc = useQueryClient();
  const save = useSaveSubmission(assignment.id);
  const submit = useSubmitAssignment(assignment.id);
  const unsubmit = useUnsubmitAssignment(assignment.id);
  const now = useNow(30_000);

  const handedIn = submission.status === 'submitted' || submission.status === 'graded';
  // Work the teacher returned for revision can be handed in again at any time and is never late.
  const wasReturned = submission.returnedAt != null;
  const returned = wasReturned && submission.status === 'in_progress';
  const pastDue = assignment.dueAt != null && now > Date.parse(assignment.dueAt);
  const closed = pastDue && !assignment.allowLate && !handedIn && !wasReturned;
  const editable = !handedIn && !closed;
  const late = submission.late || (!handedIn && pastDue && !wasReturned);

  const [code, setCode] = useState(submission.code);
  // Coming back from submitted/graded (unsubmit, or returned for revision): start from the server's copy.
  const wasHandedIn = useRef(handedIn);
  useEffect(() => {
    if (wasHandedIn.current && !handedIn) setCode(submission.code);
    wasHandedIn.current = handedIn;
  }, [handedIn, submission.code]);

  const statusRef = useRef(submission.status);
  statusRef.current = submission.status;

  const refresh = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.assignments.mySubmission(assignment.id) }),
        qc.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment.id) }),
        qc.invalidateQueries({ queryKey: queryKeys.classes.assignments(assignment.classId) }),
        qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]),
    [qc, assignment.id, assignment.classId],
  );

  const autosave = useAutosave<string>({
    enabled: editable,
    initialSavedAt: submission.updatedAt,
    save: async (value) => {
      const startedFresh = statusRef.current === 'not_started';
      await save.mutateAsync({ code: value });
      // The first save creates the submission ("In progress"): refresh lists that show the status.
      if (startedFresh) {
        void qc.invalidateQueries({ queryKey: queryKeys.classes.assignments(assignment.classId) });
        void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) handleConflict(err);
    },
  });

  const queueSave = autosave.update;
  const handleCodeChange = useCallback(
    (value: string) => {
      setCode(value);
      queueSave(value);
    },
    [queueSave],
  );

  /** The server says the work can't change any more (submitted elsewhere, graded, or closed). */
  function handleConflict(err: ApiError) {
    autosave.cancel();
    void refresh();
    notifyError(err, 'This assignment has changed');
  }

  const [submitRequest, setSubmitRequest] = useState<SubmitRequest | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [preparing, setPreparing] = useState(false);

  const startSubmit = async () => {
    setPreparing(true);
    try {
      await autosave.flush();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) notifyError(err, "Couldn't save your work");
      return;
    } finally {
      setPreparing(false);
    }
    setAttempt((n) => n + 1);
    setSubmitRequest({
      target: { kind: language.kind, pseudocode: language.pseudocode },
      code,
      tests: kindSupportsTests(language.kind) ? assignment.tests : [],
      compareMode: assignment.compareMode,
      hiddenTestCount: assignment.hiddenTestCount,
      dueAt: assignment.dueAt,
      late: !wasReturned && assignment.dueAt != null && Date.now() > Date.parse(assignment.dueAt),
      revealsSolution: handingInRevealsSolution(assignment, assignment.hasSolution, Date.now(), wasReturned),
    });
  };

  const confirmSubmit = async (testResults: TestResult[] | null) => {
    if (!submitRequest) return;
    try {
      await submit.mutateAsync({ code: submitRequest.code, testResults });
      setSubmitRequest(null);
      notifySuccess('Submitted', 'Your teacher can see your work now. You can unsubmit to change it until it is graded.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitRequest(null);
        handleConflict(err);
      } else {
        notifyError(err, "Couldn't submit");
      }
    }
  };

  const doUnsubmit = async () => {
    try {
      await unsubmit.mutateAsync();
      notifySuccess('Unsubmitted', 'Make your changes, then submit again.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) handleConflict(err);
      else notifyError(err, "Couldn't unsubmit");
    }
  };

  const handleUnsubmit = () => {
    if (!pastDue || wasReturned) {
      void doUnsubmit();
      return;
    }
    const modalId = modals.openConfirmModal({
      title: 'Unsubmit assignment?',
      children: (
        <Text size="sm">
          {assignment.allowLate
            ? 'The due date has passed, so if you submit again it will be marked late.'
            : "The due date has passed and late work isn't accepted, so you won't be able to submit again."}
        </Text>
      ),
      labels: { confirm: 'Unsubmit', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      closeOnConfirm: false,
      onConfirm: async () => {
        modals.updateModal({ modalId, confirmProps: { color: 'red', loading: true } });
        await doUnsubmit();
        modals.close(modalId);
      },
    });
  };

  // The server only sends the solution once it is released to this student; the note says when that will be.
  const expectSolution = solutionReleased(assignment, assignment.hasSolution, submission.status, now, wasReturned);
  const solutionNote =
    assignment.solutionCode == null
      ? (solutionPendingNote(assignment, assignment.hasSolution, submission.status, now, wasReturned) ??
        (expectSolution ? "Loading your teacher's solution…" : null))
      : null;
  // Handing in, a grade, a return for revision or the due date passing can release or withdraw the solution: while the
  // rules disagree with what was loaded, fetch the assignment again now and every 15 s (this computer's clock may be
  // ahead of the server's).
  const solutionStale = assignment.hasSolution && expectSolution !== (assignment.solutionCode != null);
  useEffect(() => {
    if (!solutionStale) return;
    const refetch = () => void qc.invalidateQueries({ queryKey: queryKeys.assignments.detail(assignment.id) });
    refetch();
    const id = setInterval(refetch, 15_000);
    return () => clearInterval(id);
  }, [solutionStale, qc, assignment.id]);
  // Handing in released the solution, so the server won't let this work be unsubmitted.
  const unsubmitLocked =
    submission.status === 'submitted' && handingInRevealsSolution(assignment, assignment.hasSolution, now, wasReturned);

  const visibleIds = useMemo(() => new Set(assignment.tests.map((t) => t.id)), [assignment.tests]);
  const storedResults = useMemo(
    () => submission.testResults?.filter((r) => visibleIds.has(r.testId)) ?? null,
    [submission.testResults, visibleIds],
  );

  let banner = null;
  if (submission.status === 'graded') {
    const percent = assignment.points > 0 && submission.grade != null ? (submission.grade / assignment.points) * 100 : null;
    banner = (
      <Alert
        variant="light"
        color="teal"
        icon={<IconRosetteDiscountCheck />}
        title={
          <>
            Graded: {submission.grade != null ? formatPoints(submission.grade) : '—'} / {assignment.points} ·{' '}
            <ScoreText percent={percent} />
          </>
        }
      >
        {submission.feedback ? <Feedback source={submission.feedback} /> : <Text size="sm">Your teacher didn't leave written feedback.</Text>}
      </Alert>
    );
  } else if (submission.status === 'submitted') {
    banner = (
      <Alert
        variant="light"
        color="blue"
        icon={<IconSend />}
        title={
          <>
            Submitted <RelativeTime date={submission.submittedAt} inherit />
          </>
        }
      >
        <Stack gap="sm" align="flex-start">
          {unsubmitLocked ? (
            <Text size="sm">
              Your teacher will grade it soon. You've seen the solution, so this work can't be unsubmitted; ask your teacher if
              you need to change it.
            </Text>
          ) : (
            <>
              <Text size="sm">Your teacher will grade it soon. Need to change something? Unsubmit, make your changes, then submit again.</Text>
              <Button size="sm" variant="default" leftSection={<IconArrowBackUp size={18} />} loading={unsubmit.isPending} onClick={handleUnsubmit}>
                Unsubmit
              </Button>
            </>
          )}
        </Stack>
      </Alert>
    );
  } else if (returned) {
    banner = (
      <Alert variant="light" color="orange" icon={<IconArrowBackUp />} title="Returned for revision">
        <Stack gap="xs">
          {submission.feedback ? <Feedback source={submission.feedback} /> : <Text size="sm">Your teacher didn't leave written feedback.</Text>}
          <Text size="sm">
            Make your changes, then submit again.
            {pastDue ? " You can still submit after the due date, and it won't be marked late." : ''}
          </Text>
        </Stack>
      </Alert>
    );
  } else if (closed) {
    banner = (
      <Alert variant="light" color="red" icon={<IconLock />} title="This assignment is closed">
        <Text size="sm">
          It was due {formatDate(assignment.dueAt!)} and your teacher isn't accepting late work, so it can't be changed or submitted. Talk to
          your teacher if you need more time.
        </Text>
      </Alert>
    );
  } else if (submission.feedback) {
    banner = (
      <Alert variant="light" color="orange" icon={<IconMessageCircle />} title="Feedback from your teacher">
        <Feedback source={submission.feedback} />
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: data.class.name, to: `/classes/${data.class.id}` }, { label: assignment.title }]}
        title={assignment.title}
        badges={
          <>
            <SubmissionStatusBadge status={submission.status} />
            {late && <LateBadge missing={closed} />}
            <DueBadge dueAt={assignment.dueAt} done={handedIn} />
          </>
        }
      />
      <CodeWorkspace
        language={language}
        code={handedIn ? submission.code : code}
        onCodeChange={editable ? handleCodeChange : undefined}
        readOnly={!editable}
        instructions={assignment.instructions}
        tests={assignment.tests}
        compareMode={assignment.compareMode}
        hiddenTestCount={assignment.hiddenTestCount}
        solutionCode={assignment.solutionCode}
        solutionNote={solutionNote}
        initialTestResults={storedResults}
        storageKey={`assignment-${assignment.id}`}
        banner={banner}
        toolbarRight={
          editable ? (
            <Group gap="sm" wrap="nowrap">
              <SaveStatus autosave={autosave} />
              <Button leftSection={<IconSend size={18} />} loading={preparing} onClick={() => void startSubmit()}>
                Submit
              </Button>
            </Group>
          ) : undefined
        }
      />
      <SubmitModal
        request={submitRequest}
        attempt={attempt}
        submitting={submit.isPending}
        onClose={() => setSubmitRequest(null)}
        onSubmit={(results) => void confirmSubmit(results)}
      />
    </>
  );
}

export function StudentAssignmentPage({ assignmentId }: { assignmentId: number }) {
  const assignment = useAssignment(assignmentId);
  const submission = useMySubmission(assignmentId);
  usePageTitle(assignment.data?.assignment.title ?? 'Assignment');

  // Once loaded, keep the workspace mounted even if a background refetch fails (it would lose the editor state).
  if (assignment.data && submission.data) {
    return <AssignmentWorkspace data={assignment.data} submission={submission.data.submission} />;
  }
  return (
    <QueryState query={assignment}>
      {() => (
        <QueryState query={submission} loader={<PageLoader label="Loading your work…" />}>
          {() => null}
        </QueryState>
      )}
    </QueryState>
  );
}
