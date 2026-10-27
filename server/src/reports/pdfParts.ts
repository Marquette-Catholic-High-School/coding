// Building blocks shared by every PDF report: colours, page frame, header and footer, title block, stat boxes,
// tables and the notes box. pdf.ts lays the reports out from these. Every string from users goes through
// `userText` (format.ts) before it gets here, and is only ever drawn as plain text.

import type { PaperSize } from '@codeclass/shared';
import type {
  Content,
  ContentCanvas,
  ContentStack,
  ContentTable,
  ContentText,
  CustomTableLayout,
  DynamicContent,
  Size,
  TableCell,
} from 'pdfmake/interfaces';
import { truncate } from './format';

/**
 * The only colours in the PDFs. Everything must read in grayscale too: statuses are words (Missing is bold, Late
 * italic), and colour is just an accent on top.
 */
export const COLORS = {
  ink: '#1F2933',
  muted: '#52606D',
  faint: '#7B8794',
  rule: '#DDE2E7',
  headerRule: '#9AA5B1',
  headerFill: '#EEF2F5',
  zebra: '#F7F9FA',
  panel: '#F2F5F7',
  /** CodeClass green (the web app's brand shade 8). */
  accent: '#168047',
  missing: '#B42318',
  late: '#A15C07',
} as const;

export const FONT_SIZE = {
  body: 9,
  table: 8.5,
  grid: 8,
  tableHeader: 7.5,
  small: 7.5,
  tiny: 6.5,
} as const;

/** Left, top, right, bottom: the header and footer are drawn inside the top and bottom margins. */
export const PAGE_MARGINS: [number, number, number, number] = [40, 58, 40, 50];
const [MARGIN_LEFT, , MARGIN_RIGHT] = PAGE_MARGINS;

const PAPER: Record<PaperSize, { name: 'LETTER' | 'A4'; width: number; height: number }> = {
  letter: { name: 'LETTER', width: 612, height: 792 },
  a4: { name: 'A4', width: 595.28, height: 841.89 },
};

export interface PageFrame {
  pageSize: 'LETTER' | 'A4';
  orientation: 'portrait' | 'landscape';
  /** Width available to content (page width less the side margins). */
  contentWidth: number;
}

export function pageFrame(paper: PaperSize, orientation: PageFrame['orientation']): PageFrame {
  const size = PAPER[paper];
  const width = orientation === 'portrait' ? size.width : size.height;
  return { pageSize: size.name, orientation, contentWidth: width - MARGIN_LEFT - MARGIN_RIGHT };
}

/** Roughly how many characters of `fontSize` text fit in `width` (generous, so wide letters still fit). */
export function charsThatFit(width: number, fontSize: number): number {
  return Math.max(8, Math.floor(width / (fontSize * 0.58)));
}

// --- Header and footer ----------------------------------------------------------------------------------------------

function rule(width: number, color: string = COLORS.rule, lineWidth = 0.6): ContentCanvas {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth, lineColor: color }] };
}

/** "CodeClass" left, `title · scope` right (one line, cut to fit), thin rule under it. */
export function pageHeader(title: string, scope: string | null): DynamicContent {
  return (_page, _count, pageSize) => {
    const width = pageSize.width - MARGIN_LEFT - MARGIN_RIGHT;
    const maxChars = charsThatFit(width - 80, 8);
    const right = scope ? `${title} · ${scope}` : title;
    return {
      margin: [MARGIN_LEFT, 24, MARGIN_RIGHT, 0],
      stack: [
        {
          columns: [
            { width: 'auto', text: 'CodeClass', bold: true, fontSize: 10, color: COLORS.accent },
            {
              width: '*',
              text: truncate(right, maxChars),
              alignment: 'right',
              fontSize: 8,
              color: COLORS.muted,
              margin: [0, 1.5, 0, 0],
            },
          ],
          columnGap: 16,
        },
        { ...rule(width), margin: [0, 5, 0, 0] },
      ],
    };
  };
}

/** "Generated … by …" and the privacy note left, the page number right. */
export function pageFooter(generated: string, pageLabel: (page: number, count: number) => string): DynamicContent {
  return (page, count, pageSize) => {
    const width = pageSize.width - MARGIN_LEFT - MARGIN_RIGHT;
    return {
      margin: [MARGIN_LEFT, 12, MARGIN_RIGHT, 0],
      fontSize: FONT_SIZE.small,
      color: COLORS.muted,
      stack: [
        rule(width),
        {
          margin: [0, 5, 0, 0],
          columns: [
            {
              width: '*',
              stack: [
                generated,
                { text: 'Contains student information — keep it private.', color: COLORS.faint, margin: [0, 1, 0, 0] },
              ],
            },
            { width: 'auto', text: pageLabel(page, count), alignment: 'right' },
          ],
          columnGap: 16,
        },
      ],
    };
  };
}

// --- Title block and stat boxes -------------------------------------------------------------------------------------

/** First-page title: the report's name, what it covers, then smaller detail lines (date range, notes). */
export function titleBlock(title: string, scope: string, details: string[]): Content {
  return {
    margin: [0, 0, 0, 14],
    stack: [
      { text: title, fontSize: 18, bold: true, color: COLORS.ink },
      { text: scope, fontSize: 12, color: COLORS.ink, margin: [0, 4, 0, 0] },
      ...details.map((line): Content => ({ text: line, fontSize: FONT_SIZE.body, color: COLORS.muted, margin: [0, 3, 0, 0] })),
    ],
  };
}

export interface Stat {
  label: string;
  value: string;
  /** Small line under the value, e.g. "412 of 450". */
  detail?: string;
  /** Colours the value when it is worth attention (a non-zero Missing or Late count). */
  tone?: 'missing' | 'late';
}

const GAP = 6;

/** A row of equal boxes: small grey label, large value, optional detail line. */
export function statBoxes(stats: Stat[]): ContentTable {
  const layout: CustomTableLayout = {
    hLineWidth: () => 0,
    // White vertical lines make the gaps between the boxes.
    vLineWidth: (i, node) => (i === 0 || i === node.table.widths!.length ? 0 : GAP),
    vLineColor: () => '#FFFFFF',
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 7,
    paddingBottom: () => 7,
    fillColor: () => COLORS.panel,
  };
  return {
    margin: [0, 0, 0, 4],
    unbreakable: true,
    layout,
    table: {
      widths: stats.map(() => '*'),
      body: [
        stats.map(
          (stat): TableCell => ({
            stack: [
              { text: stat.label.toUpperCase(), fontSize: FONT_SIZE.tiny, bold: true, characterSpacing: 0.4, color: COLORS.muted },
              {
                text: stat.value,
                fontSize: 15,
                bold: true,
                margin: [0, 3, 0, 0],
                color: stat.tone ? COLORS[stat.tone] : COLORS.ink,
              },
              { text: stat.detail ?? ' ', fontSize: FONT_SIZE.small, color: COLORS.muted, margin: [0, 1, 0, 0] },
            ],
          }),
        ),
      ],
    },
  };
}

// --- Tables ---------------------------------------------------------------------------------------------------------

export type Cell = string | ContentText | ContentStack;

export interface Column<T> {
  /** Plain text gets the standard header style; a stack is used as it is (e.g. the grade grid's richer headers). */
  header: string | ContentStack;
  width: Size;
  /** Numbers are right-aligned. */
  align?: 'left' | 'right' | 'center';
  cell(row: T): Cell;
}

export interface Heading {
  title: string;
  /** A smaller line under the title (counts, a legend). */
  detail?: string | ContentText;
}

/** A section heading (also used as the first row of a table so it repeats on every page the table runs onto). */
export function heading({ title, detail }: Heading): ContentStack {
  return {
    stack: [
      { text: title, fontSize: 12, bold: true, color: COLORS.ink },
      ...(detail === undefined
        ? []
        : [
            typeof detail === 'string'
              ? { text: detail, fontSize: FONT_SIZE.small + 0.5, color: COLORS.muted, margin: [0, 2, 0, 0] as [number, number, number, number] }
              : { fontSize: FONT_SIZE.small + 0.5, color: COLORS.muted, margin: [0, 2, 0, 0] as [number, number, number, number], ...detail },
          ]),
    ],
  };
}

function aligned(cell: Cell, align: Column<unknown>['align']): TableCell {
  if (!align || align === 'left') return cell;
  return typeof cell === 'string' ? { text: cell, alignment: align } : { alignment: align, ...cell };
}

/**
 * A data table: optional heading row, column headers (both repeated on every page), rows that never split across
 * pages, light zebra striping and thin grey rules.
 */
export function dataTable<T>(options: {
  heading?: Heading;
  columns: Column<T>[];
  rows: readonly T[];
  fontSize?: number;
  marginTop?: number;
}): ContentTable {
  const { columns, rows } = options;
  const body: TableCell[][] = [];
  if (options.heading) {
    body.push([
      { ...heading(options.heading), colSpan: columns.length, margin: [-4, 0, 0, 0] },
      ...columns.slice(1).map((): TableCell => ({})),
    ]);
  }
  body.push(
    columns.map(
      (column): TableCell =>
        typeof column.header === 'string'
          ? {
              text: column.header,
              bold: true,
              fontSize: FONT_SIZE.tableHeader,
              color: COLORS.muted,
              alignment: column.align ?? 'left',
            }
          : column.header,
    ),
  );
  for (const row of rows) body.push(columns.map((column) => aligned(column.cell(row), column.align)));
  const headerRows = options.heading ? 2 : 1;
  return {
    margin: [0, options.marginTop ?? 18, 0, 0],
    fontSize: options.fontSize ?? FONT_SIZE.table,
    color: COLORS.ink,
    layout: tableLayout(headerRows, Boolean(options.heading)),
    table: {
      headerRows,
      // Keep the headings with the first few rows (no heading stranded at the bottom of a page with one row).
      keepWithHeaderRows: 3,
      dontBreakRows: true,
      widths: columns.map((column) => column.width),
      body,
    },
  };
}

function tableLayout(headerRows: number, hasHeading: boolean): CustomTableLayout {
  const columnHeaderRow = headerRows - 1;
  return {
    // Line index i is the line above row i.
    hLineWidth: (i, node) => {
      if (i <= columnHeaderRow) return 0;
      if (i === headerRows) return 0.8;
      return i === node.table.body.length ? 0.8 : 0.4;
    },
    hLineColor: (i, node) => (i === headerRows || i === node.table.body.length ? COLORS.headerRule : COLORS.rule),
    vLineWidth: () => 0,
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: (i) => (hasHeading && i === 0 ? 0 : 3),
    paddingBottom: (i) => (hasHeading && i === 0 ? 6 : 3),
    fillColor: (i) => {
      if (i === columnHeaderRow) return COLORS.headerFill;
      if (i >= headerRows && (i - headerRows) % 2 === 1) return COLORS.zebra;
      return null;
    },
  };
}

/** A heading followed by a sentence, kept together (used instead of an empty table). */
export function emptySection(title: Heading, sentence: string, marginTop = 18): ContentStack {
  return {
    margin: [0, marginTop, 0, 0],
    unbreakable: true,
    stack: [heading(title), { text: sentence, fontSize: FONT_SIZE.body, color: COLORS.muted, italics: true, margin: [0, 6, 0, 0] }],
  };
}

/** "About this report": the counting rules in plain words, in a light panel that never splits across pages. */
export function notesBox(items: string[], title = 'About this report'): ContentTable {
  return {
    margin: [0, 16, 0, 0],
    unbreakable: true,
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 10,
      paddingRight: () => 10,
      paddingTop: () => 8,
      paddingBottom: () => 9,
      fillColor: () => COLORS.panel,
    },
    table: {
      widths: ['*'],
      dontBreakRows: true,
      body: [
        [
          {
            stack: [
              { text: title, bold: true, fontSize: FONT_SIZE.body, color: COLORS.ink },
              {
                ul: items,
                fontSize: FONT_SIZE.small + 0.5,
                color: COLORS.muted,
                markerColor: COLORS.faint,
                margin: [0, 4, 0, 0],
              },
            ],
          },
        ],
      ],
    },
  };
}

/** Inline text styles for statuses (always words; colour is only an accent). */
export const STATUS_STYLE = {
  missing: { bold: true, color: COLORS.missing },
  late: { italics: true, bold: true, color: COLORS.late },
  quiet: { italics: true, color: COLORS.muted },
  none: { color: COLORS.faint },
} as const;
