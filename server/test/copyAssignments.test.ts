import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, AssignmentInput, AssignmentResponse, CopyAssignmentsInput, CopyAssignmentsResponse } from '@codeclass/shared';
import { db } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let classCounter = 0;

function insertClass(ownerId: number, languageIds: string[], options: { archived?: boolean; studentIds?: number[] } = {}): number {
  classCounter += 1;
  const id = Number(
    db
      .prepare('INSERT INTO classes (name, join_code, owner_id, archived) VALUES (?, ?, ?, ?)')
      .run(`Class ${classCounter}`, `CPY${String(classCounter).padStart(3, '0')}`, ownerId, options.archived ? 1 : 0)
      .lastInsertRowid,
  );
  for (const l of languageIds) db.prepare('INSERT INTO class_languages (class_id, language_id) VALUES (?, ?)').run(id, l);
  for (const s of options.studentIds ?? []) db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(id, s);
  return id;
}

const tests = [
  { id: 'greet', name: 'Greets', input: 'Ada', expectedOutput: 'Hello, Ada!', hidden: false, points: 1 },
  { id: 'secret', name: 'Secret', input: 'Bob', expectedOutput: 'Hello, Bob!', hidden: true, points: 3 },
];

function input(overrides: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    title: 'Hello',
    instructions: '# Say hello',
    languageId: 'js',
    starterCode: '// start here',
    dueAt: null,
    points: 10,
    published: true,
    allowLate: true,
    tests,
    compareMode: 'trim',
    ...overrides,
  };
}

let teacherId: number;
let otherTeacherId: number;
let studentId: number;
let teacher: TestClient;
let otherTeacher: TestClient;
let admin: TestClient;
let student: TestClient;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('js', 'javascript');
  insertLanguage('py', 'python');
  insertLanguage('later-off', 'lua');
  teacherId = insertUser('teacher').id;
  otherTeacherId = insertUser('teacher').id;
  studentId = insertUser('student').id;
  teacher = clientAs(srv.base, teacherId);
  otherTeacher = clientAs(srv.base, otherTeacherId);
  admin = clientAs(srv.base, insertUser('admin').id);
  student = clientAs(srv.base, studentId);
});
afterAll(() => srv.close());

/** Creates an assignment through the API as `as` (the class owner by default). */
async function create(classId: number, overrides: Partial<AssignmentInput> = {}, as = teacher) {
  const res = await as.post<AssignmentResponse>(`/classes/${classId}/assignments`, input(overrides));
  expect(res.status).toBe(201);
  return res.body.assignment;
}

function copy<T = CopyAssignmentsResponse>(classId: number, body: CopyAssignmentsInput, as = teacher) {
  return as.post<T>(`/classes/${classId}/assignments/copy`, body);
}

async function read(id: number) {
  const res = await teacher.get<AssignmentResponse>(`/assignments/${id}`);
  expect(res.status).toBe(200);
  return res.body.assignment;
}

const assignmentCount = () => db.prepare('SELECT COUNT(*) FROM assignments').pluck().get() as number;
const classLanguages = (classId: number) =>
  db.prepare('SELECT language_id FROM class_languages WHERE class_id = ? ORDER BY language_id').pluck().all(classId) as string[];

describe('copying assignments', () => {
  it('copies the content, tests and solution into another class as fresh drafts without submissions', async () => {
    const from = insertClass(teacherId, ['js'], { studentIds: [studentId] });
    const to = insertClass(teacherId, ['js']);
    const src = await create(from, {
      title: 'Greeter',
      instructions: '## Steps\n1. Read a name',
      starterCode: 'const name = prompt();',
      dueAt: '2030-03-01T12:00:00Z',
      points: 25,
      allowLate: false,
      compareMode: 'ignore-case',
      solutionCode: 'console.log(`Hello, ${prompt()}!`);',
      solutionVisibility: 'after_graded',
    });
    db.prepare('UPDATE assignments SET created_at = ?, updated_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      '2020-01-02T00:00:00.000Z',
      src.id,
    );
    expect((await student.put(`/assignments/${src.id}/submission`, { code: 'mine' })).status).toBe(200);

    const before = new Date().toISOString();
    const res = await copy(to, { assignmentIds: [src.id] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      copied: [{ sourceId: src.id, id: expect.any(Number), title: 'Greeter' }],
      addedLanguageIds: [],
      skipped: [],
      notes: [],
    });
    const copyId = res.body.copied[0]!.id;
    expect(copyId).not.toBe(src.id);

    const copied = await read(copyId);
    expect(copied).toMatchObject({
      classId: to,
      title: 'Greeter',
      instructions: '## Steps\n1. Read a name',
      languageId: 'js',
      starterCode: 'const name = prompt();',
      dueAt: null,
      points: 25,
      published: false,
      allowLate: false,
      tests,
      hiddenTestCount: 1,
      compareMode: 'ignore-case',
      solutionCode: 'console.log(`Hello, ${prompt()}!`);',
      solutionVisibility: 'after_graded',
      hasSolution: true,
    });
    expect(copied.createdAt >= before).toBe(true);
    expect(copied.updatedAt >= before).toBe(true);
    expect(db.prepare('SELECT COUNT(*) FROM submissions WHERE assignment_id = ?').pluck().get(copyId)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM submissions WHERE assignment_id = ?').pluck().get(src.id)).toBe(1);

    // The source is untouched.
    expect(await read(src.id)).toMatchObject({ classId: from, published: true, dueAt: '2030-03-01T12:00:00.000Z' });
  });

  it('keeps due dates only when asked, hiding solutions that were released after the due date', async () => {
    const from = insertClass(teacherId, ['js']);
    const to = insertClass(teacherId, ['js']);
    const dueAt = '2030-04-01T08:00:00.000Z';
    const afterDue = await create(from, { title: 'After due', dueAt, solutionCode: 'answer()', solutionVisibility: 'after_due' });
    const blank = await create(from, { title: 'No solution', dueAt, solutionCode: '  ', solutionVisibility: 'after_due' });
    const visible = await create(from, { title: 'Visible', dueAt, solutionCode: 'answer()', solutionVisibility: 'visible' });

    const dropped = await copy(to, { assignmentIds: [afterDue.id, blank.id, visible.id] });
    expect(dropped.status).toBe(201);
    const [a, b, c] = dropped.body.copied;
    expect(await read(a!.id)).toMatchObject({ dueAt: null, solutionVisibility: 'hidden', solutionCode: 'answer()' });
    // A blank solution changes too (after_due needs a due date) but there is nothing worth a note.
    expect(await read(b!.id)).toMatchObject({ dueAt: null, solutionVisibility: 'hidden', hasSolution: false });
    expect(await read(c!.id)).toMatchObject({ dueAt: null, solutionVisibility: 'visible' });
    expect(dropped.body.notes).toHaveLength(1);
    expect(dropped.body.notes[0]).toContain('"After due"');
    expect(dropped.body.notes[0]).toContain('Teachers only');

    const kept = await copy(to, { assignmentIds: [afterDue.id, visible.id], keepDueDates: true });
    expect(kept.status).toBe(201);
    expect(kept.body.notes).toEqual([]);
    expect(await read(kept.body.copied[0]!.id)).toMatchObject({ dueAt, solutionVisibility: 'after_due' });
    expect(await read(kept.body.copied[1]!.id)).toMatchObject({ dueAt, solutionVisibility: 'visible' });
  });

  it('makes drafts unless publish is set, whatever the source was', async () => {
    const from = insertClass(teacherId, ['js']);
    const to = insertClass(teacherId, ['js']);
    const published = await create(from, { title: 'Published', published: true });
    const draft = await create(from, { title: 'Draft', published: false });

    const drafts = await copy(to, { assignmentIds: [published.id, draft.id] });
    for (const c of drafts.body.copied) expect((await read(c.id)).published).toBe(false);

    const live = await copy(to, { assignmentIds: [published.id, draft.id], publish: true });
    for (const c of live.body.copied) expect((await read(c.id)).published).toBe(true);
  });

  it('adds a missing language to the class once', async () => {
    const from = insertClass(teacherId, ['js', 'py']);
    const to = insertClass(teacherId, ['js']);
    const py1 = await create(from, { title: 'Py 1', languageId: 'py' });
    const js = await create(from, { title: 'Js' });
    const py2 = await create(from, { title: 'Py 2', languageId: 'py' });
    const updatedBefore = db.prepare('SELECT updated_at FROM classes WHERE id = ?').pluck().get(to) as string;

    const res = await copy(to, { assignmentIds: [py1.id, js.id, py2.id] });
    expect(res.status).toBe(201);
    expect(res.body.addedLanguageIds).toEqual(['py']);
    expect(res.body.copied.map((c) => c.sourceId)).toEqual([py1.id, js.id, py2.id]);
    expect(classLanguages(to)).toEqual(['js', 'py']);
    expect(await read(res.body.copied[0]!.id)).toMatchObject({ languageId: 'py', classId: to });
    const updatedAfter = db.prepare('SELECT updated_at FROM classes WHERE id = ?').pluck().get(to) as string;
    expect(updatedAfter > updatedBefore).toBe(true);

    // The class now has it, so another copy adds nothing.
    expect((await copy(to, { assignmentIds: [py1.id] })).body.addedLanguageIds).toEqual([]);
  });

  it('skips assignments whose language is turned off or no longer installed, and copies the rest', async () => {
    const from = insertClass(teacherId, ['js', 'later-off']);
    const to = insertClass(teacherId, ['js']);
    const off = await create(from, { title: 'Lua thing', languageId: 'later-off' });
    const ok = await create(from, { title: 'Fine' });
    db.prepare('UPDATE languages SET enabled = 0 WHERE id = ?').run('later-off');

    // An installed language that is uninstalled behind the server's back (the API refuses while assignments use it).
    insertLanguage('gone', 'python');
    db.prepare('INSERT INTO class_languages (class_id, language_id) VALUES (?, ?)').run(from, 'gone');
    const gone = await create(from, { title: 'Orphan', languageId: 'gone' });
    db.pragma('foreign_keys = OFF');
    try {
      db.prepare("DELETE FROM languages WHERE id = 'gone'").run();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    const res = await copy(to, { assignmentIds: [off.id, ok.id, gone.id] });
    expect(res.status).toBe(201);
    expect(res.body.copied).toEqual([{ sourceId: ok.id, id: expect.any(Number), title: 'Fine' }]);
    expect(res.body.skipped).toEqual([
      { sourceId: off.id, title: 'Lua thing', reason: expect.stringContaining('turned off') },
      { sourceId: gone.id, title: 'Orphan', reason: expect.stringContaining('installed') },
    ]);
    expect(res.body.addedLanguageIds).toEqual([]);
    expect(classLanguages(to)).toEqual(['js']);

    // A turned-off language can't be used for new work even in a class that still has it.
    const same = await copy(from, { assignmentIds: [off.id] });
    expect(same.status).toBe(201);
    expect(same.body.copied).toEqual([]);
    expect(same.body.skipped).toHaveLength(1);
    db.prepare('UPDATE languages SET enabled = 1 WHERE id = ?').run('later-off');
  });

  it('appends " (copy)" when copying within the same class, keeping titles within the limit', async () => {
    const cls = insertClass(teacherId, ['js']);
    const other = insertClass(teacherId, ['js']);
    const short = await create(cls, { title: 'Loops' });
    const long = await create(cls, { title: 'x'.repeat(120) });

    const same = await copy(cls, { assignmentIds: [short.id, long.id] });
    expect(same.status).toBe(201);
    expect(same.body.copied.map((c) => c.title)).toEqual(['Loops (copy)', `${'x'.repeat(113)} (copy)`]);
    expect((await read(same.body.copied[0]!.id)).title).toBe('Loops (copy)');
    expect((await read(same.body.copied[1]!.id)).title).toHaveLength(120);

    const across = await copy(other, { assignmentIds: [short.id] });
    expect(across.body.copied[0]!.title).toBe('Loops');
  });

  it('keeps the order of assignmentIds and copies a repeated id once', async () => {
    const from = insertClass(teacherId, ['js']);
    const to = insertClass(teacherId, ['js']);
    const a = await create(from, { title: 'A' });
    const b = await create(from, { title: 'B' });
    const c = await create(from, { title: 'C' });

    const res = await copy(to, { assignmentIds: [c.id, a.id, b.id, a.id] });
    expect(res.status).toBe(201);
    expect(res.body.copied.map((x) => [x.sourceId, x.title])).toEqual([
      [c.id, 'C'],
      [a.id, 'A'],
      [b.id, 'B'],
    ]);
    const ids = res.body.copied.map((x) => x.id);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    expect(db.prepare('SELECT COUNT(*) FROM assignments WHERE class_id = ?').pluck().get(to)).toBe(3);
  });
});

describe('copy permissions', () => {
  it('copies from archived classes the caller manages', async () => {
    const archived = insertClass(teacherId, ['js'], { archived: true });
    const to = insertClass(teacherId, ['js']);
    const src = await create(archived, { title: 'Old favourite' });
    const res = await copy(to, { assignmentIds: [src.id] });
    expect(res.status).toBe(201);
    expect(res.body.copied).toEqual([{ sourceId: src.id, id: expect.any(Number), title: 'Old favourite' }]);
  });

  it("returns 404 and copies nothing when any source is another teacher's or unknown", async () => {
    const mine = insertClass(teacherId, ['js', 'py']);
    const to = insertClass(teacherId, ['js']);
    const theirs = insertClass(otherTeacherId, ['js']);
    const myPy = await create(mine, { title: 'Mine', languageId: 'py' });
    const theirAssignment = await create(theirs, { title: 'Theirs' }, otherTeacher);
    const count = assignmentCount();

    for (const assignmentIds of [[theirAssignment.id], [myPy.id, theirAssignment.id], [myPy.id, 999999]]) {
      const res = await copy<ApiErrorBody>(to, { assignmentIds });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Assignment not found');
    }
    expect(assignmentCount()).toBe(count);
    // The language the first source would have added was rolled back too.
    expect(classLanguages(to)).toEqual(['js']);
  });

  it("rejects copying into another teacher's class, an unknown class, and students", async () => {
    const mine = insertClass(teacherId, ['js'], { studentIds: [studentId] });
    const theirs = insertClass(otherTeacherId, ['js']);
    const src = await create(mine);
    const count = assignmentCount();

    expect((await copy(theirs, { assignmentIds: [src.id] })).status).toBe(403);
    expect((await copy(999999, { assignmentIds: [src.id] })).status).toBe(404);
    expect((await copy(mine, { assignmentIds: [src.id] }, student)).status).toBe(403);
    expect((await student.post(`/classes/${mine}/assignments/copy`, { assignmentIds: [src.id] })).status).toBe(403);
    expect(assignmentCount()).toBe(count);
  });

  it("lets admins copy between different teachers' classes", async () => {
    const from = insertClass(teacherId, ['js']);
    const to = insertClass(otherTeacherId, ['js']);
    const src = await create(from, { title: 'Shared lesson' });
    const res = await copy(to, { assignmentIds: [src.id] }, admin);
    expect(res.status).toBe(201);
    expect(res.body.copied[0]!.title).toBe('Shared lesson');
    const copied = await otherTeacher.get<AssignmentResponse>(`/assignments/${res.body.copied[0]!.id}`);
    expect(copied.status).toBe(200);
    expect(copied.body.assignment).toMatchObject({ classId: to, tests });
  });

  it('validates the request body', async () => {
    const to = insertClass(teacherId, ['js']);
    const empty = await copy<ApiErrorBody>(to, { assignmentIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fieldErrors?.assignmentIds).toBeTruthy();
    const tooMany = await copy(to, { assignmentIds: Array.from({ length: 101 }, (_, i) => i + 1) });
    expect(tooMany.status).toBe(400);
    expect((await teacher.post(`/classes/${to}/assignments/copy`, { assignmentIds: ['1'] })).status).toBe(400);
  });
});
