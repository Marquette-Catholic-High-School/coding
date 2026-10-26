import type {
  AddStudentInput,
  AddStudentResponse,
  ClassResponse,
  ClassesResponse,
  CreateClassInput,
  ImportInvitesInput,
  InviteImportResponse,
  InvitesResponse,
  OkResponse,
  RosterResponse,
  TemporaryPasswordResponse,
  UpdateClassInput,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './client';
import { entityQueries, refreshAfterDelete } from './deletedQueries';

export function useClasses(archived = false) {
  return useQuery({
    queryKey: queryKeys.classes.list(archived),
    queryFn: () => api.get<ClassesResponse>(`/classes${archived ? '?archived=1' : ''}`),
  });
}

export function useClass(id: number) {
  return useQuery({ queryKey: queryKeys.classes.detail(id), queryFn: () => api.get<ClassResponse>(`/classes/${id}`) });
}

function useInvalidateClasses() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.classes.all }),
      qc.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
}

/** Roster changes also change every assignment's submission rows (one per enrolled student). */
function useInvalidateRoster() {
  const qc = useQueryClient();
  const invalidateClasses = useInvalidateClasses();
  return () => Promise.all([invalidateClasses(), qc.invalidateQueries({ queryKey: queryKeys.assignments.all })]);
}

export function useCreateClass() {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (input: CreateClassInput) => api.post<ClassResponse>('/classes', input),
    onSuccess: invalidate,
  });
}

export function useUpdateClass(id: number) {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (input: UpdateClassInput) => api.patch<ClassResponse>(`/classes/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useRegenerateJoinCode(id: number) {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: () => api.post<ClassResponse>(`/classes/${id}/regenerate-code`),
    onSuccess: invalidate,
  });
}

export function useDeleteClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<OkResponse>(`/classes/${id}`),
    // Its assignments go too, which changes the languages' usage counts.
    onSuccess: (_data, id) =>
      refreshAfterDelete(qc, entityQueries('classes', id), [
        queryKeys.classes.all,
        queryKeys.assignments.all,
        queryKeys.languages.all,
        queryKeys.dashboard,
      ]),
  });
}

/** Student joins a class with a code. */
export function useJoinClass() {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (joinCode: string) => api.post<ClassResponse>('/classes/join', { joinCode }),
    onSuccess: invalidate,
  });
}

export function useRoster(classId: number) {
  return useQuery({ queryKey: queryKeys.classes.roster(classId), queryFn: () => api.get<RosterResponse>(`/classes/${classId}/students`) });
}

export function useAddStudent(classId: number) {
  const invalidate = useInvalidateRoster();
  return useMutation({
    mutationFn: (input: AddStudentInput) => api.post<AddStudentResponse>(`/classes/${classId}/students`, input),
    onSuccess: invalidate,
  });
}

export function useRemoveStudent(classId: number) {
  const invalidate = useInvalidateRoster();
  return useMutation({
    mutationFn: (userId: number) => api.delete<OkResponse>(`/classes/${classId}/students/${userId}`),
    onSuccess: invalidate,
  });
}

export function useResetStudentPassword(classId: number) {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (userId: number) => api.post<TemporaryPasswordResponse>(`/classes/${classId}/students/${userId}/reset-password`),
    onSuccess: invalidate,
  });
}

// --- Invitations by email (spreadsheet import) --------------------------------------------------------

export function useInvites(classId: number) {
  return useQuery({ queryKey: queryKeys.classes.invites(classId), queryFn: () => api.get<InvitesResponse>(`/classes/${classId}/invites`) });
}

/** Import (or, with dryRun, preview) students by email. A real import refreshes the roster, invites and counts. */
export function useImportInvites(classId: number) {
  // Enrolling students changes the roster and every assignment's submission rows.
  const invalidate = useInvalidateRoster();
  return useMutation({
    mutationFn: (input: ImportInvitesInput) => api.post<InviteImportResponse>(`/classes/${classId}/invites`, input),
    onSuccess: (_data, input) => {
      if (!input.dryRun) void invalidate();
    },
  });
}

export function useDeleteInvite(classId: number) {
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (inviteId: number) => api.delete<OkResponse>(`/classes/${classId}/invites/${inviteId}`),
    onSuccess: invalidate,
  });
}
