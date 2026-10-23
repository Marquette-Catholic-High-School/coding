// Cache clean-up after deleting a class, assignment or project.

import type { Query, QueryCache, QueryClient, QueryKey } from '@tanstack/react-query';

type QueryPredicate = (query: Query) => boolean;

/** Matches one entity's queries, i.e. keys shaped [area, kind, id, …] such as ['classes', 'roster', 7]. */
export function entityQueries(area: string, id: number): QueryPredicate {
  return (query) => query.queryKey[0] === area && query.queryKey[2] === id;
}

/** Removes the query now if nothing shows it, otherwise as soon as its last observer (the mounted page) goes away. */
function removeWhenUnused(cache: QueryCache, query: Query): void {
  if (query.getObserversCount() === 0) {
    cache.remove(query);
    return;
  }
  const unsubscribe = cache.subscribe((event) => {
    if (event.query !== query) return;
    if (event.type === 'removed') unsubscribe();
    else if (event.type === 'observerRemoved' && query.getObserversCount() === 0) {
      unsubscribe();
      cache.remove(query);
    }
  });
}

/**
 * After a successful delete: refreshes the `related` queries (lists, dashboard…) but never the deleted entity's own
 * queries. Refetching those would 404 and flash "not found" on the page that is about to navigate away, so they
 * keep their data while that page is mounted and are dropped from the cache once it unmounts.
 */
export async function refreshAfterDelete(qc: QueryClient, deleted: QueryPredicate, related: QueryKey[]): Promise<void> {
  await qc.cancelQueries({ predicate: deleted });
  const cache = qc.getQueryCache();
  for (const query of cache.findAll({ predicate: deleted })) removeWhenUnused(cache, query);
  await Promise.all(related.map((queryKey) => qc.invalidateQueries({ queryKey, predicate: (query) => !deleted(query) })));
}
