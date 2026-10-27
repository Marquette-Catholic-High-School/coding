// Text and number formatting for the PDF reports (en-US wording, dates in the report's time zone).

import { robotoHas } from './fonts';
import type { ReportContext, WorkStatus } from './model';

export const DASH = '—';

const counts = new Intl.NumberFormat('en-US');
const grades = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** "1,234". */
export function formatCount(n: number): string {
  return counts.format(n);
}

/** Whole-number percent: "87%"; "—" for null. */
export function formatPercent(percent: number | null): string {
  return percent === null || !Number.isFinite(percent) ? DASH : `${Math.round(percent)}%`;
}

/** A grade or points value with at most one decimal and no trailing ".0": "7.5", "10". */
export function formatGrade(value: number): string {
  return grades.format(value);
}

/** "7.5 / 10". */
export function formatScore(grade: number, points: number): string {
  return `${formatGrade(grade)} / ${formatGrade(points)}`;
}

/** "412 of 450". */
export function ofCount(part: number, whole: number): string {
  return `${formatCount(part)} of ${formatCount(whole)}`;
}

/** part / whole as a percent, or null when there is nothing to divide by. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

// --- User text ------------------------------------------------------------------------------------------------------

// Control characters and bidi overrides/isolates: never useful in a printed name and not in Roboto.
const UNPRINTABLE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]+/g;
// Letters of scripts Roboto doesn't cover (with any marks on them). Their glyphs would be missing anyway, and
// right-to-left or complex scripts (Arabic, Hebrew, Devanagari, …) also make pdfkit overlap the text around them,
// so they are drawn as U+FFFD (which Roboto has) instead.
const UNSUPPORTED = /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]\p{M}*/gu;
// An emoji with its skin tone, variation selector and joined emoji: one character on the page.
const EMOJI = /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
// One character with the marks (accents) on it, or marks with nothing before them.
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;
const ALL_ASCII = /^[\x20-\x7E]*$/;
/** Look-alikes for characters Roboto lacks that turn up in names and titles: the Hawaiian ʻokina, ɣ, ǝ, arrows. */
const LOOK_ALIKES: Record<string, string> = {
  'ʻ': '‘',
  'ʽ': '‘',
  'ǝ': 'ə',
  'ɣ': 'γ',
  'ꞵ': 'β',
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '⇒': '=>',
};
const REPLACEMENT = '\uFFFD';
// Zero-width space: an invisible place the line breaker may break a long word.
const ZWSP = '\u200B';
/**
 * Parts of words longer than this get break opportunities every `WORD_CHUNK` characters, so a long username or
 * identifier can't make a table wider than the page. Hyphenated names wrap at their hyphens instead.
 */
const LONG_WORD = 20;
const WORD_CHUNK = 10;

/** Text from users with control characters removed, single spaces and NFC (for PDF metadata). */
export function plainText(text: string): string {
  return text.normalize('NFC').replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
}

const drawable = (text: string) => Array.from(text).every((char) => robotoHas(char.codePointAt(0)!));

/**
 * One character (with its marks) as Roboto can draw it. pdfkit draws a character Roboto lacks as an empty box and
 * runs the rest of the word into the next one, so: a letter keeps the accents Roboto has ("Ἀ" → "Α"), a ligature
 * or other compatibility character is spelled out ("Ǆ" → "DŽ"), an invisible format character is dropped, and
 * anything else becomes a look-alike or U+FFFD.
 */
function drawableCluster(cluster: string): string {
  if (drawable(cluster)) return cluster;
  const [first = '', ...marks] = Array.from(cluster.normalize('NFD'));
  if (/\p{M}/u.test(first)) return Array.from(cluster).filter(drawable).join('');
  if (drawable(first)) {
    const kept = first + marks.filter(drawable).join('');
    return drawable(kept.normalize('NFC')) ? kept.normalize('NFC') : kept;
  }
  const spelled = cluster.normalize('NFKC');
  if (drawable(spelled)) return spelled;
  if (Object.hasOwn(LOOK_ALIKES, first)) return LOOK_ALIKES[first]!;
  return /^\p{Cf}/u.test(first) ? '' : REPLACEMENT;
}

/** Text from users made safe to draw with Roboto: `plainText`, with characters Roboto lacks replaced (see above). */
export function cleanText(text: string): string {
  const plain = plainText(text);
  if (ALL_ASCII.test(plain)) return plain;
  return plain
    .replace(UNSUPPORTED, REPLACEMENT)
    .replace(EMOJI, (emoji) => (drawable(emoji) ? emoji : REPLACEMENT))
    .replace(CLUSTER, drawableCluster);
}

/** Break opportunities inside one long part of a word (never between a letter and its accent). */
function breakLongPart(part: string): string {
  const chars = Array.from(part);
  if (chars.length <= LONG_WORD) return part;
  let out = '';
  chars.forEach((char, i) => {
    if (i > 0 && i % WORD_CHUNK === 0 && !/\p{M}/u.test(char)) out += ZWSP;
    out += char;
  });
  return out;
}

/** `cleanText` plus invisible break opportunities inside very long words, for table cells and headings. */
export function userText(text: string): string {
  return cleanText(text)
    .split(' ')
    .map((word) =>
      word
        // "Turing-Featherstonehaugh" may wrap after its hyphen, so only a long part on either side of it needs more
        // break opportunities (a break inside a part that would fit on its own line reads badly).
        .split(/(?<=[-\u2010–—])/u)
        .map(breakLongPart)
        .join(''),
    )
    .join(' ');
}

/**
 * `cleanText` cut to at most `max` characters with an ellipsis, at a word break when one is close (for one-line
 * places such as the page header).
 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(cleanText(text));
  if (chars.length <= max) return chars.join('');
  const cut = chars.slice(0, Math.max(1, max - 1)).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space >= cut.length * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// --- Dates ----------------------------------------------------------------------------------------------------------

export interface DateFormats {
  /** "Oct 27, 2026". */
  date(iso: string): string;
  /** "3:14 PM". */
  time(iso: string): string;
  /** "Oct 27, 2026, 3:14 PM". */
  dateTime(iso: string): string;
}

/** Date formatters for `timeZone` (UTC if it isn't a zone this runtime knows). */
export function dateFormats(timeZone: string): DateFormats {
  const make = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
    }
  };
  const date = make({ month: 'short', day: 'numeric', year: 'numeric' });
  const time = make({ hour: 'numeric', minute: '2-digit' });
  // ICU puts a narrow no-break space before AM/PM, which Roboto lacks; a normal no-break space looks the same.
  // A no-break space keeps "PM" with its time (some ICU versions use U+202F there, which Roboto lacks).
  const tidy = (text: string) => text.replace(/\s(?=[AP]M\b)/g, '\u00A0');
  return {
    date: (iso) => tidy(date.format(new Date(iso))),
    time: (iso) => tidy(time.format(new Date(iso))),
    dateTime: (iso) => `${tidy(date.format(new Date(iso)))}, ${tidy(time.format(new Date(iso)))}`,
  };
}

/** The range's days: "Sep 1, 2026 – Oct 27, 2026", "from Sep 1, 2026", "up to Oct 27, 2026"; null when open. */
export function rangeDays(range: ReportContext['range'], timeZone: string): string | null {
  const { date } = dateFormats(timeZone);
  const from = range.from ? date(range.from) : null;
  const to = range.to ? date(range.to) : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return null;
}

/** "Assignments due Sep 1, 2026 – Oct 27, 2026", "… due from …", "… due up to …" or "All assignments". */
export function rangeText(range: ReportContext['range'], timeZone: string): string {
  const days = rangeDays(range, timeZone);
  return days ? `Assignments due ${days}` : 'All assignments';
}

// --- Statuses -------------------------------------------------------------------------------------------------------

/**
 * Status words, the same in every report. Work waiting to be graded is "To grade" for staff and "Handed in" on
 * student reports (which may go home to families).
 */
export function statusLabel(status: WorkStatus, audience: 'staff' | 'student'): string {
  switch (status) {
    case 'graded':
      return 'Graded';
    case 'handed-in':
      return audience === 'staff' ? 'To grade' : 'Handed in';
    case 'returned':
      return 'Returned';
    case 'missing':
      return 'Missing';
    case 'not-handed-in':
      return 'Not handed in';
  }
}
