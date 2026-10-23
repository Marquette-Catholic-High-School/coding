import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_PACKS, type Language } from '@codeclass/shared';
import {
  createPseudocodeConfig,
  PSEUDOCODE_PRESETS,
  starterProgram,
  type PseudocodeConfig,
} from '@codeclass/shared/pseudocode';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

// The real validator decides what a valid word set is (tested with the engine); here a sentinel preset id forces
// problems so the route's error shape can be checked independently of the engine's rules.
const FORCE_INVALID = 'force-invalid';
vi.mock('@codeclass/shared/pseudocode', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@codeclass/shared/pseudocode')>();
  return {
    ...mod,
    validatePseudocodeConfig: (config: PseudocodeConfig) =>
      config.presetId === FORCE_INVALID
        ? ['"SAY" is used for both Output and Input', 'Add at least one comment prefix']
        : mod.validatePseudocodeConfig(config),
  };
});

let srv: Awaited<ReturnType<typeof startTestServer>>;
let admin: TestClient;
let teacher: TestClient;
let otherTeacher: TestClient;
let student: TestClient;
let teacherId: number;

beforeAll(async () => {
  srv = await startTestServer();
  const a = insertUser('admin');
  const t = insertUser('teacher', { name: 'Ms Owner' });
  const t2 = insertUser('teacher');
  const s = insertUser('student');
  teacherId = t.id;
  admin = clientAs(srv.base, a.id);
  teacher = clientAs(srv.base, t.id);
  otherTeacher = clientAs(srv.base, t2.id);
  student = clientAs(srv.base, s.id);
  insertLanguage('javascript', 'javascript');
  insertLanguage('sql', 'sql', { enabled: false });
});
afterAll(() => srv.close());

/** Creates a class owned by `ownerId` with one assignment in `languageId`; returns the assignment id. */
function insertAssignment(ownerId: number, languageId: string): number {
  const cls = db
    .prepare('INSERT INTO classes (name, join_code, owner_id) VALUES (?, ?, ?)')
    .run('Class', Math.random().toString(36).slice(2, 8).toUpperCase(), ownerId);
  const classId = Number(cls.lastInsertRowid);
  db.prepare('INSERT INTO class_languages (class_id, language_id) VALUES (?, ?)').run(classId, languageId);
  const a = db
    .prepare('INSERT INTO assignments (class_id, title, language_id) VALUES (?, ?, ?)')
    .run(classId, 'Task', languageId);
  return Number(a.lastInsertRowid);
}

async function createPseudo(client: TestClient, body: Record<string, unknown>): Promise<Language> {
  const res = await client.post('/languages/pseudocode', body);
  expect(res.status).toBe(201);
  return res.body.language as Language;
}

describe('GET /languages', () => {
  it('requires sign-in', async () => {
    expect((await srv.client().get('/languages')).status).toBe(401);
  });

  it('shows staff every installed language, including disabled ones', async () => {
    const res = await teacher.get('/languages');
    expect(res.status).toBe(200);
    const ids = (res.body.languages as Language[]).map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['javascript', 'sql']));
    const sql = (res.body.languages as Language[]).find((l) => l.id === 'sql')!;
    expect(sql.enabled).toBe(false);
    expect(sql.canEdit).toBe(false);
  });

  it('shows students enabled languages only', async () => {
    const res = await student.get('/languages');
    expect(res.status).toBe(200);
    const ids = (res.body.languages as Language[]).map((l) => l.id);
    expect(ids).toContain('javascript');
    expect(ids).not.toContain('sql');
  });

  it('lets students read an enabled language but hides disabled ones', async () => {
    expect((await student.get('/languages/javascript')).status).toBe(200);
    expect((await student.get('/languages/sql')).status).toBe(404);
    expect((await teacher.get('/languages/sql')).status).toBe(200);
    expect((await teacher.get('/languages/nope')).status).toBe(404);
  });
});

describe('catalog and install', () => {
  it('lists every pack with installed flags for staff only', async () => {
    const res = await teacher.get('/languages/catalog');
    expect(res.status).toBe(200);
    expect(res.body.packs).toHaveLength(LANGUAGE_PACKS.length);
    const byId = Object.fromEntries((res.body.packs as Array<{ id: string; installed: boolean }>).map((p) => [p.id, p]));
    expect(byId.javascript!.installed).toBe(true);
    expect(byId.python!.installed).toBe(false);
    expect((await student.get('/languages/catalog')).status).toBe(403);
  });

  it('only admins install packs', async () => {
    expect((await teacher.post('/languages/install', { kind: 'python' })).status).toBe(403);
    expect((await student.post('/languages/install', { kind: 'python' })).status).toBe(403);
  });

  it('installs a pack from the catalog and refuses a second install', async () => {
    const pack = LANGUAGE_PACKS.find((p) => p.kind === 'python')!;
    const res = await admin.post('/languages/install', { kind: 'python' });
    expect(res.status).toBe(201);
    const lang = res.body.language as Language;
    expect(lang).toMatchObject({
      id: pack.id,
      kind: 'python',
      name: pack.name,
      version: pack.version,
      starterCode: pack.starterCode,
      enabled: true,
      ownerId: null,
      pseudocode: null,
      canEdit: true,
      assignmentCount: 0,
    });
    const again = await admin.post('/languages/install', { kind: 'python' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already installed/);

    const catalog = await admin.get('/languages/catalog');
    expect((catalog.body.packs as Array<{ id: string; installed: boolean }>).find((p) => p.id === 'python')!.installed).toBe(true);
  });

  it('rejects unknown pack kinds', async () => {
    const res = await admin.post('/languages/install', { kind: 'cobol' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.kind).toBeTruthy();
  });
});

describe('POST /languages/pseudocode', () => {
  it('creates a language owned by the teacher from the default preset', async () => {
    const lang = await createPseudo(teacher, { name: 'Year 7 Pseudocode', description: 'Words we know' });
    const config = createPseudocodeConfig('classroom');
    expect(lang).toMatchObject({
      id: 'pseudo-year-7-pseudocode',
      kind: 'pseudocode',
      name: 'Year 7 Pseudocode',
      description: 'Words we know',
      version: 'CodeClass pseudocode',
      enabled: true,
      ownerId: teacherId,
      ownerName: 'Ms Owner',
      canEdit: true,
      starterCode: starterProgram(config),
    });
    expect(lang.pseudocode?.presetId).toBe('classroom');
  });

  it('makes ids unique with -2, -3, …', async () => {
    const second = await createPseudo(otherTeacher, { name: 'Year 7 pseudocode!' });
    const third = await createPseudo(teacher, { name: 'year 7   PSEUDOCODE' });
    expect(second.id).toBe('pseudo-year-7-pseudocode-2');
    expect(third.id).toBe('pseudo-year-7-pseudocode-3');
  });

  it('starts from the chosen preset', async () => {
    const preset = PSEUDOCODE_PRESETS[PSEUDOCODE_PRESETS.length - 1]!;
    const lang = await createPseudo(teacher, { name: 'Preset pick', presetId: preset.id });
    expect(lang.pseudocode).toEqual(createPseudocodeConfig(preset.id));
    expect(lang.starterCode).toBe(starterProgram(createPseudocodeConfig(preset.id)));
  });

  it('rejects unknown presets with a field error', async () => {
    const res = await teacher.post('/languages/pseudocode', { name: 'Bad', presetId: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.presetId).toBeTruthy();
  });

  it('validates the name', async () => {
    const res = await teacher.post('/languages/pseudocode', { name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.name).toBeTruthy();
  });

  it('copies the words of another pseudocode language', async () => {
    const source = await createPseudo(otherTeacher, { name: 'Source words' });
    const config: PseudocodeConfig = { ...source.pseudocode!, keywords: { ...source.pseudocode!.keywords, output: ['SAY'] } };
    expect((await otherTeacher.patch(`/languages/${source.id}`, { pseudocode: config })).status).toBe(200);

    const copy = await createPseudo(teacher, { name: 'My copy', copyFromId: source.id });
    expect(copy.ownerId).toBe(teacherId);
    expect(copy.pseudocode?.keywords.output).toEqual(['SAY']);
    expect(copy.starterCode).toBe(starterProgram(copy.pseudocode!));
  });

  it('only copies pseudocode languages that exist', async () => {
    for (const copyFromId of ['javascript', 'pseudo-missing']) {
      const res = await teacher.post('/languages/pseudocode', { name: 'Copy', copyFromId });
      expect(res.status).toBe(400);
      expect(res.body.error.fieldErrors.copyFromId).toBeTruthy();
    }
  });

  it('is staff only', async () => {
    expect((await student.post('/languages/pseudocode', { name: 'Mine' })).status).toBe(403);
  });
});

describe('PATCH /languages/:id', () => {
  let lang: Language;
  beforeAll(async () => {
    lang = await createPseudo(teacher, { name: 'Editable' });
  });

  it('lets the owner edit settings and words', async () => {
    const config: PseudocodeConfig = {
      ...lang.pseudocode!,
      keywords: { ...lang.pseudocode!.keywords, output: ['DISPLAY', 'OUTPUT'] },
      constructs: { ...lang.pseudocode!.constructs, while: false },
    };
    const res = await teacher.patch(`/languages/${lang.id}`, {
      name: 'Edited',
      description: 'New words',
      enabled: false,
      starterCode: 'DISPLAY "hi"\n',
      pseudocode: config,
    });
    expect(res.status).toBe(200);
    expect(res.body.language).toMatchObject({
      name: 'Edited',
      description: 'New words',
      enabled: false,
      starterCode: 'DISPLAY "hi"\n',
    });
    expect(res.body.language.pseudocode.keywords.output).toEqual(['DISPLAY', 'OUTPUT']);
    expect(res.body.language.pseudocode.constructs.while).toBe(false);
    expect(res.body.language.updatedAt >= lang.updatedAt).toBe(true);

    const fresh = await teacher.get(`/languages/${lang.id}`);
    expect(fresh.body.language.pseudocode.keywords.output).toEqual(['DISPLAY', 'OUTPUT']);
  });

  it('forbids other teachers and students', async () => {
    const res = await otherTeacher.patch(`/languages/${lang.id}`, { name: 'Hijacked' });
    expect(res.status).toBe(403);
    expect((await student.patch(`/languages/${lang.id}`, { name: 'Hijacked' })).status).toBe(403);
    const view = await otherTeacher.get(`/languages/${lang.id}`);
    expect(view.body.language.canEdit).toBe(false);
    expect(view.body.language.name).toBe('Edited');
  });

  it('lets admins edit any language, and only admins edit packs', async () => {
    expect((await admin.patch(`/languages/${lang.id}`, { enabled: true })).status).toBe(200);
    expect((await teacher.patch('/languages/javascript', { enabled: false })).status).toBe(403);
    const res = await admin.patch('/languages/javascript', { description: 'Browser JS', starterCode: 'console.log(1)\n' });
    expect(res.status).toBe(200);
    expect(res.body.language).toMatchObject({ description: 'Browser JS', starterCode: 'console.log(1)\n' });
  });

  it('only accepts word settings for pseudocode languages', async () => {
    const res = await admin.patch('/languages/javascript', { pseudocode: createPseudocodeConfig() });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.pseudocode).toBeTruthy();
  });

  it('rejects malformed word settings', async () => {
    const config = { ...lang.pseudocode!, keywords: { ...lang.pseudocode!.keywords, output: [] } };
    const res = await teacher.patch(`/languages/${lang.id}`, { pseudocode: config });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.pseudocode).toBeTruthy();
  });

  it('returns every validation problem in fieldErrors.pseudocode', async () => {
    const before = (await teacher.get(`/languages/${lang.id}`)).body.language as Language;
    const res = await teacher.patch(`/languages/${lang.id}`, {
      name: 'Should not save',
      pseudocode: { ...lang.pseudocode!, presetId: FORCE_INVALID },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.pseudocode).toBe('"SAY" is used for both Output and Input; Add at least one comment prefix');
    const after = (await teacher.get(`/languages/${lang.id}`)).body.language as Language;
    expect(after.name).toBe(before.name);
  });

  it('returns 404 for unknown languages', async () => {
    expect((await admin.patch('/languages/pseudo-missing', { name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /languages/:id', () => {
  it('refuses while assignments use the language, keeping it usable when disabled', async () => {
    const lang = await createPseudo(teacher, { name: 'In use' });
    const assignmentId = insertAssignment(teacherId, lang.id);

    expect((await teacher.patch(`/languages/${lang.id}`, { enabled: false })).status).toBe(200);
    const listed = await teacher.get(`/languages/${lang.id}`);
    expect(listed.body.language.assignmentCount).toBe(1);

    const res = await teacher.delete(`/languages/${lang.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/1 assignment\b/);

    db.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
    expect((await otherTeacher.delete(`/languages/${lang.id}`)).status).toBe(403);
    expect((await teacher.delete(`/languages/${lang.id}`)).status).toBe(200);
    expect((await teacher.get(`/languages/${lang.id}`)).status).toBe(404);
    const links = db.prepare('SELECT COUNT(*) AS n FROM class_languages WHERE language_id = ?').get(lang.id) as { n: number };
    expect(links.n).toBe(0);
  });

  it('lets admins uninstall packs but not teachers', async () => {
    insertLanguage('lua', 'lua');
    expect((await teacher.delete('/languages/lua')).status).toBe(403);
    expect((await student.delete('/languages/lua')).status).toBe(403);
    expect((await admin.delete('/languages/lua')).status).toBe(200);
    const catalog = await admin.get('/languages/catalog');
    expect((catalog.body.packs as Array<{ id: string; installed: boolean }>).find((p) => p.id === 'lua')!.installed).toBe(false);
  });
});
