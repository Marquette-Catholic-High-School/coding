// Fetch wrapper for the JSON API plus the shared QueryClient and query keys.
// Feature hooks live next to this file (api/<area>.ts) and use `api` + `queryKeys`.

import type { ApiErrorBody } from '@codeclass/shared';
import { QueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** True when the server could not be reached at all (network down / server stopped). */
export class NetworkError extends Error {
  constructor() {
    super("Can't reach the CodeClass server. Check your connection and try again.");
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Readable cookie with the session's anti-CSRF token; the server sets it at sign-in (server/src/auth.ts). */
const CSRF_COOKIE = 'cc_csrf';

/** A cookie's value from a `document.cookie` string. */
export function readCookie(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * The anti-CSRF token, read fresh for every request (it changes when someone signs in). Only the page's main thread
 * can read cookies — code runners in Web Workers can't, which is the point.
 */
function csrfToken(): string | undefined {
  return typeof document === 'undefined' ? undefined : readCookie(document.cookie, CSRF_COOKIE);
}

async function send(method: Method, path: string, body: string | undefined): Promise<Response> {
  const token = csrfToken();
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-codeclass': '1',
        ...(token ? { 'x-codeclass-token': token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    });
  } catch {
    throw new NetworkError();
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const json = body !== undefined ? JSON.stringify(body) : undefined;
  let res = await send(method, path, json);
  let data = await readBody(res);
  // A session from before the anti-CSRF cookie existed (or a stale cookie): the 403 sets a fresh cookie, so retry once.
  if (res.status === 403 && (data as ApiErrorBody | null)?.error?.code === 'csrf') {
    res = await send(method, path, json);
    data = await readBody(res);
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status})`, err?.fieldErrors);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Field errors from a 400 response, for `form.setErrors(fieldErrors(err))`. */
export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.fieldErrors ? err.fieldErrors : {};
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/**
 * Query keys. Invalidate by prefix, e.g. `queryClient.invalidateQueries({ queryKey: queryKeys.classes.all })`.
 * Mutations that change class membership, assignments or submissions should also invalidate `dashboard`.
 */
export const queryKeys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  dashboard: ['dashboard'] as const,
  users: { all: ['users'] as const, list: (role?: string) => ['users', 'list', role ?? 'all'] as const },
  languages: {
    all: ['languages'] as const,
    list: ['languages', 'list'] as const,
    catalog: ['languages', 'catalog'] as const,
    detail: (id: string) => ['languages', 'detail', id] as const,
  },
  classes: {
    all: ['classes'] as const,
    list: (archived = false) => ['classes', 'list', archived] as const,
    detail: (id: number) => ['classes', 'detail', id] as const,
    roster: (id: number) => ['classes', 'roster', id] as const,
    invites: (id: number) => ['classes', 'invites', id] as const,
    assignments: (id: number) => ['classes', 'assignments', id] as const,
  },
  assignments: {
    all: ['assignments'] as const,
    detail: (id: number) => ['assignments', 'detail', id] as const,
    mySubmission: (id: number) => ['assignments', 'my-submission', id] as const,
    submissions: (id: number) => ['assignments', 'submissions', id] as const,
    submission: (id: number, studentId: number) => ['assignments', 'submission', id, studentId] as const,
  },
  projects: { all: ['projects'] as const, detail: (id: number) => ['projects', 'detail', id] as const },
  joinPreview: (code: string) => ['join-preview', code] as const,
};
