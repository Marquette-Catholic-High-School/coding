import type { CompareMode, Language } from '@codeclass/shared';
import { useQuery } from '@tanstack/react-query';
import { sameProgram } from './sameProgram';

/** The language as `useSameProgram` needs it; `id` and `updatedAt` stand for its configuration in the cache key. */
export type SameProgramLanguage = Pick<Language, 'id' | 'kind' | 'pseudocode' | 'updatedAt'>;

/**
 * Whether `code` is the same program as the teacher's `solution` (`sameProgram`), for badges: false until that's
 * known, and when there's no code, solution or language. Worked out once for each language, compare mode, solution
 * and code (cached like a query, so re-renders and refetched rows with the same code don't redo it).
 */
export function useSameProgram(
  language: SameProgramLanguage | null | undefined,
  code: string | null,
  solution: string | null | undefined,
  compareMode: CompareMode,
): boolean {
  const enabled = language != null && code != null && solution != null && solution.trim() !== '';
  const { data } = useQuery({
    queryKey: ['same-program', language?.id, language?.updatedAt, compareMode, solution, code],
    queryFn: () => sameProgram({ kind: language!.kind, pseudocode: language!.pseudocode }, code!, solution, compareMode),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return enabled && data === true;
}
