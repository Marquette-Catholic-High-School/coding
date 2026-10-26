import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { ApiErrorBody } from '@codeclass/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
    /** Machine-readable reason sent as `error.code` (see ApiErrorBody). */
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fieldErrors?: Record<string, string>) => new HttpError(400, message, fieldErrors);
export const unauthorized = (message = 'Please sign in') => new HttpError(401, message);
export const forbidden = (message = "You don't have access to this") => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, fieldErrors?: Record<string, string>) => new HttpError(409, message, fieldErrors);
/** A call with a session but without its anti-CSRF token (see `requireCsrfToken` in app.ts). */
export const csrfRefused = () => new HttpError(403, 'Your session needs refreshing — reload the page.', undefined, 'csrf');

/** Validates a request body; throws a 400 with per-field messages (keys = top-level field names). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    fieldErrors[key] ??= issue.message;
  }
  throw badRequest('Please check the highlighted fields', fieldErrors);
}

/** Parses a positive integer route param; 404 when invalid (so bad ids look like missing records). */
export function parseId(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw notFound();
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw notFound();
  return n;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = {
      error: {
        message: err.message,
        ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
        ...(err.code ? { code: err.code } : {}),
      },
    };
    res.status(err.status).json(body);
    return;
  }
  // Malformed JSON bodies from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { message: 'Malformed JSON body' } } satisfies ApiErrorBody);
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { message: 'That is too large to save' } } satisfies ApiErrorBody);
    return;
  }
  // Other client errors that Express or body-parser already tagged with a 4xx status (a malformed percent-encoded
  // route param, an unsupported charset or Content-Encoding, an aborted upload): bad input, not a server fault.
  const status = typeof err?.status === 'number' ? err.status : typeof err?.statusCode === 'number' ? err.statusCode : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    res.status(status).json({ error: { message: status === 415 ? 'Unsupported request format' : 'Bad request' } } satisfies ApiErrorBody);
    return;
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong on the server' } } satisfies ApiErrorBody);
};
