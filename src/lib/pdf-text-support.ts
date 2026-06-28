// jsPDF's built-in fonts (helvetica, times, courier) use WinAnsiEncoding, which
// covers ASCII plus the Latin-1 Supplement (Western European accented
// characters like é, ñ, ü) but nothing beyond — Cyrillic, Arabic, Devanagari,
// CJK, etc. all render as blank boxes or missing glyphs. Properly fixing this
// means embedding a full Unicode font (several hundred KB), which is a real
// feature investment, not a one-line fix. Until that's built, this detects
// the problem so callers can warn the user clearly instead of silently
// producing a PDF with missing text and no explanation.

// WinAnsiEncoding (Windows-1252) includes a handful of common typographic
// characters above the Latin-1 range — em/en dash, curly quotes, ellipsis,
// bullet, trademark — that jsPDF's standard fonts render just fine despite
// their Unicode codepoints being > 0xFF. Without this allowlist, ordinary
// AI-generated text using an em dash would get flagged as "unsupported"
// alongside genuinely unrenderable scripts, which would make the warning
// fire constantly and lose all signal.
const WINANSI_EXTRA_CHARS = new Set([
  "–", "—", // en dash, em dash
  "‘", "’", // left/right single quote
  "“", "”", // left/right double quote
  "•", // bullet
  "…", // ellipsis
  "™", // trademark
]);

/**
 * Returns true if any character in the text falls outside the range jsPDF's
 * standard fonts can render (Latin-1 plus the WinAnsi-extra set above).
 */
export function hasUnsupportedPdfCharacters(text: string): boolean {
  for (const char of text) {
    if (char.codePointAt(0)! > 0xff && !WINANSI_EXTRA_CHARS.has(char)) return true;
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
