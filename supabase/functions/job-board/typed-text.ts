/**
 * ONE APOSTROPHE (S11-021).
 *
 * Location is matched with a literal ILIKE and the title ring with a prefix
 * ILIKE, and neither folded the curly apostrophe a phone types: iPhone smart
 * punctuation turns "St. John's" into "St. John’s" (U+2019), which matched 0
 * live postings against 101. Stored rows are mostly ASCII (4,671 locations
 * with "'" against 89 with U+2019, read 2026-10-11), so a search folds its
 * typed text to the ASCII apostrophe, and ingest folds what it stores so the
 * two never disagree again.
 *
 * Accents are not folded here: an unaccented search reaching an accented
 * posting needs the database to compare unaccented text (title_tsv and a
 * location index rebuilt), which is a table rewrite the owner schedules.
 */
const APOSTROPHE_LIKE = "‘’‛ʼ＇";
const ANY_APOSTROPHE = new RegExp(`[${APOSTROPHE_LIKE}]`, "g");
const HAS_APOSTROPHE = new RegExp(`[${APOSTROPHE_LIKE}]`);

/** Every apostrophe-like character as the ASCII one. */
export function foldApostrophes(s: string): string {
  return s.replace(ANY_APOSTROPHE, "'");
}

/** True when two texts differ only in which apostrophe they use. */
export function sameButApostrophes(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === b) return false;
  return foldApostrophes(a) === foldApostrophes(b);
}

/** A list request with its typed search text folded: q and location. */
export function foldTypedText<T extends Record<string, unknown>>(body: T): T {
  let out = body;
  for (const k of ["q", "location"] as const) {
    const v = body[k];
    if (typeof v === "string" && HAS_APOSTROPHE.test(v)) out = { ...out, [k]: foldApostrophes(v) };
  }
  return out;
}
