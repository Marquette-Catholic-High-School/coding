import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../api/client';
import { resetSessionCache } from './session';

const ann = { id: 1, name: 'Ann Teacher' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('resetSessionCache (sign out)', () => {
  it("tells the auth provider's ['me'] observer that nobody is signed in", async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.me, ann);
    // Stands in for AuthProvider's useQuery: it only re-renders when its observer is notified.
    const observer = new QueryObserver(qc, { queryKey: queryKeys.me, queryFn: () => ann, staleTime: 60_000 });
    const seen: unknown[] = [];
    const unsubscribe = observer.subscribe((result) => seen.push(result.data));
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
    qc.setQueryData(queryKeys.me, ann);
    qc.setQueryData(queryKeys.classes.list(false), { classes: [{ id: 3 }] });
    qc.setQueryData(queryKeys.dashboard, { role: 'teacher' });

    resetSessionCache(qc);

    expect(qc.getQueryCache().findAll().map((q) => q.queryKey)).toEqual([queryKeys.me]);
  });
});
