import type { User, UserResponse } from '@codeclass/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, queryKeys } from '../api/client';
import { notifyError } from '../components/notify';
import { resetSessionCache } from './session';

interface AuthContextValue {
  /** Null when signed out. */
  user: User | null;
  /** True only during the very first /auth/me request. */
  isLoading: boolean;
  /** Error other than 401 (e.g. server unreachable) from the session check. */
  error: unknown;
  /**
   * True after logout() in this tab until someone signs in again. Guards then send people to plain /login, without a
   * ?next= that would take the next person on a shared computer to the previous user's page.
   */
  signedOut: boolean;
  /** Store the user returned by login/register/setup/profile endpoints. */
  setUser(user: User | null): void;
  refresh(): Promise<unknown>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User | null> {
  try {
    return (await api.get<UserResponse>('/auth/me')).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: 60_000, retry: 1 });
  const [signedOut, setSignedOut] = useState(false);

  const setUser = useCallback(
    (user: User | null) => {
      if (user) setSignedOut(false);
      queryClient.setQueryData(queryKeys.me, user);
    },
    [queryClient],
  );

  // Only forgets the user once the server has ended the session. If the request fails the session is still open
  // (a reload would sign the user straight back in), so stay signed in and let the caller say so.
  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setSignedOut(true);
    resetSessionCache(queryClient);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data ?? null,
      isLoading: me.isPending,
      error: me.error,
      signedOut,
      setUser,
      refresh: me.refetch,
      logout,
    }),
    [me.data, me.isPending, me.error, signedOut, me.refetch, setUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Sign-out for buttons: never rejects. Resolves true once signed out; if the server can't be reached the user stays
 * signed in (their session is still open) and a notification asks them to try again.
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
