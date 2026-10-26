import type { SubmissionDetailResponse, TestResult } from '@codeclass/shared';
import { ActionIcon, Alert, Button, Grid, Group, Kbd, Skeleton, Text, Tooltip } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconChevronLeft, IconChevronRight, IconInfoCircle, IconList, IconUserShare } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useSubmissionDetail } from '../../api/assignments';
import { api, queryKeys } from '../../api/client';
import { LateBadge, SubmissionStatusBadge } from '../../components/badges';
import { NotFoundCard } from '../../components/NotFoundCard';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useSignInAsStudent } from '../../hooks/useSignInAsStudent';
import { CodeWorkspace } from '../../ide';
import { GradeForm } from './GradeForm';

/** /assignments/:assignmentId/submissions/:studentId — one student's work with tests and the grade form. */
export function GradingPage() {
  const params = useParams();
  const assignmentId = Number(params.assignmentId);
  const studentId = Number(params.studentId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0 || !Number.isInteger(studentId) || studentId <= 0) {
    return <NotFoundCard />;
  }
  return <GradingLoader key={`${assignmentId}-${studentId}`} assignmentId={assignmentId} studentId={studentId} />;
}

function GradingLoader({ assignmentId, studentId }: { assignmentId: number; studentId: number }) {
  const query = useSubmissionDetail(assignmentId, studentId);
  usePageTitle(query.data ? `${query.data.student.name} · ${query.data.assignment.title}` : 'Grading');
  // Once loaded, a failed background refetch must not replace the page (and a half-written grade).
  if (query.data) return <GradingView data={query.data} />;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Classes', to: '/classes' }]} title={<Skeleton h={30} w={220} />} />
      <QueryState query={query}>{() => null}</QueryState>
    </>
  );
}

function NavHint({ label, keyName }: { label: string; keyName: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      {label}
      <Kbd size="xs">{keyName}</Kbd>
    </Group>
  );
}

function GradingView({ data }: { data: SubmissionDetailResponse }) {
  const { assignment, class: cls, language, student, submission, prevStudentId, nextStudentId } = data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signInAs = useSignInAsStudent();
  const [rerunResults, setRerunResults] = useState<TestResult[] | null>(null);
  const hasUnsavedGrade = useRef<() => boolean>(() => false);
  const handedIn = submission.status === 'submitted' || submission.status === 'graded';

  const goTo = (id: number | null) => {
    if (id != null) navigate(`/assignments/${assignment.id}/submissions/${id}`);
  };
  useHotkeys([
    ['k', () => goTo(prevStudentId)],
    ['j', () => goTo(nextStudentId)],
  ]);

  // Warm the neighbours so prev/next feel instant.
  useEffect(() => {
    for (const id of [prevStudentId, nextStudentId]) {
      if (id == null) continue;
      void queryClient.prefetchQuery({
        queryKey: queryKeys.assignments.submission(assignment.id, id),
        queryFn: () => api.get<SubmissionDetailResponse>(`/assignments/${assignment.id}/submissions/${id}`),
      });
    }
  }, [queryClient, assignment.id, prevStudentId, nextStudentId]);

  const banner =
    submission.status === 'not_started' ? (
      <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} py="xs">
        <Text size="sm">
          {student.name} hasn't opened this assignment yet, so this is the starter code. You can still record a grade, for example 0
          for missing work.
        </Text>
      </Alert>
    ) : submission.status === 'in_progress' ? (
      <Alert variant="light" color="orange" icon={<IconInfoCircle size={18} />} py="xs">
        <Text size="sm">Not handed in yet. This is {student.name}'s latest saved code.</Text>
      </Alert>
    ) : undefined;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Classes', to: '/classes' },
          { label: cls.name, to: `/classes/${cls.id}` },
          { label: assignment.title, to: `/assignments/${assignment.id}` },
          { label: student.name },
        ]}
        title={student.name}
        badges={
          <>
            <SubmissionStatusBadge status={submission.status} />
            {submission.late && <LateBadge missing={!handedIn} />}
          </>
        }
        actions={
          <>
            <Tooltip label={<NavHint label="Previous student" keyName="K" />}>
              <ActionIcon variant="default" size="lg" aria-label="Previous student" disabled={prevStudentId == null} onClick={() => goTo(prevStudentId)}>
                <IconChevronLeft size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={<NavHint label="Next student" keyName="J" />}>
              <ActionIcon variant="default" size="lg" aria-label="Next student" disabled={nextStudentId == null} onClick={() => goTo(nextStudentId)}>
                <IconChevronRight size={18} />
              </ActionIcon>
            </Tooltip>
            <Button component={Link} to={`/assignments/${assignment.id}`} variant="default" leftSection={<IconList size={18} />}>
              All students
            </Button>
            <Button
              variant="default"
              leftSection={<IconUserShare size={18} />}
              onClick={() =>
                signInAs(student, {
                  to: `/assignments/${assignment.id}`,
                  warning: hasUnsavedGrade.current()
                    ? `You haven't saved the grade or feedback you typed for ${student.name}. It will be lost.`
                    : undefined,
                })
              }
            >
              View as student
            </Button>
          </>
        }
      />

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <CodeWorkspace
            language={language}
            code={submission.code}
            readOnly
            instructions={assignment.instructions}
            tests={assignment.tests}
            compareMode={assignment.compareMode}
            hiddenTestCount={0}
            solutionCode={assignment.solutionCode}
            initialTestResults={submission.testResults}
            onTestResults={setRerunResults}
            banner={banner}
            storageKey="grading"
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <GradeForm
            assignment={assignment}
            student={student}
            submission={submission}
            rerunResults={rerunResults}
            onResultsSaved={() => setRerunResults(null)}
            hasUnsavedRef={hasUnsavedGrade}
          />
        </Grid.Col>
      </Grid>
    </>
  );
}
