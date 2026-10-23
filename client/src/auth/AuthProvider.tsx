import type { User, UserResponse } from '@codeclass/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError, queryKeys } from '../api/client';

interface AuthContextValue {
  /** Null when signed out. */
  user: User | null;
  /** True only during the very first /auth/me request. */
  isLoading: boolean;
  /** Error other than 401 (e.g. server unreachable) from the session check. */
  error: unknown;
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

  const setUser = useCallback(
    (user: User | null) => {
      queryClient.setQueryData(queryKeys.me, user);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data ?? null,
      isLoading: me.isPending,
      error: me.error,
      setUser,
      refresh: me.refetch,
      logout,
    }),
    [me.data, me.isPending, me.error, me.refetch, setUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
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
