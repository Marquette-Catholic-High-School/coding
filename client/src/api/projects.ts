import type { CreateProjectInput, OkResponse, ProjectResponse, ProjectsResponse, UpdateProjectInput } from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from './client';
import { entityQueries, refreshAfterDelete } from './deletedQueries';

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects.all, queryFn: () => api.get<ProjectsResponse>('/projects') });
}

export function useProject(id: number) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => api.get<ProjectResponse>(`/projects/${id}`),
    refetchOnWindowFocus: false,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<ProjectResponse>('/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects.all }),
  });
}

/** Used for autosave (code) and renames (title). */
export function useUpdateProject(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => api.patch<ProjectResponse>(`/projects/${id}`, input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.projects.detail(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all, exact: true });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<OkResponse>(`/projects/${id}`),
    onSuccess: (_data, id) => refreshAfterDelete(qc, entityQueries('projects', id), [queryKeys.projects.all]),
  });
}
