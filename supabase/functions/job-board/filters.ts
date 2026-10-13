// Rationale: docs/job-board-index-notes.md#n1051-import-job_categories-from-categories-ts
import { JOB_CATEGORIES } from "./categories.ts";
import { isExperienceBand } from "./experience.ts";
import { SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import type { JobSourceKind } from "./sources.ts";

// Defined in ../_shared/board-domains.ts so public-api's bundle can read the
// same list; re-exported here because this file is the board's filter contract.
export { WORK_MODES } from "../_shared/board-domains.ts";
import { WORK_MODES } from "../_shared/board-domains.ts";
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
 * would pull a 2MB module into every consumer of this file for eighteen strings,
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
export { BOARD_VENDORS } from "../_shared/board-domains.ts";
import { BOARD_VENDORS } from "../_shared/board-domains.ts";
// Extras are still caught here, where JobSourceKind lives: a vendor in the
// shared list that sources.ts does not know fails this assignment.
const _vendorsAreKinds: readonly JobSourceKind[] = BOARD_VENDORS;
void _vendorsAreKinds;

type _UnlistedKind = Exclude<JobSourceKind, (typeof BOARD_VENDORS)[number]>;
// Rationale: docs/job-board-index-notes.md#n1052-type-_kindsarecovered-_unlistedkind-exte
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
   * "Only postings that state pay at all" -> the employer's VERBATIM pay field
   * carries something, in every runtime that answers this. It bound the
   * annualised figure until 2026-09-27, which made it ask whether the employer
   * stated pay AND whether we were willing to multiply that rate into a year —
   * so a posting whose hourly wage the card was printing counted as silent. The
   * column it reads now is the same one rowToJob maps to `salary` and the same
   * one the card renders from; see the predicate's own note in buildQuery
   * (job-board index.ts) for the measurement and the three candidates refused.
   *
   * THE HONEST HALF OF A FACT THE BOARD ALREADY ACTS ON. Anyone who sets
   * salaryFloor is ALREADY confined to a stated-pay population — a posting with
   * no stated pay cannot clear any floor — and has never been told. Making it a
   * filter of its own means the narrowing can be asked for, seen, and taken
   * off, instead of arriving as a side effect of moving a slider. It is not the
   * SAME population: the floor compares an annualised figure converted to
   * approximate dollars, so this flag is a strict superset of what the floor,
   * the ceiling and the pay order can compare, and the board discloses the gap
   * per page rather than implying the two sets are one.
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
  /**
   * "New to the board since X": posted_at > X OR first_seen > X. The saved-
   * search digest's window (send-search-digest is its only sender): a posting
   * the employer dated three days ago and we first read today is new to the
   * person who saved the search, and an undated one can never pass postedAfter.
   * RPC-blind on purpose (no search RPC takes it), so buildQuery binds it. No
   * per-row self-check: list rows do not carry first_seen.
   */
  newSince: string | null;
  /**
   * "Hide staffing agencies" -> agency = false. OPT-IN, and a NARROWING only:
   * the 2026-08-31 charter carries agency boards (disclosed with a badge, the
   * flag riding the catalog entry), and this is the reader's way to decline
   * them. agency is NOT NULL DEFAULT false, so the predicate has 100%
   * coverage — unlike workMode there is no "not stated" population for the
   * filter to silently discard, and no coverage disclosure is owed.
   *
   * Deliberately NOT in RPC_BOUND_FILTERS yet: no search RPC takes a
   * parameter for it, so the blind-set gate routes any request carrying it
   * through buildQuery — which binds it — instead of letting an RPC answer
   * with rows it never filtered. That trades ranking for honesty on exactly
   * the requests that opt in, which is the five-filters lesson applied in
   * the safe direction; binding it in SQL later deletes the trade.
   */
  excludeAgencies: boolean;
  /**
   * "Only postings we can actually score."
   *
   * A posting with no stored description cannot be fit-scored — computeFit has
   * nothing to read — so in résumé mode it is not a weaker result, it is a row
   * that can only ever say "no score". The newest rows are exactly those rows:
   * a description arrives on a later detail hop, so the recency-ordered default
   * browse is the least scoreable page on the board. MEASURED 2026-09-04: the
   * newest 20 rows were 5% scoreable while role-query pages ran 85-95%, which
   * is why a real visitor with a scanned résumé saw "not ranked — no posting on
   * this page could be scored yet" on the one view named after personalisation.
   *
   * Deliberately NOT in RPC_BOUND_FILTERS: no search RPC takes a parameter for
   * it, so the blind-set gate routes any request carrying it through buildQuery
   * — which binds it — rather than letting an RPC answer with rows it never
   * filtered. Same trade as excludeAgencies, made in the same safe direction,
   * and the caller that needs it (the no-query résumé browse) has no relevance
   * ranking to lose. It has no per-row self-check either — see the note where
   * the others live: the list route does not carry `description`, so there is
   * nothing to check against.
   */
  hasDescription: boolean;
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
  // Rationale: docs/job-board-index-notes.md#n1053-excludeagencies
  "excludeAgencies",
  // Rationale: docs/job-board-index-notes.md#n1054-hasstatedpay
  "hasStatedPay",
  "includeUnstatedPay",
  "companies",
  "maxAgeDays",
  "postedAfter",
  // Rationale: docs/job-board-index-notes.md#n1055-salaryceiling
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
    // Rationale: docs/job-board-index-notes.md#n1056-a-hasstatedpay-p_pay_stated-true
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

// Rationale: docs/job-board-index-notes.md#n1057-const-asbands-v-unknown-string
const asBands = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => String(x ?? "")) : String(v ?? "").split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const sent = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";

/** A company token as the catalogue spells them: nothing PostgREST would read as list syntax. */
export const COMPANY_TOKEN_SHAPE = /^[A-Za-z0-9~_.:-]{1,128}$/;

/** An ISO-8601 date, or date and time with an optional Z or +hh:mm / +hhmm zone. Group 1 is the zone. */
export const POSTED_AFTER_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * postedAfter AS ONE INSTANT BOTH READERS AGREE ON (.88). It used to accept
 * any string Date.parse could read and bind that string raw, while the
 * filter-integrity sensor checked rows against Date.parse of it. The two do
 * not always read the same instant: '2026-10-04 12:00 GMT-12' is 10-05T00:00Z
 * to V8 and 10-04T00:00Z to Postgres (they read a POSIX offset with opposite
 * signs), so the database served a day of rows the sensor then flagged, and
 * any anonymous caller could write a filter-integrity incident on demand. Now
 * only an ISO shape is accepted, a time with no zone is UTC (how both runtimes
 * read it in production, said here so a machine's zone cannot change it), and
 * what is bound is `toISOString()` of the instant the sensor checks against.
 * null for anything else, which the caller names in ignoredFilters.
 */
export function canonicalInstant(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const m = POSTED_AFTER_SHAPE.exec(t);
  if (!m) return null;
  const iso = t.replace(" ", "T");
  const ms = Date.parse(/T\d/.test(iso) && !m[1] ? `${iso}Z` : iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

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
/** ISO 3166-1 alpha-2, the 249 assigned codes, plus XK (Kosovo, in common use). */
export const ISO_ALPHA2: ReadonlySet<string> = new Set(
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" "),
);
/** The usual wrong spelling, read as the code it means. */
export const COUNTRY_ALIASES: ReadonlyMap<string, string> = new Map([["UK", "GB"]]);

export const SALARY_IN_QUERY =/^\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k?)\+?$/i;

/**
 * Only a figure that cannot be anything else is money: a $, a thousands
 * comma, a trailing +, or a k (never 401k), or a bare number of six digits or
 * more. "new grad 2026", "1099 sales", "rtx 4090" and a zip code are not pay
 * floors (2,026 / 1,099 / 4,090 / 94,105). Rationale: docs/job-board-index-notes.md#n430-a-pay-figure-must-be-unambiguous
 */
function unambiguousMoney(t: string, b: string): boolean {
  if (t.startsWith("$") || t.endsWith("+") || b.includes(",")) return true;
  if (b.endsWith("k")) return b !== "401k";
  return /^\d{6,}$/.test(b);
}

/** The pay figure in the search box: the floor, and exactly the token it came from (L8-03). */
export function salaryTokenInQuery(raw: unknown): { floor: number; token: string } | null {
  for (const t of String(raw ?? "").toLowerCase().split(/\s+/)) {
    const m = SALARY_IN_QUERY.exec(t);
    if (!m || !unambiguousMoney(t, m[1])) continue;
    const b = m[1];
    const n = b.endsWith("k") ? Number(b.slice(0, -1)) * 1_000 : Number(b.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 1_000 || n > 2_000_000) continue;
    return { floor: n, token: t };
  }
  return null;
}

export function salaryFromQueryText(raw: unknown): number | null {
  return salaryTokenInQuery(raw)?.floor ?? null;
}

export function normalizeFilters(
  body: Record<string, unknown>,
  companyTokenLimit: number,
): NormalizedFilters {
  const ignored: string[] = [];

  // Rationale: docs/job-board-index-notes.md#n1058-const-country_limit
  const COUNTRY_LIMIT = 5;
  // ISO-3166 alpha-2, with "UK" read as GB: "XX" or "UK" matched no row and
  // answered 0 jobs with nothing named (L8-10). An unknown code is dropped and named.
  const countrySent = (Array.isArray(body.country) ? body.country : String(body.country ?? "").split(","))
    .map((c) => String(c ?? "").trim().toUpperCase())
    .filter(Boolean)
    .map((c) => COUNTRY_ALIASES.get(c) ?? c);
  const countryList = countrySent.filter((c) => ISO_ALPHA2.has(c));
  const countryAsked = [...new Set(countryList)];
  const country = countryAsked.length
    ? countryAsked.slice(0, COUNTRY_LIMIT).join(",")
    : null;
  if (countryList.length !== countrySent.length) ignored.push("country");
  // Rationale: docs/job-board-index-notes.md#n1059-if-sent-body-country-country-countryaske
  if (sent(body.country) && (!country || countryAsked.length > COUNTRY_LIMIT) && !ignored.includes("country")) ignored.push("country");

  // Rationale: docs/job-board-index-notes.md#n1060-const-category_limit
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

  // Rationale: docs/job-board-index-notes.md#n1061-const-wantsuncategorised-category-null-c
  const wantsUncategorised = category !== null && !category.split(",").includes("other") && body.includeUncategorised === true;

  // Rationale: docs/job-board-index-notes.md#n1062-const-sortingbysalary-string-body-sort-s
  const sortingBySalary = String(body.sort ?? "") === "salary";
  const includeUncategorised = wantsUncategorised && !sortingBySalary;
  if (wantsUncategorised && sortingBySalary) ignored.push("includeUncategorised");

  // Literal true only, same contract as includeUncategorised: a truthy string
  // from a query param must not silently narrow a search to 5.4% of the board.
  const sendableOnly = body.sendableOnly === true;

  // Rationale: docs/job-board-index-notes.md#n1063-const-excludeagencies-body-excludeagenci
  const excludeAgencies = body.excludeAgencies === true;
  const hasDescription = body.hasDescription === true;

  // Rationale: docs/job-board-index-notes.md#n1064-const-wmasked-array-isarray-body-workmod
  const wmAsked = (Array.isArray(body.workMode) ? body.workMode : String(body.workMode ?? "").split(","))
    .map((m) => String(m ?? "").trim().toLowerCase())
    .filter((m) => m.length > 0);
  const wmValid = [...new Set(wmAsked.filter((m) => (WORK_MODES as readonly string[]).includes(m)))]
    .slice(0, WORK_MODES.length);
  const workMode = wmValid.length ? wmValid.join(",") : null;
  // Rationale: docs/job-board-index-notes.md#n1065-if-sent-body-workmode-wmvalid-length
  if (sent(body.workMode) && wmValid.length !== new Set(wmAsked).size) ignored.push("workMode");

  // Rationale: docs/job-board-index-notes.md#n1066-const-etasked-array-isarray-body-employm
  const etAsked = (Array.isArray(body.employmentType) ? body.employmentType : String(body.employmentType ?? "").split(","))
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
  const etValid = [...new Set(etAsked.filter((t) => (EMPLOYMENT_TYPES as readonly string[]).includes(t)))]
    .slice(0, EMPLOYMENT_TYPES.length);
  const employmentType = etValid.length ? etValid.join(",") : null;
  // Deduped comparison, same reason as workMode: "contract,contract" must not
  // report the filter as ignored.
  if (sent(body.employmentType) && etValid.length !== new Set(etAsked).size) ignored.push("employmentType");

  // Rationale: docs/job-board-index-notes.md#n1067-const-bandsasked-asbands-body-experience
  const bandsAsked = asBands(body.experience);
  const experience = bandsAsked.filter(isExperienceBand);
  if (bandsAsked.length && experience.length !== bandsAsked.length) ignored.push("experience");

  // Rationale: docs/job-board-index-notes.md#n1068-const-explicitfloor-number-body-salaryfl
  const explicitFloor = Number(body.salaryFloor);
  const hasExplicit = sent(body.salaryFloor) && Number.isFinite(explicitFloor) && explicitFloor > 0;
  const queryFloor = hasExplicit ? null : salaryFromQueryText(body.q);
  const floorN = hasExplicit ? explicitFloor : (queryFloor ?? Number(body.salaryFloor));
  const salaryFloor = Number.isFinite(floorN) && floorN > 0 ? Math.min(floorN, 2_000_000) : null;
  if (sent(body.salaryFloor) && salaryFloor === null && floorN !== 0) ignored.push("salaryFloor");

  // Rationale: docs/job-board-index-notes.md#n1069-const-ceiln-number-body-salaryceiling
  const ceilN = Number(body.salaryCeiling);
  const ceilUsable = Number.isFinite(ceilN) && ceilN > 0;
  const ceilUnderFloor = ceilUsable && salaryFloor !== null && ceilN < salaryFloor;
  const salaryCeiling = ceilUsable && !ceilUnderFloor ? ceilN : null;
  // 0 is the off position here for the same reason it is for salaryFloor and
  // maxAgeDays — a control at rest must not hang a warning on the page.
  if (sent(body.salaryCeiling) && salaryCeiling === null && ceilN !== 0) ignored.push("salaryCeiling");

  // Rationale: docs/job-board-index-notes.md#n1070-const-pbraw-string-body-paybasis-trim
  const pbRaw = String(body.payBasis ?? "").trim().toLowerCase();
  const payBasis = (PAY_BASES as readonly string[]).includes(pbRaw) ? pbRaw : null;
  if (sent(body.payBasis) && !payBasis) ignored.push("payBasis");

  // Rationale: docs/job-board-index-notes.md#n1071-const-hasstatedpay-body-hasstatedpay-tru
  const hasStatedPay = body.hasStatedPay === true;
  // Rationale: docs/job-board-index-notes.md#n1072-const-unstatedpayasked-body-includeunsta
  const unstatedPayAsked = body.includeUnstatedPay === true;
  if (body.hasStatedPay !== undefined && body.hasStatedPay !== null && typeof body.hasStatedPay !== "boolean") {
    ignored.push("hasStatedPay");
  }
  // Rationale: docs/job-board-index-notes.md#n1073-if-body-includeunstatedpay-undefined-bod
  if (body.includeUnstatedPay !== undefined && body.includeUnstatedPay !== null && typeof body.includeUnstatedPay !== "boolean") {
    ignored.push("includeUnstatedPay");
  }
  // Rationale: docs/job-board-index-notes.md#n1074-const-includeunstatedpay-unstatedpayaske
  const includeUnstatedPay = unstatedPayAsked && !hasStatedPay;
  if (unstatedPayAsked && hasStatedPay) ignored.push("includeUnstatedPay");

  // Rationale: docs/job-board-index-notes.md#n1075-const-yearsn-number-body-maxyears
  const yearsN = Number(body.maxYears);
  const maxYears = Number.isInteger(yearsN) && yearsN >= 1 && yearsN <= 20 ? yearsN : null;
  if (sent(body.maxYears) && maxYears === null) ignored.push("maxYears");

  // Rationale: docs/job-board-index-notes.md#n1076-const-deptshapeok-typeof-body-department
  const deptShapeOk = typeof body.department === "string" || typeof body.department === "number";
  const DEPARTMENT_LIMIT = 60;
  const department = (deptShapeOk ? String(body.department) : "")
    .replace(/[%_\\|"]/g, "")
    .trim()
    .slice(0, DEPARTMENT_LIMIT)
    .trim() || null;
  if (sent(body.department) && !department) ignored.push("department");

  // Rationale: docs/job-board-index-notes.md#n1077-const-vendor_limit
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
  // The plural key is named, never aliased. Rationale: docs/job-board-index-notes.md#n425-plural-vendor-key-is-named
  if (sent(body.vendors) && !sent(body.vendor)) ignored.push("vendors");

  const ageN = Number(body.maxAgeDays);
  // Whole days only: the RPC binds an integer, and 1.5 dropped relevance ranking with 22P02 (L13-68).
  const maxAgeDays = Number.isInteger(ageN) && ageN >= 1 ? Math.min(ageN, 30) : null;
  if (sent(body.maxAgeDays) && maxAgeDays === null && ageN !== 0) ignored.push("maxAgeDays");
  // Rationale: docs/job-board-index-notes.md#n1078-const-maxageclamped-number-isinteger-age
  const maxAgeClamped = Number.isInteger(ageN) && ageN > 30;

  // Rationale: docs/job-board-index-notes.md#n1079-const-compasked-array-isarray-body-compa
  const compAsked = Array.isArray(body.companies) ? body.companies : [];
  const companies = compAsked
    .filter((c): c is string => typeof c === "string" && COMPANY_TOKEN_SHAPE.test(c))
    .slice(0, companyTokenLimit);
  if (compAsked.length && companies.length !== Math.min(compAsked.length, companyTokenLimit)) {
    ignored.push("companies");
  }

  // Rationale: docs/job-board-index-notes.md#n1080-if-body-remote-undefined-body-remote
  if (body.remote !== undefined && body.remote !== null && typeof body.remote !== "boolean") {
    ignored.push("remote");
  }
  // Rationale: docs/job-board-index-notes.md#n1081-if-body-remote-true-workmode-workmode
  if (body.remote === true && workMode && workMode !== "remote") ignored.push("remote");
  if (body.companies !== undefined && body.companies !== null && !Array.isArray(body.companies)) {
    ignored.push("companies");
  }
  // Rationale: docs/job-board-index-notes.md#n1082-if-body-sendableonly-undefined-body-send
  if (body.sendableOnly !== undefined && body.sendableOnly !== null && typeof body.sendableOnly !== "boolean") {
    ignored.push("sendableOnly");
  }
  if (body.includeUncategorised !== undefined && body.includeUncategorised !== null && typeof body.includeUncategorised !== "boolean") {
    ignored.push("includeUncategorised");
  }
  // Rationale: docs/job-board-index-notes.md#n1083-if-body-hasdescription-undefined-body-ha
  if (body.hasDescription !== undefined && body.hasDescription !== null && typeof body.hasDescription !== "boolean") {
    ignored.push("hasDescription");
  }
  if (body.excludeAgencies !== undefined && body.excludeAgencies !== null && typeof body.excludeAgencies !== "boolean") {
    ignored.push("excludeAgencies");
  }

  // One instant, in one spelling, for the database AND the sensor (.88): see
  // canonicalInstant. The caller's own string is never bound.
  const paRaw = body.postedAfter;
  const postedAfter = canonicalInstant(paRaw);
  if (sent(paRaw) && !postedAfter) ignored.push("postedAfter");
  const nsRaw = body.newSince;
  const newSince = canonicalInstant(nsRaw);
  if (sent(nsRaw) && !newSince) ignored.push("newSince");

  return {
    applied: {
      q: String(body.q ?? "").trim(),
      location: String(body.location ?? "").trim(),
      country,
      // Rationale: docs/job-board-index-notes.md#n1084-remote-body-remote-true-workmode
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
      newSince,
      excludeAgencies,
      hasDescription,
    },
    ignored,
    maxAgeClamped,
  };
}

// Rationale: docs/job-board-index-notes.md#n1085-block
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

// Rationale: docs/job-board-index-notes.md#n1086-block
/**
 * S12-020: "TODAY" IS A CALENDAR DAY. maxAgeDays was a rolling 24 hours per
 * day, and most vendors state a date with no time (stored 00:00Z), so a US
 * visitor choosing Today at 8pm EDT (00:00Z) lost every posting dated that
 * same day: countOnly 2,879 -> 1,200 across midnight UTC. The window now
 * starts at the earlier of the rolling bound and the start of the viewer's own
 * calendar day N-1 days back, read as the date a date-only stamp names.
 * `tzOffset` is the viewer's Date#getTimezoneOffset() in minutes (positive
 * west of UTC); without one the latest date line's (UTC-12, 720) is used, so
 * no visitor anywhere loses a posting dated their today. Never narrower than
 * the rolling window; at most a day wider.
 */
/**
 * S12-124: THE TWO TEXT FILTERS ARE TEXT, AND A FILTER THAT VANISHES IS NAMED.
 * location ["Austin","Dallas"] was coerced to the string "Austin,Dallas" and
 * matched nothing; a q or location of nothing but stripped characters ("%%")
 * dropped silently; and a NUL in any string reached Postgres as 22P05 and
 * answered 500. Before any other reader sees the body: NULs go from every
 * top-level string, a q or location that is not a string is dropped and named
 * in ignoredFilters, and so is one with nothing left to search for.
 */
export function textFieldShape(body: Record<string, unknown>, locationTermsOf: (raw: unknown) => { terms: string[] }): { body: Record<string, unknown>; ignored: string[] } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) out[k] = typeof v === "string" ? v.replace(/\u0000/g, "") : v;
  const ignored: string[] = [];
  for (const k of ["q", "location"] as const) {
    const v = out[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") { ignored.push(k); delete out[k]; continue; }
    if (!v.trim()) continue;
    const empty = k === "q" ? !/[\p{L}\p{N}]/u.test(v) : locationTermsOf(v).terms.length === 0;
    if (empty) { ignored.push(k); delete out[k]; }
  }
  return { body: out, ignored };
}

export const DEFAULT_TZ_OFFSET_MIN = 720;
export function viewerTzOffset(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= -840 && n <= 720 ? n : DEFAULT_TZ_OFFSET_MIN;
}
export function ageCutoffMs(maxAgeDays: number, now: number, tzOffset?: unknown): number {
  const local = new Date(now - viewerTzOffset(tzOffset) * 60_000);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - (maxAgeDays - 1) * 86_400_000;
  return Math.min(now - maxAgeDays * 86_400_000, dayStart);
}

export function filterViolations(
  rows: Array<Record<string, unknown>>,
  a: AppliedFilters,
  ageCutoff?: number,
): FilterViolation[] {
  const out: FilterViolation[] = [];
  const push = (field: string, want: string, got: unknown) => {
    if (out.length < 20) out.push({ field, want, got: String(got ?? "null") });
  };
  const cutoff = a.maxAgeDays === null ? null : ageCutoff ?? ageCutoffMs(a.maxAgeDays, Date.now());
  // Rationale: docs/job-board-index-notes.md#n1087-const-wantcountry-a-country-a-country
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
    // Rationale: docs/job-board-index-notes.md#n1088-if-wantcats-wantcats-includes-string-r
    if (wantCats && !wantCats.includes(String(r.category ?? ""))) {
      const allowedOther = a.includeUncategorised && String(r.category ?? "") === "other";
      if (!allowedOther) push("category", a.category as string, r.category);
    }
    // Rationale: docs/job-board-index-notes.md#n1089-if-wantet-wantet-includes-string-r
    if (wantEt && !wantEt.includes(String(r.employmentType ?? ""))) {
      push("employmentType", a.employmentType as string, r.employmentType);
    }
    // Rationale: docs/job-board-index-notes.md#n1090-if-postedfloor-null-number-isfinite-post
    if (postedFloor !== null && Number.isFinite(postedFloor)) {
      const pp = r.postedAt ? Date.parse(String(r.postedAt)) : NaN;
      if (!Number.isFinite(pp) || pp < postedFloor) push("postedAfter", `>=${a.postedAfter}`, r.postedAt);
    }
    // Rationale: docs/job-board-index-notes.md#n1091-if-a-sendableonly-sendable_vendors-inclu
    if (a.sendableOnly && !SENDABLE_VENDORS.includes(String(r.source ?? ""))) {
      push("sendableOnly", SENDABLE_VENDORS.join("|"), r.source);
    }
    if (a.experience.length && !a.experience.includes(String(r.experienceBand ?? ""))) {
      push("experience", a.experience.join("|"), r.experienceBand);
    }
    // Rationale: docs/job-board-index-notes.md#n1092-if-a-paybasis
    if (a.payBasis) {
      const per = String(r.salaryPeriod ?? "");
      const ok = a.payBasis === "hourly" ? per === "hour" : (SALARIED_PERIODS as readonly string[]).includes(per);
      if (!ok) push("payBasis", a.payBasis, r.salaryPeriod);
    }
    // THE SENSOR READS THE COLUMN THE PREDICATE READS, or it reports every row
    // the filter correctly admitted as a violation. This checked the annualised
    // figure while the query bound it too; on 2026-09-27 the query moved to the
    // employer's verbatim pay field, and a sensor left behind would have flagged
    // roughly 33,000 legitimately-admitted postings board-wide — an integrity
    // channel that floods is an integrity channel somebody switches off.
    // rowToJob maps the column straight through, so a served row that carries no
    // pay text under this filter is the defect, exactly as an undated row under
    // maxAgeDays is.
    //
    // DELIBERATELY STRICTER THAN THE QUERY ON ONE CASE, AND THAT ASYMMETRY IS
    // NAMED RATHER THAN GLOSSED. Every query arm is a bare NOT-NULL test — the
    // edge builder's and all three SQL bodies' — so a pay field holding only
    // whitespace is ADMITTED by all four, while this test also rejects a blank.
    // The asymmetry cannot stop such a row being served, and claiming the two
    // tests are the same one would be exactly the kind of comment this change
    // exists to retire. What it can do, and all it does, is turn one bad row into
    // a reported incident on every page that serves it — a FALSE incident by the
    // predicate's own definition, since the query admitted the row on purpose.
    // The cost is bounded and the population is unobserved: 0 blank or
    // whitespace-only pay strings in 12,000 rows walked live 2026-09-27T03:30Z
    // and 0 in the earlier 18,000-row walk. It is kept strict because a vendor
    // sending whitespace is a real ingest defect worth one console line — clean()
    // strips NUL bytes and the writers' `|| null` turns "" into null, but neither
    // trims, so "   " can reach the column. Closing it properly means trimming at
    // the writers (an ingest change) or a btrim arm in four runtimes, one of
    // which — PostgREST — cannot express btrim; not a comment's decision to make.
    if (a.hasStatedPay && (typeof r.salary !== "string" || r.salary.trim() === "")) {
      push("hasStatedPay", "stated", r.salary);
    }
    // Rationale: docs/job-board-index-notes.md#n1093-if-a-maxyears-null
    if (a.maxYears !== null) {
      const y = r.minYears;
      if (typeof y !== "number" || y > a.maxYears) push("maxYears", `<=${a.maxYears}`, r.minYears);
    }
    // Rationale: docs/job-board-index-notes.md#n1094-if-a-department-string-r-department
    if (a.department && !String(r.department ?? "").toLowerCase().includes(a.department.toLowerCase())) {
      push("department", a.department, r.department);
    }
    if (a.vendors.length && !a.vendors.includes(String(r.source ?? ""))) {
      push("vendor", a.vendors.join("|"), r.source);
    }
    if (a.remote && r.remote !== true) push("remote", "true", r.remote);
    // Rationale: docs/job-board-index-notes.md#n1095-if-a-excludeagencies-r-agency-true
    if (a.excludeAgencies && r.agency === true) push("excludeAgencies", "agency=false", r.agency);
    // NO SELF-CHECK FOR hasDescription, deliberately. rowToJob does not emit
    // `description` on list rows — it is the largest field on the table and the
    // list route leaves it out on purpose — so any check here reads undefined
    // and flags every row, which is the companyToken mistake recorded a few
    // lines below, repeated. The sensor this filter would need is a column the
    // rows do not carry; adding one to carry it would cost every list request
    // the field the route exists to avoid.
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
