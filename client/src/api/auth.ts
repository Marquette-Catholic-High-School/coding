import type {
  ChangePasswordInput,
  ImpersonateInput,
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
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import {
  ACCOUNT_SWITCH_KEY,
  ACCOUNT_SWITCH_STATE,
  rememberReturnPath,
  settleBeforeSwitch,
  takeReturnPath,
  type Session,
} from '../auth/session';
import { AccountChangedError, api, ApiError, queryKeys } from './client';

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

/** Student self-registration with a class code and/or an email address a teacher added (`joinedClasses` says which). */
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<UserResponse>('/auth/profile', input),
    onSuccess: ({ user, joinedClasses }) => {
      setUser(user);
      // Saving an email address a teacher added enrolls the student in those classes.
      if (joinedClasses?.length) {
        void qc.invalidateQueries({ queryKey: queryKeys.classes.all });
        void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      }
    },
  });
}

/**
 * "Sign in as student": a teacher or admin switches into a student's account (admins: any student; teachers: students
 * whose classes are all theirs), then opens `to` (default: the dashboard) as them. The page they started from is
 * remembered for "Back to my account". Leaving it isn't blocked by unsaved-changes guards: the confirm says what's lost.
 */
export function useImpersonate() {
  const { switchAccount } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useMutation({
    mutationKey: ACCOUNT_SWITCH_KEY,
    mutationFn: async ({ userId }: ImpersonateInput & { to?: string }) => {
      await settleBeforeSwitch(qc);
      return api.post<UserResponse>('/auth/impersonate', { userId });
    },
    onSuccess: ({ user, impersonator }, { to }) => {
      if (impersonator) rememberReturnPath(impersonator.id, pathname + search);
      switchAccount(user, impersonator ?? null);
      navigate(to ?? '/dashboard', { replace: true, state: ACCOUNT_SWITCH_STATE });
    },
  });
}

/**
 * "Back to my account": saves the student's latest edits while still signed in as them, ends the student view and
 * returns to the teacher's or admin's own account and the page they left.
 */
export function useStopImpersonating() {
  const { switchAccount, forgetSession } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationKey: ACCOUNT_SWITCH_KEY,
    mutationFn: async () => {
      await settleBeforeSwitch(qc);
      try {
        return await api.post<UserResponse>('/auth/stop-impersonating');
      } catch (err) {
        // This tab was behind: another tab already went back. Catch up if the browser is in the staff member's own account.
        if (err instanceof AccountChangedError || (err instanceof ApiError && err.status === 400)) {
          const shown = qc.getQueryData<Session | null>(queryKeys.me);
          const now = await api.get<UserResponse>('/auth/me');
          if (!now.impersonator && now.user.id === shown?.impersonator?.id) return now;
        }
        throw err;
      }
    },
    onSuccess: ({ user }) => {
      const back = takeReturnPath(user.id) ?? '/dashboard';
      switchAccount(user, null);
      navigate(back, { replace: true, state: ACCOUNT_SWITCH_STATE });
    },
    onError: (err) => {
      // Their own account can't be used any more (deleted, no longer a teacher or admin, or its session would have
      // ended), or the student view expired: the server has ended the session, so show the sign-in page.
      if (err instanceof ApiError && err.status === 401) forgetSession();
    },
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
