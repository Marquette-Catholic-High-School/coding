import type {
  AddStudentInput,
  AddStudentResponse,
  ClassResponse,
  ClassesResponse,
  CreateClassInput,
  OkResponse,
  RosterResponse,
  TemporaryPasswordResponse,
  UpdateClassInput,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './client';

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
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (id: number) => api.delete<OkResponse>(`/classes/${id}`),
    onSuccess: invalidate,
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
  const invalidate = useInvalidateClasses();
  return useMutation({
    mutationFn: (input: AddStudentInput) => api.post<AddStudentResponse>(`/classes/${classId}/students`, input),
    onSuccess: invalidate,
  });
}

export function useRemoveStudent(classId: number) {
  const invalidate = useInvalidateClasses();
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
