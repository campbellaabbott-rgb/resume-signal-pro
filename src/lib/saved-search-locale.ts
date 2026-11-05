/**
 * THE LANGUAGE A SAVED SEARCH'S DIGEST IS WRITTEN IN (S13-102).
 *
 * The digest runs on a schedule with no request in hand, so it reads
 * user_job_searches.locale (20261103240000). The site's language is what the
 * reader reads, and only the page knows it: a browser's own preference says
 * nothing about someone who chose English on a German browser. So every write
 * the owner's page makes to a saved search carries the page's language.
 *
 * The page publishes ahead of the migration, and a database without the column
 * refuses a write that names it (PGRST204). A refusal that names the language
 * goes again without it: a search saves, and its mail switches on, whatever the
 * rollout's state. Until then, and for a row no such page has written, the
 * column stays NULL, which the digest reads as English, as it always did.
 */

/** user_job_searches_locale_known: fr-CA is written as fr, as the mail tables are. */
const DIGEST_LANGUAGES: ReadonlySet<string> = new Set(["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]);

export function digestLocaleOf(language: string | null | undefined): string | null {
  const tag = String(language ?? "").trim();
  if (DIGEST_LANGUAGES.has(tag)) return tag;
  const base = tag.split(/[-_]/)[0].toLowerCase();
  return DIGEST_LANGUAGES.has(base) ? base : null;
}

type Refusable = { error?: { message?: string; code?: string } | null } | null | undefined;

/** Runs `write` with the language beside its row, and once more without it if the database refuses that. */
export async function writeWithDigestLocale<R extends Refusable>(
  language: string | null | undefined,
  write: (locale: { locale?: string }) => PromiseLike<R>,
): Promise<R> {
  const locale = digestLocaleOf(language);
  if (!locale) return write({});
  const first = await write({ locale });
  return first?.error && /locale/.test(first.error.message ?? "") ? write({}) : first;
}
