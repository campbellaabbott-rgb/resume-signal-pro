/**
 * WHAT A PARSE ANSWER SAYS ABOUT THE FILE, IN THE VISITOR'S LANGUAGE.
 *
 * parse-pdf and parse-docx name the file's own problems with a `code` beside
 * their English `error` (registers S11-033, S11-035): a damaged file, a font
 * whose glyphs map to no letters, and Indic glyphs pdf.js could not name. The
 * page shows these through its translations rather than the server's English.
 */
type Translate = (key: string, options?: Record<string, unknown>) => string;

const FAILURE_KEYS: Record<string, { title: string; description: string }> = {
  damaged_file: { title: "homepage.toast.fileDamaged", description: "homepage.toast.fileDamagedDescription" },
  garbled_text: { title: "homepage.toast.fontUnreadable", description: "homepage.toast.fontUnreadableDescription" },
};

/** The translated toast for a refused upload whose answer names its code, else null. */
export function parseFailureCopy(t: Translate, body: Record<string, unknown> | null | undefined): { title: string; description: string } | null {
  const code = typeof body?.code === "string" ? body.code : "";
  const keys = FAILURE_KEYS[code];
  return keys ? { title: t(keys.title), description: t(keys.description) } : null;
}

/** The translated notice for an accepted upload that lost characters, else null. */
export function parseNoticeCopy(t: Translate, data: { notice?: unknown; unreadCharacters?: unknown } | null | undefined): { title: string; description: string } | null {
  if (data?.notice !== "unread_characters") return null;
  const count = typeof data.unreadCharacters === "number" ? data.unreadCharacters : 0;
  return { title: t("homepage.toast.unreadCharacters"), description: t("homepage.toast.unreadCharactersDescription", { count }) };
}
