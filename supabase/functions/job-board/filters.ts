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
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;

export type AppliedFilters = {
  q: string;
  location: string;
  country: string | null;
  remote: boolean;
  workMode: string | null;
  category: string | null;
  /**
   * Also return the `other` bucket alongside the chosen category.
   *
   * OPT-IN, and it must stay opt-in. `other` held 162,800 of 590,808 postings
   * on 2026-08-05 — a posting lands there when the classifier cannot read its
   * field from the title — so a category filter silently costs a searcher a
   * quarter of the board. But the SEO landers at /jobs/field/:slug run through
   * this same path, and a page titled "Engineering jobs" must not list postings
   * whose field is unknown. They never send the flag, so they never widen.
   */
  includeUncategorised: boolean;
  /**
   * "Only jobs the agent can apply to." A FILTER, never a sort — the
   * .order("category") incident is what a ranking version of this becomes.
   * The vendor list itself lives in _shared/apply-automation.ts
   * (SENDABLE_VENDORS); this flag only says the caller asked.
   */
  sendableOnly: boolean;
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

/**
 * A pay figure typed into the search box, as a salary FLOOR.
 *
 * MEASURED: q="100k engineer" returned ZERO jobs with total null. The money
 * token is not a title word, so it ANDs against every title and matches
 * nothing — the same failure as "jobs near me", except the intent maps onto a
 * filter the board already has.
 *
 * Recognises 100k, 100K, $100k, 120,000, $120,000 and "100k+". Anything under
 * $1,000 is ignored: a bare "10" is a version number far more often than a
 * salary, and guessing wrong hides the entire board behind a filter nobody
 * asked for.
 */
export const SALARY_IN_QUERY = /^\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?)\+?$/i;

export function salaryFromQueryText(raw: unknown): number | null {
  for (const t of String(raw ?? "").toLowerCase().split(/\s+/)) {
    const m = SALARY_IN_QUERY.exec(t);
    if (!m) continue;
    const b = m[1];
    const n = b.endsWith("k") ? Number(b.slice(0, -1)) * 1_000 : Number(b.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 1_000 || n > 2_000_000) continue;
    return n;
  }
  return null;
}

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

  // Only meaningful alongside a category — with no category the bucket is
  // already included, so accepting it there would be a no-op that reads like a
  // setting.
  const wantsUncategorised = category !== null && category !== "other" && body.includeUncategorised === true;

  // NOT AVAILABLE UNDER A SALARY SORT, and refused out loud rather than served
  // slowly or as a 500.
  //
  // Measured 2026-08-06 against production: `category=other + country=DE +
  // sort=salary` returns HTTP 500 after 17.7s ON ITS OWN, with no opt-in
  // involved — ordering the unsorted bucket by salary cannot use the category
  // index, and `other` is 162,800 rows. That is a PRE-EXISTING defect (`other`
  // has always been selectable) and it is not fixed here; what is fixed is the
  // opt-in no longer walking into it, because the two-subset pager queries
  // `other` as one of its halves.
  //
  // Pushed onto `ignored` because this file's contract is that a filter is
  // never silently dropped — the caller is told which one did not apply.
  const sortingBySalary = String(body.sort ?? "") === "salary";
  const includeUncategorised = wantsUncategorised && !sortingBySalary;
  if (wantsUncategorised && sortingBySalary) ignored.push("includeUncategorised");

  // Literal true only, same contract as includeUncategorised: a truthy string
  // from a query param must not silently narrow a search to 5.4% of the board.
  const sendableOnly = body.sendableOnly === true;

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
  // PAY TYPED INTO THE SEARCH BOX becomes this filter, but only when the
  // visitor did not set it explicitly. Someone who moved the slider to $150k
  // and then typed "100k engineer" meant the slider; silently lowering their
  // floor would widen a search they deliberately narrowed.
  //
  // Derived HERE rather than at the call site because this file is the single
  // filter derivation — reading body.salaryFloor anywhere else is exactly what
  // src/test/board-filter-contract.test.ts forbids, and it forbids it because
  // two derivations drift and the count starts answering a different question
  // from the page.
  const explicitFloor = Number(body.salaryFloor);
  const hasExplicit = sent(body.salaryFloor) && Number.isFinite(explicitFloor) && explicitFloor > 0;
  const queryFloor = hasExplicit ? null : salaryFromQueryText(body.q);
  const floorN = hasExplicit ? explicitFloor : (queryFloor ?? Number(body.salaryFloor));
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

  // `remote` and `companies` were the two fields that could be REQUESTED and
  // dropped without ever being named — the exact breach this file exists to
  // close, still open in the file that closes it.
  //
  //   remote:"true"  (the natural shape from a query string) -> `=== true` is
  //     false, the filter evaporates, and the caller who asked for remote work
  //     receives the entire 600k-row board.
  //   companies:"tok" (a bare token instead of a one-element array) -> the
  //     Array.isArray guard yields [], the employer scope evaporates, and the
  //     caller receives every posting under a total they will read as that
  //     employer's.
  //
  // Neither is reachable from a UI control today — every in-repo caller sends a
  // boolean and an array respectively — but "no first-party surface can reach
  // it" is a statement about today's callers, not about the contract. The data
  // API is public, and query strings are where non-booleans come from.
  if (body.remote !== undefined && body.remote !== null && typeof body.remote !== "boolean") {
    ignored.push("remote");
  }
  if (body.companies !== undefined && body.companies !== null && !Array.isArray(body.companies)) {
    ignored.push("companies");
  }
  // sendableOnly AND includeUncategorised were the two that had the `=== true`
  // strictness WITHOUT the shape guard, so a non-boolean evaporated silently —
  // the one class of filter this file's own header says cannot happen.
  //
  // Proven live on the deployed build: {"sendableOnly":"true"} returned total
  // 598,066 with ignoredFilters ABSENT and 0 of 25 rows sendable, while the
  // identical shape {"remote":"true"} returned ignoredFilters ["remote"]. Same
  // failure, one named and one silent — and the silent one is the filter for
  // the $99/mo product.
  //
  // The `=== true` strictness stays; it just stops being quiet about a value
  // it refused.
  if (body.sendableOnly !== undefined && body.sendableOnly !== null && typeof body.sendableOnly !== "boolean") {
    ignored.push("sendableOnly");
  }
  if (body.includeUncategorised !== undefined && body.includeUncategorised !== null && typeof body.includeUncategorised !== "boolean") {
    ignored.push("includeUncategorised");
  }

  const paRaw = body.postedAfter;
  const postedAfter = typeof paRaw === "string" && !Number.isNaN(Date.parse(paRaw)) ? paRaw : null;
  if (sent(paRaw) && !postedAfter) ignored.push("postedAfter");

  return {
    applied: {
      q: String(body.q ?? "").trim(),
      location: String(body.location ?? "").trim(),
      country,
      // An explicit workMode BEATS the legacy `remote` boolean, and that decision
      // belongs here rather than at the query. It used to live only in buildQuery,
      // so the row query dropped `remote` while the three count RPCs and the
      // per-page self-check all still bound it — three consumers, three different
      // questions, from one request. Deciding it once means they cannot disagree.
      remote: body.remote === true && !workMode,
      workMode,
      category,
      includeUncategorised,
      sendableOnly,
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
    // `other` is LEGITIMATE under the opt-in — the two-subset pager returns it
    // by design. Without this allowance every opted-in page with any `other`
    // rows logged a false filter-integrity incident, unsampled, and wrote a
    // permanent red light over a working feature. Found 2026-08-07 while adding
    // the sendable check below, one day after the opt-in shipped; nothing had
    // used the opt-in yet, which is the only reason the incident log is clean.
    if (a.category && String(r.category ?? "") !== a.category) {
      const allowedOther = a.includeUncategorised && String(r.category ?? "") === "other";
      if (!allowedOther) push("category", a.category, r.category);
    }
    // The agent-ready filter, checked against the same mirror the query used.
    // `source` is the key rowToJob actually emits — verified, not assumed,
    // because the `token`/`companyToken` mismatch above shipped exactly that way.
    if (a.sendableOnly && !SENDABLE_VENDORS.includes(String(r.source ?? ""))) {
      push("sendableOnly", SENDABLE_VENDORS.join("|"), r.source);
    }
    if (a.experience.length && !a.experience.includes(String(r.experienceBand ?? ""))) {
      push("experience", a.experience.join("|"), r.experienceBand);
    }
    if (a.remote && r.remote !== true) push("remote", "true", r.remote);
    // `token` is what rowToJob actually emits for the company feed token — NOT
    // `companyToken`, which is what this line read when it was first written.
    // Consequence had it shipped: with a companies filter active every row would
    // have compared undefined against the token list and been flagged, so every
    // company lander page — a primary SEO surface — would have logged an error,
    // written a false incident, and returned filterIntegrity to the client. A
    // permanent red light on a board that was working.
    //
    // Caught by reading rowToJob's emitted keys, not by the tests: all 26 passed,
    // because the fixtures were written with the same wrong name the code used.
    // A test that invents its own field names only proves the code agrees with
    // the test. The guard in board-filter-contract.test.ts now parses the real
    // emitted names out of index.ts so this cannot drift again.
    // No `?? r.companyToken` fallback: the guard rejected it, correctly. rowToJob
    // is the only producer of these rows, it emits `token`, and a fallback to a
    // name nothing emits is dead code that quietly re-legitimises the mistake.
    const tok = String(r.token ?? "");
    if (a.companies.length && !a.companies.includes(tok)) {
      push("companies", `${a.companies.length} token(s)`, tok);
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

/**
 * The value `p_category` carries into search_jobs / count_jobs_capped.
 *
 * The RPCs split this on commas (`= ANY(string_to_array($N, ','))`, migration
 * 20260806020000), so one value with no comma produces exactly the query it
 * always did and two values widen to the uncategorised bucket.
 *
 * A COMMA CANNOT ARRIVE FROM A CALLER. `category` is validated against
 * JOB_CATEGORIES above and anything else is rejected, so this only ever joins a
 * known slug to the literal "other". It matters because the RPC now treats a
 * comma as a separator: if arbitrary text could reach here, a caller could
 * widen their own query to categories they never asked for — the same class of
 * hazard as a comma surviving into the mandate's PostgREST or().
 */
export function categoryParam(a: Pick<AppliedFilters, "category" | "includeUncategorised">): string | null {
  if (!a.category) return null;
  return a.includeUncategorised ? `${a.category},other` : a.category;
}

/**
 * The agent-ready filter as an RPC body FRAGMENT, spread into the call.
 *
 * A fragment rather than a value, because the key must be ABSENT when the
 * toggle is off — not null. During the deploy window where the new bundle runs
 * against the old SQL, a call that includes `p_sources` (even null) matches no
 * function signature and PostgREST 404s the whole search. Omitting the key
 * keeps every non-toggle query working against either SQL version; only the
 * toggle itself needs the migration, which is the smallest possible blast
 * radius. Same trick as the MorningQueuePanel two-select fallback.
 *
 * The list is a COPY of SENDABLE_VENDORS ([...spread]) because PostgREST
 * serialises the body and a readonly array is fine — but the copy makes it a
 * plain string[], which is what the RPC's text[] expects from supabase-js.
 */
export function sendableSourcesParam(a: Pick<AppliedFilters, "sendableOnly">): { p_sources: string[] } | Record<string, never> {
  return a.sendableOnly ? { p_sources: [...SENDABLE_VENDORS] } : {};
}

/**
 * PAGING ACROSS TWO SUBSETS THAT MUST STAY IN ORDER.
 *
 * When somebody picks a field and opts into the unsorted bucket, the result is
 * conceptually one list: every posting in their chosen category, then every
 * posting in `other`. Asking the database for that with
 * `.in([chosen, "other"]) ORDER BY category, date` was tried and reverted — it
 * stops Postgres using the date index and the whole widened set has to be
 * sorted, which returned HTTP 500 after 17.5s on sales+DE.
 *
 * Two `.eq()` queries are each indexed and fast. This works out which slice of
 * which subset a given page needs, so they can be fetched separately and
 * concatenated.
 *
 * `countA` is the exact size of the FIRST subset, and it has to be exact: an
 * estimate would silently skip or repeat rows at the boundary, which is the
 * kind of paging bug nobody reports because it looks like the board simply not
 * having that job.
 */
export type PageSplit = {
  aOffset: number; aLimit: number;
  bOffset: number; bLimit: number;
};

export function splitPage(offset: number, limit: number, countA: number): PageSplit {
  const off = Math.max(0, Math.floor(offset));
  const lim = Math.max(0, Math.floor(limit));
  const ca = Math.max(0, Math.floor(countA));

  // How many of this page's slots the first subset can still fill.
  const aLimit = Math.max(0, Math.min(ca - off, lim));
  return {
    // Past the end of A, aLimit is 0 and the offset is irrelevant — clamped so
    // it can never be a negative range.
    aOffset: Math.min(off, ca),
    aLimit,
    // B starts where A ran out. On pages entirely inside A this is 0 and
    // bLimit is 0, so B is never queried at all.
    bOffset: Math.max(0, off - ca),
    bLimit: lim - aLimit,
  };
}
