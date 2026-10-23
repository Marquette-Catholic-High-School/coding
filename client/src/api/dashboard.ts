import type { DashboardResponse } from '@codeclass/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from './client';

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: () => api.get<DashboardResponse>('/dashboard') });
}
