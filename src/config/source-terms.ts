// WHAT THE TERMS WE READ SAY ABOUT EACH ROW, MIRRORED FOR THE SITE.
//
// The authority is supabase/functions/public-api/source-terms.ts (Deno),
// which every /v1 row is labelled from. A page cannot import a Deno module, so
// this is its copy, and a copy is exactly what drifts (project_claim_drift):
// the data-API docs, the embed builder and the open-data page will each say
// which systems are permissive and which may never train a model, and a page
// that names a system the API labels otherwise is a false statement about
// what a builder may do with the rows.
//
// src/test/the-source-terms-are-one-list-in-both-runtimes.test.ts holds this
// file equal to the Deno one, list by list and answer by answer, and
// src/test/no-permissive-source-is-withheld.test.ts holds both apart from
// every withheld list in use today. Change both files together or neither.

/** Systems whose publisher's own terms, as read on 2026-11-16, license reuse of the data outright: redistribution included, no prior approval. */
export const LICENSED_SOURCES = ["usajobs"] as const;

/** Systems whose terms, as read on 2026-11-16, permit our use or say nothing to a reader. */
export const PERMISSIVE_SOURCES = ["greenhouse", "workable", "ashby", "teamtailor", "personio"] as const;

/** Systems whose published content signal forbids using their pages to train a model, permissive or not. */
export const AI_TRAIN_BARRED = ["workable", "teamtailor", "lever"] as const;

/** The three answers a row can carry, in the order the API documents them. */
export const SOURCE_TERMS = ["licensed", "permissive", "conditional"] as const;
export type SourceTerms = (typeof SOURCE_TERMS)[number];

/** What every row carries. aiTrain is false (barred) or null (no signal read); never true. */
export type RowSourceTerms = { sourceTerms: SourceTerms; aiTrain: false | null };

/** The wording the API and its docs use for each answer. One sentence each. */
export const SOURCE_TERMS_MEANING = {
  licensed: "The publisher's own terms license reuse of this public data, redistribution included, without prior approval, under the conditions each row carries. Fields we add (our categories, parsed pay and closed status) are ours, not the publisher's.",
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
    sourceTerms: (LICENSED_SOURCES as readonly string[]).includes(s)
      ? "licensed"
      : (PERMISSIVE_SOURCES as readonly string[]).includes(s) ? "permissive" : "conditional",
    aiTrain: (AI_TRAIN_BARRED as readonly string[]).includes(s) ? false : null,
  };
}

/** The credit every /v1 body carries in meta.attribution. The API is free with attribution. */
export const ATTRIBUTION: Readonly<{ text: string; url: string; required: true }> = Object.freeze({
  text: "Job data from Resume Booster (resumebooster.work)",
  url: "https://resumebooster.work",
  required: true,
});
