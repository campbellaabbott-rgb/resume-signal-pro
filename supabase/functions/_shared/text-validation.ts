// Pure, dependency-free validation helpers shared by parse-pdf and parse-docx.
// No imports on purpose — this lets the exact same file be imported both by the
// Deno edge functions (relative import) and by Node/vitest regression tests, so
// the logic under test is the literal logic running in production, not a copy
// that can silently drift from it.

/**
 * Detects text that "parsed" without throwing but isn't actually readable
 * language — e.g. a wall of mis-decoded glyphs from a broken embedded font.
 * Deliberately language-agnostic (this product accepts resumes in any
 * language, not just the UI's supported locales) — relies on signals that are
 * abnormal in genuinely garbled text regardless of language, rather than
 * checking for specific scripts/character sets that would false-positive on
 * legitimate non-English resumes.
 */
export function looksGarbled(text: string): boolean {
  if (text.length < 40) return false; // Too short to judge either way — handled by a separate length check.

  const replacementCharCount = (text.match(/�/g) || []).length;
  // eslint-disable-next-line no-control-regex -- deliberately detecting raw control bytes as a corruption signal
  const controlCharCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length; // excludes \t \n \r
  const whitespaceCount = (text.match(/\s/g) || []).length;

  const replacementRatio = replacementCharCount / text.length;
  const controlRatio = controlCharCount / text.length;
  const whitespaceRatio = whitespaceCount / text.length;

  // Real decoded text, in any language, essentially never contains the
  // Unicode replacement character or raw control bytes in any volume — these
  // are the highest-confidence, lowest false-positive signals of corruption.
  if (replacementRatio > 0.02) return true;
  if (controlRatio > 0.01) return true;

  // Backstop only: a wall of glued-together garbage typically has almost no
  // whitespace at all. Threshold is deliberately very lenient (not a normal
  // "is this well-formatted" check) so it doesn't trigger on legitimate dense
  // text — resumes in any language still have line breaks from sections,
  // dates, and Latin-script contact info (email, phone) mixed in.
  if (whitespaceRatio < 0.01) return true;

  return false;
}

/**
 * Legacy .doc (pre-2007, OLE Compound File binary format) is not a ZIP at all,
 * so mammoth/JSZip can't read it — it would fail deep inside JSZip with a
 * confusing, generic error instead of a clear "convert to .docx" message.
 * A password-encrypted .docx (Word's "Encrypt with Password") is ALSO wrapped
 * in this same OLE container per the MS-OFFCRYPTO spec, so this check
 * deliberately covers both cases rather than asserting it must be the legacy
 * format specifically.
 */
export function isOleCompoundFile(buffer: ArrayBuffer): boolean {
  const header = new Uint8Array(buffer.slice(0, 4));
  return header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
}
