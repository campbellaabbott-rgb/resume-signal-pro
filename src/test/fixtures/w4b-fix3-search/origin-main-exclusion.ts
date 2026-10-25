// origin/main's search exclusion, frozen: the text of
// supabase/functions/job-board/search-routing.ts at origin/main ef4fb53e,
// from the "engineer not manager" note to the end of the file, byte for byte
// (the file's last change on main was 54e0023d). Wave 4 ships exactly this
// code after the descope of 2026-10-25, and the tests that import this file
// prove it: the shipped file's exclusion section must equal the section
// below, and the two must answer every corpus query and title alike. Do not
// edit the code below; a new exclusion rule is its own project and is
// measured against this one.

/**
 * "engineer not manager" WAS RETURNING MANAGERS.
 *
 * The words were dropped from the tsquery and the remainder re-read as a
 * conjunction, so the query came back as roughly "engineer manager" — the exact
 * opposite of what was asked. "nurse -travel" and "driver not cdl" are the same
 * shape, and they are ordinary refinements a searcher reaches for the moment a
 * result set is nearly right.
 *
 * Split BEFORE any SQL is issued, so every tier — ranked, routed, fuzzy,
 * semantic — searches the positive query and none of them has to know this
 * exists. The exclusion is then applied to what comes back.
 *
 * TWO FORMS, both common and neither ambiguous:
 *   "-token"    a leading hyphen, the convention every search engine uses
 *   "not X"     the ONE token after the word "not", which reads as English
 *
 * ONE TOKEN, not the remainder. "not" used to claim everything after it, and
 * "director not for profit" — a search FOR nonprofit titles — came back as
 * excluded:["for","profit"]: it struck the exact titles asked for AND every
 * title containing the word "for". And when the token after "not" is a
 * stopword, the "not" is the English word inside a phrase, not an operator at
 * all, so both words stay in the positive query.
 *
 * A bare "not" with nothing after it, or a query that is ONLY exclusions, is
 * left alone: stripping it would leave an empty query, and an empty query
 * returns the whole board — "better to run the poor query the person typed
 * than to silently ignore them", as the note above queryTerms puts it.
 */

/** Stopword-grade words that must never become an exclusion. A "not" followed
 *  by one of these is part of a phrase ("not for profit"), and excluding a
 *  stopword strikes half the board by coincidence of grammar. */
const EXCLUSION_STOPWORDS: ReadonlySet<string> = new Set([
  "for", "the", "a", "an", "of", "in", "at", "to", "on",
]);

export function splitExclusions(raw: string): { positive: string; excluded: string[] } {
  const text = String(raw ?? "").trim();
  if (!text) return { positive: text, excluded: [] };

  const words = text.split(/\s+/);
  const positive: string[] = [];
  const excluded: string[] = [];
  let pendingNot: string | null = null;
  for (const w of words) {
    if (pendingNot !== null) {
      // "not" marks exactly this one token — never the whole remainder — and
      // a stopword-grade token vetoes the operator reading entirely.
      if (EXCLUSION_STOPWORDS.has(w.toLowerCase())) positive.push(pendingNot, w);
      else excluded.push(w.toLowerCase());
      pendingNot = null;
      continue;
    }
    if (/^not$/i.test(w)) { pendingNot = w; continue; }
    if (w.length > 1 && w.startsWith("-")) { excluded.push(w.slice(1).toLowerCase()); continue; }
    positive.push(w);
  }
  const cleanExcluded = [...new Set(excluded.map((e) => e.replace(/[^a-z0-9+#.]/gi, "").toLowerCase()).filter((e) => e.length >= 2))];
  // Nothing left to search means the exclusion has eaten the query. Run what
  // they typed instead of returning the entire board.
  if (!positive.length || !cleanExcluded.length) return { positive: text, excluded: [] };
  return { positive: positive.join(" "), excluded: cleanExcluded };
}

/** Does a title contain any excluded term? Word-ish match, so "manager" does
 *  not strike out "management-adjacent" by coincidence of substring. */
export function titleExcluded(title: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const t = String(title ?? "").toLowerCase();
  return excluded.some((e) => new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(t));
}
