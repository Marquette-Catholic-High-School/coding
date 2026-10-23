import type {
  CatalogResponse,
  CreatePseudocodeInput,
  InstallLanguageInput,
  Language,
  LanguageResponse,
  LanguagesResponse,
  OkResponse,
  UpdateLanguageInput,
} from '@codeclass/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, queryKeys } from './client';

/** All installed languages visible to the viewer (students: enabled only). */
export function useLanguages() {
  return useQuery({
    queryKey: queryKeys.languages.list,
    queryFn: () => api.get<LanguagesResponse>('/languages'),
    staleTime: 60_000,
  });
}

/** id → Language lookup built from useLanguages(). */
export function useLanguageMap(): Map<string, Language> {
  const { data } = useLanguages();
  return useMemo(() => new Map((data?.languages ?? []).map((l) => [l.id, l])), [data]);
}

export function useLanguage(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.languages.detail(id ?? ''),
    queryFn: () => api.get<LanguageResponse>(`/languages/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
}

export function useLanguageCatalog() {
  return useQuery({ queryKey: queryKeys.languages.catalog, queryFn: () => api.get<CatalogResponse>('/languages/catalog') });
}

function useInvalidateLanguages() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.languages.all });
}

export function useInstallLanguage() {
  const invalidate = useInvalidateLanguages();
  return useMutation({
    mutationFn: (input: InstallLanguageInput) => api.post<LanguageResponse>('/languages/install', input),
    onSuccess: invalidate,
  });
}

export function useCreatePseudocode() {
  const invalidate = useInvalidateLanguages();
  return useMutation({
    mutationFn: (input: CreatePseudocodeInput) => api.post<LanguageResponse>('/languages/pseudocode', input),
    onSuccess: invalidate,
  });
}

export function useUpdateLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateLanguageInput & { id: string }) =>
      api.patch<LanguageResponse>(`/languages/${encodeURIComponent(id)}`, input),
    onSuccess: ({ language }) => {
      qc.setQueryData(queryKeys.languages.detail(language.id), { language });
      void qc.invalidateQueries({ queryKey: queryKeys.languages.all });
    },
  });
}

export function useUninstallLanguage() {
  const invalidate = useInvalidateLanguages();
  return useMutation({
    mutationFn: (id: string) => api.delete<OkResponse>(`/languages/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });
}
