import type {
  AssignmentInput,
  AssignmentResponse,
  AssignmentsResponse,
  GradeSubmissionInput,
  OkResponse,
  SaveSubmissionInput,
  SubmissionDetailResponse,
  SubmissionResponse,
  SubmissionRowsResponse,
  SubmitInput,
  UpdateAssignmentInput,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './client';

export function useClassAssignments(classId: number) {
  return useQuery({
    queryKey: queryKeys.classes.assignments(classId),
    queryFn: () => api.get<AssignmentsResponse>(`/classes/${classId}/assignments`),
  });
}

export function useAssignment(id: number) {
  return useQuery({ queryKey: queryKeys.assignments.detail(id), queryFn: () => api.get<AssignmentResponse>(`/assignments/${id}`) });
}

function useInvalidateAssignments() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.assignments.all }),
      qc.invalidateQueries({ queryKey: queryKeys.classes.all }),
      qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
}

export function useCreateAssignment(classId: number) {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (input: AssignmentInput) => api.post<AssignmentResponse>(`/classes/${classId}/assignments`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateAssignment(id: number) {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (input: UpdateAssignmentInput) => api.patch<AssignmentResponse>(`/assignments/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteAssignment() {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (id: number) => api.delete<OkResponse>(`/assignments/${id}`),
    onSuccess: invalidate,
  });
}

// --- Student work -----------------------------------------------------------------------------------

export function useMySubmission(assignmentId: number) {
  return useQuery({
    queryKey: queryKeys.assignments.mySubmission(assignmentId),
    queryFn: () => api.get<SubmissionResponse>(`/assignments/${assignmentId}/submission`),
    // Don't clobber code the student is typing with a background refetch.
    refetchOnWindowFocus: false,
  });
}

/** Autosave. Updates the cached submission silently (no list invalidation on every keystroke batch). */
export function useSaveSubmission(assignmentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSubmissionInput) => api.put<SubmissionResponse>(`/assignments/${assignmentId}/submission`, input),
    onSuccess: (data) => qc.setQueryData(queryKeys.assignments.mySubmission(assignmentId), data),
  });
}

export function useSubmitAssignment(assignmentId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: (input: SubmitInput) => api.post<SubmissionResponse>(`/assignments/${assignmentId}/submit`, input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.assignments.mySubmission(assignmentId), data);
      void invalidate();
    },
  });
}

export function useUnsubmitAssignment(assignmentId: number) {
  const qc = useQueryClient();
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: () => api.post<SubmissionResponse>(`/assignments/${assignmentId}/unsubmit`),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.assignments.mySubmission(assignmentId), data);
      void invalidate();
    },
  });
}

// --- Teacher grading --------------------------------------------------------------------------------

export function useSubmissionRows(assignmentId: number) {
  return useQuery({
    queryKey: queryKeys.assignments.submissions(assignmentId),
    queryFn: () => api.get<SubmissionRowsResponse>(`/assignments/${assignmentId}/submissions`),
  });
}

export function useSubmissionDetail(assignmentId: number, studentId: number) {
  return useQuery({
    queryKey: queryKeys.assignments.submission(assignmentId, studentId),
    queryFn: () => api.get<SubmissionDetailResponse>(`/assignments/${assignmentId}/submissions/${studentId}`),
  });
}

export function useGradeSubmission(assignmentId: number) {
  const invalidate = useInvalidateAssignments();
  return useMutation({
    mutationFn: ({ studentId, ...input }: GradeSubmissionInput & { studentId: number }) =>
      api.patch<SubmissionResponse>(`/assignments/${assignmentId}/submissions/${studentId}`, input),
    onSuccess: invalidate,
  });
}
