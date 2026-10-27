// The font the PDF reports are drawn in (the Roboto files pdfmake ships; no other fonts, no network) and which
// characters it can draw.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const font = (file: string) => require.resolve(`pdfmake/fonts/Roboto/${file}`);

/** Roboto as pdfmake ships it; Medium is the bold. */
export const ROBOTO = {
  normal: font('Roboto-Regular.ttf'),
  bold: font('Roboto-Medium.ttf'),
  italics: font('Roboto-Italic.ttf'),
  bolditalics: font('Roboto-MediumItalic.ttf'),
} as const;

/** The part of fontkit (the font reader pdfkit draws with) used here. */
interface FontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

let fonts: FontkitFont[] | null = null;
const known = new Map<number, boolean>();

/** True when every Roboto style has a glyph for `codePoint` (a missing glyph garbles the text around it). */
export function robotoHas(codePoint: number): boolean {
  let has = known.get(codePoint);
  if (has === undefined) {
    if (!fonts) {
      // fontkit is pdfkit's own dependency (pdfmake → pdfkit → fontkit), so it is the copy that draws the PDFs.
      const pdfkit = createRequire(require.resolve('pdfmake')).resolve('pdfkit');
      const fontkit = createRequire(pdfkit)('fontkit') as { openSync(path: string): FontkitFont };
      fonts = Object.values(ROBOTO).map((file) => fontkit.openSync(file));
    }
    has = fonts.every((f) => f.hasGlyphForCodePoint(codePoint));
    known.set(codePoint, has);
  }
  return has;
}
