// WHAT THE TERMS WE READ SAY ABOUT EACH ROW (API4, owner 2026-11-18).
//
// /v1 hands on every source it does not withhold. The legal ledger of
// 2026-11-16 read each hiring system's robots file and terms; the API4
// program takes five of them as permissive. Every other carried source is
// conditional: our use carries a condition or an open question (counsel,
// pacing, terms we could not read, an access route that is ending). USAJOBS
// read as open but is withheld by owner decision, and a withheld system is
// never on the permissive list. So each row says which kind it is, under a
// name that claims no more than that:
//
//   sourceTerms "permissive"   the terms we read permit our use or say nothing
//   sourceTerms "conditional"  our use carries a condition or an open question
//
// "permissive" is not a grant of republication rights. Counsel item
// OD17(viii) (employers' copyright in description text, EU database right)
// is open even for these five, so this module never says "clear" or
// "licensed".
//
// TRAINING. Three carried systems publish a content signal that says their
// pages must never be used to train a model: Workable and Teamtailor, both
// permissive, and Lever, whose posting host declares the same signal although
// Lever itself is conditional. The two questions are separate, so the barred
// list is not a subset of the permissive one, and a Lever row answers
// conditional with aiTrain false. Rows from all three carry aiTrain false.
// Every other row carries aiTrain null: we read no training signal from that
// source, which is NOT permission, so no row ever says true.
//
// ONE LIST, TWO RUNTIMES. src/config/source-terms.ts is the frontend's copy
// (a page cannot import a Deno module) and the test
// the-source-terms-are-one-list-in-both-runtimes holds the two equal by value
// and by behaviour. no-permissive-source-is-withheld holds this list apart
// from every withheld list the API, the connector and the site use today.
//
// This file imports nothing, so later lanes can copy it byte for byte into
// another function's folder (no function imports another's directory, and
// nothing new goes under _shared).

/** Systems whose terms, as read on 2026-11-16, permit our use or say nothing to a reader. */
export const PERMISSIVE_SOURCES = ["greenhouse", "workable", "ashby", "teamtailor", "personio"] as const;

/** Systems whose published content signal forbids using their pages to train a model, permissive or not. */
export const AI_TRAIN_BARRED = ["workable", "teamtailor", "lever"] as const;

/** The two answers a row can carry, in the order the API documents them. */
export const SOURCE_TERMS = ["permissive", "conditional"] as const;
export type SourceTerms = (typeof SOURCE_TERMS)[number];

/** What every row carries. aiTrain is false (barred) or null (no signal read); never true. */
export type RowSourceTerms = { sourceTerms: SourceTerms; aiTrain: false | null };

/** The wording the API and its docs use for each answer. One sentence each. */
export const SOURCE_TERMS_MEANING = {
  permissive: "The hiring system's terms, as we read them, permit this use or say nothing to readers. This is not a grant of republication rights.",
  conditional: "Our use of this hiring system carries a condition or an open question (counsel, pacing or terms we could not read).",
  aiTrainFalse: "The hiring system publishes a signal that its pages must never be used to train a model.",
  aiTrainNull: "We read no training signal from this hiring system. That is not permission to train.",
} as const;

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** The terms a row from `source` carries. Unknown or empty sources are conditional. */
export function sourceTermsOf(source: unknown): RowSourceTerms {
  const s = norm(source);
  return {
    sourceTerms: (PERMISSIVE_SOURCES as readonly string[]).includes(s) ? "permissive" : "conditional",
    aiTrain: (AI_TRAIN_BARRED as readonly string[]).includes(s) ? false : null,
  };
}

/** The credit every /v1 body carries in meta.attribution. The API is free with attribution. */
export const ATTRIBUTION: Readonly<{ text: string; url: string; required: true }> = Object.freeze({
  text: "Job data from Resume Booster (resumebooster.work)",
  url: "https://resumebooster.work",
  required: true,
});
