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
import type { JobSourceKind } from "./sources.ts";

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
/** Closed domain, matching the column CHECK — values come from vendors'
 *  structured fields only (nine of sixteen carry one, measured 2026-08-28). */
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;

/** "hourly" -> salary_period = 'hour'; "salaried" -> salary_period IN ('year','month'). */
export const PAY_BASES = ["hourly", "salaried"] as const;

/**
 * The periods a "salaried" request means, as one producer.
 *
 * 'week' IS in the data and is deliberately NOT here. Counted live 2026-08-25:
 * hour 42,280 | year 17,534 | month 632 | week 24 | day 0 — and those 24 weekly
 * rows are the whole of the gap between the servable salary_period total
 * (59,505) and hour+year+month (59,481). They fall outside BOTH bases on
 * purpose: "salaried" absorbing a period nobody measured it against is how it
 * starts meaning "not hourly", which is a different question. The contract
 * says salary_period IN ('year','month'), and 24 rows is not a reason to
 * widen it — it is a reason to say out loud that they are excluded.
 */
export const SALARIED_PERIODS = ["year", "month"] as const;

/**
 * Every hiring system the board serves, as VALUES.
 *
 * The authoritative set is `JobSourceKind` in sources.ts — the union the
 * catalogue's 19,701 entries are typed against — but a union is a type and a
 * filter needs a runtime list. Importing JOB_SOURCES itself to derive one
 * (`[...new Set(JOB_SOURCES.map(s => s.source))]`, which index.ts's audit does)
 * would pull a 2MB module into every consumer of this file for sixteen strings,
 * and it would also derive the CATALOGUE's vendors rather than the BOARD's:
 * `oracle` has no catalogue entry today and still has rows in the table.
 *
 * So the list is written out and then PINNED to the union in both directions by
 * the two assertions below. `satisfies` rejects a name that is not a real kind;
 * `_kindsAreCovered` fails to compile, naming the offender, if a kind is ever
 * added to sources.ts and not added here. Two lists that cannot drift are not
 * two lists — this is the same contract src/config/ats-vendors.ts holds against
 * apply-automation.ts, enforced by the typechecker instead of a test.
 */
export const BOARD_VENDORS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "bamboohr",
  "recruitee",
  "teamtailor",
  "personio",
  "breezy",
  "rippling",
  "workday",
  "pinpoint",
  "oracle",
  "icims",
  "usajobs",
] as const satisfies readonly JobSourceKind[];

type _UnlistedKind = Exclude<JobSourceKind, (typeof BOARD_VENDORS)[number]>;
// If sources.ts gains a vendor this list does not carry, `_UnlistedKind` stops
// being `never`, this alias becomes a tuple, and `true` no longer assigns —
// deno check then prints the missing vendor's name in the error.
type _KindsAreCovered = [_UnlistedKind] extends [never] ? true
  : ["BOARD_VENDORS is missing a JobSourceKind:", _UnlistedKind];
const _kindsAreCovered: _KindsAreCovered = true;
void _kindsAreCovered;

export type AppliedFilters = {
  q: string;
  location: string;
  country: string | null;
  remote: boolean;
  workMode: string | null;
  /** Comma-joined subset of EMPLOYMENT_TYPES, same list contract as workMode. */
  employmentType: string | null;
  /**
   * One or more field slugs, COMMA-JOINED — never an array.
   *
   * That is not a shortcut: `categoryParam` has always produced a comma-joined
   * string (it appends the unsorted bucket that way), and the SQL has always
   * split it. Measured live against the deployed function: science 7,420 +
   * education 7,439 = 14,859, and the joined form returns exactly 14,859. The
   * union was there the whole time; the only thing refusing multi-select was
   * the single-slug check in this file.
   *
   * Keeping the type `string | null` also keeps every consumer honest —
   * isUnfiltered, filterViolations and the contract test all ask "is this set?"
   * and none of them has to learn a new shape.
   */
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
  /**
   * Widen an ACTIVE floor to admit rows with no stated pay.
   *
   * WIDENING, not narrowing, and the same shape as includeUncategorised above.
   * It does nothing on its own: with no salaryFloor set there is no comparison
   * to relax, and unpriced rows are already included.
   */
  includeUnstatedPay: boolean;
  /**
   * The other end of the pay band, on the SAME column as the floor
   * (salary_rank_usd, approximate USD). A ceiling below the floor describes an
   * empty band and is refused into `ignored` rather than served as a page of
   * nothing — an empty result reads as a statement about the market, and this
   * one would be a statement about the request.
   *
   * Not clamped upward. Clamping a ceiling DOWN narrows the caller's request,
   * which is the maxAgeDays incident (a silent narrowing that reads as "the
   * board has nothing older"), so an absurd ceiling is simply honoured — its
   * only real effect is the NULL exclusion the floor already has.
   */
  salaryCeiling: number | null;
  /**
   * hourly | salaried. A SCALPEL: salary_period is stated on 10.6% of servable
   * rows (59,505 of 559,805 — hour 41,542, year 17,312, month 627, measured
   * 2026-08-25), and a row with no period is EXCLUDED, exactly as workMode
   * excludes rows with no stated mode. coverageDisclosure publishes the 10.6%
   * whenever this is set, because a filter that can see a tenth of the board
   * and does not say so is a filter that lies about the market.
   */
  payBasis: string | null;
  /**
   * "Only postings that state pay at all" -> salary_min_annual IS NOT NULL.
   *
   * THE HONEST HALF OF A FACT THE BOARD ALREADY ACTS ON. Anyone who sets
   * salaryFloor is ALREADY confined to this population — a posting with no
   * stated pay cannot clear any floor — and has never been told. Making it a
   * filter of its own means the narrowing can be asked for, seen, and taken
   * off, instead of arriving as a side effect of moving a slider.
   */
  hasStatedPay: boolean;
  /**
   * "Does not demand more than n years" -> min_years <= n.
   *
   * THE JOB-SEEKER'S QUESTION, not the employer's. Every existing seniority
   * control expresses what a posting wants; this one expresses what a person
   * has. min_years is stated on 28.9% of servable rows, and rows that state
   * nothing are excluded — a posting that never named a requirement cannot be
   * shown to satisfy one.
   */
  maxYears: number | null;
  /**
   * department ILIKE '%s%'. 40.5% coverage.
   *
   * Reachable today ONLY by typing into free-text `q`, where buildQuery ORs it
   * with title and company — so "Legal" as a department request also returns
   * every Legal Assistant title and every company with Legal in its name, and
   * nothing tells the caller which of the three matched.
   */
  department: string | null;
  /**
   * Hiring systems to restrict to -> source IN (...). Wire name is `vendor`
   * (string CSV or array); the applied field is plural because it is a list,
   * the way `companies` and `experience` are.
   *
   * 100% coverage: every row carries a source. The only vendor filter the board
   * had was the sendableOnly boolean, which pins the visitor to 5.4% of the
   * catalogue with no way to ask for one system.
   */
  vendors: string[];
  companies: string[];
  maxAgeDays: number | null;
  postedAfter: string | null;
};

/**
 * The filters the search/count RPCs can bind, by AppliedFilters key.
 *
 * WHY THIS EXISTS AS DATA. search_jobs, search_jobs_semantic and
 * count_jobs_capped each take one p_ parameter per filter, and a filter with no
 * parameter is not refused by them — it is IGNORED. That is the defect this
 * whole file exists to prevent, arriving through the SQL instead of the TS:
 * measured 2026-07-25, the ranked path without p_work_mode returned 30 rows
 * that ALL had work_mode NULL under a request for remote-only.
 *
 * Listed as the BOUND set rather than the blind one so it is mechanical in the
 * direction that matters: a filter added to AppliedFilters and not to the SQL
 * shows up in `rpcBlindFilters` on the day it exists, with no edit here.
 */
const RPC_BOUND_FILTERS = new Set<keyof AppliedFilters>([
  "q",
  "location",
  "country",
  "remote",
  "workMode",
  "employmentType",
  "category",
  "includeUncategorised",
  "sendableOnly",
  "experience",
  "salaryFloor",
  // Bound as of 20260826041500. Both were previously blind, which meant a
  // stated-pay search could never use the ranked path at all — it fell through
  // to recency and lost ranking, the fuzzy tier and the semantic tier with it.
  "hasStatedPay",
  "includeUnstatedPay",
  "companies",
  "maxAgeDays",
  "postedAfter",
  // Bound as of 20260827210000. All five were blind, and any ONE of them
  // routed the search away from ranking, the fuzzy tier, the exact-word tier
  // and semantic — a pay ceiling turned "nurse" into date-ordered ILIKE.
  // vendors rides the existing p_sources parameter (merged with sendableOnly
  // in sendableSourcesParam); the other four have parameters of their own.
  "salaryCeiling",
  "payBasis",
  "maxYears",
  "department",
  "vendors",
]);

/**
 * Which ACTIVE filters no RPC can bind, i.e. which ones a route that serves RPC
 * rows directly would drop on the floor.
 *
 * buildQuery binds all of them, so every route that fetches through buildQuery
 * — recency, the facet counts, the head-term ring, the id re-fetch the semantic
 * and routed tiers use — is already correct. The ranked `search_jobs` exit
 * serves its RPC rows as they come back, and count_jobs_capped answers with its
 * own parameter list, so both need this gate: non-empty means fall through to
 * the buildQuery path (exactly as the multi-country deploy guard in
 * cappedCount already does) rather than serve an unfiltered answer.
 *
 * Delete a key from the blind set by adding its p_ parameter to the SQL and its
 * name to RPC_BOUND_FILTERS above — in that order.
 */
/**
 * The two pay toggles as an RPC body FRAGMENT, spread into the call.
 *
 * ONE PRODUCER, FIVE CALL SITES. search_jobs is called three times, plus
 * count_jobs_capped and the rescue tier's parameter set — this file's header
 * records what happens to a filter list maintained by hand in more than one
 * place, and `filtersActive` was rewritten for exactly that reason.
 *
 * Keys ABSENT when the toggle is off, never null. 20260826041500 DROPs the old
 * signatures, so during the window where a new bundle meets old SQL (or the
 * reverse) a call carrying an unknown key matches no function and PostgREST
 * 404s the whole search. Omitting the keys keeps every ordinary query working
 * against either version; only a query that actually uses a toggle depends on
 * the migration. Same trick as sendableSourcesParam above it.
 */
export function payParams(a: AppliedFilters): Record<string, unknown> {
  return {
    ...(a.hasStatedPay ? { p_pay_stated: true } : {}),
    ...(a.includeUnstatedPay ? { p_include_unstated: true } : {}),
  };
}

export function rpcBlindFilters(a: AppliedFilters): string[] {
  return Object.entries(a as Record<string, unknown>)
    .filter(([k, v]) => {
      if (RPC_BOUND_FILTERS.has(k as keyof AppliedFilters)) return false;
      if (Array.isArray(v)) return v.length > 0;
      return typeof v === "boolean" ? v : v !== null && v !== "";
    })
    .map(([k]) => k);
}

export type NormalizedFilters = {
  applied: AppliedFilters;
  ignored: string[];
  /**
   * The caller asked for a window wider than the serving window and it was cut
   * to 30 days. Deliberately NOT a field of AppliedFilters: board-filter-
   * contract counts every field there as a filter, and isUnfiltered() treats any
   * truthy value as one — so putting it inside would have made a clamped
   * request look filtered and re-routed it. It is a NOTICE about a filter, not
   * a filter, and the type now says so.
   */
  maxAgeClamped: boolean;
};

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

  // MULTI-SELECT, comma-joined, exactly like category — and validated the same
  // way, per element. Two letters or it never reaches the split. "United
  // Kingdom" or "GB; drop" cannot become a predicate, and a list whose members
  // are ALL unusable is a refused filter, which is always named.
  // Five. Country is cheap by comparison (an indexed equality per member) but
  // US-heavy sets are not, and nothing on screen will offer more than a handful.
  const COUNTRY_LIMIT = 5;
  const countryList = (Array.isArray(body.country) ? body.country : String(body.country ?? "").split(","))
    .map((c) => String(c ?? "").trim())
    .filter((c) => /^[A-Za-z]{2}$/.test(c))
    .map((c) => c.toUpperCase());
  const countryAsked = [...new Set(countryList)];
  const country = countryAsked.length
    ? countryAsked.slice(0, COUNTRY_LIMIT).join(",")
    : null;
  // The vendor rule, not the silent slice: a truncated list is REPORTED. Asking
  // for six countries, getting five, and being told all six applied reads as
  // "the board carries nothing in the sixth" — the same shape as the
  // maxAgeDays clamp incident. Only API/URL callers can exceed the cap (the UI
  // stops at five), and the API caller is exactly who ignoredFilters exists for.
  if (sent(body.country) && (!country || countryAsked.length > COUNTRY_LIMIT)) ignored.push("country");

  // MULTI-SELECT, and the trimming is load-bearing rather than tidy: the SQL
  // splits on a BARE comma and does not trim, so " design , legal " matched
  // nothing at all — verified live, it returns zero. Every element is trimmed,
  // lowercased and checked before it is allowed near the query.
  //
  // Unknown slugs are dropped rather than named: they cannot match a posting,
  // and the SQL already treats them as inert. Only a request whose categories
  // are ALL unusable has had its filter refused, and that one is named.
  // THREE, AND THE NUMBER IS MEASURED. search_jobs q=manager: 1 field
  // 0.26-0.35s, 3 fields ~0.45s, 6 big fields 0.75-0.79s; q=nurse across 7
  // values 1.24-1.89s. Six is the same cost class as the two-value cliff the
  // two-subset pager exists to avoid, so the cap sits below it rather than at
  // a round number.
  const CATEGORY_LIMIT = 3;
  const categoryList = (Array.isArray(body.category) ? body.category : String(body.category ?? "").split(","))
    .map((c) => String(c ?? "").trim().toLowerCase())
    .filter((c) => (JOB_CATEGORIES as readonly string[]).includes(c));
  const categoryAsked = [...new Set(categoryList)];
  const category = categoryAsked.length
    ? categoryAsked.slice(0, CATEGORY_LIMIT).join(",")
    : null;
  // Same truncation-is-reported rule as country above.
  if (sent(body.category) && (!category || categoryAsked.length > CATEGORY_LIMIT)) ignored.push("category");

  // Only meaningful alongside a category — with no category the bucket is
  // already included, so accepting it there would be a no-op that reads like a
  // setting.
  // "other" already IS the unsorted bucket, so asking to add it to a selection
  // that contains it is a no-op that would read like a setting.
  const wantsUncategorised = category !== null && !category.split(",").includes("other") && body.includeUncategorised === true;

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

  // A LIST, LIKE EVERY OTHER CLOSED-SET FILTER HERE.
  //
  // category, country, experience and vendor all accept several values; work
  // mode alone accepted one, so "remote or hybrid" — the ordinary thing a
  // person wants — could not be asked. Measured 2026-08-27: GB has 1,476 remote
  // and 3,765 hybrid, so the either-question is 5,241 postings against the
  // 1,476 a searcher could actually reach.
  //
  // STILL A STRING, comma-joined, and that is deliberate: the type stays
  // `string | null` so isUnfiltered, filterViolations, the contract test and the
  // RPC signature all need no new shape — and an unchanged p_work_mode signature
  // is what keeps a PGRST203 overload off the table.
  //
  // Validated per element and deduped, capped at the whole domain. A request
  // whose every element is unusable is named in `ignored`, exactly as before;
  // a request with one good and one bad element keeps the good one and still
  // reports, which is the rule `experience` follows two blocks below.
  const wmAsked = (Array.isArray(body.workMode) ? body.workMode : String(body.workMode ?? "").split(","))
    .map((m) => String(m ?? "").trim().toLowerCase())
    .filter((m) => m.length > 0);
  const wmValid = [...new Set(wmAsked.filter((m) => (WORK_MODES as readonly string[]).includes(m)))]
    .slice(0, WORK_MODES.length);
  const workMode = wmValid.length ? wmValid.join(",") : null;
  // Compare against the DEDUPED asked set, or a request that merely repeats a
  // valid value ("remote,remote") or varies its case ("Remote,remote") reports
  // the filter as ignored though every value bound — a false "we couldn't do
  // that" on a correct request. Casing already folded above; dedup here.
  if (sent(body.workMode) && wmValid.length !== new Set(wmAsked).size) ignored.push("workMode");

  // Employment type: the same validated-comma-list shape, wire name
  // `employmentType`. Casing folds (Full_Time binds), junk is dropped and
  // NAMED in ignoredFilters — a filter silently not applied is the five-
  // filters incident again.
  const etAsked = (Array.isArray(body.employmentType) ? body.employmentType : String(body.employmentType ?? "").split(","))
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
  const etValid = [...new Set(etAsked.filter((t) => (EMPLOYMENT_TYPES as readonly string[]).includes(t)))]
    .slice(0, EMPLOYMENT_TYPES.length);
  const employmentType = etValid.length ? etValid.join(",") : null;
  // Deduped comparison, same reason as workMode: "contract,contract" must not
  // report the filter as ignored.
  if (sent(body.employmentType) && etValid.length !== new Set(etAsked).size) ignored.push("employmentType");

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

  // THE OTHER END OF THE BAND, and it is derived AFTER the floor on purpose:
  // the floor it must clear is the DERIVED one, which can come from the search
  // box ("100k engineer") rather than from a slider. Comparing against
  // body.salaryFloor would let {q:"200k nurse", salaryCeiling:150000} through as
  // a band whose floor is above its ceiling — zero rows, no explanation.
  //
  // An inverted band is REFUSED, not served. "0 results" is the board's answer
  // to a real question about the market; using it as the answer to an
  // impossible request teaches a searcher something false about the market.
  const ceilN = Number(body.salaryCeiling);
  const ceilUsable = Number.isFinite(ceilN) && ceilN > 0;
  const ceilUnderFloor = ceilUsable && salaryFloor !== null && ceilN < salaryFloor;
  const salaryCeiling = ceilUsable && !ceilUnderFloor ? ceilN : null;
  // 0 is the off position here for the same reason it is for salaryFloor and
  // maxAgeDays — a control at rest must not hang a warning on the page.
  if (sent(body.salaryCeiling) && salaryCeiling === null && ceilN !== 0) ignored.push("salaryCeiling");

  // TWO LITERALS, and every casing of a real one binds — the workMode rule.
  // {workMode:"Remote"} once served the entire unfiltered board to API callers
  // because a capital R was not a work mode; a capital H must not cost a caller
  // their pay-basis filter the same way.
  const pbRaw = String(body.payBasis ?? "").trim().toLowerCase();
  const payBasis = (PAY_BASES as readonly string[]).includes(pbRaw) ? pbRaw : null;
  if (sent(body.payBasis) && !payBasis) ignored.push("payBasis");

  // LITERAL true ONLY, and a non-boolean is NAMED — the shape that let
  // {"sendableOnly":"true"} return 598,066 rows with an empty ignoredFilters.
  // A string "false" from a query param is truthy in JS, and this filter cuts
  // the board to a fifth; guessing at it is not an option in either direction.
  const hasStatedPay = body.hasStatedPay === true;
  // Literal true only, same contract as includeUncategorised — and like it,
  // this WIDENS. It relaxes an active floor to admit rows with no stated pay;
  // with no floor set there is nothing to relax and it is inert.
  const includeUnstatedPay = body.includeUnstatedPay === true;
  if (body.hasStatedPay !== undefined && body.hasStatedPay !== null && typeof body.hasStatedPay !== "boolean") {
    ignored.push("hasStatedPay");
  }
  // Same non-boolean guard as its sibling above: a query-string
  // {"includeUnstatedPay":"true"} is not the literal true this reads, so it
  // silently fails to widen — and without this line it is never named, the
  // exact sendableOnly:"true" shape the comment above records.
  if (body.includeUnstatedPay !== undefined && body.includeUnstatedPay !== null && typeof body.includeUnstatedPay !== "boolean") {
    ignored.push("includeUnstatedPay");
  }

  // 1..20, REFUSED OUTSIDE IT RATHER THAN CLAMPED, which is the opposite of
  // what maxAgeDays does one block below — and the difference is deliberate.
  // maxAgeDays clamps because 90 days and 30 days are the same INTENT ("recent")
  // against a board that only keeps 30; the clamp is then disclosed, because a
  // silent one reads as "there is nothing older".
  //
  // maxYears has no such intent to preserve. Clamping 99 to 20 would turn "I do
  // not mind how much experience they ask for" into "at most 20 years" — a
  // NARROWING, invented by us, of a number the caller chose. And 0 is not an
  // off position: no control's rest state is 0 here, so a 0 is a request we
  // cannot bind, and a request we cannot bind is always named.
  //
  // AND IT MUST BE A WHOLE NUMBER, because min_years is a SMALLINT. A fraction
  // is not a narrower filter here, it is a 400: PostgREST renders .lte() as a
  // literal and Postgres casts that literal to the column type. Probed live
  // 2026-08-25, read-only:
  //   min_years=lte.3   -> a row
  //   min_years=lte.3.5 -> {"code":"22P02","message":"invalid input syntax for
  //                        type smallint: \"3.5\""}
  // So {"maxYears":3.5} would have taken down the whole list query under a
  // value that passed every bound above. salaryFloor and salaryCeiling do not
  // need this — salary_rank_usd is `numeric`, which parses 3.5 and 1e+21 alike
  // (probed the same day) — which is exactly why the rule belongs on THIS
  // filter and not as a blanket one.
  const yearsN = Number(body.maxYears);
  const maxYears = Number.isInteger(yearsN) && yearsN >= 1 && yearsN <= 20 ? yearsN : null;
  if (sent(body.maxYears) && maxYears === null) ignored.push("maxYears");

  // ILIKE '%s%', so the ILIKE WILDCARDS COME OUT FIRST. index.ts's sanitizeTerm
  // strips exactly this set for every other text predicate; a surviving `%`
  // turns "eng%" into a prefix match nobody asked for, `_` matches any single
  // character, and `\` escapes the next one. Commas deliberately STAY: this is a
  // plain .ilike() and not an or() branch, so a comma is data here, and "Sales,
  // Marketing" is a real department name on this board.
  //
  // 60 characters. The longest department in a 50-row live sample was 38
  // ("680 - Engineering - CoreSuite Platform"); the cap is there so a filter
  // value cannot become a query-string payload, not to trim real names.
  //
  // A NON-STRING IS NAMED, not coerced. String({}) is "[object Object]", which
  // would bind as a real ILIKE and return an empty page under a filter the
  // caller never expressed — the `companies` rule ("a non-string member IS
  // invalid and gets named"), applied to the text filter. A number is allowed
  // through: departments like "680 - Engineering - CoreSuite Platform" and
  // "Technology/Imaging 40-065" exist on this board, so a digit is a plausible
  // thing to search for.
  const deptShapeOk = typeof body.department === "string" || typeof body.department === "number";
  const DEPARTMENT_LIMIT = 60;
  const department = (deptShapeOk ? String(body.department) : "")
    .replace(/[%_\\|"]/g, "")
    .trim()
    .slice(0, DEPARTMENT_LIMIT)
    .trim() || null;
  if (sent(body.department) && !department) ignored.push("department");

  // MULTI-SELECT over a CLOSED set, validated per element like country and
  // category, and capped like both.
  //
  // Unknown members are NAMED, which is the opposite of how an unknown company
  // token is treated — and the difference is the size of the space. There are
  // 19,701 company tokens and a caller can legitimately ask about one the board
  // does not carry, so an empty page is the true answer. There are SIXTEEN
  // vendors; a name outside that set is a typo or a guess, never a question the
  // board can answer, and returning an empty page for it would be answering it.
  //
  // EIGHT, and the cap follows the experience rule rather than the country one:
  // a truncated list is reported. Slicing silently would mean a caller asking
  // for nine systems gets eight and is told they got nine — the same shape as
  // the clamp that reads as "there is nothing older".
  const VENDOR_LIMIT = 8;
  const vendorsAsked = [
    ...new Set(
      (Array.isArray(body.vendor) ? body.vendor : String(body.vendor ?? "").split(","))
        .map((v) => String(v ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const vendors = vendorsAsked
    .filter((v) => (BOARD_VENDORS as readonly string[]).includes(v))
    .slice(0, VENDOR_LIMIT);
  if (sent(body.vendor) && vendors.length !== vendorsAsked.length) ignored.push("vendor");

  const ageN = Number(body.maxAgeDays);
  const maxAgeDays = Number.isFinite(ageN) && ageN >= 1 ? Math.min(ageN, 30) : null;
  if (sent(body.maxAgeDays) && maxAgeDays === null && ageN !== 0) ignored.push("maxAgeDays");
  // A CLAMP IS A NARROWING AND HAS TO BE SAID. maxAgeDays:90, :365 and :30 all
  // returned identical results with nothing in the body admitting the window
  // had been cut — the ignoredFilters line above cannot fire, because a clamped
  // value is non-null and therefore "honoured". A caller asking for 90 days is
  // told nothing and reasonably concludes the board has no older postings,
  // rather than that it declined to look.
  const maxAgeClamped = Number.isFinite(ageN) && ageN > 30;

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
  // AND THE SECOND WAY A `remote` REQUEST DIES: an explicit workMode wins the
  // precedence in `applied` below, so remote:true alongside one binds nothing.
  // The precedence is RIGHT and stays — {country:IE, workMode:onsite,
  // remote:true} returned 261 onsite rows, the same as workMode alone, not the
  // 137 remote ones — but it was the only drop path in this file with no name
  // attached to it, because it lives in the return literal instead of up here
  // with the others (166, 175, 193, 215, 233, 253, 256, 262 all have one).
  //
  // The intent lift makes it worse than an omission. liftIntentFilters injects
  // {remote:true} for "work from home"/"wfh" and STRIPS the words from the
  // query, checking only body.remote and never body.workMode: q="work from home
  // nurse" + workMode=onsite returned 2,205 rows, byte for byte the same as
  // q="nurse" + workMode=onsite, while the payload claimed intentFilters
  // ["work from home"]. The phrase was deleted from the search AND its filter
  // discarded, and the response asserted the opposite.
  //
  // EXEMPT workMode:"remote", and this is measured, not assumed. The boolean is
  // a strict subset of the mode: IE remote=true is 137 rows, of which
  // work_mode='remote' is 137 and work_mode<>'remote' is ZERO; GB is 1454 and
  // 1447. Under {workMode:"remote", remote:true} the dropped predicate would
  // only have removed rows that are remote by work_mode, so every row returned
  // IS remote — and the only string the UI has says "those results are
  // unfiltered by it", which would be false. That shape is exactly what
  // nl-search/index.ts:52 tells the model to emit and what
  // send-search-digest/index.ts:126 forwards. Trading a silence for a falsehood
  // is the error this push exists to correct, not to commit.
  //
  // `=== true`, not sent(): remote:false is not a request for remote work, and
  // naming it would hang a warning on every page where the box is off. Disjoint
  // from the shape guard above (that one requires a NON-boolean), so
  // {remote:"true", workMode:"onsite"} still names "remote" exactly once.
  if (body.remote === true && workMode && workMode !== "remote") ignored.push("remote");
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
      employmentType,
      category,
      includeUncategorised,
      sendableOnly,
      experience,
      salaryFloor,
      salaryCeiling,
      payBasis,
      hasStatedPay,
      includeUnstatedPay,
      maxYears,
      department,
      vendors,
      companies,
      maxAgeDays,
      postedAfter,
    },
    ignored,
    maxAgeClamped,
  };
}

// Does this request constrain the catalogue at all?
//
// Derived MECHANICALLY from the applied values rather than written out field by
// field. A hand-maintained conjunction is exactly what published 587,793 over a
// filtered page, and a hand-maintained one would go stale again the first time
// somebody adds a filter and updates three sites out of four. Any non-empty
// applied value means filtered, so a new field is counted the moment it exists.
/**
 * Toggles that only ever ADMIT rows. They are not narrowings, so they must not
 * make an otherwise-bare request look filtered. The same set serveList's rescue
 * gate calls NON_NARROWING — exported so the two answers cannot drift.
 */
export const WIDENING_FILTERS: ReadonlySet<string> = new Set(["includeUncategorised", "includeUnstatedPay"]);

/**
 * A WIDENING FLAG IS NOT A FILTER, and counting one as a filter made the bare
 * board count itself. includeUnstatedPay is the one widening flag that can be
 * true ALONE (the checkbox only renders under a pay floor, but the state
 * survives clearing the floor and round-trips through the URL as
 * inclUnstatedPay=1). With it set and nothing else, buildQuery binds no
 * predicate at all — the rows are byte-identical to the bare board — but
 * isUnfiltered returned false, so the commonest request on the site stopped
 * reading its maintained total and ran a capped count instead, publishing
 * "10,000 (capped)" beside a totalAllCompanies of 601,760.
 *
 * Mechanical over EVERY field is still the rule (a hand-maintained list is what
 * published 587,793 over a filtered page); the exemption is one named set, not
 * a per-field opinion.
 */
export const isUnfiltered = (a: AppliedFilters): boolean =>
  !Object.entries(a as Record<string, unknown>).some(([k, v]) =>
    WIDENING_FILTERS.has(k)
      ? false
      : Array.isArray(v)
      ? v.length > 0
      : typeof v === "boolean"
      ? v
      : v !== null && v !== ""
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
  // SPLIT, NEVER COMPARED WHOLE. country/workMode/category/employmentType are
  // comma-joined multi-selects now (the Remote+Hybrid toggles are a mainstream
  // gesture), and testing a row by EQUALITY against the joined string flagged
  // every correct row of every multi-select page: workMode="remote,hybrid"
  // against a row's "remote" produced a violation per row, a false
  // filterIntegrity block on the payload, a console.error per request, and an
  // UNSAMPLED incident row overwriting the sensor on every page view —
  // drowning the one channel built to catch a tier that genuinely serves
  // filter-violating rows. Verified by executing the old checks: 6 violations
  // across two perfectly matching rows. The row satisfies the filter when its
  // value is ANY member of the list, which is exactly the question the SQL's
  // string_to_array/IN asked.
  const wantCountry = a.country ? a.country.split(",") : null;
  const wantModes = a.workMode ? a.workMode.split(",") : null;
  const wantCats = a.category ? a.category.split(",") : null;
  const wantEt = a.employmentType ? a.employmentType.split(",") : null;
  const postedFloor = a.postedAfter ? Date.parse(a.postedAfter) : null;
  for (const r of rows) {
    if (wantCountry && !wantCountry.includes(String(r.country ?? ""))) push("country", a.country as string, r.country);
    if (wantModes && !wantModes.includes(String(r.workMode ?? "").toLowerCase())) {
      push("workMode", a.workMode as string, r.workMode);
    }
    // `other` is LEGITIMATE under the opt-in — the two-subset pager returns it
    // by design. Without this allowance every opted-in page with any `other`
    // rows logged a false filter-integrity incident, unsampled, and wrote a
    // permanent red light over a working feature. Found 2026-08-07 while adding
    // the sendable check below, one day after the opt-in shipped; nothing had
    // used the opt-in yet, which is the only reason the incident log is clean.
    if (wantCats && !wantCats.includes(String(r.category ?? ""))) {
      const allowedOther = a.includeUncategorised && String(r.category ?? "") === "other";
      if (!allowedOther) push("category", a.category as string, r.category);
    }
    // The newest filter, checked like workMode: closed domain, list
    // membership, NULL excluded by the predicate so a NULL row arriving under
    // the filter is itself the defect. This is the sensor for the next
    // p_work_mode-shaped regression (an RPC overload drop, a deploy-window
    // skew) — the 30-NULL-rows-under-a-remote-filter incident class, which
    // this check turns from a silent page into a reported violation.
    if (wantEt && !wantEt.includes(String(r.employmentType ?? ""))) {
      push("employmentType", a.employmentType as string, r.employmentType);
    }
    // postedAfter is exactly decidable the same way maxAgeDays below is —
    // undated rows are excluded by the predicate, so one arriving under the
    // filter is the defect.
    if (postedFloor !== null && Number.isFinite(postedFloor)) {
      const pp = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(pp) || pp < postedFloor) push("postedAfter", `>=${a.postedAfter}`, r.postedAt);
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
    // THE SIX NEW FILTERS ARE CHECKED HERE BECAUSE ONLY ONE OF THE BOARD'S
    // QUERY PATHS BINDS THEM. buildQuery does; the ranked search_jobs exit
    // serves rows straight out of an RPC that has no parameter for any of them.
    // Until those parameters exist, this self-check is what turns "the filter
    // was ignored" into a reported filterIntegrity violation instead of a page
    // that looks correct. See rpcBlindFilters above.
    //
    // salaryCeiling is EXCLUDED for the same reason salaryFloor is: both compare
    // against salary_rank_usd, an approximate-USD generated column the mapped
    // row does not carry, and checking the raw figure would fail SEK/JPY rows
    // that legitimately passed.
    if (a.payBasis) {
      const per = String(r.salaryPeriod ?? "");
      const ok = a.payBasis === "hourly" ? per === "hour" : (SALARIED_PERIODS as readonly string[]).includes(per);
      if (!ok) push("payBasis", a.payBasis, r.salaryPeriod);
    }
    if (a.hasStatedPay && r.salaryMinAnnual == null) push("hasStatedPay", "stated", r.salaryMinAnnual);
    // An unstated requirement is EXCLUDED by the predicate at the database, so a
    // row with no min_years arriving under this filter is itself the defect —
    // the same reading maxAgeDays gives an undated posting.
    if (a.maxYears !== null) {
      const y = r.minYears;
      if (typeof y !== "number" || y > a.maxYears) push("maxYears", `<=${a.maxYears}`, r.minYears);
    }
    // Substring, case-insensitive — the same question the ILIKE asked, not a
    // stricter one. An equality check here would flag "Hardware Engineering"
    // under department=engineering, which the query deliberately returns.
    if (a.department && !String(r.department ?? "").toLowerCase().includes(a.department.toLowerCase())) {
      push("department", a.department, r.department);
    }
    if (a.vendors.length && !a.vendors.includes(String(r.source ?? ""))) {
      push("vendor", a.vendors.join("|"), r.source);
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
/**
 * The rescue tier's twin of sendableSourcesParam, and it exists so that the
 * vendor list still has exactly ONE producer per call shape.
 *
 * The trigram rescue spells its array parameter differently from the two ranked
 * RPCs. That is not a style choice — a guard counts the ranked spelling and
 * expects one declaration per ranked function, and a third copy fails it. The
 * right response to that is a second named producer, not a second inline spread
 * of the shared constant: the fifth copy of a vendor list is the one that goes
 * stale when adapter five lands.
 */
/**
 * ONE source list from TWO toggles. buildQuery applies vendors and sendableOnly
 * as two .in("source", ...) calls, which PostgREST ANDs — the intersection. The
 * RPCs have one p_sources parameter, so the merge happens here, and the
 * semantics must be identical or the ranked path and the browse path answer the
 * same request differently.
 *
 * An EMPTY intersection (a vendor filter naming only non-sendable systems, plus
 * sendable-only) must match NOTHING — that is what two ANDed .in() calls
 * produce. NULL here would mean "no filter" and quietly widen the search, so it
 * returns an impossible sentinel value instead: no source is named "".
 */
function mergedSourceList(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): string[] | null {
  const v = a.vendors?.length ? a.vendors : null;
  const send = a.sendableOnly ? [...SENDABLE_VENDORS] : null;
  if (v && send) {
    const set = new Set<string>(send);
    const both = v.filter((x) => set.has(x));
    return both.length ? both : [""];
  }
  return v ?? send;
}

export function rescueVendorsParam(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): { p_vendors: string[] } | Record<string, never> {
  const list = mergedSourceList(a);
  return list ? { p_vendors: list } : {};
}

export function sendableSourcesParam(a: Pick<AppliedFilters, "sendableOnly"> & Partial<Pick<AppliedFilters, "vendors">>): { p_sources: string[] } | Record<string, never> {
  const list = mergedSourceList(a);
  return list ? { p_sources: list } : {};
}

/**
 * The four filters that used to be RPC-blind, as a body FRAGMENT. Keys ABSENT
 * when off, never null — same deploy-window contract as payParams above it: an
 * unknown key against old SQL matches no function and 404s the whole call, so
 * ordinary searches must not carry these. A search that USES one of them
 * against old SQL errors and falls through to the recency path, which is
 * exactly where such a search always went.
 */
export function extraFilterParams(a: AppliedFilters): Record<string, unknown> {
  return {
    ...(a.salaryCeiling !== null ? { p_salary_ceiling: a.salaryCeiling } : {}),
    ...(a.payBasis ? { p_pay_basis: a.payBasis } : {}),
    ...(a.maxYears !== null ? { p_max_years: a.maxYears } : {}),
    ...(a.department ? { p_department: a.department } : {}),
  };
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
