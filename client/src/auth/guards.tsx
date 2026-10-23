import type { Role } from '@codeclass/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '../components/QueryState';
import { ServerUnreachable } from '../components/ServerUnreachable';
import { NotFoundCard } from '../components/NotFoundCard';
import { useAuth } from './AuthProvider';

/** Layout route: renders children only when signed in, otherwise redirects to /login?next=… (plain /login after signing out). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, isLoading, error, refresh, signedOut } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader label="Loading…" fullPage />;
  if (!user && error) return <ServerUnreachable onRetry={() => void refresh()} />;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={signedOut || next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children ?? <Outlet />;
}

/** Shows a not-found card (not a redirect) when the user's role is not allowed. */
export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <NotFoundCard />;
  return children ?? <Outlet />;
}

/** Layout route for login/setup pages: signed-in users go to their dashboard (or ?next=). */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader label="Loading…" fullPage />;
  if (user) {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'} replace />;
  }
  return children ?? <Outlet />;
}
