import type { Impersonator, LogoutResponse, User, UserResponse } from '@codeclass/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, queryKeys, setSessionProblemListener } from '../api/client';
import { notifyError } from '../components/notify';
import { cancelAutosaves } from '../hooks/useAutosave';
import {
  announceAccountChange,
  checkSession,
  listenForAccountChanges,
  resetSessionCache,
  sameAccount,
  settleBeforeSwitch,
  switchSessionCache,
  type Session,
} from './session';

/**
 * The browser's session changed under this tab (see checkSession): another tab now uses `session`, or this tab's
 * student view stopped working. AccountSync deals with it.
 */
export type AccountChange = { kind: 'other-tab'; session: Session } | { kind: 'view-ended' };

interface AuthContextValue {
  /** Null when signed out. */
  user: User | null;
  /**
   * The teacher or admin using this student's account ("Sign in as student", the student view); null otherwise.
   * "Back to my account" or signing out returns them to their own account without a password.
   */
  impersonator: Impersonator | null;
  /** True only during the very first /auth/me request. */
  isLoading: boolean;
  /** Error other than 401 (e.g. server unreachable) from the session check. */
  error: unknown;
  /**
   * True after logout() in this tab until someone signs in again. Guards then send people to plain /login, without a
   * ?next= that would take the next person on a shared computer to the previous user's page.
   */
  signedOut: boolean;
  /** Set while the browser's session no longer matches the account this tab shows. */
  accountChange: AccountChange | null;
  /** Store the user returned by login/register/setup/profile endpoints. */
  setUser(user: User | null): void;
  /**
   * Switch to another account without signing in (into a student's account, or back to your own) after the server
   * has switched the session: forgets everything cached and every unsaved edit for the previous account.
   */
  switchAccount(user: User, impersonator: Impersonator | null): void;
  /** Forget a session the server has already ended, as after logout. */
  forgetSession(): void;
  refresh(): Promise<unknown>;
  /** Signs out. Signing out of a student view goes back to the teacher's or admin's own account instead. */
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<Session | null> {
  try {
    const { user, impersonator } = await api.get<UserResponse>('/auth/me');
    return { user, impersonator: impersonator ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const [accountChange, setAccountChange] = useState<AccountChange | null>(null);
  // Bumped whenever this tab switches accounts, so a session check that started before can't undo the switch.
  const generation = useRef(0);

  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => {
      const started = generation.current;
      const actual = await fetchMe();
      const shown = queryClient.getQueryData<Session | null>(queryKeys.me);
      if (signal.aborted || generation.current !== started) return shown ?? null;
      const check = checkSession(shown, actual);
      if (check === 'use') {
        setAccountChange(null);
        return actual;
      }
      // Keep showing this tab's account until AccountSync has dealt with the change (the same change keeps its object,
      // so AccountSync acts on it once).
      setAccountChange((prev) => {
        if (check === 'view-ended') return prev?.kind === 'view-ended' ? prev : { kind: 'view-ended' };
        return prev?.kind === 'other-tab' && sameAccount(prev.session, actual) ? prev : { kind: 'other-tab', session: actual! };
      });
      return shown!;
    },
    staleTime: 60_000,
    retry: 1,
  });

  // Check the session when another tab switches accounts, or a call says this tab's account is out of date.
  useEffect(() => {
    const recheck = () => void queryClient.refetchQueries({ queryKey: queryKeys.me }, { cancelRefetch: false });
    const stopListening = listenForAccountChanges(() => void queryClient.refetchQueries({ queryKey: queryKeys.me }));
    setSessionProblemListener(recheck);
    return () => {
      stopListening();
      setSessionProblemListener(null);
    };
  }, [queryClient]);

  /** This tab now shows another account (or none): tell the other tabs. */
  const switched = useCallback(() => {
    generation.current += 1;
    setAccountChange(null);
    announceAccountChange();
  }, []);

  const setUser = useCallback(
    (user: User | null) => {
      if (user) setSignedOut(false);
      // Login, register and setup start the account's own session. Storing the same account again (a profile change)
      // keeps a student view's impersonator.
      queryClient.setQueryData<Session | null>(queryKeys.me, (prev) =>
        user ? { user, impersonator: prev?.user.id === user.id ? prev.impersonator : null } : null,
      );
      switched();
    },
    [queryClient, switched],
  );

  const switchAccount = useCallback(
    (user: User, impersonator: Impersonator | null) => {
      setSignedOut(false);
      // Edits still waiting to be saved belong to the previous account: saving them now would save them as this one.
      cancelAutosaves();
      switchSessionCache(queryClient, { user, impersonator });
      switched();
    },
    [queryClient, switched],
  );

  const forgetSession = useCallback(() => {
    setSignedOut(true);
    cancelAutosaves();
    resetSessionCache(queryClient);
    switched();
  }, [queryClient, switched]);

  // Only forgets the user once the server has ended the session. If the request fails the session is still open
  // (a reload would sign the user straight back in), so stay signed in and let the caller say so.
  const logout = useCallback(async () => {
    // Save the latest edits first, while their account is still signed in.
    await settleBeforeSwitch(queryClient);
    const { user } = await api.post<LogoutResponse>('/auth/logout');
    // Signing out of a student view: the server has put the teacher or admin back in their own account.
    if (user) switchAccount(user, null);
    else forgetSession();
  }, [queryClient, switchAccount, forgetSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data?.user ?? null,
      impersonator: me.data?.impersonator ?? null,
      isLoading: me.isPending,
      error: me.error,
      signedOut,
      accountChange,
      setUser,
      switchAccount,
      forgetSession,
      refresh: me.refetch,
      logout,
    }),
    [me.data, me.isPending, me.error, signedOut, accountChange, me.refetch, setUser, switchAccount, forgetSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Sign-out for buttons: never rejects. Resolves true once signed out (or, from a student view, back in the teacher's or
 * admin's own account); if the server can't be reached the user stays signed in (their session is still open) and a
 * notification asks them to try again.
 */
export function useSignOut(): () => Promise<boolean> {
  const { logout } = useAuth();
  return useCallback(async () => {
    try {
      await logout();
      return true;
    } catch (err) {
      notifyError(err, "Couldn't sign out — try again");
      return false;
    }
  }, [logout]);
}

/** The signed-in user; only call inside routes wrapped by <RequireAuth>. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser called while signed out');
  return user;
}

export function isStaff(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'teacher' || user?.role === 'admin';
}
