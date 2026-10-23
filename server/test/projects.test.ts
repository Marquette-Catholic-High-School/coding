import type { Project } from '@codeclass/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('python', 'python');
  db.prepare('UPDATE languages SET starter_code = ? WHERE id = ?').run('print("hi")\n', 'python');
  insertLanguage('lua', 'lua', { enabled: false });
});
afterAll(() => srv.close());

function setUpdatedAt(id: number, iso: string) {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(iso, id);
}

describe('playground projects', () => {
  it('requires sign-in', async () => {
    const res = await srv.client().get('/projects');
    expect(res.status).toBe(401);
  });

  it('creates a project with the language starter code', async () => {
    const student = insertUser('student');
    const c = clientAs(srv.base, student.id);
    const res = await c.post<{ project: Project }>('/projects', { title: '  Guess the number ', languageId: 'python' });
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      ownerId: student.id,
      title: 'Guess the number',
      languageId: 'python',
      code: 'print("hi")\n',
    });
    expect(res.body.project.id).toBeGreaterThan(0);

    const got = await c.get<{ project: Project }>(`/projects/${res.body.project.id}`);
    expect(got.status).toBe(200);
    expect(got.body.project).toEqual(res.body.project);
  });

  it('validates the title and language', async () => {
    const teacher = insertUser('teacher');
    const c = clientAs(srv.base, teacher.id);

    const blank = await c.post('/projects', { title: '   ', languageId: 'python' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fieldErrors.title).toBeTruthy();

    const unknown = await c.post('/projects', { title: 'X', languageId: 'cobol' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fieldErrors.languageId).toBeTruthy();

    const disabled = await c.post('/projects', { title: 'X', languageId: 'lua' });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error.fieldErrors.languageId).toMatch(/turned off/);

    const missing = await c.post('/projects', { title: 'X' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fieldErrors.languageId).toBeTruthy();
  });

  it('lists only my projects, most recently updated first', async () => {
    const me = insertUser('student');
    const other = insertUser('student');
    const c = clientAs(srv.base, me.id);
    const ids: number[] = [];
    for (const title of ['First', 'Second', 'Third']) {
      ids.push((await c.post<{ project: Project }>('/projects', { title, languageId: 'python' })).body.project.id);
    }
    await clientAs(srv.base, other.id).post('/projects', { title: 'Not mine', languageId: 'python' });

    setUpdatedAt(ids[0]!, '2026-01-03T00:00:00.000Z');
    setUpdatedAt(ids[1]!, '2026-01-01T00:00:00.000Z');
    setUpdatedAt(ids[2]!, '2026-01-02T00:00:00.000Z');

    const list = await c.get<{ projects: Project[] }>('/projects');
    expect(list.status).toBe(200);
    expect(list.body.projects.map((p) => p.title)).toEqual(['First', 'Third', 'Second']);

    // Saving moves a project to the top.
    const saved = await c.patch<{ project: Project }>(`/projects/${ids[1]}`, { code: 'print(1)' });
    expect(saved.status).toBe(200);
    expect(saved.body.project.updatedAt > '2026-01-03T00:00:00.000Z').toBe(true);
    const again = await c.get<{ projects: Project[] }>('/projects');
    expect(again.body.projects.map((p) => p.title)).toEqual(['Second', 'First', 'Third']);
  });

  it('updates the title and code independently', async () => {
    const me = insertUser('student');
    const c = clientAs(srv.base, me.id);
    const { id } = (await c.post<{ project: Project }>('/projects', { title: 'Draft', languageId: 'python' })).body.project;
    setUpdatedAt(id, '2026-01-01T00:00:00.000Z');

    const renamed = await c.patch<{ project: Project }>(`/projects/${id}`, { title: 'Final' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project).toMatchObject({ title: 'Final', code: 'print("hi")\n' });
    expect(renamed.body.project.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);

    const coded = await c.patch<{ project: Project }>(`/projects/${id}`, { code: '' });
    expect(coded.body.project).toMatchObject({ title: 'Final', code: '' });

    const bad = await c.patch(`/projects/${id}`, { title: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fieldErrors.title).toBeTruthy();
  });

  it('keeps projects whose language was disabled later', async () => {
    insertLanguage('sql', 'sql');
    const me = insertUser('student');
    const c = clientAs(srv.base, me.id);
    const { id } = (await c.post<{ project: Project }>('/projects', { title: 'Pets', languageId: 'sql' })).body.project;
    db.prepare('UPDATE languages SET enabled = 0 WHERE id = ?').run('sql');

    expect((await c.get(`/projects/${id}`)).status).toBe(200);
    expect((await c.patch(`/projects/${id}`, { code: 'SELECT 1;' })).status).toBe(200);
  });

  it("hides other people's projects (404), even from admins", async () => {
    const owner = insertUser('student');
    const ownerClient = clientAs(srv.base, owner.id);
    const { id } = (await ownerClient.post<{ project: Project }>('/projects', { title: 'Secret', languageId: 'python' })).body.project;

    for (const role of ['student', 'teacher', 'admin'] as const) {
      const c = clientAs(srv.base, insertUser(role).id);
      expect((await c.get(`/projects/${id}`)).status).toBe(404);
      expect((await c.patch(`/projects/${id}`, { title: 'Hacked' })).status).toBe(404);
      expect((await c.delete(`/projects/${id}`)).status).toBe(404);
    }

    const still = await ownerClient.get<{ project: Project }>(`/projects/${id}`);
    expect(still.body.project.title).toBe('Secret');
  });

  it('deletes a project', async () => {
    const me = insertUser('teacher');
    const c = clientAs(srv.base, me.id);
    const { id } = (await c.post<{ project: Project }>('/projects', { title: 'Temp', languageId: 'python' })).body.project;

    const del = await c.delete(`/projects/${id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
    expect((await c.get(`/projects/${id}`)).status).toBe(404);
    expect((await c.delete(`/projects/${id}`)).status).toBe(404);
    expect((await c.get<{ projects: Project[] }>('/projects')).body.projects).toEqual([]);
  });

  it('returns 404 for malformed ids', async () => {
    const c = clientAs(srv.base, insertUser('student').id);
    expect((await c.get('/projects/abc')).status).toBe(404);
    expect((await c.get('/projects/0')).status).toBe(404);
  });
});
