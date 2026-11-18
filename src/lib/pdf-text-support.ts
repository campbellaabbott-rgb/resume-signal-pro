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
 * WHAT A RÉSUMÉ EXPORT DRAWS, CLEANED OF WHAT NOBODY CAN SEE (S14X-034).
 *
 * Text pasted from Word, a PDF or a web page carries characters that show
 * nothing: a soft line break (U+000B, Shift+Enter in Word), a zero-width
 * space, a byte-order mark, the one-character "fi" ligature a PDF extracts.
 * Each one alone made the check above refuse the PDF, and U+000B written
 * into a Word file made the file one Word refuses (XML 1.0 forbids it).
 *
 * So, before the check and before either file is drawn:
 *   - NFC, so a letter and its accent are one character;
 *   - the soft breaks (U+000B, U+000C, U+0085, U+2028, U+2029) are line breaks;
 *   - every other control character goes, but tab, newline and return; so do
 *     lone surrogates and U+FFFE/U+FFFF, which no file can hold;
 *   - the invisible format characters go (zero-width space, byte-order mark,
 *     soft hyphen, word joiner), except the two joiners Indic scripts shape
 *     with (U+200C, U+200D), and the direction marks a right-to-left résumé
 *     needs (kept only when it has right-to-left letters);
 *   - the ligatures U+FB00-FB06 are their letters, the Unicode hyphens and
 *     the minus sign are "-", the typographic spaces are spaces (a narrow
 *     no-break space a no-break space), and full-width ASCII is ASCII unless
 *     the résumé is written in a CJK script, where it is the punctuation.
 * NFKC would do some of this, but it also turns the drawable ½ into "1⁄2"
 * (whose fraction slash the fonts cannot draw) and ™ into "TM", so it is not
 * used. What remains undrawable (Ł, ₹, Cyrillic) still goes to the Word file.
 */
const LIGATURES: Record<string, string> = {
  "\uFB00": "ff", "\uFB01": "fi", "\uFB02": "fl", "\uFB03": "ffi", "\uFB04": "ffl", "\uFB05": "st", "\uFB06": "st",
};
const RTL_LETTER = /(?=\p{L})[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const CJK_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DIRECTION_MARK = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const ZWNJ = "\u200C";
const ZWJ = "\u200D";
// eslint-disable-next-line no-control-regex -- the soft breaks a paste carries are what this maps
const SOFT_BREAK = /[\u000B\u000C\u0085\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex -- the control characters no file can hold are what this removes
const UNDRAWABLE_CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

export function sanitizeExportText(text: string): string {
  if (!text) return text ?? "";
  let s = String(text).normalize("NFC");
  const rtl = RTL_LETTER.test(s);
  const cjk = CJK_LETTER.test(s);
  s = s
    .replace(SOFT_BREAK, "\n")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(UNDRAWABLE_CONTROL, "")
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c])
    .replace(/[\u2010\u2011\u2012\u2212]/g, "-")
    .replace(/\u202F/g, "\u00A0")
    .replace(/[\u2000-\u200A\u205F]/g, " ")
    .replace(/\p{Cf}/gu, (c) => (c === ZWNJ || c === ZWJ || (rtl && DIRECTION_MARK.test(c)) ? c : ""));
  if (!cjk) {
    s = s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, " ");
  }
  return s;
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
