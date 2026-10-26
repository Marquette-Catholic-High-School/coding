// Own file: the per-IP limiter is module state, so this starts with a fresh one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientAs, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.close());

describe('trying out emails', () => {
  it('limits how many email changes that join nothing a student can make', async () => {
    const prober = insertUser('student', { email: 'try0@school.org' });
    const client = clientAs(srv.base, prober.id);
    const statuses: number[] = [];
    for (let i = 1; i <= 80; i++) {
      statuses.push((await client.patch('/auth/profile', { name: 'Prober', email: `try${i}@school.org` })).status);
      if (statuses.at(-1) === 429) break;
    }
    // The first changes are fine; after the limit (60 misses per 10 minutes) further tries are refused.
    expect(statuses.slice(0, 50).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("doesn't limit teachers changing their own email", async () => {
    const teacher = insertUser('teacher', { email: 't0@school.org' });
    const client = clientAs(srv.base, teacher.id);
    expect((await client.patch('/auth/profile', { name: 'Teacher', email: 't1@school.org' })).status).toBe(200);
  });
});
