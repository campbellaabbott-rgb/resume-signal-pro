// One normalisation for every board filter, shared by the gate, the row query,
// the count and the response self-check.
//
// WHY THIS FILE EXISTS
// Every filter defect this board has shipped has had the same shape: two places
// computed the "same" filter differently, and the disagreement was invisible
// until somebody counted rows.
//
//   * category="Engineering" satisfied the `unfiltered` test (which compared the
//     RAW casing) while the query lower-cased it. The board concluded no count
//     was needed and published the whole catalogue's total — 587,793 — above
//     3,949 correctly filtered results.
//
//   * experience=["bogus"] met a gate that only inspected
//     `typeof body.experience === "string"`, so an array was never examined and
//     never reported. The query then evaluated
//     String(["bogus"]).split(",").filter(isExperienceBand) -> [] and bound NO
//     predicate at all. Measured live on 2026-07-29, before this file existed:
//     the returned bands were null 15 / entry 12 / mid 8 / senior 4 / expert 1.
//     That is the unfiltered board, served as though the filter had applied,
//     with an empty ignoredFilters. The fence in this codebase is that a filter
//     is NEVER silently ignored; that was a direct breach, and it survived the
//     morning's fix precisely because that fix patched the string path only.
//
// THE RULE ENCODED HERE
// A filter is REQUESTED when the caller sends anything non-empty for it, and
// APPLIED only when normalisation yields a value the query can bind. Requested
// but not applied is ALWAYS named back to the caller.
//
// The point is not that this validation is cleverer. It is that the gate, the
// query, the count and the self-check now read the SAME `applied` object — so
// they cannot drift apart, not because four sites were each remembered, but
// because there is only one site.
import { JOB_CATEGORIES } from "./categories.ts";
import { isExperienceBand } from "./experience.ts";

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;

export type AppliedFilters = {
  q: string;
  location: string;
  country: string | null;
  remote: boolean;
  workMode: string | null;
  category: string | null;
  experience: string[];
  salaryFloor: number | null;
  companies: string[];
  maxAgeDays: number | null;
  postedAfter: string | null;
};

export type NormalizedFilters = { applied: AppliedFilters; ignored: string[] };

// Accepts both shapes clients actually send: an array (["senior"]) and a comma
// string ("senior,expert"). The previous code leaned on String(["a","b"])
// happening to join with a comma — true, but accidental, and it collapsed a
// single bad member to [] with no signal.
const asBands = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const sent = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";

export function normalizeFilters(
  body: Record<string, unknown>,
  companyTokenLimit: number,
): NormalizedFilters {
  const ignored: string[] = [];

  const countryRaw = String(body.country ?? "").trim();
  const country = /^[A-Za-z]{2}$/.test(countryRaw) ? countryRaw.toUpperCase() : null;
  if (sent(body.country) && !country) ignored.push("country");

  const categoryRaw = String(body.category ?? "").trim().toLowerCase();
  const category = (JOB_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : null;
  if (sent(body.category) && !category) ignored.push("category");

  const wmRaw = String(body.workMode ?? "").trim().toLowerCase();
  const workMode = (WORK_MODES as readonly string[]).includes(wmRaw) ? wmRaw : null;
  if (sent(body.workMode) && !workMode) ignored.push("workMode");

  // Report when ANY requested band was dropped, not only when every one was. A
  // caller asking for senior+bogus gets senior and must still be told bogus did
  // nothing — reporting only total loss is how ["senior","bogus"] stayed silent.
  const bandsAsked = asBands(body.experience);
  const experience = bandsAsked.filter(isExperienceBand);
  if (bandsAsked.length && experience.length !== bandsAsked.length) ignored.push("experience");

  // 0 is the UI's "off" position for both of the next two, not a rejected value.
  // Reporting it would hang a warning on every unfiltered page.
  const floorN = Number(body.salaryFloor);
  const salaryFloor = Number.isFinite(floorN) && floorN > 0 ? Math.min(floorN, 2_000_000) : null;
  if (sent(body.salaryFloor) && salaryFloor === null && floorN !== 0) ignored.push("salaryFloor");

  const ageN = Number(body.maxAgeDays);
  const maxAgeDays = Number.isFinite(ageN) && ageN >= 1 ? Math.min(ageN, 30) : null;
  if (sent(body.maxAgeDays) && maxAgeDays === null && ageN !== 0) ignored.push("maxAgeDays");

  // An unknown company token is not invalid — it matches nothing, and a truthful
  // empty result is the correct answer to "jobs at a company we don't carry".
  // A non-string member IS invalid and gets named.
  const compAsked = Array.isArray(body.companies) ? body.companies : [];
  const companies = compAsked
    .filter((c): c is string => typeof c === "string")
    .slice(0, companyTokenLimit);
  if (compAsked.length && companies.length !== Math.min(compAsked.length, companyTokenLimit)) {
    ignored.push("companies");
  }

  const paRaw = body.postedAfter;
  const postedAfter = typeof paRaw === "string" && !Number.isNaN(Date.parse(paRaw)) ? paRaw : null;
  if (sent(paRaw) && !postedAfter) ignored.push("postedAfter");

  return {
    applied: {
      q: String(body.q ?? "").trim(),
      location: String(body.location ?? "").trim(),
      country,
      remote: body.remote === true,
      workMode,
      category,
      experience,
      salaryFloor,
      companies,
      maxAgeDays,
      postedAfter,
    },
    ignored,
  };
}

// Does this request constrain the catalogue at all?
//
// Derived MECHANICALLY from the applied values rather than written out field by
// field. A hand-maintained conjunction is exactly what published 587,793 over a
// filtered page, and a hand-maintained one would go stale again the first time
// somebody adds a filter and updates three sites out of four. Any non-empty
// applied value means filtered, so a new field is counted the moment it exists.
export const isUnfiltered = (a: AppliedFilters): boolean =>
  !Object.values(a as Record<string, unknown>).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : v !== null && v !== ""
  );

export type FilterViolation = { field: string; want: string; got: string };

// Does a row we are about to return actually satisfy the filters we just told
// the caller we applied?
//
// This runs against rows already in memory, so it costs no query and can run on
// EVERY request rather than in a nightly job. It is the check that would have
// caught `country` arriving null on every row while a unit test asserting
// "rowToJob emits country" passed — that test proved the last link in the chain
// and nothing about the first.
//
// Only exactly-decidable predicates are checked. q and location are deliberately
// excluded: q matches title OR description via full-text with stemming and
// aliases (swe -> Software Engineer), and asserting a literal substring would
// flag correct behaviour as a violation — which is how a bad audit metric scored
// a working alias at 0/10 earlier today. salaryFloor is excluded because the
// comparison runs on salary_rank_usd, an approximate-USD generated column the
// mapped row does not carry; checking the raw figure would fail legitimately
// passing SEK/JPY rows.
export function filterViolations(
  rows: Array<Record<string, unknown>>,
  a: AppliedFilters,
): FilterViolation[] {
  const out: FilterViolation[] = [];
  const push = (field: string, want: string, got: unknown) => {
    if (out.length < 20) out.push({ field, want, got: String(got ?? "null") });
  };
  const cutoff = a.maxAgeDays === null ? null : Date.now() - a.maxAgeDays * 86_400_000;
  for (const r of rows) {
    if (a.country && String(r.country ?? "") !== a.country) push("country", a.country, r.country);
    if (a.workMode && String(r.workMode ?? "").toLowerCase() !== a.workMode) {
      push("workMode", a.workMode, r.workMode);
    }
    if (a.category && String(r.category ?? "") !== a.category) push("category", a.category, r.category);
    if (a.experience.length && !a.experience.includes(String(r.experienceBand ?? ""))) {
      push("experience", a.experience.join("|"), r.experienceBand);
    }
    if (a.remote && r.remote !== true) push("remote", "true", r.remote);
    if (a.companies.length && !a.companies.includes(String(r.companyToken ?? ""))) {
      push("companies", `${a.companies.length} token(s)`, r.companyToken);
    }
    // Undated rows are EXCLUDED by the maxAgeDays predicate at the database, so
    // a row with no postedAt reaching us under that filter is itself the defect.
    if (cutoff !== null) {
      const p = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(p) || p < cutoff) push("maxAgeDays", `<=${a.maxAgeDays}d`, r.postedAt);
    }
  }
  return out;
}
