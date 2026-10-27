// PDF report routes: who may download which report, query checks, the download headers and file names, and that each
// report shows only the classes its viewer may see.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, ReportOptionsResponse, ReportQueryInput, UserResponse } from '@codeclass/shared';
import { db } from '../src/db';
import { contentDisposition, reportFileName } from '../src/routes/reports';
import { classFixture, reportContext, schoolFixture, studentFixture, studentSetFixture } from './fixtures/reports';
import { clientAs, insertLanguage, insertUser, startTestServer, type TestClient } from './helpers';

let srv: Awaited<ReturnType<typeof startTestServer>>;
type TestUser = ReturnType<typeof insertUser>;
let admin: TestUser;
let teacher: TestUser; // Grace Hopper: Algebra Coding, and the archived Old Robotics
let otherTeacher: TestUser; // Alan Turing: Bio Coding
let maya: TestUser; // Algebra Coding and Bio Coding
let zoe: TestUser; // Algebra Coding
let sam: TestUser; // only the archived Old Robotics
let olu: TestUser; // only Bio Coding
let lone: TestUser; // in no class
let algebra: number;
let robotics: number;
let biology: number;

const DAY_MS = 86_400_000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

let seq = 0;
function insertClass(ownerId: number, name: string, archived = false): number {
  seq += 1;
  const info = db
    .prepare('INSERT INTO classes (name, join_code, archived, owner_id) VALUES (?, ?, ?, ?)')
    .run(name, `REP${String(seq).padStart(3, '0')}`, archived ? 1 : 0, ownerId);
  return Number(info.lastInsertRowid);
}

function enroll(classId: number, userId: number) {
  db.prepare('INSERT INTO enrollments (class_id, user_id) VALUES (?, ?)').run(classId, userId);
}

function insertAssignment(classId: number, title: string, dueAt: string): number {
  const info = db
    .prepare(`INSERT INTO assignments (class_id, title, language_id, due_at, points) VALUES (?, ?, 'python', ?, 10)`)
    .run(classId, title, dueAt);
  return Number(info.lastInsertRowid);
}

function insertWork(assignmentId: number, studentId: number, status: 'submitted' | 'graded', grade: number | null = null) {
  db.prepare('INSERT INTO submissions (assignment_id, student_id, status, submitted_at, grade) VALUES (?, ?, ?, ?, ?)').run(
    assignmentId,
    studentId,
    status,
    daysFromNow(-3),
    grade,
  );
}

beforeAll(async () => {
  srv = await startTestServer();
  insertLanguage('python', 'python');
  admin = insertUser('admin', { name: 'Ada Admin' });
  teacher = insertUser('teacher', { name: 'Grace Hopper' });
  otherTeacher = insertUser('teacher', { name: 'Alan Turing' });
  algebra = insertClass(teacher.id, 'Algebra Coding');
  robotics = insertClass(teacher.id, 'Old Robotics', true);
  biology = insertClass(otherTeacher.id, 'Bio Coding');
  maya = insertUser('student', { name: 'Maya Rivera' });
  zoe = insertUser('student', { name: 'Zoë Ångström' });
  sam = insertUser('student', { name: 'Sam Stone' });
  olu = insertUser('student', { name: 'Olu Ade' });
  lone = insertUser('student', { name: 'Lee Lone' });
  enroll(algebra, maya.id);
  enroll(algebra, zoe.id);
  enroll(biology, maya.id);
  enroll(robotics, sam.id);
  enroll(biology, olu.id);

  const loops = insertAssignment(algebra, 'Loops Quiz', daysFromNow(-2));
  insertAssignment(biology, 'Cell Sim', daysFromNow(-2));
  insertAssignment(robotics, 'Motor Drill', daysFromNow(-2));
  insertWork(loops, maya.id, 'graded', 8);
  insertWork(loops, zoe.id, 'submitted');
});

afterAll(async () => {
  await srv.close();
});

interface Download {
  status: number;
  headers: Headers;
  bytes: Buffer;
  /** The JSON error body, when the route answered one. */
  error?: ApiErrorBody['error'];
}

/** GET as `client` (cookies and the anti-CSRF header like TestClient), keeping the body as bytes. */
async function download(client: TestClient, path: string, query: ReportQueryInput | Record<string, string> = {}): Promise<Download> {
  const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString();
  const cookies = [client.cookie, client.csrf ? `cc_csrf=${client.csrf}` : ''].filter(Boolean).join('; ');
  const res = await fetch(`${srv.base}${path}${search ? `?${search}` : ''}`, {
    headers: {
      ...(client.csrf ? { 'x-codeclass-token': client.csrf } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
      ...client.headers,
    },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const json = res.headers.get('content-type')?.startsWith('application/json');
  return { status: res.status, headers: res.headers, bytes, error: json ? (JSON.parse(bytes.toString()) as ApiErrorBody).error : undefined };
}

/** The PDF's text (all pages, whitespace collapsed) and page sizes. */
async function readPdf(bytes: Buffer): Promise<{ text: string; pageCount: number; size: number[] }> {
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  let size: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    if (n === 1) size = page.view.slice(2);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  const pageCount = doc.numPages;
  await task.destroy();
  return { text: pages.join(' ').replace(/\s+/g, ' '), pageCount, size };
}

/** The report's text, after checking it downloaded. */
async function reportText(client: TestClient, path: string, query: ReportQueryInput = {}): Promise<string> {
  const res = await download(client, path, query);
  expect(res.status, res.error?.message).toBe(200);
  return (await readPdf(res.bytes)).text;
}

/** "2026-10-27" in `timeZone` (as `Intl` writes it in Canadian English). */
const dayIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());

describe('who may download reports', () => {
  const everyRoute = () => [
    '/reports/options',
    `/reports/classes/${algebra}`,
    `/reports/classes/${algebra}/students`,
    `/reports/students/${maya.id}`,
    '/reports/school',
  ];

  it('needs a signed-in teacher or admin', async () => {
    for (const path of everyRoute()) {
      expect((await download(srv.client(), path)).status, path).toBe(401);
      expect((await download(clientAs(srv.base, maya.id), path)).status, path).toBe(403);
    }
  });

  it('refuses a teacher or admin signed in as a student (that session is the student)', async () => {
    for (const [staff, student] of [
      [teacher, zoe],
      [admin, maya],
    ] as const) {
      const client = clientAs(srv.base, staff.id);
      expect((await client.post<UserResponse>('/auth/impersonate', { userId: student.id })).status).toBe(200);
      for (const path of everyRoute()) expect((await download(client, path)).status, path).toBe(403);
    }
  });

  it('lets an admin download every report', async () => {
    const client = clientAs(srv.base, admin.id);
    const paths = [
      ...[algebra, robotics, biology].flatMap((id) => [`/reports/classes/${id}`, `/reports/classes/${id}/students`]),
      ...[maya, zoe, sam, olu, lone].map((s) => `/reports/students/${s.id}`),
      `/reports/students/${maya.id}?classId=${biology}`,
      '/reports/school',
    ];
    for (const path of paths) expect((await download(client, path)).status, path).toBe(200);
  });

  it("gives a teacher their own classes, archived ones too, and 404 for anyone else's", async () => {
    const client = clientAs(srv.base, teacher.id);
    for (const id of [algebra, robotics]) {
      expect((await download(client, `/reports/classes/${id}`)).status).toBe(200);
      expect((await download(client, `/reports/classes/${id}/students`)).status).toBe(200);
    }
    for (const path of [
      `/reports/classes/${biology}`,
      `/reports/classes/${biology}/students`,
      '/reports/classes/999999',
      '/reports/classes/999999/students',
      '/reports/classes/abc',
    ]) {
      const res = await download(client, path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    }
    expect((await download(client, `/reports/classes/${biology}`)).error?.message).toBe('Class not found');
  });

  it("gives a teacher reports on their own students only, and 404 for anyone else's", async () => {
    const client = clientAs(srv.base, teacher.id);
    for (const student of [maya, zoe, sam]) expect((await download(client, `/reports/students/${student.id}`)).status).toBe(200);
    expect((await download(client, `/reports/students/${maya.id}`, { classId: algebra })).status).toBe(200);

    const refused: [string, ReportQueryInput, string][] = [
      [`/reports/students/${olu.id}`, {}, 'Student not found'], // only in another teacher's class
      [`/reports/students/${lone.id}`, {}, 'Student not found'], // in no class
      [`/reports/students/${maya.id}`, { classId: biology }, 'Class not found'], // another teacher's class
      [`/reports/students/${maya.id}`, { classId: robotics }, 'Class not found'], // the teacher's, but she isn't in it
      [`/reports/students/${maya.id}`, { classId: 999999 }, 'Class not found'],
      [`/reports/students/${teacher.id}`, {}, 'Student not found'],
      [`/reports/students/${otherTeacher.id}`, {}, 'Student not found'],
      [`/reports/students/${admin.id}`, {}, 'Student not found'],
      ['/reports/students/999999', {}, 'Student not found'],
      // With one of the teacher's own classes as `classId`, a student she can't see answers like a missing account,
      // so `classId` can't be used to tell which ids are students.
      [`/reports/students/${olu.id}`, { classId: algebra }, 'Student not found'],
      [`/reports/students/${lone.id}`, { classId: algebra }, 'Student not found'],
      [`/reports/students/${otherTeacher.id}`, { classId: algebra }, 'Student not found'],
      ['/reports/students/999999', { classId: algebra }, 'Student not found'],
    ];
    for (const [path, query, message] of refused) {
      const res = await download(client, path, query);
      expect(res.status, `${path} ${JSON.stringify(query)}`).toBe(404);
      expect(res.error?.message).toBe(message);
    }
  });

  it('answers 404 to an admin for staff ids and classes the student is not in', async () => {
    const client = clientAs(srv.base, admin.id);
    for (const id of [teacher.id, admin.id, 999999]) expect((await download(client, `/reports/students/${id}`)).status).toBe(404);
    expect((await download(client, `/reports/students/${maya.id}`, { classId: robotics })).status).toBe(404);
  });

  it('keeps the school report for admins', async () => {
    const res = await download(clientAs(srv.base, teacher.id), '/reports/school');
    expect(res.status).toBe(403);
    expect(res.error?.message).toBeTruthy();
  });
});

describe('what each report shows', () => {
  it("shows a teacher only their own classes in a student's report", async () => {
    const own = await reportText(clientAs(srv.base, teacher.id), `/reports/students/${maya.id}`);
    expect(own).toContain('Maya Rivera');
    expect(own).toContain('Algebra Coding');
    expect(own).toContain('Loops Quiz');
    expect(own).not.toContain('Bio Coding');
    expect(own).not.toContain('Cell Sim');
    expect(own).toContain('by Grace Hopper');

    const all = await reportText(clientAs(srv.base, admin.id), `/reports/students/${maya.id}`);
    expect(all).toContain('Algebra Coding');
    expect(all).toContain('Bio Coding');
    expect(all).toContain('Cell Sim');
    expect(all).toContain('by Ada Admin');

    const one = await reportText(clientAs(srv.base, admin.id), `/reports/students/${maya.id}`, { classId: biology });
    expect(one).toContain('Bio Coding');
    expect(one).not.toContain('Algebra Coding');
  });

  it('gives an admin a report for a student in no class, saying so', async () => {
    const text = await reportText(clientAs(srv.base, admin.id), `/reports/students/${lone.id}`);
    expect(text).toContain('Lee Lone');
    expect(text).toContain('any of the classes this report covers');
  });

  it('makes class reports and one student report per student', async () => {
    const client = clientAs(srv.base, teacher.id);
    const report = await reportText(client, `/reports/classes/${algebra}`);
    expect(report).toContain('Class report');
    expect(report).toContain('Algebra Coding');
    expect(report).toContain('Maya Rivera');
    expect(report).toContain('Loops Quiz');
    expect(await reportText(client, `/reports/classes/${robotics}`)).toContain('Old Robotics');

    const set = await download(client, `/reports/classes/${algebra}/students`);
    const pdf = await readPdf(set.bytes);
    expect(pdf.pageCount).toBeGreaterThanOrEqual(2); // each student starts on a new page
    expect(pdf.text).toContain('Maya Rivera');
    expect(pdf.text).toContain('Student report');
  });

  it('leaves archived classes out of the school report unless asked', async () => {
    const client = clientAs(srv.base, admin.id);
    const active = await reportText(client, '/reports/school');
    expect(active).toContain('School report');
    expect(active).toContain('Algebra Coding');
    expect(active).toContain('Bio Coding');
    expect(active).not.toContain('Old Robotics');
    expect(await reportText(client, '/reports/school', { archived: '1' })).toContain('Old Robotics');
    expect(await reportText(client, '/reports/school', { archived: '0' })).not.toContain('Old Robotics');
  });

  it('applies the date range, paper size and orientation from the query', async () => {
    const client = clientAs(srv.base, teacher.id);
    // The only assignment was due two days ago, so a range starting tomorrow has none.
    const later = await reportText(client, `/reports/classes/${algebra}`, { from: daysFromNow(1) });
    expect(later).not.toContain('Loops Quiz');
    expect(later).toContain('Assignments due from');
    const inRange = await reportText(client, `/reports/classes/${algebra}`, { from: daysFromNow(-5), to: daysFromNow(5) });
    expect(inRange).toContain('Loops Quiz');

    const letterClass = await readPdf((await download(client, `/reports/classes/${algebra}`)).bytes);
    expect(letterClass.size).toEqual([792, 612]);
    const a4Class = await readPdf((await download(client, `/reports/classes/${algebra}`, { paper: 'a4' })).bytes);
    expect(a4Class.size[0]).toBeCloseTo(841.89, 1);
    expect(a4Class.size[1]).toBeCloseTo(595.28, 1);
    const a4Student = await readPdf((await download(client, `/reports/students/${maya.id}`, { paper: 'a4' })).bytes);
    expect(a4Student.size[0]).toBeCloseTo(595.28, 1);
    expect(a4Student.size[1]).toBeCloseTo(841.89, 1);
  });
});

describe('report query checks', () => {
  const cases: [string, Record<string, string>, string][] = [
    ['a from that is not a date', { from: 'yesterday' }, 'from'],
    ['a from without a time zone offset', { from: '2026-10-01T00:00:00' }, 'from'],
    ['a to that is not a date', { to: '2026-13-45T00:00:00Z' }, 'to'],
    ['an unknown time zone', { tz: 'Mars/Olympus_Mons' }, 'tz'],
    ['a from after the to', { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }, 'to'],
    ['an unknown paper size', { paper: 'legal' }, 'paper'],
    ['a class id that is not a number', { classId: 'abc' }, 'classId'],
    ['a class id that is not positive', { classId: '0' }, 'classId'],
    ['an archived flag other than 0 or 1', { archived: 'yes' }, 'archived'],
  ];

  it.each(cases)('refuses %s with a 400 naming the query key', async (_label, query, key) => {
    const res = await download(clientAs(srv.base, admin.id), `/reports/students/${maya.id}`, query);
    expect(res.status).toBe(400);
    expect(Object.keys(res.error?.fieldErrors ?? {})).toEqual([key]);
    expect(res.error?.message).toBe(res.error?.fieldErrors?.[key]);
  });

  it('checks the query on every report route', async () => {
    const client = clientAs(srv.base, admin.id);
    for (const path of [`/reports/classes/${algebra}`, `/reports/classes/${algebra}/students`, '/reports/school']) {
      const res = await download(client, path, { paper: 'legal', tz: 'Nowhere/Land' });
      expect(res.status, path).toBe(400);
      expect(Object.keys(res.error?.fieldErrors ?? {}).sort()).toEqual(['paper', 'tz']);
    }
    const reversed = await download(client, '/reports/school', { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' });
    expect(reversed.error?.message).toBe('The start date must be on or before the end date');
  });

  it('accepts ISO dates with an offset and a time zone, and ignores unknown keys', async () => {
    const res = await download(clientAs(srv.base, teacher.id), `/reports/classes/${algebra}`, {
      from: '2026-09-01T00:00:00.000-05:00',
      to: '2026-10-31T23:59:59.999+01:00',
      tz: 'America/Chicago',
      paper: 'a4',
      utm_source: 'mail',
    });
    expect(res.status, res.error?.message).toBe(200);
  });
});

describe('report downloads', () => {
  it('sends a PDF attachment that is never cached', async () => {
    const res = await download(clientAs(srv.base, teacher.id), `/reports/classes/${algebra}`, { tz: 'America/Chicago' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Number(res.headers.get('content-length'))).toBe(res.bytes.length);
    expect(res.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const day = dayIn('America/Chicago');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Algebra Coding - class report - ${day}.pdf"; ` +
        `filename*=UTF-8''Algebra%20Coding%20-%20class%20report%20-%20${day}.pdf`,
    );
  });

  it('names each kind of report, with the date in the report’s time zone', async () => {
    const teacherClient = clientAs(srv.base, teacher.id);
    const adminClient = clientAs(srv.base, admin.id);
    // Kiritimati is UTC+14 and Pago Pago UTC−11: always different days.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const before = dayIn(tz);
      const downloads = [
        [await download(teacherClient, `/reports/classes/${algebra}`, { tz }), 'Algebra Coding - class report'],
        [await download(teacherClient, `/reports/classes/${algebra}/students`, { tz }), 'Algebra Coding - student reports'],
        [await download(teacherClient, `/reports/students/${maya.id}`, { tz }), 'Maya Rivera - student report'],
        [await download(adminClient, '/reports/school', { tz }), 'School report'],
      ] as const;
      const after = dayIn(tz);
      for (const [res, name] of downloads) {
        expect(res.status).toBe(200);
        const disposition = res.headers.get('content-disposition') ?? '';
        expect([before, after].map((day) => `attachment; filename="${name} - ${day}.pdf"`)).toContain(disposition.split('; filename*')[0]);
      }
    }
  });

  it('spells non-ASCII names exactly in filename* and plainly in filename', async () => {
    const res = await download(clientAs(srv.base, teacher.id), `/reports/students/${zoe.id}`, { tz: 'UTC' });
    const day = dayIn('UTC');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Zoe Angstrom - student report - ${day}.pdf"; ` +
        `filename*=UTF-8''Zo%C3%AB%20%C3%85ngstr%C3%B6m%20-%20student%20report%20-%20${day}.pdf`,
    );
  });
});

describe('report file names', () => {
  /** A class report named `name`, made 2026-10-27T19:14Z (Oct 27 in Chicago). */
  const classNamed = (name: string, timeZone = 'America/Chicago') => ({
    ...classFixture({ name, studentCount: 1, assignmentCount: 1 }),
    context: reportContext({ timeZone }),
  });

  it('names every kind of report with the day in its time zone', () => {
    const cls = classNamed('Year 8 Computing');
    expect(reportFileName(cls)).toBe('Year 8 Computing - class report - 2026-10-27.pdf');
    expect(reportFileName(classNamed('Year 8 Computing', 'Pacific/Kiritimati'))).toBe('Year 8 Computing - class report - 2026-10-28.pdf');
    expect(reportFileName(studentSetFixture(cls))).toBe('Year 8 Computing - student reports - 2026-10-27.pdf');
    const student = studentFixture([cls], cls.students[0]!.id);
    expect(reportFileName(student)).toBe(`${cls.students[0]!.name} - student report - 2026-10-27.pdf`);
    expect(reportFileName(schoolFixture([cls]))).toBe('School report - 2026-10-27.pdf');
  });

  it('removes characters file systems refuse, control characters and bidi overrides', () => {
    const name = (text: string) => reportFileName(classNamed(text)).replace(' - class report - 2026-10-27.pdf', '');
    expect(name('A/B: "C" <D>|E*?\\F')).toBe('A B C D E F');
    expect(name('Tabs\tand\nlines\u0000 \u202Eevil')).toBe('Tabs and lines evil');
    expect(name('  ..hidden   class  ')).toBe('hidden class');
    expect(name('???')).toBe('Class');
    expect(name('Año 8 · Informática')).toBe('Año 8 · Informática');
  });

  it('caps long names well under file-system limits', () => {
    const long = reportFileName(classNamed('x'.repeat(300)));
    expect(long).toBe(`${'x'.repeat(80)} - class report - 2026-10-27.pdf`);
    const wide = reportFileName(classNamed('数'.repeat(300)));
    expect(Buffer.byteLength(wide)).toBeLessThan(200);
    expect(wide).toMatch(/^数+ - class report - 2026-10-27\.pdf$/);
    // Never cuts a letter from its accent ("q́" has no single-character form: 3 bytes each, so 50 fit).
    expect(reportFileName(classNamed('q́'.repeat(100)))).toBe(`${'q́'.repeat(50)} - class report - 2026-10-27.pdf`);
  });

  it('writes both filename forms', () => {
    expect(contentDisposition('Straße Œuvre – Ærø.pdf')).toBe(
      `attachment; filename="Strasse OEuvre - AEro.pdf"; filename*=UTF-8''Stra%C3%9Fe%20%C5%92uvre%20%E2%80%93%20%C3%86r%C3%B8.pdf`,
    );
    expect(contentDisposition("O'Brien (Year 8) 100% - class report.pdf")).toBe(
      `attachment; filename="O'Brien (Year 8) 100_ - class report.pdf"; ` +
        `filename*=UTF-8''O%27Brien%20%28Year%208%29%20100%25%20-%20class%20report.pdf`,
    );
    expect(contentDisposition('王小明 🙂 - student report.pdf')).toMatch(/^attachment; filename="_ _ - student report\.pdf"; filename\*=UTF-8''%E7%8E%8B/);
  });
});

describe('report options', () => {
  it("lists a teacher's classes, archived ones last, and their students", async () => {
    const res = await clientAs(srv.base, teacher.id).get<ReportOptionsResponse>('/reports/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      classes: [
        { id: algebra, name: 'Algebra Coding', teacherName: 'Grace Hopper', archived: false, studentCount: 2 },
        { id: robotics, name: 'Old Robotics', teacherName: 'Grace Hopper', archived: true, studentCount: 1 },
      ],
      students: [
        { id: maya.id, name: 'Maya Rivera', username: maya.username, classIds: [algebra] },
        { id: sam.id, name: 'Sam Stone', username: sam.username, classIds: [robotics] },
        { id: zoe.id, name: 'Zoë Ångström', username: zoe.username, classIds: [algebra] },
      ],
      school: false,
    } satisfies ReportOptionsResponse);
  });

  it('lists every class and student for an admin, with the school report', async () => {
    const res = await clientAs(srv.base, admin.id).get<ReportOptionsResponse>('/reports/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      classes: [
        { id: algebra, name: 'Algebra Coding', teacherName: 'Grace Hopper', archived: false, studentCount: 2 },
        { id: biology, name: 'Bio Coding', teacherName: 'Alan Turing', archived: false, studentCount: 2 },
        { id: robotics, name: 'Old Robotics', teacherName: 'Grace Hopper', archived: true, studentCount: 1 },
      ],
      students: [
        { id: maya.id, name: 'Maya Rivera', username: maya.username, classIds: [algebra, biology] },
        { id: olu.id, name: 'Olu Ade', username: olu.username, classIds: [biology] },
        { id: sam.id, name: 'Sam Stone', username: sam.username, classIds: [robotics] },
        { id: zoe.id, name: 'Zoë Ångström', username: zoe.username, classIds: [algebra] },
      ],
      school: true,
    } satisfies ReportOptionsResponse);
  });
});
