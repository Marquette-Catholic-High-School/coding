import type { Impersonator, User } from '@codeclass/shared';
import type { QueryClient } from '@tanstack/react-query';
import { NetworkError, queryKeys } from '../api/client';
import { flushAutosaves } from '../hooks/useAutosave';

/** What the ['me'] query holds while signed in (null when signed out). */
export interface Session {
  user: User;
  /** The teacher or admin using this student's account ("Sign in as student"); null in the account's own sessions. */
  impersonator: Impersonator | null;
}

/** Drops every cached query except ['me'], so nothing loaded for one account is shown to another. */
function removeAccountQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
}

/**
 * Forgets everything cached for the signed-in user after signing out. ['me'] is set to null in place so the
 * AuthProvider observing it re-renders as signed out; `queryClient.clear()` would drop that query without notifying
 * its observers, leaving the old user in the auth context until a full reload.
 */
export function resetSessionCache(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.me, null);
  removeAccountQueries(queryClient);
}

/**
 * Switches to another account without a sign-in (a teacher or admin into a student's account, and back): forgets
 * everything cached for the previous account, then stores the new session in place so the AuthProvider re-renders as it.
 */
export function switchSessionCache(queryClient: QueryClient, session: Session): void {
  removeAccountQueries(queryClient);
  queryClient.setQueryData<Session | null>(queryKeys.me, session);
}

// ---------------------------------------------------------------------------
// Keeping a tab in step with the account signed in (all tabs share the session cookie)
// ---------------------------------------------------------------------------

/** True when both are signed out, or the same user used the same way (on their own, or by the same teacher or admin). */
export function sameAccount(a: Session | null, b: Session | null): boolean {
  if (!a || !b) return a === b;
  return a.user.id === b.user.id && (a.impersonator?.id ?? null) === (b.impersonator?.id ?? null);
}

/**
 * What a tab does with the session the server reports (GET /auth/me), given the one it shows:
 * - `use`: show the server's (first load, the same account with fresh details, or signed out).
 * - `other-tab`: another tab switched to a different account. Keep showing this one (the server refuses its calls
 *   meanwhile) and say so: switching this tab under its open pages could save one account's work as another's.
 * - `view-ended`: this tab's student view no longer works (the student left the teacher's classes, or it expired). Go
 *   back to the teacher's or admin's own account, which needs no password.
 */
export function checkSession(shown: Session | null | undefined, actual: Session | null): 'use' | 'other-tab' | 'view-ended' {
  if (!shown || sameAccount(shown, actual)) return 'use';
  if (!actual) return shown.impersonator ? 'view-ended' : 'use';
  return 'other-tab';
}

const ACCOUNT_CHANNEL = 'codeclass.account';
let announcer: BroadcastChannel | null = null;

/** Tells the app's other tabs that this one switched accounts, signed in or signed out, so they check theirs. */
export function announceAccountChange(): void {
  try {
    announcer ??= new BroadcastChannel(ACCOUNT_CHANNEL);
    announcer.postMessage('changed');
  } catch {
    // No BroadcastChannel: other tabs find out when the server refuses their calls.
  }
}

/** Calls `onChange` when another tab announces an account change. Returns a function that stops listening. */
export function listenForAccountChanges(onChange: () => void): () => void {
  try {
    const channel = new BroadcastChannel(ACCOUNT_CHANNEL);
    channel.onmessage = () => onChange();
    return () => channel.close();
  } catch {
    return () => {};
  }
}

/**
 * Navigation state for leaving a page because this tab switched accounts. Unsaved-changes guards let it through: the
 * previous account's changes can't be saved any more (pages that would lose some ask before the switch).
 */
export const ACCOUNT_SWITCH_STATE = { accountSwitch: true } as const;

export function isAccountSwitch(location: { state: unknown }): boolean {
  return (location.state as { accountSwitch?: unknown } | null)?.accountSwitch === true;
}

/** Mutation key of the calls that switch this tab's account; settleBeforeSwitch doesn't wait for those. */
export const ACCOUNT_SWITCH_KEY = ['account-switch'] as const;

/** Resolves once no call other than an account switch is in progress, or after `maxMs` (not to hang on a paused one). */
export function waitForMutations(queryClient: QueryClient, maxMs = 10_000): Promise<void> {
  const busy = () => queryClient.isMutating({ predicate: (m) => m.options.mutationKey?.[0] !== ACCOUNT_SWITCH_KEY[0] }) > 0;
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    const unsubscribe = queryClient.getMutationCache().subscribe(() => {
      if (!busy()) done();
    });
  });
}

/**
 * Before this tab switches accounts or signs out: saves what autosaving editors still hold and waits for calls in
 * progress, while the account they belong to is still signed in (afterwards they would be refused). Rejects only when
 * the server can't be reached, as the switch would fail too. Work the server refused to save stays refused; its editor
 * has already said so.
 */
export async function settleBeforeSwitch(queryClient: QueryClient, flush: () => Promise<void> = flushAutosaves): Promise<void> {
  try {
    await flush();
  } catch (err) {
    if (err instanceof NetworkError) throw err;
  }
  await waitForMutations(queryClient);
}

// ---------------------------------------------------------------------------
// "Back to my account" returns to the page the teacher or admin left (this tab only)
// ---------------------------------------------------------------------------

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RETURN_KEY = 'codeclass.studentView.returnTo';

/** sessionStorage, or null where it is unavailable (blocked storage, tests). */
function tabStorage(): TabStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isAppPath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

/** Remembers the page `staffId` left to sign in as a student. */
export function rememberReturnPath(staffId: number, path: string, storage: TabStorage | null = tabStorage()): void {
  if (!isAppPath(path)) return;
  try {
    storage?.setItem(RETURN_KEY, JSON.stringify({ staffId, path }));
  } catch {
    // Storage full or blocked: "Back to my account" opens the dashboard instead.
  }
}

/** The page `staffId` left to sign in as a student (forgotten once read), or null when it isn't known. */
export function takeReturnPath(staffId: number, storage: TabStorage | null = tabStorage()): string | null {
  try {
    const raw = storage?.getItem(RETURN_KEY);
    if (raw == null) return null;
    storage?.removeItem(RETURN_KEY);
    const saved = JSON.parse(raw) as { staffId?: unknown; path?: unknown } | null;
    return saved?.staffId === staffId && isAppPath(saved.path) ? saved.path : null;
  } catch {
    return null;
  }
}
