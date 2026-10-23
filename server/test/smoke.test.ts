import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientAs, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

describe('foundation', () => {
  it('rejects state-changing calls without the CSRF header', async () => {
    const res = await fetch(`${srv.base}/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('sends cross-origin isolation headers', async () => {
    const res = await fetch(`${srv.base}/nope`);
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(res.status).toBe(404);
  });

  it('can create a signed-in client directly', async () => {
    const u = insertUser('teacher');
    const c = clientAs(srv.base, u.id);
    expect(c.cookie).toMatch(/^sid=/);
  });
});
