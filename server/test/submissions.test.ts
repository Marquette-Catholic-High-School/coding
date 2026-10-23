import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AssignmentInput,
  AssignmentResponse,
  SubmissionDetailResponse,
  SubmissionResponse,
  SubmissionRowsResponse,
  TestResult,
} from '@codeclass/shared';
import { db, type SubmissionDbRow } from '../src/db';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;

const tests = [
  { id: 'v1', name: 'Visible one', input: '1', expectedOutput: '1', hidden: false, points: 1 },
  { id: 'v2', name: 'Visible two', input: '2', expectedOutput: '2', hidden: false, points: 3 },
  { id: 'h1', name: 'Hidden', input: '3', expectedOutput: '3', hidden: true, points: 5 },
];

const result = (testId: string, passed: boolean): TestResult => ({ testId, passed, actualOutput: passed ? 'ok' : 'nope', error: null, durationMs: 5 });

let teacher: TestClient;
let otherTeacher: TestClient;
let teacherId: number;
let classId: number;
// Enrolled students, inserted out of name order to check sorting.
let zed: { id: number; client: TestClient };
let amy: { id: number; client: TestClient };
let mia: { id: number; client: TestClient };
let outsider: TestClient;

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('js', 'javascript');
  const t = insertUser('teacher');
  teacherId = t.id;
  teacher = clientAs(srv.base, t.id);
  otherTeacher = clientAs(srv.base, insertUser('teacher').id);
  classId = Number(db.prepare("INSERT INTO classes (name, join_code, owner_id) VALUES ('Period 1', 'SUBS01', ?)").run(t.id).lastInsertRowid);
  db.prepare("INSERT INTO class_languages (class_id, language_id) VALUES (?, 'js')").run(classId);
  const mk = (name: string) => {
    const u = insertUser('student', { name });
    db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, u.id);
    return { id: u.id, client: clientAs(srv.base, u.id) };
  };
  zed = mk('Zed Zimmer');
  amy = mk('Amy Adams');
  mia = mk('Mia Moss');
  outsider = clientAs(srv.base, insertUser('student').id);
});
afterAll(() => srv.close());

async function createAssignment(overrides: Partial<AssignmentInput> = {}) {
  const res = await teacher.post<AssignmentResponse>(`/classes/${classId}/assignments`, {
    title: 'Echo',
    languageId: 'js',
    starterCode: '// starter',
    points: 10,
    tests,
    ...overrides,
  } satisfies AssignmentInput);
  expect(res.status).toBe(201);
  return res.body.assignment.id;
}

function dbRow(assignmentId: number, studentId: number) {
  return db.prepare('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?').get(assignmentId, studentId) as SubmissionDbRow | undefined;
}

describe('student work', () => {
  it('returns a virtual not_started submission, then autosaves', async () => {
    const id = await createAssignment();
    const first = await amy.client.get<SubmissionResponse>(`/assignments/${id}/submission`);
    expect(first.status).toBe(200);
    expect(first.body.submission).toMatchObject({ id: null, status: 'not_started', code: '// starter', late: false });
    expect(dbRow(id, amy.id)).toBeUndefined();

    const saved = await amy.client.put<SubmissionResponse>(`/assignments/${id}/submission`, { code: 'console.log(1)' });
    expect(saved.status).toBe(200);
    expect(saved.body.submission).toMatchObject({ status: 'in_progress', code: 'console.log(1)' });
    expect(saved.body.submission.id).toEqual(expect.any(Number));

    const again = await amy.client.put<SubmissionResponse>(`/assignments/${id}/submission`, { code: 'console.log(2)' });
    expect(again.body.submission).toMatchObject({ id: saved.body.submission.id, code: 'console.log(2)' });
    expect((await amy.client.put(`/assignments/${id}/submission`, {})).status).toBe(400);
  });

  it('forbids staff and hides the endpoints from students outside the class', async () => {
    const id = await createAssignment();
    expect((await teacher.get(`/assignments/${id}/submission`)).status).toBe(403);
    expect((await teacher.put(`/assignments/${id}/submission`, { code: '' })).status).toBe(403);
    expect((await teacher.post(`/assignments/${id}/submit`, { code: '' })).status).toBe(403);
    expect((await teacher.post(`/assignments/${id}/unsubmit`)).status).toBe(403);
    expect((await outsider.get(`/assignments/${id}/submission`)).status).toBe(404);
    expect((await outsider.post(`/assignments/${id}/submit`, { code: '' })).status).toBe(404);

    const draft = await createAssignment({ published: false });
    expect((await amy.client.get(`/assignments/${draft}/submission`)).status).toBe(404);
    expect((await amy.client.put(`/assignments/${draft}/submission`, { code: 'x' })).status).toBe(404);
  });

  it('submits with visible-test results only and computes the auto-score over visible tests', async () => {
    const id = await createAssignment();
    const res = await mia.client.post<SubmissionResponse>(`/assignments/${id}/submit`, {
      code: 'answer',
      testResults: [result('v1', false), result('v2', true), result('h1', true), result('unknown', true), result('v2', false)],
    });
    expect(res.status).toBe(200);
    const sub = res.body.submission;
    expect(sub).toMatchObject({ status: 'submitted', code: 'answer', late: false });
    expect(sub.submittedAt).toEqual(expect.any(String));
    expect(sub.testResults!.map((r) => [r.testId, r.passed])).toEqual([
      ['v1', false],
      ['v2', true],
    ]);
    // v2 is worth 3 of the 4 visible points.
    expect(sub.autoScore).toBe(75);

    const noResults = await createAssignment();
    const plain = await mia.client.post<SubmissionResponse>(`/assignments/${noResults}/submit`, { code: 'x' });
    expect(plain.body.submission).toMatchObject({ status: 'submitted', testResults: null, autoScore: null });
  });

  it('blocks editing after submit until the student unsubmits', async () => {
    const id = await createAssignment();
    await zed.client.put(`/assignments/${id}/submission`, { code: 'draft' });
    expect((await zed.client.post(`/assignments/${id}/unsubmit`)).status).toBe(409);
    expect((await zed.client.post(`/assignments/${id}/submit`, { code: 'final' })).status).toBe(200);

    const blocked = await zed.client.put(`/assignments/${id}/submission`, { code: 'more' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Unsubmit/);

    const un = await zed.client.post<SubmissionResponse>(`/assignments/${id}/unsubmit`);
    expect(un.status).toBe(200);
    expect(un.body.submission).toMatchObject({ status: 'in_progress', submittedAt: null, code: 'final' });
    expect((await zed.client.put(`/assignments/${id}/submission`, { code: 'more' })).status).toBe(200);
    expect((await zed.client.post(`/assignments/${id}/unsubmit`)).status).toBe(409);
  });

  it('enforces the due date when late work is not allowed', async () => {
    const closed = await createAssignment({ dueAt: '2020-01-01T00:00:00Z', allowLate: false });
    await amy.client.put(`/assignments/${closed}/submission`, { code: 'late work' });
    const res = await amy.client.post(`/assignments/${closed}/submit`, { code: 'late work' });
    expect(res.status).toBe(409);
    expect(dbRow(closed, amy.id)!.status).toBe('in_progress');

    const open = await createAssignment({ dueAt: '2020-01-01T00:00:00Z', allowLate: true });
    const late = await amy.client.post<SubmissionResponse>(`/assignments/${open}/submit`, { code: 'late work' });
    expect(late.status).toBe(200);
    expect(late.body.submission).toMatchObject({ status: 'submitted', late: true });

    const future = await createAssignment({ dueAt: '2099-01-01T00:00:00Z', allowLate: false });
    expect((await amy.client.post(`/assignments/${future}/submit`, { code: 'on time' })).status).toBe(200);
  });
});

describe('teacher grading', () => {
  it('lists one row per enrolled student in name order', async () => {
    const id = await createAssignment();
    await mia.client.post(`/assignments/${id}/submit`, { code: 'mia' });
    const res = await teacher.get<SubmissionRowsResponse>(`/assignments/${id}/submissions`);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.student.name)).toEqual(['Amy Adams', 'Mia Moss', 'Zed Zimmer']);
    expect(res.body.rows.map((r) => r.submission.status)).toEqual(['not_started', 'submitted', 'not_started']);
    expect(res.body.rows[0]!.submission).toMatchObject({ id: null, code: '// starter', studentId: amy.id });
    expect(res.body.rows[0]!.student).toEqual({ id: amy.id, name: 'Amy Adams', username: expect.any(String) });
  });

  it('returns the detail with all tests and prev/next in name order', async () => {
    const id = await createAssignment();
    const first = await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${amy.id}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ prevStudentId: null, nextStudentId: mia.id, student: { id: amy.id, name: 'Amy Adams' } });
    expect(first.body.assignment.tests.map((t) => t.id)).toEqual(['v1', 'v2', 'h1']);
    expect(first.body.language.id).toBe('js');
    expect(first.body.class).toEqual({ id: classId, name: 'Period 1' });
    expect(first.body.submission.status).toBe('not_started');

    const middle = await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${mia.id}`);
    expect(middle.body).toMatchObject({ prevStudentId: amy.id, nextStudentId: zed.id });
    const last = await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${zed.id}`);
    expect(last.body).toMatchObject({ prevStudentId: mia.id, nextStudentId: null });

    const outsiderId = insertUser('student').id;
    expect((await teacher.get(`/assignments/${id}/submissions/${outsiderId}`)).status).toBe(404);
    expect((await teacher.get(`/assignments/${id}/submissions/${teacherId}`)).status).toBe(404);
  });

  it('keeps students and other teachers out of the teacher endpoints', async () => {
    const id = await createAssignment();
    expect((await amy.client.get(`/assignments/${id}/submissions`)).status).toBe(403);
    expect((await amy.client.get(`/assignments/${id}/submissions/${amy.id}`)).status).toBe(403);
    expect((await amy.client.patch(`/assignments/${id}/submissions/${amy.id}`, { grade: 10 })).status).toBe(403);
    expect((await otherTeacher.get(`/assignments/${id}/submissions`)).status).toBe(403);
    expect((await otherTeacher.patch(`/assignments/${id}/submissions/${amy.id}`, { grade: 10 })).status).toBe(403);
    expect(dbRow(id, amy.id)).toBeUndefined();
  });

  it('grades, locks the work, and returns it for revision keeping feedback', async () => {
    const id = await createAssignment();
    await zed.client.post(`/assignments/${id}/submit`, { code: 'zed final' });

    const graded = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${zed.id}`, {
      grade: 8.5,
      feedback: 'Nice loop!',
    });
    expect(graded.status).toBe(200);
    expect(graded.body.submission).toMatchObject({ status: 'graded', grade: 8.5, feedback: 'Nice loop!' });
    expect(graded.body.submission.gradedAt).toEqual(expect.any(String));
    expect(dbRow(id, zed.id)!.graded_by).toBe(teacherId);

    expect((await zed.client.put(`/assignments/${id}/submission`, { code: 'x' })).status).toBe(409);
    expect((await zed.client.post(`/assignments/${id}/submit`, { code: 'x' })).status).toBe(409);
    expect((await zed.client.post(`/assignments/${id}/unsubmit`)).status).toBe(409);
    const seen = await zed.client.get<SubmissionResponse>(`/assignments/${id}/submission`);
    expect(seen.body.submission).toMatchObject({ status: 'graded', grade: 8.5, feedback: 'Nice loop!' });

    const returned = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${zed.id}`, { status: 'in_progress' });
    expect(returned.status).toBe(200);
    expect(returned.body.submission).toMatchObject({
      status: 'in_progress',
      feedback: 'Nice loop!',
      grade: null,
      gradedAt: null,
      submittedAt: null,
      code: 'zed final',
    });
    expect((await zed.client.put(`/assignments/${id}/submission`, { code: 'zed v2' })).status).toBe(200);
    expect((await zed.client.post(`/assignments/${id}/submit`, { code: 'zed v2' })).status).toBe(200);
  });

  it('stores test results without changing the status', async () => {
    const id = await createAssignment();
    await amy.client.post(`/assignments/${id}/submit`, { code: 'amy', testResults: [result('v1', true)] });
    const res = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${amy.id}`, {
      testResults: [result('v1', true), result('v2', false), result('h1', true)],
      autoScore: 66.7,
    });
    expect(res.status).toBe(200);
    expect(res.body.submission).toMatchObject({ status: 'submitted', autoScore: 66.7, grade: null });
    expect(res.body.submission.testResults!.map((r) => r.testId)).toEqual(['v1', 'v2', 'h1']);

    // Without an autoScore the server computes it over every test: v1 (1) + h1 (5) of 9.
    const computed = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${amy.id}`, {
      testResults: [result('v1', true), result('v2', false), result('h1', true)],
    });
    expect(computed.body.submission.autoScore).toBe(66.7);
    expect(computed.body.submission.status).toBe('submitted');

    const feedbackOnly = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${amy.id}`, { feedback: 'Looking good' });
    expect(feedbackOnly.body.submission).toMatchObject({ status: 'submitted', feedback: 'Looking good' });
  });

  it('creates the row from starter code for students who never started', async () => {
    const id = await createAssignment();
    const res = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${mia.id}`, { grade: 0, feedback: 'Missing' });
    expect(res.status).toBe(200);
    expect(res.body.submission).toMatchObject({ status: 'graded', grade: 0, code: '// starter', submittedAt: null });

    const resultsOnly = await createAssignment();
    const ran = await teacher.patch<SubmissionResponse>(`/assignments/${resultsOnly}/submissions/${zed.id}`, {
      testResults: [result('v1', false)],
      autoScore: 0,
    });
    expect(ran.body.submission).toMatchObject({ status: 'in_progress', code: '// starter', autoScore: 0 });
  });

  it('validates grades', async () => {
    const id = await createAssignment();
    await amy.client.post(`/assignments/${id}/submit`, { code: 'a' });
    const tooHigh = await teacher.patch(`/assignments/${id}/submissions/${amy.id}`, { grade: 11 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.fieldErrors.grade).toBeTruthy();
    const missing = await teacher.patch(`/assignments/${id}/submissions/${amy.id}`, { status: 'graded' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fieldErrors.grade).toBeTruthy();
    expect(dbRow(id, amy.id)!.status).toBe('submitted');
  });
});
