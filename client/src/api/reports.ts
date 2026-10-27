import type { ReportOptionsResponse } from '@codeclass/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, queryKeys } from './client';

/** The classes and students the viewer can report on, and whether the school report is theirs to download (admins). */
export function useReportOptions() {
  return useQuery({ queryKey: queryKeys.reports.options, queryFn: () => api.get<ReportOptionsResponse>('/reports/options') });
}

/**
 * Fetches a report PDF from a path made by `reportPath` (pages/reports/reportParams.ts). Saving it is up to the caller
 * (`saveBlob` in api/download.ts), in `mutate`'s own `onSuccess`, so a dialog closed while the PDF is made saves nothing.
 */
export function useDownloadReport() {
  return useMutation({ mutationFn: (path: string) => api.download(path) });
}
