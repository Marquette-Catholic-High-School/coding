import type { Impersonator, User } from '@codeclass/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, queryKeys } from '../api/client';
import {
  ACCOUNT_SWITCH_KEY,
  ACCOUNT_SWITCH_STATE,
  checkSession,
  isAccountSwitch,
  listenForAccountChanges,
  rememberReturnPath,
  resetSessionCache,
  sameAccount,
  settleBeforeSwitch,
  switchSessionCache,
  takeReturnPath,
  waitForMutations,
  type Session,
} from './session';

const user = (id: number, name: string, role: User['role']): User => ({
  id,
  username: name.toLowerCase().replace(' ', '.'),
  email: null,
  name,
  role,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const ann = user(1, 'Ann Teacher', 'teacher');
const maya = user(7, 'Maya Rivera', 'student');
const annAsImpersonator: Impersonator = { id: ann.id, name: ann.name, username: ann.username, role: ann.role };
const annSession: Session = { user: ann, impersonator: null };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Stands in for AuthProvider's useQuery: it only re-renders when its observer is notified. */
function observeMe(qc: QueryClient) {
  const observer = new QueryObserver<Session | null>(qc, { queryKey: queryKeys.me, queryFn: () => annSession, staleTime: 60_000 });
  const seen: (Session | null | undefined)[] = [];
  const unsubscribe = observer.subscribe((result) => seen.push(result.data));
  return { observer, seen, unsubscribe };
}

describe('resetSessionCache (sign out)', () => {
  it("tells the auth provider's ['me'] observer that nobody is signed in", async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, annSession);
    const { observer, seen, unsubscribe } = observeMe(qc);
    await tick();

    resetSessionCache(qc);
    await tick();

    expect(seen.at(-1)).toBeNull();
    expect(observer.getCurrentResult().data).toBeNull();
    expect(qc.getQueryData(queryKeys.me)).toBeNull();
    unsubscribe();
  });

  it("drops every other cached query so the next user can't see them", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, annSession);
    qc.setQueryData(queryKeys.classes.list(false), { classes: [{ id: 3 }] });
    qc.setQueryData(queryKeys.dashboard, { role: 'teacher' });

    resetSessionCache(qc);

    expect(qc.getQueryCache().findAll().map((q) => q.queryKey)).toEqual([queryKeys.me]);
  });
});

describe('switchSessionCache (sign in as student, back to my account)', () => {
  it("tells the auth provider's ['me'] observer about the new account and who is using it", async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, annSession);
    const { observer, seen, unsubscribe } = observeMe(qc);
    await tick();

    const studentView: Session = { user: maya, impersonator: annAsImpersonator };
    switchSessionCache(qc, studentView);
    await tick();
    expect(seen.at(-1)).toEqual(studentView);
    expect(observer.getCurrentResult().data).toEqual(studentView);

    switchSessionCache(qc, annSession);
    await tick();
    expect(seen.at(-1)).toEqual(annSession);
    unsubscribe();
  });

  it("drops everything cached for the previous account so the student view can't show the teacher's data", () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, annSession);
    qc.setQueryData(queryKeys.classes.roster(3), { students: [maya] });
    qc.setQueryData(queryKeys.dashboard, { role: 'teacher' });

    switchSessionCache(qc, { user: maya, impersonator: annAsImpersonator });

    expect(qc.getQueryCache().findAll().map((q) => q.queryKey)).toEqual([queryKeys.me]);
    expect(qc.getQueryData(queryKeys.me)).toEqual({ user: maya, impersonator: annAsImpersonator });
  });
});

describe('checkSession (keeping a tab in step with the account other tabs switch to)', () => {
  const ben = user(8, 'Ben Okafor', 'student');
  const mayaView: Session = { user: maya, impersonator: annAsImpersonator };
  const benView: Session = { user: ben, impersonator: annAsImpersonator };
  const mayaOwn: Session = { user: maya, impersonator: null };

  it('compares the user and who is using their account', () => {
    expect(sameAccount(mayaView, { user: { ...maya, name: 'Maya R.' }, impersonator: annAsImpersonator })).toBe(true);
    expect(sameAccount(mayaView, mayaOwn)).toBe(false);
    expect(sameAccount(mayaView, benView)).toBe(false);
    expect(sameAccount(null, null)).toBe(true);
    expect(sameAccount(annSession, null)).toBe(false);
  });

  it("uses the server's session on first load, for the same account, and when signed out", () => {
    expect(checkSession(undefined, annSession)).toBe('use');
    expect(checkSession(null, mayaView)).toBe('use'); // a signed-out tab follows a sign-in elsewhere
    expect(checkSession(annSession, { user: { ...ann, name: 'Ann T.' }, impersonator: null })).toBe('use');
    expect(checkSession(annSession, null)).toBe('use'); // signed out or expired: the sign-in page, as before
  });

  it("keeps showing this tab's account when another tab switched to a different one", () => {
    // The scenario that could save Maya's code as Ben's work: this tab still shows Maya's view.
    expect(checkSession(mayaView, benView)).toBe('other-tab');
    expect(checkSession(mayaView, annSession)).toBe('other-tab');
    expect(checkSession(annSession, mayaView)).toBe('other-tab');
    expect(checkSession(mayaView, mayaOwn)).toBe('other-tab');
  });

  it('goes back to the staff account when the student view stopped working', () => {
    expect(checkSession(mayaView, null)).toBe('view-ended');
  });

  it('hears about account changes from other tabs', async () => {
    const heard = vi.fn();
    const stop = listenForAccountChanges(heard);
    const otherTab = new BroadcastChannel('codeclass.account');
    otherTab.postMessage('changed');
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    otherTab.close();
    stop();
  });
});

describe('leaving pages and settling work when switching accounts', () => {
  it('marks account-switch navigations so unsaved-changes guards let them through', () => {
    expect(isAccountSwitch({ state: ACCOUNT_SWITCH_STATE })).toBe(true);
    expect(isAccountSwitch({ state: null })).toBe(false);
    expect(isAccountSwitch({ state: { from: '/x' } })).toBe(false);
  });

  /** A mutation that stays pending until `finish` is called. */
  function pendingMutation(qc: QueryClient, mutationKey?: readonly unknown[]) {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const running = qc.getMutationCache().build(qc, { mutationKey, mutationFn: () => done }).execute(undefined);
    return { finish: async () => (finish(), await running) };
  }

  it('waits for calls in progress, but not for the account switch itself', async () => {
    const qc = new QueryClient();
    const save = pendingMutation(qc);
    pendingMutation(qc, ACCOUNT_SWITCH_KEY); // never finishes: must not be waited for
    let settled = false;
    const waiting = waitForMutations(qc).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    await save.finish();
    await waiting;
    expect(settled).toBe(true);
  });

  it("doesn't wait forever for a call that never finishes", async () => {
    const qc = new QueryClient();
    pendingMutation(qc);
    await expect(waitForMutations(qc, 20)).resolves.toBeUndefined();
  });

  it('saves pending edits first, and stops the switch only when the server is unreachable', async () => {
    const qc = new QueryClient();
    const flush = vi.fn(async () => {});
    await settleBeforeSwitch(qc, flush);
    expect(flush).toHaveBeenCalledTimes(1);

    // Refused saves stay refused (their editor says so); switching still works.
    await expect(settleBeforeSwitch(qc, () => Promise.reject(new ApiError(409, 'Already submitted')))).resolves.toBeUndefined();
    // Unreachable: the switch would fail too, so stay and say so.
    await expect(settleBeforeSwitch(qc, () => Promise.reject(new NetworkError()))).rejects.toBeInstanceOf(NetworkError);
  });
});

/** In-memory stand-in for sessionStorage. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe('return path for "Back to my account"', () => {
  it('returns the page the teacher left, once', () => {
    const storage = memoryStorage();
    rememberReturnPath(ann.id, '/classes/3?tab=students', storage);

    expect(takeReturnPath(ann.id, storage)).toBe('/classes/3?tab=students');
    expect(takeReturnPath(ann.id, storage)).toBeNull();
  });

  it("ignores a page remembered for someone else (and forgets it)", () => {
    const storage = memoryStorage();
    rememberReturnPath(99, '/admin/users?tab=students', storage);

    expect(takeReturnPath(ann.id, storage)).toBeNull();
    expect(storage.items.size).toBe(0);
  });

  it('only keeps paths inside the app', () => {
    const storage = memoryStorage();
    rememberReturnPath(ann.id, '//evil.example/x', storage);
    expect(takeReturnPath(ann.id, storage)).toBeNull();

    storage.setItem('codeclass.studentView.returnTo', JSON.stringify({ staffId: ann.id, path: 'https://evil.example' }));
    expect(takeReturnPath(ann.id, storage)).toBeNull();
  });

  it('copes with unreadable, broken or missing storage', () => {
    const storage = memoryStorage();
    storage.setItem('codeclass.studentView.returnTo', '{not json');
    expect(takeReturnPath(ann.id, storage)).toBeNull();

    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => rememberReturnPath(ann.id, '/dashboard', throwing)).not.toThrow();
    expect(takeReturnPath(ann.id, throwing)).toBeNull();

    // No storage at all (here: no `window` under Node).
    expect(() => rememberReturnPath(ann.id, '/dashboard')).not.toThrow();
    expect(takeReturnPath(ann.id)).toBeNull();
  });
});
