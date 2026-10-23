// Per-IP throttle on unknown class codes (join preview, registration, joining). Its own file, so the in-memory limiter
// starts empty and locking out 127.0.0.1 can't affect other tests.

import type { ClassResponse } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientAs, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let code: string;
beforeAll(async () => {
  srv = await startTestServer();
  const teacher = clientAs(srv.base, insertUser('teacher').id);
  code = (await teacher.post<ClassResponse>('/classes', { name: 'Year 8' })).body.class.joinCode!;
});
afterAll(() => srv.close());

const MISSES_ALLOWED = 60;

describe('class code guessing', () => {
  it("doesn't count codes that match a class", async () => {
    for (let i = 0; i < MISSES_ALLOWED + 10; i++) {
      expect((await srv.client().get(`/join/${code}`)).status).toBe(200);
    }
  });

  it('locks a client out after too many unknown codes, on every code endpoint', async () => {
    const student = clientAs(srv.base, insertUser('student').id);
    const register = { name: 'Guesser', username: 'guesser', password: 'password123' };
    // Misses from all three endpoints share one budget.
    for (let i = 0; i < MISSES_ALLOWED / 3; i++) {
      expect((await srv.client().get('/join/ZZZZZZ')).status).toBe(404);
      expect((await srv.client().post('/auth/register', { ...register, joinCode: 'ZZZZZZ' })).status).toBe(400);
      expect((await student.post('/classes/join', { joinCode: 'ZZZZZZ' })).status).toBe(400);
    }

    const preview = await srv.client().get(`/join/${code}`);
    expect(preview.status).toBe(429);
    expect(preview.body.error.message).toMatch(/too many/i);

    // Even a right code is refused, so guesses learn nothing while locked.
    const raw = await fetch(`${srv.base}/join/${code}`);
    expect(raw.status).toBe(429);
    expect(Number(raw.headers.get('retry-after'))).toBeGreaterThan(0);

    const registered = await srv.client().post('/auth/register', { ...register, joinCode: code });
    expect(registered.status).toBe(429);
    expect(registered.body.error.fieldErrors).toHaveProperty('joinCode');

    const joined = await student.post('/classes/join', { joinCode: code });
    expect(joined.status).toBe(429);
    expect(joined.body.error.fieldErrors).toHaveProperty('joinCode');
  });
});
