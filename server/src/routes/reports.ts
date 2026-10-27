// PDF report downloads (see "Reports" in shared/src/api.ts): access checks and file names. reports/data.ts builds each
// report from the database and reports/pdf.ts draws it. Teachers and admins only; a teacher or admin signed in as a
// student is that student here (403).

import { Router, type Request, type Response } from 'express';
import { reportQuerySchema, type ReportOptionsResponse, type ReportQuery } from '@codeclass/shared';
import { canManageClass } from '../access';
import { currentUser, requireAdmin, requireStaff } from '../auth';
import { db, type ClassRow } from '../db';
import { badRequest, notFound, parseId } from '../http';
import {
  buildClassReport,
  buildClassStudentReports,
  buildSchoolReport,
  buildStudentReport,
  reportContext,
  reportOptions,
  studentClassIdsFor,
} from '../reports/data';
import type { Report, ReportContext } from '../reports/model';
import { renderReportPdf } from '../reports/pdf';

export const router = Router();

/** The report query string; 400 with `fieldErrors` keyed by query key, like `parseBody`. */
function parseReportQuery(query: unknown): ReportQuery {
  const result = reportQuerySchema.safeParse(query ?? {});
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    fieldErrors[key] ??= issue.message;
  }
  // A download has no form whose fields could be highlighted, so the message is the first problem itself.
  throw badRequest(Object.values(fieldErrors)[0] ?? 'Please check the report options', fieldErrors);
}

/**
 * The class a report is about: its teacher's or, for admins, any. Unlike `loadClassForStaff` (403), another teacher's
 * class answers 404, as if it didn't exist.
 */
function loadReportClass(req: Request): ClassRow {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(parseId(String(req.params.id))) as ClassRow | undefined;
  if (!cls || !canManageClass(cls, currentUser(req))) throw notFound('Class not found');
  return cls;
}

// --- File names -----------------------------------------------------------------------------------------------------

// Characters file systems refuse (/\:*?"<>|), control and invisible format characters (incl. bidi overrides, which
// could make a name read backwards) and line breaks.
const UNSAFE_IN_FILE_NAMES = /[/\\:*?"<>|\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Longest name part, in characters and in UTF-8 bytes, so the whole file name stays well under 255 bytes. */
const MAX_NAME_CHARS = 80;
const MAX_NAME_BYTES = 150;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** A class or student name made safe for a file name (`fallback` when nothing is left). */
function fileNamePart(text: string, fallback: string): string {
  const cleaned = text
    .replace(LONE_SURROGATE, '\uFFFD')
    .normalize('NFC')
    .replace(UNSAFE_IN_FILE_NAMES, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '') // no hidden ".name" files
    .trim();
  let out = '';
  let chars = 0;
  let bytes = 0;
  for (const { segment } of graphemes.segment(cleaned)) {
    bytes += Buffer.byteLength(segment);
    if (++chars > MAX_NAME_CHARS || bytes > MAX_NAME_BYTES) break;
    out += segment;
  }
  return out.trim() || fallback;
}

/** "2026-10-27": the day the report was made, in its time zone. */
function fileDate(context: Pick<ReportContext, 'generatedAt' | 'timeZone'>): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: context.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(context.generatedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** "Year 8 Computing - class report - 2026-10-27.pdf" and so on (the date in the report's time zone). */
export function reportFileName(report: Report): string {
  const day = fileDate(report.context);
  switch (report.kind) {
    case 'class':
      return `${fileNamePart(report.cls.name, 'Class')} - class report - ${day}.pdf`;
    case 'students':
      return `${fileNamePart(report.cls.name, 'Class')} - student reports - ${day}.pdf`;
    case 'student':
      return `${fileNamePart(report.student.name, 'Student')} - student report - ${day}.pdf`;
    case 'school':
      return `School report - ${day}.pdf`;
  }
}

/** Letters that don't decompose into an ASCII letter plus accents, and typographic punctuation. */
const ASCII_SPELLING: Record<string, string> = {
  ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D',
  þ: 'th', Þ: 'Th', ı: 'i', '‘': "'", '’': "'", '‚': "'", '“': "'", '”': "'", '„': "'", '–': '-', '—': '-',
};

/** The ASCII `filename` for old browsers: accents dropped ("Zoë" → "Zoe"), other letters as "_". */
function asciiFileName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7E]+/gu, (run) => Array.from(run, (char) => ASCII_SPELLING[char] ?? '_').join('').replace(/_+/g, '_'))
    .replace(/%/g, '_'); // some browsers percent-decode `filename`
}

/** `Content-Disposition` for a download: an ASCII `filename` and the exact name as UTF-8 in `filename*` (RFC 6266). */
export function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encoded}`;
}

async function sendReport(res: Response, report: Report): Promise<void> {
  const pdf = await renderReportPdf(report);
  res.type('application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(reportFileName(report)));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(pdf.length));
  res.end(pdf);
}

// --- Routes ---------------------------------------------------------------------------------------------------------

router.get('/reports/options', requireStaff, (req, res) => {
  const body: ReportOptionsResponse = reportOptions(currentUser(req));
  res.json(body);
});

router.get('/reports/classes/:id', requireStaff, async (req, res) => {
  const query = parseReportQuery(req.query);
  const cls = loadReportClass(req);
  const ctx = reportContext({ title: 'Class report', viewer: currentUser(req), query });
  await sendReport(res, buildClassReport(cls.id, ctx));
});

router.get('/reports/classes/:id/students', requireStaff, async (req, res) => {
  const query = parseReportQuery(req.query);
  const cls = loadReportClass(req);
  const ctx = reportContext({ title: 'Student reports', viewer: currentUser(req), query });
  await sendReport(res, buildClassStudentReports(cls.id, ctx));
});

router.get('/reports/students/:id', requireStaff, async (req, res) => {
  const viewer = currentUser(req);
  const query = parseReportQuery(req.query);
  const studentId = parseId(String(req.params.id));
  // Teachers and admins have no student report: their ids answer as if they didn't exist.
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'student'").get(studentId)) throw notFound('Student not found');

  // Only the viewer's classes (teachers: their own, archived ones too; admins: all).
  const visible = studentClassIdsFor(viewer, studentId);
  // Not in any of this teacher's classes: not their student, checked before `classId` so that the answer is the same
  // as for a missing account. Admins still get a report (saying there's no class).
  if (visible.length === 0 && viewer.role !== 'admin') throw notFound('Student not found');
  let classIds = visible;
  if (query.classId !== undefined) {
    if (!visible.includes(query.classId)) throw notFound('Class not found');
    classIds = [query.classId];
  }
  const ctx = reportContext({ title: 'Student report', viewer, query });
  await sendReport(res, buildStudentReport(studentId, classIds, ctx));
});

router.get('/reports/school', requireAdmin, async (req, res) => {
  const query = parseReportQuery(req.query);
  const ctx = reportContext({ title: 'School report', viewer: currentUser(req), query });
  await sendReport(res, buildSchoolReport(ctx, query.archived === '1'));
});
