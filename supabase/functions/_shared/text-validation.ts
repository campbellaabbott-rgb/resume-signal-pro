// Pure validation helpers for parse-pdf, parse-docx and the page's .txt
// reader. No imports, so Deno, the browser and vitest run this very file.

/**
 * Text that parsed without throwing but is not readable language: a wall of
 * glyphs from a broken embedded font. Language-agnostic on purpose (résumés
 * come in any language): it reads only signals that are abnormal in garbled
 * text whatever the script.
 */
export function looksGarbled(text: string): boolean {
  if (text.length < 40) return false; // Too short to judge; the length check handles it.

  const replacementCharCount = (text.match(/\uFFFD/g) || []).length;
  // eslint-disable-next-line no-control-regex -- deliberately detecting raw control bytes as a corruption signal
  const controlCharCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length; // excludes \t \n \r
  const whitespaceCount = (text.match(/\s/g) || []).length;

  // Replacement characters and raw control bytes: the surest signs.
  if (replacementCharCount / text.length > 0.02) return true;
  if (controlCharCount / text.length > 0.01) return true;

  // Backstop, deliberately lenient: glued garbage has almost no whitespace,
  // while a résumé in any script has line breaks, dates and contact details.
  if (whitespaceCount / text.length < 0.01) return true;

  return false;
}

/**
 * The same text at intake (C-S14-129): the hyphens Word and PDFs write as
 * U+2010-U+2012 are "-", soft hyphens and zero-width marks go, and a word a
 * line break split after its hyphen ("cross-" / "functional") is one word
 * again, so a keyword is found however the file spelled it.
 */
export function normalizeIntakeText(text: string): string {
  return text.replace(/[\u2010-\u2012]/g, "-").replace(/[\u00AD\u200B\u2060\uFEFF]/g, "").replace(/(\p{L})-\r?\n(?=\p{Ll})/gu, "$1-");
}

/**
 * A BROKEN FILE IS NOT AN OUTAGE (S11-033): the error names pdf.js gives a
 * damaged stream, page tree or cross-reference table (a worker-side
 * FormatError arrives as UnknownErrorException) are a 422 about the file;
 * anything else is ours, a 500. Names, never `instanceof`: pdfjs-serverless
 * does not export the classes.
 */
const DAMAGED_PDF_ERRORS = new Set([
  "InvalidPDFException",
  "MissingPDFException",
  "FormatError",
  "UnknownErrorException",
  "UnexpectedResponseException",
]);

export function isDamagedPdfError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && DAMAGED_PDF_ERRORS.has(name);
}

/**
 * An OLE compound file: a legacy .doc, or a password-encrypted .docx (Word
 * wraps those in the same container, MS-OFFCRYPTO). Neither is a zip mammoth
 * can open, so the caller names both.
 */
export function isOleCompoundFile(buffer: ArrayBuffer): boolean {
  const header = new Uint8Array(buffer.slice(0, 4));
  return header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
}
