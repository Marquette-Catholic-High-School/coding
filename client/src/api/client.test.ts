import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, readCookie } from './client';

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('a=1; cc_csrf=tok-EN_1; b=2', 'cc_csrf')).toBe('tok-EN_1');
    expect(readCookie('cc_csrf=x', 'cc_csrf')).toBe('x');
    expect(readCookie('xcc_csrf=no; cc_csrf2=no', 'cc_csrf')).toBeUndefined();
    expect(readCookie('', 'cc_csrf')).toBeUndefined();
    expect(readCookie('cc_csrf=a%20b', 'cc_csrf')).toBe('a b');
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const csrfError = { error: { message: 'Your session needs refreshing — reload the page.', code: 'csrf' } };

describe('api wrapper anti-CSRF token', () => {
  const doc = { cookie: '' };
  const fetchMock = vi.fn<typeof fetch>();
  const sentHeaders = (call: number) => fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;

  beforeEach(() => {
    doc.cookie = 'theme=dark; cc_csrf=token-1';
    fetchMock.mockReset();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the cookie value as x-codeclass-token on every method', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }));
    await api.get('/auth/me');
    await api.patch('/classes/1', { name: 'x' });
    expect(sentHeaders(0)).toMatchObject({ 'x-codeclass': '1', 'x-codeclass-token': 'token-1' });
    expect(sentHeaders(1)).toMatchObject({ 'x-codeclass': '1', 'x-codeclass-token': 'token-1' });
  });

  it('sends no token when there is no cookie (signed out)', async () => {
    doc.cookie = '';
    fetchMock.mockResolvedValueOnce(json(200, { needsSetup: false }));
    await api.get('/setup');
    expect(sentHeaders(0)).not.toHaveProperty('x-codeclass-token');
  });

  it('retries once with the refreshed cookie after a csrf 403', async () => {
    doc.cookie = '';
    fetchMock.mockImplementationOnce(async () => {
      doc.cookie = 'cc_csrf=fresh'; // the 403 response set it
      return json(403, csrfError);
    });
    fetchMock.mockResolvedValueOnce(json(200, { user: { id: 1 } }));
    await expect(api.post('/classes', { name: 'C' })).resolves.toEqual({ user: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(1)['x-codeclass-token']).toBe('fresh');
    expect(fetchMock.mock.calls[1]![1]!.body).toBe(JSON.stringify({ name: 'C' }));
  });

  it('gives up after one retry', async () => {
    fetchMock.mockImplementation(async () => json(403, csrfError));
    const err = await api.get('/auth/me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toMatch(/reload the page/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry other 403s", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { message: "You don't have access to this" } }));
    await expect(api.get('/classes/1')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
