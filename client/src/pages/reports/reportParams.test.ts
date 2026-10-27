import { reportQuerySchema } from '@codeclass/shared';
import { describe, expect, it } from 'vitest';
import { ALL_DATES, paperForLocale, rangeToQuery, reportPath, reportQuery } from './reportParams';

describe('paperForLocale', () => {
  it('uses Letter in the US, Canada, Mexico, the Philippines, Chile, Colombia and Venezuela', () => {
    for (const locale of ['en-US', 'en-CA', 'fr-CA', 'es-MX', 'fil-PH', 'en-PH', 'es-CL', 'es-CO', 'es-VE']) {
      expect(paperForLocale(locale), locale).toBe('letter');
    }
  });

  it('uses A4 everywhere else', () => {
    for (const locale of ['en-GB', 'en-AU', 'en-IE', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ja-JP', 'es-419', 'zh-Hans-CN']) {
      expect(paperForLocale(locale), locale).toBe('a4');
    }
  });

  it("uses a language's most likely region when the locale has none", () => {
    expect(paperForLocale('en')).toBe('letter');
    expect(paperForLocale('fr')).toBe('a4');
    expect(paperForLocale('de')).toBe('a4');
  });

  it('reads underscores and any case, and falls back to A4 for nothing or nonsense', () => {
    expect(paperForLocale('en_US')).toBe('letter');
    expect(paperForLocale('EN-us')).toBe('letter');
    expect(paperForLocale('')).toBe('a4');
    expect(paperForLocale(undefined)).toBe('a4');
    expect(paperForLocale(null)).toBe('a4');
    expect(paperForLocale('not a locale!')).toBe('a4');
  });
});

/** The local time a query value stands for, as numbers. */
function local(iso: string) {
  const d = new Date(iso);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
}

const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

describe('rangeToQuery', () => {
  it('sends the start of the From day and the end of the To day, with the browser offset', () => {
    const { from, to } = rangeToQuery(['2026-09-01', '2026-10-31']);
    expect(from).toMatch(WITH_OFFSET);
    expect(to).toMatch(WITH_OFFSET);
    expect(from!.slice(0, 23)).toBe('2026-09-01T00:00:00.000');
    expect(to!.slice(0, 23)).toBe('2026-10-31T23:59:59.999');
    // The same instants as local midnight / the last millisecond of the day, whatever this machine's time zone.
    expect(local(from!)).toEqual([2026, 9, 1, 0, 0, 0, 0]);
    expect(local(to!)).toEqual([2026, 10, 31, 23, 59, 59, 999]);
  });

  it('covers a single day', () => {
    const { from, to } = rangeToQuery(['2026-10-27', '2026-10-27']);
    expect(Date.parse(to!) - Date.parse(from!)).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('leaves out open ends', () => {
    expect(rangeToQuery(ALL_DATES)).toEqual({});
    expect(Object.keys(rangeToQuery(['2026-10-01', null]))).toEqual(['from']);
    expect(Object.keys(rangeToQuery([null, '2026-10-01']))).toEqual(['to']);
  });
});

describe('reportQuery', () => {
  it('is a query the server accepts', () => {
    const query = reportQuery(['2026-09-01', '2026-10-31'], { locale: 'en-US', timeZone: 'America/Chicago' });
    expect(query).toMatchObject({ tz: 'America/Chicago', paper: 'letter' });
    const parsed = reportQuerySchema.safeParse(query);
    expect(parsed.success).toBe(true);
    // As it arrives through the query string.
    const fromUrl = Object.fromEntries(new URL(`http://x${reportPath({ kind: 'class', classId: 1 }, query)}`).searchParams);
    expect(reportQuerySchema.safeParse(fromUrl).data).toEqual(parsed.data);
  });

  it('picks the paper from the locale and leaves out a time zone the server would refuse', () => {
    expect(reportQuery(ALL_DATES, { locale: 'en-GB', timeZone: 'Europe/London' })).toEqual({ tz: 'Europe/London', paper: 'a4' });
    expect(reportQuery(ALL_DATES, { locale: 'en-US', timeZone: 'Mars/Olympus_Mons' })).toEqual({ paper: 'letter' });
    expect(reportQuery(ALL_DATES, { locale: 'en-US', timeZone: 'X'.repeat(65) })).toEqual({ paper: 'letter' });
    expect(reportQuery(ALL_DATES, {})).toEqual({ paper: 'a4' });
  });
});

describe('reportPath', () => {
  const query = { from: '2026-09-01T00:00:00.000+01:00', to: '2026-10-31T23:59:59.999-05:00', tz: 'Europe/London', paper: 'a4' as const };

  it('names each report route', () => {
    expect(reportPath({ kind: 'class', classId: 4 }, { paper: 'letter' })).toBe('/reports/classes/4?paper=letter');
    expect(reportPath({ kind: 'class-students', classId: 4 }, { paper: 'letter' })).toBe('/reports/classes/4/students?paper=letter');
    expect(reportPath({ kind: 'student', studentId: 9 }, { paper: 'a4' })).toBe('/reports/students/9?paper=a4');
    expect(reportPath({ kind: 'student', studentId: 9, classId: null }, { paper: 'a4' })).toBe('/reports/students/9?paper=a4');
    expect(reportPath({ kind: 'student', studentId: 9, classId: 4 }, { paper: 'a4' })).toBe('/reports/students/9?paper=a4&classId=4');
    expect(reportPath({ kind: 'school', includeArchived: false }, { paper: 'a4' })).toBe('/reports/school?paper=a4');
    expect(reportPath({ kind: 'school', includeArchived: true }, { paper: 'a4' })).toBe('/reports/school?paper=a4&archived=1');
    expect(reportPath({ kind: 'class', classId: 4 }, {})).toBe('/reports/classes/4');
  });

  it('encodes the offsets so a + is not read as a space', () => {
    const path = reportPath({ kind: 'class', classId: 1 }, query);
    expect(path).toContain('from=2026-09-01T00%3A00%3A00.000%2B01%3A00');
    const params = new URL(`http://x${path}`).searchParams;
    expect(params.get('from')).toBe(query.from);
    expect(params.get('to')).toBe(query.to);
    expect(params.get('tz')).toBe('Europe/London');
  });
});
