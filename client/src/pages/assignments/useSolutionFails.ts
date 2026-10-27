import type { Assignment, Language, TestCase } from '@codeclass/shared';
import { useQuery } from '@tanstack/react-query';
import { runTests } from '../../runtime';
import { summarizeSolutionCheck } from './solutionView';

/**
 * Which of `tests` the teacher's solution fails (their ids), from running it on them once: whether work that is the
 * same program as the solution keeps full marks over tests it fails (`passesSolutionTests`). Null until that's known,
 * when there's nothing to check (`tests` null or empty, no solution or language), or when the code runner didn't
 * start. Cached like a query, so re-renders don't run it again.
 */
export function useSolutionFails(
  assignment: Pick<Assignment, 'id' | 'solutionCode' | 'compareMode'>,
  language: Pick<Language, 'id' | 'kind' | 'pseudocode' | 'updatedAt'> | null,
  tests: TestCase[] | null,
): string[] | null {
  const solution = assignment.solutionCode ?? '';
  const enabled = language != null && tests != null && tests.length > 0 && solution.trim() !== '';
  const { data } = useQuery({
    queryKey: ['solution-fails', assignment.id, language?.id, language?.updatedAt, assignment.compareMode, solution, tests],
    queryFn: async ({ signal }) => {
      let runnerError = false;
      const results = await runTests({ kind: language!.kind, pseudocode: language!.pseudocode }, solution, tests!, {
        compareMode: assignment.compareMode,
        signal,
        freshWorker: true,
        onRunnerError: () => {
          runnerError = true;
        },
      });
      // Results that say nothing about the solution aren't worth keeping.
      if (runnerError || signal.aborted) throw new Error("The solution couldn't be run.");
      return summarizeSolutionCheck(tests!, results).failing.map((f) => f.id);
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return enabled ? (data ?? null) : null;
}
