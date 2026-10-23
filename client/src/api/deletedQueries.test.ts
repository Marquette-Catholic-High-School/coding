import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from './client';
import { entityQueries, refreshAfterDelete } from './deletedQueries';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('entityQueries', () => {
  it("matches only one entity's queries", () => {
    const qc = new QueryClient();
    for (const key of [
      queryKeys.classes.detail(7),
      queryKeys.classes.roster(7),
      queryKeys.classes.assignments(7),
      queryKeys.classes.detail(8),
      queryKeys.classes.list(false),
      queryKeys.assignments.detail(7),
    ]) {
      qc.setQueryData(key, {});
    }
    const matched = qc.getQueryCache().findAll({ predicate: entityQueries('classes', 7) });
    expect(matched.map((q) => q.queryKey)).toEqual([queryKeys.classes.detail(7), queryKeys.classes.roster(7), queryKeys.classes.assignments(7)]);
  });

  it("covers an assignment's detail, submissions and per-student submissions", () => {
    const qc = new QueryClient();
    for (const key of [queryKeys.assignments.detail(4), queryKeys.assignments.submissions(4), queryKeys.assignments.submission(4, 12)]) {
      qc.setQueryData(key, {});
    }
    expect(qc.getQueryCache().findAll({ predicate: entityQueries('assignments', 4) })).toHaveLength(3);
  });
});

describe('refreshAfterDelete', () => {
  it("doesn't refetch the deleted page's query (no 404 flash), and drops it once the page unmounts", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchDetail = vi.fn(async () => ({ project: { id: 5, title: 'Old' } }));
    const fetchList = vi.fn(async () => ({ projects: [] }));
    // The project page (still mounted while the delete finishes) and the playground list.
    const page = new QueryObserver(qc, { queryKey: queryKeys.projects.detail(5), queryFn: fetchDetail });
    const list = new QueryObserver(qc, { queryKey: queryKeys.projects.all, queryFn: fetchList });
    const stopPage = page.subscribe(() => {});
    const stopList = list.subscribe(() => {});
    await tick();
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(fetchList).toHaveBeenCalledTimes(1);

    await refreshAfterDelete(qc, entityQueries('projects', 5), [queryKeys.projects.all]);

    expect(fetchList).toHaveBeenCalledTimes(2);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(page.getCurrentResult().data).toEqual({ project: { id: 5, title: 'Old' } });
    expect(qc.getQueryCache().find({ queryKey: queryKeys.projects.detail(5) })).toBeDefined();

    stopPage(); // the page navigates away
    expect(qc.getQueryCache().find({ queryKey: queryKeys.projects.detail(5) })).toBeUndefined();
    expect(qc.getQueryData(queryKeys.projects.all)).toEqual({ projects: [] });
    stopList();
  });

  it('removes unused queries of the deleted entity straight away', async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.assignments.detail(9), { assignment: { id: 9 } });
    qc.setQueryData(queryKeys.assignments.submission(9, 2), { submission: {} });
    qc.setQueryData(queryKeys.assignments.detail(10), { assignment: { id: 10 } });

    await refreshAfterDelete(qc, entityQueries('assignments', 9), [queryKeys.assignments.all]);

    expect(qc.getQueryData(queryKeys.assignments.detail(9))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.assignments.submission(9, 2))).toBeUndefined();
    const other = qc.getQueryCache().find({ queryKey: queryKeys.assignments.detail(10) });
    expect(other?.state.isInvalidated).toBe(true);
  });
});
