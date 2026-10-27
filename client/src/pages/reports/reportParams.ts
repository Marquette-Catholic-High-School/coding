// What the PDF report downloads ask for (GET /api/reports/…; see the "Reports" section of shared/src/api.ts): which
// report, the date range, and the time zone and paper size the PDF is written for.

import type { PaperSize, ReportQueryInput } from '@codeclass/shared';
import dayjs from 'dayjs';

/** The date picker's range: days as 'YYYY-MM-DD' in the browser's time zone; a null end is open. */
export type DayRange = [string | null, string | null];

export const ALL_DATES: DayRange = [null, null];

/** Which report to download. */
export type ReportTarget =
  | { kind: 'class'; classId: number }
  /** One student report per student of the class, in one PDF. */
  | { kind: 'class-students'; classId: number }
  /** `classId` limits it to one class; otherwise every class of the student's the viewer can see. */
  | { kind: 'student'; studentId: number; classId?: number | null }
  | { kind: 'school'; includeArchived: boolean };

/** The browser settings a report's dates and paper follow. */
export interface BrowserSettings {
  /** e.g. 'en-US' (`navigator.language`). */
  locale?: string | null;
  /** IANA time zone, e.g. 'America/Chicago'. */
  timeZone?: string | null;
}

/** Regions that print on US Letter; everywhere else uses A4. */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE']);

/** ISO 8601 with milliseconds and the browser's UTC offset, e.g. 2026-10-01T00:00:00.000+01:00. */
const ISO_WITH_OFFSET = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

/**
 * The paper size for a locale's region: Letter in the US, Canada, Mexico, the Philippines, Chile, Colombia and
 * Venezuela, A4 elsewhere. A locale without a region ('en') uses its most likely one ('en' → US, 'fr' → FR).
 */
export function paperForLocale(locale: string | null | undefined): PaperSize {
  if (!locale) return 'a4';
  try {
    const parsed = new Intl.Locale(locale.replace(/_/g, '-'));
    const region = parsed.region ?? parsed.maximize().region;
    return region && LETTER_REGIONS.has(region.toUpperCase()) ? 'letter' : 'a4';
  } catch {
    return 'a4'; // not a valid language tag
  }
}

/** True for a time zone this browser (and so the server's `reportQuerySchema`) knows. */
function isKnownTimeZone(timeZone: string): boolean {
  if (timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The `from`/`to` query values: the start of the From day and the end of the To day, in the browser's time zone. */
export function rangeToQuery([from, to]: DayRange): Pick<ReportQueryInput, 'from' | 'to'> {
  const query: Pick<ReportQueryInput, 'from' | 'to'> = {};
  if (from) query.from = dayjs(from).startOf('day').format(ISO_WITH_OFFSET);
  if (to) query.to = dayjs(to).endOf('day').format(ISO_WITH_OFFSET);
  return query;
}

/** The query every report route takes. A time zone the server wouldn't accept is left out (the PDF uses UTC). */
export function reportQuery(range: DayRange, browser: BrowserSettings): ReportQueryInput {
  const tz = browser.timeZone && isKnownTimeZone(browser.timeZone) ? browser.timeZone : undefined;
  return { ...rangeToQuery(range), ...(tz ? { tz } : {}), paper: paperForLocale(browser.locale) };
}

/** This browser's language and time zone. */
export function browserSettings(): BrowserSettings {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return { locale: typeof navigator === 'undefined' ? undefined : navigator.language, timeZone };
}

/** The API path (under /api) of a report download, with its query string. */
export function reportPath(target: ReportTarget, query: ReportQueryInput): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.tz) params.set('tz', query.tz);
  if (query.paper) params.set('paper', query.paper);

  let path: string;
  switch (target.kind) {
    case 'class':
      path = `/reports/classes/${target.classId}`;
      break;
    case 'class-students':
      path = `/reports/classes/${target.classId}/students`;
      break;
    case 'student':
      path = `/reports/students/${target.studentId}`;
      if (target.classId != null) params.set('classId', String(target.classId));
      break;
    case 'school':
      path = '/reports/school';
      if (target.includeArchived) params.set('archived', '1');
      break;
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
