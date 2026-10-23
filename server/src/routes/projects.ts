// Playground projects: private scratch files in any enabled language. Only the owner can see or change a project;
// everyone else gets a 404 so project ids don't leak.

import {
  createProjectSchema,
  updateProjectSchema,
  type OkResponse,
  type ProjectResponse,
  type ProjectsResponse,
} from '@codeclass/shared';
import { Router } from 'express';
import { currentUser } from '../auth';
import { db, nowIso, type LanguageRow, type ProjectRow } from '../db';
import { badRequest, notFound, parseBody, parseId } from '../http';
import { toProject } from '../mappers';

export const router = Router();

function loadOwnProject(id: number, ownerId: number): ProjectRow {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(id, ownerId) as ProjectRow | undefined;
  if (!row) throw notFound('Project not found');
  return row;
}

router.get('/projects', (req, res) => {
  const user = currentUser(req);
  const rows = db
    .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY updated_at DESC, id DESC')
    .all(user.id) as ProjectRow[];
  res.json({ projects: rows.map(toProject) } satisfies ProjectsResponse);
});

router.post('/projects', (req, res) => {
  const user = currentUser(req);
  const input = parseBody(createProjectSchema, req.body);
  const language = db.prepare('SELECT * FROM languages WHERE id = ?').get(input.languageId) as LanguageRow | undefined;
  if (!language) {
    throw badRequest("That language isn't installed", { languageId: "That language isn't installed" });
  }
  if (language.enabled !== 1) {
    throw badRequest('That language is turned off', { languageId: 'That language is turned off' });
  }
  const info = db
    .prepare('INSERT INTO projects (owner_id, title, language_id, code) VALUES (?, ?, ?, ?)')
    .run(user.id, input.title, language.id, language.starter_code);
  const row = loadOwnProject(Number(info.lastInsertRowid), user.id);
  res.status(201).json({ project: toProject(row) } satisfies ProjectResponse);
});

router.get('/projects/:id', (req, res) => {
  const user = currentUser(req);
  const row = loadOwnProject(parseId(req.params.id), user.id);
  res.json({ project: toProject(row) } satisfies ProjectResponse);
});

router.patch('/projects/:id', (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  loadOwnProject(id, user.id);
  const input = parseBody(updateProjectSchema, req.body);
  db.prepare(
    `UPDATE projects SET title = COALESCE(?, title), code = COALESCE(?, code), updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(input.title ?? null, input.code ?? null, nowIso(), id, user.id);
  res.json({ project: toProject(loadOwnProject(id, user.id)) } satisfies ProjectResponse);
});

router.delete('/projects/:id', (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  loadOwnProject(id, user.id);
  db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(id, user.id);
  res.json({ ok: true } satisfies OkResponse);
});
