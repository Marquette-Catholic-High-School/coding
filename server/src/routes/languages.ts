// Languages: installed packs + teacher-designed pseudocode languages (ARCHITECTURE §7.5).

import { Router } from 'express';
import {
  createPseudocodeSchema,
  installLanguageSchema,
  LANGUAGE_PACKS,
  updateLanguageSchema,
  type CatalogResponse,
  type LanguageResponse,
  type LanguagesResponse,
  type OkResponse,
  type User,
} from '@codeclass/shared';
import {
  createPseudocodeConfig,
  normalizePseudocodeConfig,
  PSEUDOCODE_PRESETS,
  starterProgram,
  validatePseudocodeConfig,
  type PseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { loadLanguageRow, slugify } from '../access';
import { currentUser, isStaff, requireAdmin, requireAuth, requireStaff } from '../auth';
import { db, nowIso, parseJson, type LanguageRow } from '../db';
import { badRequest, conflict, forbidden, notFound, parseBody } from '../http';
import { canEditLanguage, LANGUAGE_SELECT, toLanguage, type LanguageQueryRow } from '../mappers';

export const router = Router();

const PSEUDOCODE_VERSION = 'CodeClass pseudocode';

function selectLanguage(id: string, viewer: User) {
  const row = db.prepare(`${LANGUAGE_SELECT} WHERE l.id = ?`).get(id) as LanguageQueryRow | undefined;
  if (!row) throw notFound('Language not found');
  return toLanguage(row, viewer);
}

/** Loads a language row the user may edit (admin, or the owner of a pseudocode language). */
function loadEditableLanguage(id: string, user: User): LanguageRow {
  const row = loadLanguageRow(id);
  if (!canEditLanguage(row, user)) {
    throw forbidden(
      row.kind === 'pseudocode'
        ? 'Only the teacher who created this language or an admin can change it'
        : 'Only admins can change language packs',
    );
  }
  return row;
}

/** `pseudo-<slug>`, with -2, -3, … appended until it is unused. */
function uniquePseudocodeId(name: string): string {
  const base = `pseudo-${slugify(name)}`;
  const exists = db.prepare('SELECT 1 FROM languages WHERE id = ?');
  if (!exists.get(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!exists.get(id)) return id;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

router.get('/languages', requireAuth, (req, res) => {
  const user = currentUser(req);
  const where = isStaff(user) ? '' : 'WHERE l.enabled = 1';
  const rows = db
    .prepare(`${LANGUAGE_SELECT} ${where} ORDER BY l.kind = 'pseudocode', l.name COLLATE NOCASE, l.id`)
    .all() as LanguageQueryRow[];
  res.json({ languages: rows.map((r) => toLanguage(r, user)) } satisfies LanguagesResponse);
});

router.get('/languages/catalog', requireStaff, (_req, res) => {
  const installed = new Set(
    (db.prepare('SELECT id FROM languages').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const packs = LANGUAGE_PACKS.map((p) => ({ ...p, installed: installed.has(p.id) }));
  res.json({ packs } satisfies CatalogResponse);
});

router.post('/languages/install', requireAdmin, (req, res) => {
  const user = currentUser(req);
  const { kind } = parseBody(installLanguageSchema, req.body);
  const pack = LANGUAGE_PACKS.find((p) => p.kind === kind);
  if (!pack) throw badRequest('Unknown language pack', { kind: 'Unknown language pack' });
  if (db.prepare('SELECT 1 FROM languages WHERE id = ?').get(pack.id)) {
    throw conflict(`${pack.name} is already installed`);
  }
  db.prepare(
    `INSERT INTO languages (id, kind, name, description, version, enabled, starter_code, config, owner_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NULL)`,
  ).run(pack.id, pack.kind, pack.name, pack.description, pack.version, pack.starterCode);
  res.status(201).json({ language: selectLanguage(pack.id, user) } satisfies LanguageResponse);
});

router.post('/languages/pseudocode', requireStaff, (req, res) => {
  const user = currentUser(req);
  const input = parseBody(createPseudocodeSchema, req.body);

  let config: PseudocodeConfig;
  if (input.copyFromId) {
    const source = db.prepare('SELECT * FROM languages WHERE id = ?').get(input.copyFromId) as LanguageRow | undefined;
    if (!source || source.kind !== 'pseudocode') {
      throw badRequest('Choose a pseudocode language to copy', { copyFromId: 'Choose a pseudocode language to copy' });
    }
    config = normalizePseudocodeConfig(parseJson(source.config, null));
  } else {
    if (!PSEUDOCODE_PRESETS.some((p) => p.id === input.presetId)) {
      throw badRequest('Choose one of the starting points', { presetId: 'Choose one of the starting points' });
    }
    config = createPseudocodeConfig(input.presetId);
  }

  const id = db.transaction(() => {
    const newId = uniquePseudocodeId(input.name);
    db.prepare(
      `INSERT INTO languages (id, kind, name, description, version, enabled, starter_code, config, owner_id)
       VALUES (?, 'pseudocode', ?, ?, ?, 1, ?, ?, ?)`,
    ).run(newId, input.name, input.description, PSEUDOCODE_VERSION, starterProgram(config), JSON.stringify(config), user.id);
    return newId;
  })();
  res.status(201).json({ language: selectLanguage(id, user) } satisfies LanguageResponse);
});

router.get('/languages/:id', requireAuth, (req, res) => {
  const user = currentUser(req);
  const language = selectLanguage(String(req.params.id), user);
  if (!isStaff(user) && !language.enabled) throw notFound('Language not found');
  res.json({ language } satisfies LanguageResponse);
});

router.patch('/languages/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const row = loadEditableLanguage(String(req.params.id), user);
  const input = parseBody(updateLanguageSchema, req.body);

  let config: string | undefined;
  if (input.pseudocode !== undefined) {
    if (row.kind !== 'pseudocode') {
      throw badRequest('Only pseudocode languages have word settings', {
        pseudocode: 'Only pseudocode languages have word settings',
      });
    }
    const problems = validatePseudocodeConfig(input.pseudocode);
    if (problems.length > 0) {
      throw badRequest('Please fix the problems with the words', { pseudocode: problems.join('; ') });
    }
    config = JSON.stringify(normalizePseudocodeConfig(input.pseudocode));
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (input.name !== undefined) set('name', input.name);
  if (input.description !== undefined) set('description', input.description);
  if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0);
  if (input.starterCode !== undefined) set('starter_code', input.starterCode);
  if (config !== undefined) set('config', config);
  set('updated_at', nowIso());
  db.prepare(`UPDATE languages SET ${sets.join(', ')} WHERE id = ?`).run(...values, row.id);

  res.json({ language: selectLanguage(row.id, user) } satisfies LanguageResponse);
});

router.delete('/languages/:id', requireStaff, (req, res) => {
  const user = currentUser(req);
  const row = loadEditableLanguage(String(req.params.id), user);
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM assignments WHERE language_id = ?').get(row.id) as {
    count: number;
  };
  if (count > 0) {
    const them = count === 1 ? 'it' : 'them';
    throw conflict(
      `${row.name} is used by ${plural(count, 'assignment')}. Move ${them} to another language or delete ${them} ` +
        'first — or switch the language off instead, which keeps existing work running.',
    );
  }
  // class_languages rows cascade; playground projects keep their code (no foreign key).
  db.prepare('DELETE FROM languages WHERE id = ?').run(row.id);
  res.json({ ok: true } satisfies OkResponse);
});
