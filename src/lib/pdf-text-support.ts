// jsPDF's built-in fonts (helvetica, times, courier) use WinAnsiEncoding
// (Windows-1252): ASCII, the Latin-1 Supplement (é, ñ, ü) and 27 more
// characters in 0x80-0x9F, and nothing else. Polish, Czech, Hungarian,
// Turkish and Romanian letters (Ł, ő, ğ, ș), the rupee sign, arrows, and every
// non-Latin script (Cyrillic, Devanagari, CJK) come out as letter-spaced
// garbage or blanks. Callers check here first, and draw another way (a Word
// file, the browser's own print-to-PDF) instead of producing that garbage.

// THE REAL TABLE (S12-006). The old list held eight of the 27 characters
// Windows-1252 adds above Latin-1, so text with €, „, œ or Š (which draw
// fine) raised the "may not display" warning, while the check itself still
// let nothing through that it should not. These are all 27.
const WINANSI_ABOVE_LATIN1 = new Set([
  "€", "‚", "ƒ", "„", "…", "†", "‡", "ˆ", "‰", "Š", "‹", "Œ", "Ž",
  "‘", "’", "“", "”", "•", "–", "—", "˜", "™", "š", "›", "œ", "ž", "Ÿ",
]);

/** True when jsPDF's built-in fonts can draw this one character. */
export function pdfCanDraw(char: string): boolean {
  const cp = char.codePointAt(0)!;
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return true;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return WINANSI_ABOVE_LATIN1.has(char);
}

/** The distinct characters in `text` the built-in fonts cannot draw, in order of first appearance. */
export function unsupportedPdfCharacters(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const char of text ?? "") {
    if (!pdfCanDraw(char) && !seen.has(char)) {
      seen.add(char);
      out.push(char);
    }
  }
  return out;
}

/**
 * Returns true if any character in the text falls outside what jsPDF's
 * standard fonts can render (Windows-1252).
 */
export function hasUnsupportedPdfCharacters(text: string): boolean {
  for (const char of text ?? "") {
    if (!pdfCanDraw(char)) return true;
  }
  return false;
}

/**
 * Checks an arbitrary set of text fields at once (e.g. every section of a
 * generated report) and returns true if any of them contain characters
 * outside jsPDF's supported range.
 */
export function anyFieldHasUnsupportedPdfCharacters(fields: Array<string | undefined | null>): boolean {
  return fields.some((field) => !!field && hasUnsupportedPdfCharacters(field));
}
