import type {
  CreateUserInput,
  OkResponse,
  Role,
  TemporaryPasswordResponse,
  UpdateUserInput,
  User,
  UserResponse,
  UsersResponse,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './client';

export function useUsers(role?: Role) {
  return useQuery({
    queryKey: queryKeys.users.list(role),
    queryFn: () => api.get<UsersResponse>(`/admin/users${role ? `?role=${role}` : ''}`),
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.users.all });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (input: CreateUserInput) => api.post<TemporaryPasswordResponse>('/admin/users', input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateUserInput & { id: number }) => api.patch<UserResponse>(`/admin/users/${id}`, input),
    onSuccess: ({ user }) => {
      // An admin editing their own row: keep the header and Account settings in step.
      if (qc.getQueryData<User | null>(queryKeys.me)?.id === user.id) qc.setQueryData(queryKeys.me, user);
      return invalidate();
    },
  });
}

export function useResetUserPassword() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: number) => api.post<TemporaryPasswordResponse>(`/admin/users/${id}/reset-password`),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (id: number) => api.delete<OkResponse>(`/admin/users/${id}`),
    onSuccess: invalidate,
  });
}
