import type {
  ChangePasswordInput,
  JoinPreviewResponse,
  LoginInput,
  OkResponse,
  RegisterInput,
  SetupInput,
  SetupStatusResponse,
  UpdateProfileInput,
  UserResponse,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { api, queryKeys } from './client';

export function useSetupStatus() {
  return useQuery({ queryKey: queryKeys.setup, queryFn: () => api.get<SetupStatusResponse>('/setup'), staleTime: 0 });
}

/** On success the user is stored in the auth context (signed in). */
export function useSetup() {
  const { setUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => api.post<UserResponse>('/setup', input),
    onSuccess: ({ user }) => {
      qc.setQueryData(queryKeys.setup, { needsSetup: false });
      setUser(user);
    },
  });
}

export function useLogin() {
  const { setUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<UserResponse>('/auth/login', input),
    onSuccess: ({ user }) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      setUser(user);
    },
  });
}

/** Student self-registration with a class code. */
export function useRegister() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<UserResponse>('/auth/register', input),
    onSuccess: ({ user }) => setUser(user),
  });
}

export function useChangePassword() {
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<OkResponse>('/auth/change-password', input),
    onSuccess: () => void refresh(),
  });
}

export function useUpdateProfile() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<UserResponse>('/auth/profile', input),
    onSuccess: ({ user }) => setUser(user),
  });
}

/** Public class preview for the join page; disabled until the code looks valid. */
export function useJoinPreview(code: string) {
  const normalized = code.trim().toUpperCase();
  return useQuery({
    queryKey: queryKeys.joinPreview(normalized),
    queryFn: () => api.get<JoinPreviewResponse>(`/join/${encodeURIComponent(normalized)}`),
    enabled: /^[A-Z0-9]{6}$/.test(normalized),
    retry: false,
  });
}
