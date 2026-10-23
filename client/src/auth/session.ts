import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/client';

/**
 * Forgets everything cached for the signed-in user after signing out. ['me'] is set to null in place so the
 * AuthProvider observing it re-renders as signed out; `queryClient.clear()` would drop that query without notifying
 * its observers, leaving the old user in the auth context until a full reload.
 */
export function resetSessionCache(queryClient: QueryClient): void {
  queryClient.setQueryData(queryKeys.me, null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
}
