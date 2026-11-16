/**
 * WHAT A PARSE ANSWER SAYS ABOUT THE FILE, IN THE VISITOR'S LANGUAGE.
 *
 * parse-pdf and parse-docx name the file's own problems with a `code` beside
 * their English `error` (registers S11-033, S11-035): a damaged file, a font
 * whose glyphs map to no letters, and Indic glyphs pdf.js could not name. The
 * page shows these through its translations rather than the server's English.
 *
 * S14X-183: every refusal now carries a code (an empty file, a locked or
 * invalid PDF, too many pages, a scanned PDF, an old or locked Word file, a
 * document with no text, one saved as web content, and the two rate limits),
 * and each is said in the reader's language from the ingestParsers strings.
 * A Word document whose text is garbled gets a title that does not say "PDF".
 * The accepted-with-a-notice answers gain Arabic text pdf.js cannot rebuild
 * (rtl_unreliable) and pages with no text skipped (image_pages_skipped).
 */
type Translate = (key: string, options?: Record<string, unknown>) => string;
type Keys = { title: string; description: string };

const refusal = (name: string): Keys => ({ title: `ingestParsers.refusal.${name}`, description: `ingestParsers.refusal.${name}Description` });

const FAILURE_KEYS: Record<string, Keys> = {
  damaged_file: { title: "homepage.toast.fileDamaged", description: "homepage.toast.fileDamagedDescription" },
  garbled_text: { title: "homepage.toast.fontUnreadable", description: "homepage.toast.fontUnreadableDescription" },
  empty_file: refusal("emptyFile"),
  password_protected: refusal("passwordProtected"),
  invalid_pdf: refusal("invalidPdf"),
  too_many_pages: refusal("tooManyPages"),
  scanned_or_empty: refusal("scannedOrEmpty"),
  legacy_doc_or_encrypted: refusal("legacyDoc"),
  empty_or_too_short: refusal("noText"),
  web_export: refusal("webExport"),
  rate_limited_budget: refusal("rateLimited"),
  rate_limited_function: refusal("rateLimited"),
};

/** Every refusal code the copy knows: the parsers' tests hold each code they send to this list. */
export const PARSE_FAILURE_CODES: readonly string[] = Object.keys(FAILURE_KEYS);

/** The translated toast for a refused upload whose answer names its code, else null. */
export function parseFailureCopy(t: Translate, body: Record<string, unknown> | null | undefined): { title: string; description: string } | null {
  const code = typeof body?.code === "string" ? body.code : "";
  const keys = code === "garbled_text" && body?.file === "docx" ? refusal("docxGarbled") : FAILURE_KEYS[code];
  if (!keys) return null;
  const values = { pages: body?.pages, max: body?.max };
  return { title: t(keys.title), description: t(keys.description, values) };
}

/** The translated notice for an accepted upload that lost or skipped something, else null. */
export function parseNoticeCopy(
  t: Translate,
  data: { notice?: unknown; unreadCharacters?: unknown; skippedPages?: unknown } | null | undefined,
): { title: string; description: string } | null {
  if (data?.notice === "unread_characters") {
    const count = typeof data.unreadCharacters === "number" ? data.unreadCharacters : 0;
    return { title: t("homepage.toast.unreadCharacters"), description: t("homepage.toast.unreadCharactersDescription", { count }) };
  }
  if (data?.notice === "rtl_unreliable") {
    return { title: t("ingestParsers.notice.rtlUnreliable"), description: t("ingestParsers.notice.rtlUnreliableDescription") };
  }
  if (data?.notice === "image_pages_skipped") {
    const pages = typeof data.skippedPages === "number" ? data.skippedPages : 0;
    return { title: t("ingestParsers.notice.imagePagesSkipped"), description: t("ingestParsers.notice.imagePagesSkippedDescription", { pages }) };
  }
  return null;
}
