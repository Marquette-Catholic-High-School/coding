import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountChangedError, api, ApiError, queryClient, queryKeys, readCookie, setSessionProblemListener } from './client';

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

describe('api wrapper: the account this tab shows', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const sentHeaders = (call: number) => fetchMock.mock.calls[call]![1]!.headers as Record<string, string>;
  const problem = vi.fn();
  const accountChanged = { error: { message: "You're using a different account in another tab", code: 'account-changed' } };

  beforeEach(() => {
    fetchMock.mockReset();
    problem.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setSessionProblemListener(problem);
    queryClient.setQueryData(queryKeys.me, { user: { id: 7 }, impersonator: { id: 1 } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionProblemListener(null);
    queryClient.clear();
  });

  it('sends the shown user id on every call but GET /auth/me', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }));
    await api.put('/assignments/3/submission', { code: 'x' });
    await api.get('/auth/me');
    await api.get('/classes');
    expect(sentHeaders(0)['x-codeclass-user']).toBe('7');
    expect(sentHeaders(1)).not.toHaveProperty('x-codeclass-user');
    expect(sentHeaders(2)['x-codeclass-user']).toBe('7');

    queryClient.setQueryData(queryKeys.me, null); // signed out
    await api.post('/auth/login', { login: 'a', password: 'b' });
    expect(sentHeaders(3)).not.toHaveProperty('x-codeclass-user');
  });

  it("turns the server's account-changed refusal into an AccountChangedError and rechecks the session", async () => {
    fetchMock.mockResolvedValue(json(409, accountChanged));
    const err = await api.put('/assignments/3/submission', { code: 'x' }).catch((e: unknown) => e);
    // Not an ApiError 409, which pages handle as "this work changed" (e.g. by dropping unsaved edits).
    expect(err).toBeInstanceOf(AccountChangedError);
    expect(err).not.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(problem).toHaveBeenCalledTimes(1);
  });

  it('rechecks the session when a call finds it signed out, and leaves other errors alone', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { message: 'Please sign in' } }));
    await expect(api.get('/classes')).rejects.toBeInstanceOf(ApiError);
    expect(problem).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json(409, { error: { message: 'Already submitted' } }));
    await expect(api.post('/assignments/3/submit', {})).rejects.toMatchObject({ status: 409 });
    expect(problem).toHaveBeenCalledTimes(1);

    // A wrong password while signed out isn't a session problem.
    queryClient.setQueryData(queryKeys.me, null);
    fetchMock.mockResolvedValueOnce(json(401, { error: { message: 'Incorrect username or password' } }));
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(problem).toHaveBeenCalledTimes(1);
  });
});
