import { APP_NAME } from '@codeclass/shared';
import { useEffect } from 'react';

/** Sets the browser tab title to "{page} · CodeClass". */
export function usePageTitle(page: string | null | undefined) {
  useEffect(() => {
    document.title = page ? `${page} · ${APP_NAME}` : APP_NAME;
  }, [page]);
}
