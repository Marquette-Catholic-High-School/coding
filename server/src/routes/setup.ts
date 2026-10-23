// First-run setup: creates the first admin and installs the starter languages.

import { Router } from 'express';
import { LANGUAGE_PACKS, setupSchema, type SetupStatusResponse, type UserResponse } from '@codeclass/shared';
import { createPseudocodeConfig, starterProgram } from '@codeclass/shared/pseudocode';
import { hashPassword, startSession } from '../auth';
import { db, type UserRow } from '../db';
import { conflict, parseBody } from '../http';
import { toUser } from '../mappers';

export const router = Router();

/** Packs installed on first run, next to the classroom pseudocode language. */
const STARTER_PACK_IDS = ['javascript', 'python'];

function hasUsers(): boolean {
  return !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
}

/** Inserts the starter languages, leaving any row that already exists untouched. */
function seedLanguages(adminId: number): void {
  const insert = db.prepare(
    `INSERT INTO languages (id, kind, name, description, version, enabled, starter_code, config, owner_id)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const pack of LANGUAGE_PACKS.filter((p) => STARTER_PACK_IDS.includes(p.id))) {
    insert.run(pack.id, pack.kind, pack.name, pack.description, pack.version, pack.starterCode, null, null);
  }
  const config = createPseudocodeConfig('classroom');
  insert.run(
    'pseudocode',
    'pseudocode',
    'Classroom Pseudocode',
    'Plain-English pseudocode. Switch words on as your class learns them.',
    'CodeClass pseudocode',
    starterProgram(config),
    JSON.stringify(config),
    adminId,
  );
}

router.get('/setup', (_req, res) => {
  res.json({ needsSetup: !hasUsers() } satisfies SetupStatusResponse);
});

router.post('/setup', (req, res) => {
  const input = parseBody(setupSchema, req.body);
  const passwordHash = hashPassword(input.password);

  const user = db.transaction(() => {
    if (hasUsers()) throw conflict('CodeClass is already set up. Please sign in.');
    const info = db
      .prepare("INSERT INTO users (username, email, name, role, password_hash) VALUES (?, ?, ?, 'admin', ?)")
      .run(input.username, input.email, input.name, passwordHash);
    const adminId = Number(info.lastInsertRowid);
    seedLanguages(adminId);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(adminId) as UserRow;
  })();

  startSession(res, user.id);
  res.status(201).json({ user: toUser(user) } satisfies UserResponse);
});
