import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AssignmentInput,
  AssignmentResponse,
  AssignmentsResponse,
  RosterResponse,
  StudentDashboard,
  SubmissionDetailResponse,
  SubmissionResponse,
  SubmissionRowsResponse,
  TeacherDashboard,
  TestResult,
} from '@codeclass/shared';
import { db, migrate, type SubmissionDbRow } from '../src/db';
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
    const closed = await createAssignment({ dueAt: '2099-01-01T00:00:00Z', allowLate: false });
    expect((await amy.client.put(`/assignments/${closed}/submission`, { code: 'draft' })).status).toBe(200);
    expect((await teacher.patch(`/assignments/${closed}`, { dueAt: '2020-01-01T00:00:00Z' })).status).toBe(200);
    // Once closed, the work can neither be handed in nor changed.
    expect((await amy.client.put(`/assignments/${closed}/submission`, { code: 'late work' })).status).toBe(409);
    const res = await amy.client.post(`/assignments/${closed}/submit`, { code: 'late work' });
    expect(res.status).toBe(409);
    expect(dbRow(closed, amy.id)).toMatchObject({ status: 'in_progress', code: 'draft' });

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

    const handedInAt = seen.body.submission.submittedAt;
    expect(graded.body.submission.returnedAt).toBeNull();
    const returned = await teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${zed.id}`, { status: 'in_progress' });
    expect(returned.status).toBe(200);
    expect(returned.body.submission).toMatchObject({
      status: 'in_progress',
      feedback: 'Nice loop!',
      grade: null,
      gradedAt: null,
      submittedAt: handedInAt,
      returnedAt: expect.any(String),
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

describe('autograded grades', () => {
  const patch = (id: number, studentId: number, body: unknown) =>
    teacher.patch<SubmissionResponse>(`/assignments/${id}/submissions/${studentId}`, body);

  it('stores and returns autoGraded until the teacher changes the grade by hand', async () => {
    const id = await createAssignment();
    await zed.client.post(`/assignments/${id}/submit`, { code: 'zed' });

    const auto = await patch(id, zed.id, {
      testResults: [result('v1', true), result('v2', false), result('h1', true)],
      autoScore: 66.7,
      grade: 6.7,
      status: 'graded',
      autoGraded: true,
    });
    expect(auto.status).toBe(200);
    expect(auto.body.submission).toMatchObject({ status: 'graded', grade: 6.7, autoScore: 66.7, autoGraded: true });
    expect(dbRow(id, zed.id)!.auto_graded).toBe(1);
    const rows = await teacher.get<SubmissionRowsResponse>(`/assignments/${id}/submissions`);
    expect(rows.body.rows.find((r) => r.student.id === zed.id)!.submission.autoGraded).toBe(true);
    expect(rows.body.rows.find((r) => r.student.id === amy.id)!.submission.autoGraded).toBe(false);
    const detail = await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${zed.id}`);
    expect(detail.body.submission.autoGraded).toBe(true);
    expect((await zed.client.get<SubmissionResponse>(`/assignments/${id}/submission`)).body.submission.autoGraded).toBe(true);

    // Fresh results, feedback, and "graded" without a grade don't change who set the grade.
    const rerun = await patch(id, zed.id, { testResults: [result('v1', true), result('v2', true), result('h1', true)] });
    expect(rerun.body.submission).toMatchObject({ status: 'graded', grade: 6.7, autoScore: 100, autoGraded: true });
    const feedback = await patch(id, zed.id, { feedback: 'Check v2' });
    expect(feedback.body.submission).toMatchObject({ grade: 6.7, feedback: 'Check v2', autoGraded: true });
    const regraded = await patch(id, zed.id, { status: 'graded', feedback: 'Checked' });
    expect(regraded.body.submission).toMatchObject({ grade: 6.7, autoGraded: true });

    // A grade without the flag is the teacher's, even the same number.
    const byHand = await patch(id, zed.id, { grade: 6.7 });
    expect(byHand.body.submission).toMatchObject({ status: 'graded', grade: 6.7, autoGraded: false });
    expect(dbRow(id, zed.id)!.auto_graded).toBe(0);
    const explicitFalse = await patch(id, zed.id, { grade: 7, autoGraded: false });
    expect(explicitFalse.body.submission).toMatchObject({ grade: 7, autoGraded: false });
    const reauto = await patch(id, zed.id, { grade: 10, status: 'graded', autoGraded: true });
    expect(reauto.body.submission).toMatchObject({ grade: 10, autoGraded: true });
  });

  it('clears autoGraded when the grade goes away', async () => {
    const id = await createAssignment();
    await amy.client.post(`/assignments/${id}/submit`, { code: 'amy' });

    expect((await patch(id, amy.id, { grade: 10, status: 'graded', autoGraded: true })).body.submission.autoGraded).toBe(true);
    const returned = await patch(id, amy.id, { status: 'in_progress', feedback: 'Try again' });
    expect(returned.body.submission).toMatchObject({ status: 'in_progress', grade: null, autoGraded: false });
    expect(dbRow(id, amy.id)!.auto_graded).toBe(0);

    // The student hands it in again: still nothing autograded.
    const again = await amy.client.post<SubmissionResponse>(`/assignments/${id}/submit`, { code: 'amy v2' });
    expect(again.body.submission).toMatchObject({ status: 'submitted', grade: null, autoGraded: false });

    expect((await patch(id, amy.id, { grade: 9, autoGraded: true })).body.submission.autoGraded).toBe(true);
    const backToSubmitted = await patch(id, amy.id, { status: 'submitted' });
    expect(backToSubmitted.body.submission).toMatchObject({ status: 'submitted', grade: null, autoGraded: false });
    expect(dbRow(id, amy.id)!.auto_graded).toBe(0);

    // A grade sent with a "not graded" status is dropped, and so is the flag.
    const dropped = await patch(id, amy.id, { grade: 9, status: 'in_progress', autoGraded: true });
    expect(dropped.body.submission).toMatchObject({ status: 'in_progress', grade: null, autoGraded: false });
    expect(dbRow(id, amy.id)!.auto_graded).toBe(0);
  });

  it('ignores autoGraded without a grade', async () => {
    const id = await createAssignment();
    await mia.client.post(`/assignments/${id}/submit`, { code: 'mia' });

    const resultsOnly = await patch(id, mia.id, { testResults: [result('v1', true)], autoScore: 11.1, autoGraded: true });
    expect(resultsOnly.status).toBe(200);
    expect(resultsOnly.body.submission).toMatchObject({ status: 'submitted', grade: null, autoScore: 11.1, autoGraded: false });
    expect(dbRow(id, mia.id)!.auto_graded).toBe(0);
    const nullGrade = await patch(id, mia.id, { grade: null, autoGraded: true });
    expect(nullGrade.body.submission).toMatchObject({ status: 'submitted', grade: null, autoGraded: false });
    expect(dbRow(id, mia.id)!.auto_graded).toBe(0);
    const missing = await patch(id, mia.id, { status: 'graded', autoGraded: true });
    expect(missing.status).toBe(400);
    expect(dbRow(id, mia.id)).toMatchObject({ status: 'submitted', auto_graded: 0 });
  });
});

describe('grading work that changed since it was looked at', () => {
  // Untyped: these responses are often 409 errors.
  const patch = (id: number, studentId: number, body: unknown) => teacher.patch(`/assignments/${id}/submissions/${studentId}`, body);

  it('saves when expectedUpdatedAt matches, and refuses without saving anything when it does not', async () => {
    const id = await createAssignment();
    const handedIn = await amy.client.post<SubmissionResponse>(`/assignments/${id}/submit`, {
      code: 'amy',
      testResults: [result('v1', true)],
    });
    const loaded = handedIn.body.submission.updatedAt!;

    const ok = await patch(id, amy.id, { grade: 8, expectedUpdatedAt: loaded });
    expect(ok.status).toBe(200);
    expect(ok.body.submission).toMatchObject({ status: 'graded', grade: 8 });
    expect(ok.body.submission.updatedAt).not.toBe(loaded);

    const before = dbRow(id, amy.id)!;
    const stale = await patch(id, amy.id, {
      grade: 2,
      status: 'graded',
      autoGraded: true,
      feedback: 'Stale',
      testResults: [result('v1', false), result('v2', false), result('h1', false)],
      autoScore: 0,
      expectedUpdatedAt: loaded,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toBe("Amy Adams's work changed while you were grading it. Reload to see the latest version.");
    expect(dbRow(id, amy.id)).toEqual(before);

    // Results-only and return-for-revision patches are checked too.
    expect((await patch(id, amy.id, { testResults: [result('v1', false)], expectedUpdatedAt: loaded })).status).toBe(409);
    expect((await patch(id, amy.id, { status: 'in_progress', expectedUpdatedAt: loaded })).status).toBe(409);
    expect(dbRow(id, amy.id)).toEqual(before);

    // Without expectedUpdatedAt the PATCH works as before.
    expect((await patch(id, amy.id, { feedback: 'Nice' })).status).toBe(200);
  });

  it('treats null as "not started": creates the row for a student with no work, refuses once work exists', async () => {
    const id = await createAssignment();
    const missing = await patch(id, mia.id, { grade: 0, feedback: 'Missing', expectedUpdatedAt: null });
    expect(missing.status).toBe(200);
    expect(missing.body.submission).toMatchObject({ status: 'graded', grade: 0, code: '// starter', autoGraded: false });
    expect(dbRow(id, mia.id)).toBeDefined();

    const before = dbRow(id, mia.id)!;
    const again = await patch(id, mia.id, { grade: 1, expectedUpdatedAt: null });
    expect(again.status).toBe(409);
    expect(dbRow(id, mia.id)).toEqual(before);

    // The student started after the teacher loaded the list: the not-started view is stale.
    const started = await createAssignment();
    expect((await zed.client.put(`/assignments/${started}/submission`, { code: 'zed draft' })).status).toBe(200);
    const late = await patch(started, zed.id, { grade: 0, expectedUpdatedAt: null });
    expect(late.status).toBe(409);
    expect(dbRow(started, zed.id)).toMatchObject({ status: 'in_progress', grade: null, code: 'zed draft' });

    // A not-started student with a made-up timestamp: refused before any row is created.
    const empty = await createAssignment();
    expect((await patch(empty, amy.id, { grade: 5, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })).status).toBe(409);
    expect(dbRow(empty, amy.id)).toBeUndefined();
  });

  it('refuses a grade for work the student unsubmitted after the teacher loaded the list', async () => {
    const id = await createAssignment();
    await zed.client.post(`/assignments/${id}/submit`, { code: 'zed v1' });
    const rows = await teacher.get<SubmissionRowsResponse>(`/assignments/${id}/submissions`);
    const seen = rows.body.rows.find((r) => r.student.id === zed.id)!.submission;
    expect(seen.status).toBe('submitted');

    // Straight away, so the unsubmit can land in the same millisecond as the hand-in.
    expect((await zed.client.post(`/assignments/${id}/unsubmit`)).status).toBe(200);
    const refused = await patch(id, zed.id, { grade: 10, status: 'graded', autoGraded: true, autoScore: 100, expectedUpdatedAt: seen.updatedAt });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Zed Zimmer's work changed/);
    expect(dbRow(id, zed.id)).toMatchObject({ status: 'in_progress', grade: null, auto_score: null, auto_graded: 0 });
    // The student can keep working.
    expect((await zed.client.put(`/assignments/${id}/submission`, { code: 'zed v2' })).status).toBe(200);

    // Reloaded: the teacher can grade (here a 0 for work that isn't handed in).
    const fresh = (await teacher.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${zed.id}`)).body.submission;
    const graded = await patch(id, zed.id, { grade: 0, expectedUpdatedAt: fresh.updatedAt });
    expect(graded.status).toBe(200);
    expect(graded.body.submission).toMatchObject({ status: 'graded', grade: 0, code: 'zed v2' });
  });

  it('changes updatedAt on every write, however quickly they follow each other', async () => {
    const id = await createAssignment();
    let current = (await mia.client.post<SubmissionResponse>(`/assignments/${id}/submit`, { code: 'mia' })).body.submission.updatedAt!;
    const seen = new Set([current]);
    for (let i = 0; i < 10; i += 1) {
      const res = await patch(id, mia.id, { testResults: [result('v1', i % 2 === 0)], expectedUpdatedAt: current });
      expect(res.status).toBe(200);
      current = res.body.submission.updatedAt!;
      expect(seen.has(current)).toBe(false);
      seen.add(current);
    }
    // Even when the stored time is ahead of the clock, the next write moves it forward.
    const ahead = '2099-01-01T00:00:00.000Z';
    db.prepare('UPDATE submissions SET updated_at = ? WHERE assignment_id = ? AND student_id = ?').run(ahead, id, mia.id);
    const next = await patch(id, mia.id, { grade: 5, expectedUpdatedAt: ahead });
    expect(next.status).toBe(200);
    expect(next.body.submission.updatedAt).toBe('2099-01-01T00:00:00.001Z');
  });
});

describe('return for revision after the due date', () => {
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  // A class of its own, so the roster and dashboard counts only see these students.
  let owner: TestClient;
  let ownClassId: number;
  let ann: { id: number; client: TestClient };
  let bob: { id: number; client: TestClient };
  let cara: { id: number; client: TestClient };

  beforeAll(() => {
    const t = insertUser('teacher');
    owner = clientAs(srv.base, t.id);
    ownClassId = Number(db.prepare("INSERT INTO classes (name, join_code, owner_id) VALUES ('Period 2', 'SUBS02', ?)").run(t.id).lastInsertRowid);
    db.prepare("INSERT INTO class_languages (class_id, language_id) VALUES (?, 'js')").run(ownClassId);
    const mk = (name: string) => {
      const u = insertUser('student', { name });
      db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(ownClassId, u.id);
      return { id: u.id, client: clientAs(srv.base, u.id) };
    };
    ann = mk('Ann Arbor');
    bob = mk('Bob Baker');
    cara = mk('Cara Cole');
  });

  /** A no-late-work assignment that Ann and Bob handed in on time (2 hours ago) and that was due 1 hour ago. */
  async function dueAfterOnTimeHandIns() {
    const res = await owner.post<AssignmentResponse>(`/classes/${ownClassId}/assignments`, {
      title: 'Loops',
      languageId: 'js',
      points: 10,
      allowLate: false,
      dueAt: hoursFromNow(1),
    } satisfies AssignmentInput);
    expect(res.status).toBe(201);
    const id = res.body.assignment.id;
    for (const s of [ann, bob]) expect((await s.client.post(`/assignments/${id}/submit`, { code: 'v1' })).status).toBe(200);
    const handedInAt = hoursFromNow(-2);
    db.prepare('UPDATE submissions SET submitted_at = ? WHERE assignment_id = ?').run(handedInAt, id);
    db.prepare('UPDATE assignments SET due_at = ? WHERE id = ?').run(hoursFromNow(-1), id);
    return { id, handedInAt };
  }

  it('lets the student hand returned work in again with late work off, and never counts it late', async () => {
    const { id, handedInAt } = await dueAfterOnTimeHandIns();
    expect((await ann.client.get<SubmissionResponse>(`/assignments/${id}/submission`)).body.submission).toMatchObject({ late: false, returnedAt: null });

    const returned = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${ann.id}`, {
      status: 'in_progress',
      feedback: 'Please fix line 2',
    });
    expect(returned.status).toBe(200);
    expect(returned.body.submission).toMatchObject({
      status: 'in_progress',
      feedback: 'Please fix line 2',
      submittedAt: handedInAt,
      returnedAt: expect.any(String),
      late: false,
    });
    const seen = await ann.client.get<SubmissionResponse>(`/assignments/${id}/submission`);
    expect(seen.body.submission).toMatchObject({ status: 'in_progress', late: false, returnedAt: returned.body.submission.returnedAt });

    expect((await ann.client.put(`/assignments/${id}/submission`, { code: 'v2' })).status).toBe(200);
    const resubmitted = await ann.client.post<SubmissionResponse>(`/assignments/${id}/submit`, { code: 'v2' });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.submission).toMatchObject({ status: 'submitted', code: 'v2', late: false });
    // Unsubmitting returned work doesn't lock the student out either.
    expect((await ann.client.post(`/assignments/${id}/unsubmit`)).status).toBe(200);
    expect((await ann.client.post(`/assignments/${id}/submit`, { code: 'v3' })).status).toBe(200);

    // Work that wasn't returned still can't be handed in late.
    expect((await bob.client.post(`/assignments/${id}/unsubmit`)).status).toBe(200);
    const blocked = await bob.client.post(`/assignments/${id}/submit`, { code: 'v2' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/late work/);

    const graded = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${ann.id}`, { grade: 9 });
    expect(graded.body.submission).toMatchObject({ status: 'graded', grade: 9, late: false, returnedAt: expect.any(String) });

    // Ann's returned work isn't late anywhere; Bob (unsubmitted after the due date) and Cara (never started) are.
    const rows = await owner.get<SubmissionRowsResponse>(`/assignments/${id}/submissions`);
    expect(rows.body.rows.map((r) => [r.student.name, r.submission.late])).toEqual([
      ['Ann Arbor', false],
      ['Bob Baker', true],
      ['Cara Cole', true],
    ]);
    const detail = await owner.get<SubmissionDetailResponse>(`/assignments/${id}/submissions/${ann.id}`);
    expect(detail.body.submission).toMatchObject({ late: false, returnedAt: expect.any(String) });
    const list = await owner.get<AssignmentsResponse>(`/classes/${ownClassId}/assignments`);
    expect(list.body.assignments.find((a) => a.id === id)).toMatchObject({ lateCount: 2 });
    const roster = await owner.get<RosterResponse>(`/classes/${ownClassId}/students`);
    expect(roster.body.students.map((s) => [s.name, s.lateCount])).toEqual([
      ['Ann Arbor', 0],
      ['Bob Baker', 1],
      ['Cara Cole', 1],
    ]);
    const teacherDash = (await owner.get<TeacherDashboard>('/dashboard')).body;
    expect(teacherDash.stats.lateCount).toBe(2);
    const annList = await ann.client.get<AssignmentsResponse>(`/classes/${ownClassId}/assignments`);
    expect(annList.body.assignments.find((a) => a.id === id)).toMatchObject({ myStatus: 'graded', myLate: false });
    const annDash = (await ann.client.get<StudentDashboard>('/dashboard')).body;
    expect(annDash.assignments.find((a) => a.assignmentId === id)).toMatchObject({ status: 'graded', late: false });
  });

  it('only marks handed-in work as returned, and forgets the return when the teacher sets it back to submitted', async () => {
    const { id, handedInAt } = await dueAfterOnTimeHandIns();

    // Cara never handed anything in, so "returning" it doesn't reopen the assignment for her.
    const notHandedIn = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${cara.id}`, {
      status: 'in_progress',
      feedback: 'Start please',
    });
    expect(notHandedIn.body.submission).toMatchObject({ status: 'in_progress', returnedAt: null, late: true });
    expect((await cara.client.post(`/assignments/${id}/submit`, { code: 'x' })).status).toBe(409);

    expect((await owner.patch(`/assignments/${id}/submissions/${ann.id}`, { status: 'in_progress' })).status).toBe(200);
    const undone = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${ann.id}`, { status: 'submitted' });
    expect(undone.body.submission).toMatchObject({ status: 'submitted', submittedAt: handedInAt, returnedAt: null, late: false });
    expect(dbRow(id, ann.id)!.returned_at).toBeNull();
    expect((await ann.client.post(`/assignments/${id}/unsubmit`)).status).toBe(200);
    expect((await ann.client.post(`/assignments/${id}/submit`, { code: 'x' })).status).toBe(409);
  });

  it('keeps the return when a grade is taken off work handed in again (autograde can no longer score it)', async () => {
    const { id } = await dueAfterOnTimeHandIns();
    expect((await owner.patch(`/assignments/${id}/submissions/${ann.id}`, { status: 'in_progress' })).status).toBe(200);
    // Handed in again after the due date: allowed, and not late, because it was returned.
    expect((await ann.client.post(`/assignments/${id}/submit`, { code: 'v2' })).status).toBe(200);
    const auto = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${ann.id}`, { grade: 10, autoGraded: true });
    expect(auto.body.submission).toMatchObject({ status: 'graded', autoGraded: true, late: false });

    const ungraded = await owner.patch<SubmissionResponse>(`/assignments/${id}/submissions/${ann.id}`, {
      status: 'submitted',
      autoScore: null,
      expectedUpdatedAt: auto.body.submission.updatedAt,
    });
    expect(ungraded.status).toBe(200);
    expect(ungraded.body.submission).toMatchObject({
      status: 'submitted',
      grade: null,
      autoGraded: false,
      autoScore: null,
      returnedAt: expect.any(String),
      late: false,
    });
  });

  it('adds returned_at to databases created before it existed, marking work that was returned', () => {
    const old = new Database(':memory:');
    try {
      old.exec('CREATE TABLE assignments (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
      old.exec(`CREATE TABLE submissions (
        id INTEGER PRIMARY KEY, status TEXT NOT NULL, feedback TEXT, submitted_at TEXT, updated_at TEXT NOT NULL)`);
      const insert = old.prepare('INSERT INTO submissions (id, status, feedback, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      insert.run(1, 'in_progress', 'Fix line 2', null, '2026-01-02T00:00:00.000Z'); // returned before returned_at existed
      insert.run(2, 'in_progress', null, null, '2026-01-03T00:00:00.000Z');
      insert.run(3, 'graded', 'Great', '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z');
      migrate(old);
      migrate(old); // idempotent
      const rows = old.prepare('SELECT id, returned_at FROM submissions ORDER BY id').all();
      expect(rows).toEqual([
        { id: 1, returned_at: '2026-01-02T00:00:00.000Z' },
        { id: 2, returned_at: null },
        { id: 3, returned_at: null },
      ]);
    } finally {
      old.close();
    }
  });

  it('adds auto_graded to databases created before it existed, counting existing grades as the teacher\'s', () => {
    const old = new Database(':memory:');
    try {
      old.exec('CREATE TABLE assignments (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
      old.exec(`CREATE TABLE submissions (
        id INTEGER PRIMARY KEY, status TEXT NOT NULL, grade REAL, feedback TEXT, returned_at TEXT, updated_at TEXT NOT NULL)`);
      old.prepare("INSERT INTO submissions (id, status, grade, updated_at) VALUES (1, 'graded', 9, '2026-01-02T00:00:00.000Z')").run();
      migrate(old);
      migrate(old); // idempotent
      const columns = old.prepare('PRAGMA table_info(submissions)').all() as { name: string; notnull: number; dflt_value: string | null }[];
      expect(columns.find((c) => c.name === 'auto_graded')).toMatchObject({ notnull: 1, dflt_value: '0' });
      expect(old.prepare('SELECT id, grade, auto_graded FROM submissions').all()).toEqual([{ id: 1, grade: 9, auto_graded: 0 }]);
      old.prepare("INSERT INTO submissions (id, status, updated_at) VALUES (2, 'submitted', '2026-01-03T00:00:00.000Z')").run();
      expect(old.prepare('SELECT auto_graded FROM submissions WHERE id = 2').pluck().get()).toBe(0);
    } finally {
      old.close();
    }
  });
});
