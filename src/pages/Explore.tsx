// Explore — a way INTO the board, not a leaderboard of twelve employers.
//
// WHY THIS PAGE WAS REBUILT, IN ONE NUMBER. The version this replaces opened on
// a section whose twelve employer cards held 1,812 open roles against ~938,000
// on the board — 0.19% of the inventory, at employers most readers have never
// heard of — while its highest-coverage surface, the field grid, was the
// seventh of seven tabs. The rigour was never the problem; the DENOMINATOR was.
// Twelve employer cards cannot exceed 11.09% of this board and in practice sit
// under 0.5%, so no amount of care spent on those twelve cards could make the
// page reach the reader's market.
//
// WHAT CHANGED, IN ORDER OF VALUE:
//   1. The default view is the FIELD GRID (DEFAULT_INTENT below). Eighteen
//      tiles, ordered by live count, reaching every posting that carries a
//      field plus the uncategorised bucket no field tile can see.
//   2. Under a field, PRICED ROLE ROWS. This adds no new mass — it changes the
//      SIZE OF WHAT YOU LAND IN, which is the actual failure. Every row's
//      number is a real count from the board, and a row we could not price does
//      not render.
//   3. Under the chosen slice, PRICED CONSTRAINT CHIPS carrying both a live
//      count and the live coverage of the column each one filters on.
//   4. LIFECYCLE AT SLICE GRAIN — not a ranking, a narrowing of the slice the
//      reader already has, with the gap in our record said as loudly as the
//      finding.
//   5. The employer lookup, moved to LAST, plus saved searches.
//
// WHAT LEFT, AND IT IS NOT THE STATISTICS:
//   • All five twelve-card employer leaderboards AS SECTIONS — "How long do I
//     have", "The dates here are not what they look like", "Still advertised
//     when it crossed day 30", "Who states pay", "Where a beginner has a
//     chance". Their claim builders, their ranking functions, their card
//     renderers and their client-side gates are all deleted with them: this
//     page's own standing property is that a removed section's COMPUTATION goes
//     with it, because arithmetic with no rendered sentence is a number waiting
//     to be re-rendered by someone who does not know why it left.
//   • HIRING_SLICE = 12 as a page concept, and with it every sentence that had
//     to explain that a collection of twelve is not a population.
//
// THE STATISTICS STAY, AT THE GRAIN WHERE THEIR SAMPLE EXISTS. A field has
// thousands of observed closures where an employer has three, so
// get_category_fill_curve PASSES the very gates the per-employer version was
// failing — same estimator, same sufficiency flag (25 at risk, 5 fills,
// interval half-width 0.15), same coverage bands. The moat gets bigger by
// changing its denominator, never by lowering a bar.
//
// STANDING HONESTY RULES, UNCHANGED AND ENFORCED BELOW:
//   • A published statistic names its date basis AND its population.
//   • A deduped count publishes as a floor ("at least N"), never an equality.
//   • Sample gates are mandatory; the curve returns sufficiency — honour it.
//   • A closure NEVER means "hired".
//   • Never publish a number the query could not produce; a total can be null.
//   • A locale VALUE overrides an inline English default, so every sentence
//     whose MEANING changed here takes a NEW key. Editing a key in place would
//     leave seven languages rendering the claim this page stopped making.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bookmark, Briefcase, Layers, LucideIcon, MapPin, Search, SlidersHorizontal } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
// The methodology disclosure /ghost-jobs and /hiring-trends already use —
// native <details>, in the accessibility tree, zero JS.
import { HowWeMeasure } from "@/components/HowWeMeasure";
import { SavedSearchPills } from "@/components/jobs/SavedSearchPills";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
// ONE MAPPER, TWO CONSUMERS, SO A NUMBER AND ITS DESTINATION CANNOT DRIFT.
// Every priced thing on this page is a JobSearchParams object that is mapped
// TWICE: through searchToBoardBody to produce the count, and through
// searchToQuery to produce the link. That is the entire defence against the
// class of defect that put "38 entry-level roles" on a card whose destination
// showed 900 — the count and the link were two hand-written filter sets.
import { searchName, searchToBoardBody, searchToQuery, type JobSearchParams } from "@/lib/job-search-params";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";
// ONE BAR, ONE DECLARATION. /jobs owns these constants and the two predicates
// over them; a second literal here would let one file's edit be silent on the
// other, and the two surfaces would publish and refuse the same evidence.
import { canStateFillRate, coverageBand, FILL_COVERAGE_MIN, FILL_RATE_MIN_TRACKING_DAYS, FILL_SUPPORT_MAX_DAYS, URGENT_FILL_MAX_DAYS } from "@/pages/Jobs";

/** EVERY LINK THIS PAGE HANDS TO /jobs, WITH THE ONE PARAMETER THE MAPPER
 *  CANNOT CARRY.
 *
 *  Jobs.tsx reads `from=explore` (:1587) and renders its "Back to Explore" link
 *  only on that flag (:6193) — the affordance that stops a discovery page being
 *  a one-way trip. The deleted employer cards each spelled the param by hand,
 *  so when this rebuild routed the tiles, role rows, constraint chips and
 *  country chips through searchToQuery — which does not emit it, and should
 *  not, being the saved-search mapper shared with /jobs itself — every new link
 *  on the page silently lost the way back.
 *
 *  Wrapped rather than added to the mapper so ONE spelling of `from=explore`
 *  exists on this page and a call site cannot quietly omit it. */
const toBoard = (p: JobSearchParams): string => {
  const url = searchToQuery(p);
  return `${url}${url.includes("?") ? "&" : "?"}from=explore`;
};

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }> }).rpc(fn, args);

/** The saved-search table, typed to the ONE operation this page performs.
 *  `code` is read because 23505 (UNIQUE(user_id, name)) means "you already
 *  saved this", which is a different message from a failure and must not
 *  borrow its sentence. */
const searchesTable = () => (supabase as unknown as {
  from: (t: string) => {
    insert: (row: { user_id: string; name: string; params: JobSearchParams }) =>
      Promise<{ error: { code?: string; message?: string } | null }>;
  };
}).from("user_job_searches");

/** COERCE AT THE BOUNDARY, ONCE. An absent column reads as null, which is a
 *  REFUSAL rather than a zero: a gate that cannot be evaluated must suppress
 *  the claim, not pass it.
 *
 *  Exported because the guard test drives the claim builders below with real
 *  payload shapes — including the PostgREST build that sends `numeric` as a
 *  STRING, where `"0.42" >= 0.3` is true by string collation for the wrong
 *  reason. */
export const numOr = (v: unknown, fallback: number | null = null): number | null => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** THE ARITHMETIC BAR, MIRRORED FROM Jobs.tsx:354 (ACTIVELY_HIRING_MIN_CLOSED).
 *
 *  It is the ONE constant on this page that could not be imported: /jobs
 *  declares it without exporting it, and this workflow does not own that file.
 *  Mirrored deliberately and named here so the duplication is visible rather
 *  than accidental — if /jobs ever exports it, this line is what to delete.
 *
 *  DELIBERATELY NOT GATED ON `sufficient`, and that is the whole reason section
 *  4 can speak where the deleted employer sections could not: "this employer
 *  has taken down three roles and not put them back up" is ARITHMETIC over
 *  events we logged, and it stays true on a record far too thin to carry a
 *  rate. The estimator bar governs rates; this one governs counting. */
const CLOSURE_MIN_FILLS = 3;

/** How many of the slice's own result rows we read to find the employers in it.
 *  One board page. Every distinct token among them goes to the curve in one
 *  batch, and the sentence on screen names BOTH numbers — the rows read and the
 *  employers found — because "the employers in the first sixty results" is a
 *  different claim from "the biggest employers in the slice", and only the
 *  first one is true. */
const CLOSURE_ROWS = 60;

/** MIRRORS `COUNT_CAP` in supabase/functions/job-board/index.ts.
 *
 *  The serving API stops counting at 10,000 and replies `countCapped: true`, so
 *  /jobs/field/marketing renders "10,000+" no matter how many roles are there.
 *  A tile printing an uncapped SQL count would open a page saying "10,000+" —
 *  same number, two runtimes, two presentations. */
const SERVE_COUNT_CAP = 10_000;

/** How old the hourly cache may be before the page stops presenting it as the
 *  current state of the board. Three hours, not one: a single missed run is
 *  ordinary jitter, and crying stale on it would train readers to ignore the
 *  line that matters when pg_cron actually dies — which it did, for a day. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** Collections this page no longer renders. A refresh that could not recompute
 *  one of them says nothing about what is on this screen, and naming it in the
 *  staleness warning is a false alarm about a section that does not exist.
 *
 *  FIVE NAMES JOINED THIS SET IN THE REBUILD — hiring, relisting, entry,
 *  transparent and salary — because the five employer leaderboards they fed are
 *  gone. Unknown names are still KEPT: a part we have not heard of may well be
 *  one we render tomorrow, and swallowing it would hide a real failure.
 *
 *  THREE MORE JOINED IT WHEN THE CACHE WRITER GREW KEYS THIS PAGE DOES NOT
 *  READ. role_rows, chip_coverage and ageout_basis are all written by
 *  refresh_explore_cache and read by nothing here — the roles and the chips are
 *  priced by live probes at click time, and the age-out basis belonged to a
 *  deleted section. role_rows is the one that would have fired on its own:
 *  refresh_explore_role_rows runs on a SEPARATE six-hourly cron, so until its
 *  first tick the read-through finds nothing and the hourly refresh names
 *  role_rows stale — a yellow warning, in a raw internal spelling, about a
 *  section this page does not have. field_curves is deliberately NOT here: it
 *  IS read, and its staleness is this page's business. */
const RETIRED_CACHE_PARTS = new Set([
  "trending", "newest", "segments", "reposters",
  "hiring", "relisting", "entry", "transparent", "salary",
  "role_rows", "chip_coverage", "ageout_basis",
]);

/** THE BOARD'S SERVING WINDOW, MIRRORED — AND IT IS NOT THE CURVE'S SUPPORT CAP.
 *
 *  Both are 30 today and they are INDEPENDENT constants that answer different
 *  questions. This one is `effective_posted >= now() - interval '30 days'` in
 *  get_explore_field_grid and get_explore_denominators — how far back the board
 *  will serve, and therefore what every tile COUNTS. FILL_SUPPORT_MAX_DAYS
 *  (Jobs.tsx:379) is how far out the closure curve may be read before a median
 *  is reported as censored, and its own comment anticipates it moving.
 *
 *  The tile method sentence was interpolating the CURVE's cap to describe the
 *  SERVING window: move FILL_SUPPORT_MAX_DAYS to 45 and that sentence would
 *  have started saying "inside our 45-day freshness window" over counts still
 *  taken at 30, in nine languages, with no edit on this page. Mirrored here
 *  rather than imported because the value lives in SQL; if the scan's interval
 *  moves, this line moves in the same commit. */
const SERVE_WINDOW_DAYS = 30;

/** A ROLE ROW IS ONLY WORTH A CLICK IF IT LANDS ON A LIST. Section 2 exists to
 *  change the SIZE of what a reader lands in, so a row opening four results
 *  reproduces the very failure the section was added to fix, one grain down.
 *  Rows below this floor are withheld and SAID to be withheld — never silently
 *  dropped into the "nothing matched" sentence, which would be a false
 *  statement about the board. */
const ROLE_ROW_MIN = 25;

/** The uncategorised bucket's category VALUE, and the tile that reaches it.
 *
 *  MEASURED CORRECTION TO THE OBVIOUS ROUTE. `?inclUncat=1` alone reaches
 *  nothing: filters.ts:461 requires a category before the widening applies
 *  (`category !== null && !category.split(",").includes("other") &&
 *  body.includeUncategorised === true`), so a bare inclUncat is dropped and the
 *  link would open the whole unfiltered board under a tile promising the
 *  uncategorised rows. `category=other` is the value that actually selects
 *  them — filters.ts:1051 passes it straight through as the category param, and
 *  Jobs.tsx reads `category` from the URL without validating it against
 *  BOARD_CATEGORY_SLUGS, so the destination initialises with the bucket
 *  selected. get_explore_denominators counts it like any other category, so the
 *  tile's number comes from the same payload as the other seventeen. */
const UNCATEGORISED = "other";

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", [UNCATEGORISED]: "Other",
};

/** THE ROLE VOCABULARY, AND WHAT IT IS AND IS NOT.
 *
 *  IT IS OURS, NOT A MEASUREMENT. These are the role names a reader recognises,
 *  chosen per field; nothing here is a claim about the board. Every row's
 *  NUMBER is a live count from the serving API for exactly the query the row's
 *  link carries, and a row whose probe returns nothing DOES NOT RENDER. So a
 *  role we guessed wrong costs a missing row, never a wrong number — which is
 *  the only way a curated list is allowed on this page.
 *
 *  WHY A VOCABULARY AT ALL, when 20260908130000 already ported
 *  normalizeCloseTitle into SQL as normalize_close_title(text): that function
 *  is exactly the key a role vocabulary needs — it collapses requisition-number
 *  and seniority variants onto one group — but it lives on the CLOSURE log,
 *  which has no anon read path, and mining it into a ranked list of titles is a
 *  migration this workflow does not own. scripts/role-vocab-gaps.ts already
 *  ranks normalised board titles by posting count and is the tool that should
 *  replace this constant the day a cached role table exists. Until then the
 *  honest arrangement is a named list priced by real probes, with the list's
 *  authorship stated on screen.
 *
 *  The spellings lean on supabase/functions/job-board/search-alias.ts: it
 *  expands "rn" to "registered nurse" and "sdr" to "sales development
 *  representative", so the FULL spellings here are the ones that match the most
 *  postings and the shorthand a reader types still reaches them. */
export const FIELD_ROLES: Record<string, readonly string[]> = {
  engineering: ["software engineer", "mechanical engineer", "electrical engineer", "project engineer", "devops engineer", "quality engineer", "systems engineer", "maintenance technician"],
  data_ai: ["data analyst", "data engineer", "data scientist", "machine learning engineer", "business intelligence analyst", "database administrator", "analytics manager"],
  design: ["graphic designer", "product designer", "ux designer", "interior designer", "ui designer", "design manager"],
  product: ["product manager", "product owner", "program manager", "technical program manager", "product analyst", "business analyst"],
  marketing: ["marketing manager", "digital marketing specialist", "content writer", "social media manager", "brand manager", "communications specialist", "marketing coordinator"],
  sales: ["account executive", "sales representative", "sales manager", "account manager", "business development representative", "inside sales representative", "sales engineer"],
  customer: ["customer service representative", "customer success manager", "technical support specialist", "call center representative", "client services manager", "support engineer"],
  finance: ["accountant", "financial analyst", "controller", "accounts payable specialist", "auditor", "bookkeeper", "payroll specialist", "tax accountant"],
  legal: ["paralegal", "attorney", "compliance officer", "legal counsel", "contracts manager", "legal assistant"],
  people_hr: ["recruiter", "human resources generalist", "talent acquisition specialist", "human resources manager", "hr business partner", "benefits specialist"],
  operations: ["operations manager", "warehouse associate", "logistics coordinator", "supply chain analyst", "production supervisor", "truck driver", "forklift operator", "inventory specialist"],
  healthcare: ["registered nurse", "medical assistant", "certified nursing assistant", "physical therapist", "pharmacist", "nurse practitioner", "licensed practical nurse", "medical technologist"],
  science: ["research scientist", "laboratory technician", "clinical research associate", "chemist", "research associate", "quality control analyst"],
  education: ["teacher", "instructional designer", "school counselor", "professor", "teaching assistant", "tutor", "principal"],
  hospitality_retail: ["retail sales associate", "store manager", "server", "cook", "bartender", "housekeeper", "front desk agent", "shift supervisor"],
  security: ["security officer", "information security analyst", "security engineer", "cybersecurity analyst", "security guard", "trust and safety analyst"],
  admin: ["administrative assistant", "executive assistant", "office manager", "receptionist", "data entry clerk", "scheduler"],
};

/** THE SEVEN CONSTRAINTS A READER ACTUALLY NARROWS BY, and the column each one
 *  can see.
 *
 *  COMPOSED, NOT CONSTRUCTED. Every one of these is a JobSearchParams patch —
 *  filters.ts:99-295 already accepts the whole set, normalizeFilters already
 *  refuses contradictory bands, and ignoredFilters already NAMES anything it
 *  dropped. Nothing here re-implements a filter; it hands the existing one a
 *  slice and reads back what the server says about it.
 *
 *  `coverageKey` NAMES THE filterCoverage FIELD THE SERVER RETURNS FOR THIS
 *  FILTER, and the chip prints THAT number — never a constant of ours. See the
 *  long note on PayCoverage below for why a pinned percentage was not an
 *  option here.
 *
 *  A `null` coverageKey MEANS THE SERVER PUBLISHES NO FIGURE FOR THIS FILTER,
 *  AND IT COMES IN TWO KINDS THAT MUST NOT SHARE A RENDER:
 *
 *    sendableOnly — genuinely complete. It filters on `source`, which every
 *      served row carries, so there is no hidden population and a "100%" line
 *      would be noise.
 *
 *    maxAgeDays — THE OPPOSITE, and this was shipped the wrong way round. It
 *      does NOT filter on effective_posted: the board applies
 *      `q.gte("posted_at", …)` (job-board/index.ts:13787, and count_jobs_capped
 *      itself), the EMPLOYER'S own stated date, because our discovery date is
 *      not a posting age. Whole vendors are structurally undated — bamboohr
 *      43,687 of 43,687, rippling 8,991 of 8,991 — and every one of those rows
 *      is silently excluded by this chip however new it is. So it is the chip
 *      hiding the MOST, and it was the only one disclosing nothing, directly
 *      under a note teaching readers that a chip with no percentage is one we
 *      hold no reading for. get_filter_coverage publishes the fraction as
 *      `dated` (20260909100000) but coverageDisclosure has no branch for
 *      maxAgeDays, so no number reaches this page — and the honest render of a
 *      number we cannot get is the exclusion IN WORDS, which is `note`.
 *
 *  `note` therefore states an exclusion the server will not quantify. It is not
 *  a substitute for a coverage figure and no chip may carry both. */
export interface ConstraintChip {
  id: string;
  /** The English fallback; the render interpolates a t() key built from `id`. */
  label: string;
  patch: JobSearchParams;
  coverageKey: string | null;
  /** An exclusion this filter makes that no published figure measures, said in
   *  words on the chip. English fallback; the key is `explore.chipNote.{id}`. */
  note?: string;
}

export const CONSTRAINT_CHIPS: readonly ConstraintChip[] = [
  { id: "remote", label: "Remote", patch: { workMode: "remote" }, coverageKey: "workMode" },
  { id: "onsite", label: "On-site", patch: { workMode: "onsite" }, coverageKey: "workMode" },
  { id: "statedPay", label: "States the pay", patch: { hasStatedPay: true }, coverageKey: "hasStatedPay" },
  { id: "pay80k", label: "$80,000+", patch: { salaryFloor: 80_000 }, coverageKey: "salaryFloor" },
  { id: "entry", label: "Open to beginners", patch: { experience: "entry" }, coverageKey: "experience" },
  { id: "fullTime", label: "Full-time", patch: { employmentType: "full_time" }, coverageKey: "employmentType" },
  { id: "week", label: "Posted this week", patch: { maxAgeDays: 7 }, coverageKey: null, note: "roles carrying the employer's own date only" },
  { id: "apply", label: "One-click apply", patch: { sendableOnly: true }, coverageKey: null },
];

/** WHERE, AS A CANONICAL VALUE RATHER THAN A TYPED STRING.
 *
 *  The brief for this rebuild asked for a location tier under each role, and
 *  the honest form of it is COUNTRY, not city. `location` is free text matched
 *  against whatever the employer wrote, so "canonical" is a property it does
 *  not have and a hand-written metro list would be a curated denominator
 *  pricing nothing. `country` is ISO-2, the board filters on the column
 *  directly, and it is one of the ten filters the server publishes a coverage
 *  figure for — so a country chip can say both how many roles and how much of
 *  the board could even answer. A country with no roles in the slice is priced
 *  at nothing and does not render. */
export const COUNTRY_CHIPS: readonly { id: string; label: string }[] = [
  { id: "US", label: "United States" },
  { id: "GB", label: "United Kingdom" },
  { id: "CA", label: "Canada" },
  { id: "DE", label: "Germany" },
  { id: "AU", label: "Australia" },
  { id: "IN", label: "India" },
];

/** ONE ROW OF get_category_fill_curve, typed for the PostgREST build that sends
 *  `numeric` as a STRING. Every read goes through numOr(). */
interface FieldCurveRow {
  category?: string;
  fill_rate_14?: number | string | null;
  fill_rate_14_lo?: number | string | null;
  fill_rate_14_hi?: number | string | null;
  median_days_to_fill?: number | string | null;
  median_censored?: boolean;
  dated_coverage?: number | string | null;
  window_days?: number | string | null;
  sufficient?: boolean;
}

/** ONE ROW OF get_company_fill_curve, reduced to the counts section 4 divides
 *  and compares. Deliberately NOT the rate columns: section 4 makes an
 *  arithmetic statement and must not acquire the ability to make a rate one.
 *
 *  ageouts_90d IS HERE FOR THE ABSENCE TEST, not for a sentence. See
 *  closureRecordOf: the three _90d counts together are the only way to tell an
 *  employer we have logged nothing about from one whose log we have read. */
interface CompanyCurveRow {
  company_token?: string;
  fills_90d?: number | string | null;
  relists_90d?: number | string | null;
  ageouts_90d?: number | string | null;
  tracking_days?: number | string | null;
}

/** ONE HIT FROM get_company_suggest, with the two counts the check answer needs.
 *
 *  `open_roles` is an EXACT count of what /jobs/company/{token} serves (both
 *  serving predicates) and a FLOOR on the employer's own hiring, because
 *  paginated vendors are read a page at a time. `feed_total` is the employer's
 *  own advertised number and `feed_total_at` the day we read it — and the SQL
 *  returns both ONLY for an employer we carry a single board for, because
 *  summing several boards' totals read on different days is a figure with no
 *  date basis. */
interface SuggestHit {
  name: string; tokens: string[];
  open_roles?: number | string | null;
  /** ABSENT (undefined) on a build where get_company_suggest still returns
   *  (name, tokens) alone — the deploy window before 20260908136000. That is a
   *  statement about our instrument and must not be rendered as one about the
   *  employer, which is why the refusal below tests for the KEY and not only
   *  for a value. PostgREST sends a NULL column as a present key, so `null`
   *  here really does mean "we hold no reading". */
  feed_total?: number | string | null;
  feed_total_at?: string | null;
}

/** THE ONLY PATH feed_total TAKES ONTO THIS PAGE.
 *
 *  1. The employer's own total must be larger than what we hold, or there is no
 *     gap to report and printing it invites the comparison anyway.
 *  2. It must carry the day it was read. job_board_verifications keeps ONE ROW
 *     PER BOARD and is UPSERTed on every fetch, so it has no history: without
 *     the stamp the number reads as current when it may be three weeks stale.
 *  3. We must know our own count, because the sentence is a comparison.
 *
 *  IT RETURNS TWO NUMBERS AND NEVER A RATIO. Ours is a floor on what we hold;
 *  theirs is one stale reading of what they advertise. 678/19,265 is not a
 *  coverage percentage, it is a division of two quantities measured on
 *  different days under different definitions, and there is no sentence on this
 *  page that may perform it. */
export function feedTotalClaim(
  open: number | null, feedTotal: number | null, feedTotalAt: string | null,
): { open: number; total: number; at: string } | null {
  if (open === null || feedTotal === null || feedTotalAt === null) return null;
  if (!(feedTotal > open)) return null;
  return { open, total: feedTotal, at: feedTotalAt };
}

/** Pool sizes behind the page's denominators. Every key is optional and every
 *  one is ABSENT rather than zero when its scan failed (NULLIF/strip_nulls in
 *  the cache builder). Nothing here may render as "0".
 *
 *  ONLY TWO SURVIVE THE REBUILD. hiring_n, entry_n, entry_min_entry,
 *  entry_min_open, pay_n, pay_pool_n, repost_pool_n, repost_flagged_n and
 *  relisting_pool_n were the denominators UNDER the five deleted leaderboards;
 *  with the sections gone there is no sentence for them to stand under, and a
 *  denominator with no numerator on screen is the emitter-with-no-reader shape
 *  this page has now cleared out twice. */
interface Totals {
  employers_n?: number;
  /** Postings the board can serve — both serving predicates, no cap.
   *
   *  NOT THE DENOMINATOR OF THE REACH CLAIM, and it used to be. It comes from
   *  get_explore_denominators' own board CTE, while the tiles now come from
   *  get_explore_field_grid (20260909130000 repointed `fields` at the grid so
   *  one quantity would stop having two scans). Dividing one function's sum by
   *  another function's total, under a sentence ending "as counted in the same
   *  hourly scan", is a published date basis the numbers do not have — and
   *  during an ingest tick the two disagree enough to trip the wholeness branch
   *  and print "every posting we can serve" as an equality neither scan proved.
   *  The reach line reads FieldGrid below instead, where both halves come off
   *  one statement at one instant. */
  postings_n?: number;
}

/** THE FIELD GRID'S OWN ROLL-UP — the two numbers the reach sentence divides,
 *  taken in ONE pass by get_explore_field_grid (20260909110000).
 *
 *  `board.n` is the whole serving population; `tiled_n` is the sum of the tiles
 *  actually returned, which is smaller by exactly the fields under the scan's
 *  50-posting floor. That gap is the thing the sentence exists to mark, so both
 *  numbers must come from the same statement or the gap is scan skew wearing
 *  the floor's name. refresh_explore_cache projects this same object's `fields`
 *  into the {category: n} shape the tiles render, including on the fallback
 *  path, so the tiles and this roll-up cannot describe two different scans. */
interface FieldGrid {
  tiled_n?: number;
  board?: { n?: number };
}

/** token -> [repost_events, reposted_roles, days_tracked]. Kept for the
 *  employer check alone: a reader typing a company name has already decided to
 *  consider that employer, and this is the last moment before they leave. */
type RepostIndex = Record<string, [number, number, number] | undefined>;

// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE'S TWO ANSWERS
// ─────────────────────────────────────────────────────────────────────────────

/** THE ANSWERS, IN RENDER ORDER, AND THE DEFAULT IS THE FIRST OF THEM.
 *
 *  `fields` and `check` keep the ids they have always had, so every shared
 *  /explore?i=fields and /explore?i=check link still lands where it named.
 *  The five leaderboard ids (`hiring`, `ghost`, `aged`, `pay`, `entry`) are
 *  GONE and isIntent rejects them, exactly as it already rejected `scale`: a
 *  retired id falls back to DEFAULT_INTENT rather than silently showing a
 *  reader something other than what their link said. */
export type Intent = "fields" | "check";
export const INTENTS: readonly Intent[] = ["fields", "check"];

/**
 * THE SINGLE HIGHEST-VALUE LINE ON THIS PAGE.
 *
 * The page opens on the field grid. That one change moves the default view from
 * a section reaching 0.19% of the board to one reaching every posting that
 * carries a field plus the uncategorised bucket — a change in reach of roughly
 * two and a half orders of magnitude, bought by moving a default and attaching
 * RPCs that already existed, without lowering a single gate.
 *
 * DECLARED AS AN EXPORTED CONSTANT RATHER THAN TYPED INTO useState, so the
 * property is assertable from outside the render and cannot be undone by an
 * edit that looks local. The guard test reads THIS, the initial state that
 * consumes it, and the rendered page.
 */
export const DEFAULT_INTENT: Intent = "fields";

const isIntent = (v: string | null): v is Intent => !!v && (INTENTS as readonly string[]).includes(v);

// ─────────────────────────────────────────────────────────────────────────────
// THE CLAIMS. Each builder returns a fully-formed statement or a named refusal,
// and a refusal is STATED rather than left as a gap. No renderer below composes
// a figure from a row directly, so there is no path on which a number reaches
// the screen without the window it was measured over.
// ─────────────────────────────────────────────────────────────────────────────

/** WHAT A FIELD'S LIFECYCLE RECORD CAN SAY, INCLUDING WHEN IT IS "NOTHING".
 *
 *  `absent` and `thin` are DIFFERENT FACTS and must not share a sentence:
 *  `absent` is our instrument (the RPC did not answer, or the field sits under
 *  its p_min_n floor), `thin` is the estimator's own sufficiency flag refusing
 *  on a record that exists. Folding the first into the second makes the page
 *  apologise for an outage it is not having. */
export type FieldLifecycle =
  | { kind: "median"; days: number; windowDays: number; qualified: boolean; coveragePct: number; rate: number }
  | { kind: "censored"; windowDays: number; qualified: boolean; coveragePct: number; rate: number }
  /** We have not watched long enough. A statement about OUR log, and a
   *  different fact from a thin sample — which is why it is its own branch and
   *  its own sentence. */
  | { kind: "window"; windowDays: number }
  | { kind: "thin" }
  | { kind: "absent" };

/**
 * THE FIELD'S LIFECYCLE SENTENCE, THROUGH THE SAME GATE /jobs USES.
 *
 * get_category_fill_curve runs the SAME competing-risks estimator as the
 * per-employer curve, with the SAME sufficiency flag (25 at risk, 5 observed
 * fills, interval half-width within 15 points, and observed relists not
 * outnumbering fills), and returns dated_coverage SEPARATELY so the caller owns
 * the coverage decision. Its COMMENT ON is explicit that `sufficient` gates
 * whether a returned row may be published — so this honours it rather than
 * re-deriving anything from whatever counts happened to arrive.
 *
 * window_days is the OBSERVED depth of the closure log, not the requested
 * window, which is why it is what gets handed to canStateFillRate: a fourteen-
 * day claim needs a log deeper than fourteen days, and `sufficient` does not
 * look at time at all.
 *
 * median_days_to_fill is min{t <= 30 : R(t) >= 0.5} — the median of the FILL
 * incidence, where the estimator's "fill" is a closure that did not come back.
 * Its renderer therefore says "gone within N days AND DID NOT COME BACK", and
 * both halves of that are load-bearing:
 *
 *   • Dropping the second half gives "half were gone within N days", which is
 *     the weaker S-form claim for a different number (off-board incidence
 *     counts re-listings too, so its median falls at or before day N). True,
 *     but not what this estimator measured.
 *   • Replacing it with "FILLED", which is what /jobs renders for this same
 *     column, is the stronger claim in the forbidden direction: this page's
 *     standing rule is that a closure never means hired, and a hire, a
 *     withdrawal, a cancelled requisition and a retitle are indistinguishable
 *     to us. The exact claim needs neither word, so it uses neither.
 *
 * Where the incidence never reaches half inside the observable 30 days the row
 * comes back NULL with median_censored true, and the honest render is "more
 * than 30 days", never a figure.
 */
export function fieldLifecycleOf(row: FieldCurveRow | undefined | null): FieldLifecycle {
  if (!row) return { kind: "absent" };
  const windowDays = numOr(row.window_days);
  const coverage = numOr(row.dated_coverage);
  const rate = numOr(row.fill_rate_14);
  if (windowDays === null || rate === null) return { kind: "absent" };
  // THE OBSERVATION-WINDOW HALF, APPLIED AND NAMED SEPARATELY. `sufficient`
  // counts roles at risk, observed fills and interval width — three statements
  // about the SAMPLE and none about how long we watched. Lifetimes run from the
  // employer's stated posted_at, so a ten-day-deep log can satisfy every one of
  // them, and a fourteen-day claim over a ten-day log is a claim about a stretch
  // of time we did not observe. canStateFillRate applies this same floor to the
  // same imported constant; it is checked FIRST so the page can say which half
  // of the bar refused, because "we have not watched long enough" is a
  // statement about our log and "too few closures" is one about the field.
  if (!(windowDays >= FILL_RATE_MIN_TRACKING_DAYS)) return { kind: "window", windowDays };
  // The estimator's own flag AND the coverage floor AND the window again,
  // through /jobs' single predicate — one bar, one declaration, no second
  // literal here. numOr, not a typeof test: `numeric` arrives as a STRING on
  // some PostgREST builds, and a local coercion that rejected it would turn
  // every field into a refusal that looks exactly like a field with no record.
  if (!canStateFillRate({ sufficient: row.sufficient === true, dated_coverage: coverage ?? 0 }, windowDays)) {
    return { kind: "thin" };
  }
  const qualified = coverageBand(coverage) === "qualified";
  const coveragePct = Math.round(Math.max(0, Math.min(1, coverage ?? 0)) * 100);
  const clampedRate = Math.max(0, Math.min(1, rate));
  const med = numOr(row.median_days_to_fill);
  // THE SAMPLE IS ASKED ABOUT BEFORE THE NUMBER. median_censored TRUE is a
  // finding — "we did not see half of them come down inside thirty days" — and
  // it must outlive the median it refuses, or a censored field renders no line
  // at all and reads as "no data".
  if (row.median_censored !== false || med === null || !(med > 0)) {
    return { kind: "censored", windowDays, qualified, coveragePct, rate: clampedRate };
  }
  return { kind: "median", days: med, windowDays, qualified, coveragePct, rate: clampedRate };
}

/**
 * SECTION 4'S CLAIM: THE CLOSURE RECORD FOR THE SLICE THE READER IS IN.
 *
 * NOT A LEADERBOARD. It narrows the slice the reader already has, and it says
 * the GAP IN OUR RECORD as loudly as the finding:
 *
 *   "118 employers have data-analyst roles here. We have a readable closure
 *    record for 9 of them. 7 of those 9 close roles and do not put them back
 *    up."
 *
 * THREE DENOMINATORS, AND ALL THREE ARE NAMED, because they are three different
 * populations and this page's whole defect history is populations swapped for
 * each other:
 *
 *   inSlice  — companiesCount from the board's own facet. The employers with a
 *              posting in this slice. NULL when the server did not compute it;
 *              never defaulted to the facet array's length, which is a TOP-N
 *              slice capped for payload weight.
 *   asked    — how many tokens we could actually hand to the curve. The facet
 *              array is capped, so this is at most the top employers by count
 *              and the sentence says so rather than implying we asked about all
 *              of them.
 *   readable — of those, how many the closure log HAS ANYTHING IN IT FOR.
 *
 * WHAT "READABLE" HAD TO BECOME, AND WHY THE OBVIOUS TEST WAS A FALSEHOOD.
 * This once tested `fills_90d === null || relists_90d === null`, which reads
 * like the right refusal and is a branch that can never be taken:
 * get_company_fill_curve is `FROM toks t LEFT JOIN …` and projects
 * `COALESCE(c.f90, 0) AS fills_90d` / `COALESCE(c.r90, 0) AS relists_90d`
 * (20260908137000:535-536). It returns ONE ROW FOR EVERY TOKEN ASKED, and an
 * employer with no logged closure at all comes back 0/0 rather than null. So
 * `readable` was structurally identical to `asked`, and the sentence whose
 * whole job is to state the gap in our record printed "51 employers, a readable
 * closure record for 51 of those" — a confident claim about our own log for the
 * forty-seven of them we have never logged an event for. The gap it exists to
 * state could not be non-zero.
 *
 * The test that works is over the COUNTS the curve actually reports, all three
 * arms of them: an employer contributes a fill, a relist or an age-out, or we
 * have read nothing about it and may not count it as evidence in either
 * direction. The null test is KEPT in front of it, because a build that stops
 * returning the columns at all is our instrument failing and is a different
 * fact again.
 *
 * THE BAR IS ARITHMETIC, NOT AN ESTIMATE: fills_90d >= CLOSURE_MIN_FILLS AND
 * relists_90d <= fills_90d. relists_90d is a FLOOR (the collector logs one
 * superseded closure per title per 24h and deletes the rest), so requiring it
 * to stay at or under the fills errs towards DISQUALIFYING — the safe direction
 * for a claim that speaks well of an employer.
 *
 * AND IT IS NOT A CLAIM THAT ANYONE WAS HIRED. A closure is a posting going
 * away and not coming back; a hire, a withdrawal, a cancelled requisition and a
 * retitle are indistinguishable to us, and no sentence built from this may pick
 * one.
 */
export interface ClosureRecord {
  /** How many employers have a role in this slice IN ALL.
   *
   *  ALWAYS NULL TODAY, AND THAT IS A MEASUREMENT, NOT AN OVERSIGHT. The board
   *  returns a `companies` facet with a `companiesCount` beside it, and both
   *  are BOARD-WIDE — probed live, three ways, while this was written:
   *
   *    category=data_ai                             total 7,837  companiesCount 33,545
   *    category=data_ai + q="database administrator" total     4  companiesCount 33,545
   *    the whole board                              total 805,926 companiesCount 33,545
   *
   *  ...with the identical top row every time (Domino's, whose `count` of
   *  34,000 is its WHOLE-BOARD total, over a slice holding four roles). It is a
   *  cached global employer list, not a facet of the query. Reading it as the
   *  slice's employer count would have printed "33,545 employers have roles in
   *  this slice" over four postings, and handed the curve the sixty largest
   *  employers on the board, most of which have nothing in the slice at all —
   *  the exact denominator defect this whole rebuild exists to remove, at the
   *  bottom of the page that removed it.
   *
   *  So the field stays, and stays null: the shape keeps the three quantities
   *  separate, and the sentence says plainly that we cannot count this one
   *  rather than borrowing a number that answers a different question. */
  inSlice: number | null;
  /** Result rows the slice's own query returned, and the population `asked` was
   *  drawn from. Named on screen, because "the employers in the first sixty
   *  results" is a different claim from "the biggest employers in the slice". */
  rowsRead: number;
  asked: number;
  readable: number;
  closers: number;
  /** The closers' tokens, capped at 12 — the size Jobs.tsx:1523-1545 already
   *  round-trips through the comma-separated `company` param, so a link this
   *  page builds cannot become a scope the destination silently truncates. */
  tokens: string[];
  /** THE TRUNCATION, RETURNED RATHER THAN LEFT FOR THE LINK TO IMPLY. The
   *  finding sentence counts `closers` and the link that follows it carries at
   *  most twelve, so "open this slice at THOSE employers" asserted an identity
   *  the destination did not have — on a live Design slice it read "27 of those
   *  51" and then opened twelve of the twenty-seven. The link's own copy has to
   *  name both numbers when they differ, and it can only do that if the builder
   *  says they do. */
  capped: boolean;
}

export function closureRecordOf(
  inSlice: number | null,
  rowsRead: number,
  askedTokens: readonly string[],
  rows: readonly CompanyCurveRow[],
): ClosureRecord | null {
  const asked = askedTokens.length;
  if (asked === 0) return null;
  const byToken = new Map<string, CompanyCurveRow>();
  for (const r of rows) {
    if (r && typeof r.company_token === "string" && r.company_token) byToken.set(r.company_token, r);
  }
  let readable = 0;
  const tokens: string[] = [];
  for (const tok of askedTokens) {
    const r = byToken.get(tok);
    if (!r) continue;
    const fills = numOr(r.fills_90d);
    const relists = numOr(r.relists_90d);
    const ageouts = numOr(r.ageouts_90d);
    // OUR INSTRUMENT FIRST. Absent columns mean the deployed function does not
    // return them, which is a statement about the build and not about the
    // employer.
    if (fills === null || relists === null) continue;
    // THEN THE RECORD. The RPC answers for every token it is handed, so a row
    // is not evidence of anything until the log has actually recorded one of
    // this employer's roles leaving: a fill, a re-list or an age-out. All three
    // at zero is "we have logged nothing about this board", and counting it as
    // a readable record is how the gap-stating sentence came to state no gap.
    // ageouts_90d absent on an older build degrades to 0, which errs towards
    // calling a record unreadable — the safe direction for a sentence about how
    // little we hold.
    if (fills + relists + (ageouts ?? 0) <= 0) continue;
    readable += 1;
    if (fills >= CLOSURE_MIN_FILLS && relists <= fills) tokens.push(tok);
  }
  if (readable === 0) return { inSlice, rowsRead, asked, readable: 0, closers: 0, tokens: [], capped: false };
  return {
    inSlice, rowsRead, asked, readable,
    closers: tokens.length,
    tokens: tokens.slice(0, 12),
    capped: tokens.length > 12,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING. Every number on a role row, a constraint chip and a country chip
// comes from here, and every one of them is a REAL COUNT for exactly the query
// the thing's own link carries.
// ─────────────────────────────────────────────────────────────────────────────

/** WHAT A PROBE CAN HONESTLY RETURN.
 *
 *  `total: null` IS A REAL OUTCOME AND NOT AN ERROR. The board answers
 *  countUnavailable when the exact count could not be taken, and this page's
 *  standing rule is that a number the query could not produce is never
 *  published — so a null total renders as no number, not as a zero.
 *
 *  `capped` is the server's countCapped: the count stopped at COUNT_CAP and the
 *  true figure is higher, so it renders "10,000+" and never an equality.
 *  `atLeast` is totalAtLeast — a proven floor when the exact total is
 *  unknowable, rendered as "N+" for the same reason.
 *
 *  `ignored` is ignoredFilters. A chip whose OWN filter is named there priced
 *  a query the click will not run, so it does not render at all. */
export interface Priced {
  total: number | null;
  capped: boolean;
  atLeast: number | null;
  coverage: number | null;
  ignored: string[];
  /** The probe itself failed — OUR instrument, distinct from a probe that
   *  answered with nothing. */
  failed: boolean;
}

/** THE PAY-COVERAGE RECONCILIATION, AND WHY NO CHIP HERE CARRIES A CONSTANT.
 *
 *  Three numbers were in the repository for one apparent fact, which is the
 *  claim-drift shape this codebase has already been burned by:
 *
 *    20.1%  MEASURED_COVERAGE.hasStatedPay in job-board/index.ts. It is
 *           `salary_min_annual IS NOT NULL` — 112,524 of the 559,805 SERVABLE
 *           rows (open, inside the freshness window), measured 2026-08-25. This
 *           is the population "states pay at all", and it is the right figure
 *           for a "states the pay" chip.
 *
 *    12.9%  In the comments at index.ts (the coverage pass, and again above
 *           coverageDisclosure), written as "salary is stated on 12.9%" and
 *           measured against 599,316 OPEN postings — a denominator that does
 *           NOT apply the freshness window. It is attached to the PAY FLOOR's
 *           cost ("setting a salary floor discards 87% of the board"), and the
 *           floor binds `salary_rank_usd`, a different column from the one
 *           20.1% counts. So it is mislabelled AND stale, and the live board
 *           settles it: probed here while this was written, the same request
 *           that returns a count returns filterCoverage {salaryFloor 0.22,
 *           hasStatedPay 0.22}. The two columns are within a point of each
 *           other in practice — almost every parsed annual figure also resolves
 *           a currency — so 12.9% is not a second reading of a narrower
 *           population. It is simply an old number under a wrong name.
 *
 *     ~4%   "only ~4% of postings state salary at all", in a comment in
 *           Jobs.tsx. WRONG UNDER EVERY DEFINITION IN THE REPOSITORY. It is a
 *           gloss on an $80k-floor collapse (572,348 -> 10,374), which is a
 *           FLOOR RESULT — 1.8% — and not a pay-statement rate at all. No query
 *           in this codebase produces 4%. It drives no rendered figure (the
 *           panel it introduces prices itself with live countOnly probes), so
 *           it is a stale comment rather than a shipped falsehood; it belongs
 *           to /jobs, which this workflow does not own, and is reported rather
 *           than edited here.
 *
 *  THE ANSWER, THEN: 20.1% is right, for the servable board, as at 2026-08-25,
 *  and the live figure has since moved to about 22% for both keys. 12.9% is
 *  wrong under its own label and out of date under any other. ~4% is not a
 *  measurement of anything.
 *
 *  THE RESOLUTION THIS PAGE ADOPTS: a chip publishes NO pinned percentage at
 *  all. get_filter_coverage() recomputes all ten figures in one pass every
 *  refresh, coverageDisclosure returns the live value for exactly the filters a
 *  request applied, and each chip reads the figure for ITS OWN column out of
 *  ITS OWN probe response. A chip whose response carries no coverage for its
 *  key says so in words and prints no percentage — which is the only reading of
 *  three-numbers-for-one-fact that cannot go stale again.
 */
export const PAY_COVERAGE_SOURCE = "filterCoverage" as const;

interface BoardCountReply {
  total?: number | null;
  totalAtLeast?: number;
  countCapped?: boolean;
  countUnavailable?: boolean;
  ignoredFilters?: string[];
  filterCoverage?: Record<string, number>;
  /** The slice's own result rows. `token` on a row is the employer that posting
   *  belongs to, and a page of these is the ONLY slice-scoped employer list the
   *  board offers — see the note on ClosureRecord.inSlice for what the
   *  `companies` facet actually is, and why it is not read anywhere here. */
  jobs?: Array<{ token?: string | null }>;
}

const FAILED: Priced = { total: null, capped: false, atLeast: null, coverage: null, ignored: [], failed: true };

/** ONE PROBE, ONE SLICE, THROUGH THE ONE MAPPER.
 *
 *  `searchToBoardBody` is the same mapper the Account card and the board's own
 *  saved-search pills use — the one that knows `companies` is an array the
 *  board reads while `company` is a key it does not. A hand-written body here
 *  would be the drift that had a pill advertising "+N new" for a query the user
 *  never saved: every filter the hand-written list omitted was silently WIDENED
 *  for the count only. */
async function priceSlice(params: JobSearchParams, coverageKey: string | null): Promise<Priced> {
  try {
    const { data, error } = await supabase.functions.invoke("job-board", {
      // `limit: 1`, NOT `countOnly: true`, AND THE REASON IS MEASURED.
      //
      // Probed live against production while this was written, same filters,
      // both exits:
      //   {countOnly:true}  -> keys ["total"]                     total 1059
      //   {limit:1}         -> keys [... "filterCoverage" ...]    total 1059,
      //                        filterCoverage {workMode: 0.235}
      //
      // The countOnly exit returns the number and DROPS EVERY DISCLOSURE the
      // other exits carry — the coverage block and ignoredFilters both. On a
      // countOnly probe every chip on this page said "coverage unknown", which
      // is the honest render of a missing figure and a completely avoidable
      // one; worse, a chip whose filter the server had REFUSED would have
      // rendered a count for a query the click never runs, because the name of
      // the refusal was in the payload the countOnly exit does not send. That
      // is the silent-filter failure this codebase has a standing contract
      // against.
      //
      // One row of payload buys both. The count is identical, and the server
      // does the same work either way.
      body: { action: "list", limit: 1, includeFacets: false, ...searchToBoardBody(params) },
    });
    if (error) return FAILED;
    const r = (data ?? null) as BoardCountReply | null;
    if (!r) return FAILED;
    const total = typeof r.total === "number" ? r.total : null;
    const cov = coverageKey && r.filterCoverage && typeof r.filterCoverage[coverageKey] === "number"
      ? r.filterCoverage[coverageKey] : null;
    return {
      total,
      capped: r.countCapped === true,
      atLeast: typeof r.totalAtLeast === "number" ? r.totalAtLeast : null,
      coverage: cov,
      ignored: Array.isArray(r.ignoredFilters) ? r.ignoredFilters.filter((x): x is string => typeof x === "string") : [],
      failed: false,
    };
  } catch { return FAILED; }
}

/** Run probes a few at a time. A field with eight roles, eight constraints and
 *  six countries is twenty-two counts; firing them at once is a burst the
 *  serving API has no reason to absorb, and they are all triggered by an
 *  explicit click rather than by a page view. */
async function inBatches<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/** A STATED REFUSAL, never a gap. */
function Refusal({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
    </div>
  );
}

function Section({ icon: Icon, title, blurb, note, children }: { icon: LucideIcon; title: string; blurb: string; note?: string | null; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0 mt-0.5">
          <Icon className="w-4 h-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{blurb}</p>
          {note && <p className="text-[12px] text-foreground/70 mt-1.5 font-medium">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Explore() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  // THE DEFAULT VIEW. Consumes DEFAULT_INTENT rather than repeating its value,
  // so the constant above is the single place the page's entry point is
  // decided and an edit to one cannot leave the other behind.
  const [intent, setIntent] = useState<Intent>(DEFAULT_INTENT);

  const [fields, setFields] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Totals>({});
  /** The field grid's own roll-up. Null until the cache answers, and null
   *  FOREVER on a build whose cache predates get_explore_field_grid — in which
   *  case the reach sentence does not render at all, which is the honest
   *  outcome for a fraction whose two halves would otherwise come from two
   *  scans. */
  const [grid, setGrid] = useState<FieldGrid | null>(null);
  const [repostIndex, setRepostIndex] = useState<RepostIndex>({});
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [stale, setStale] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /** THE HOURLY CACHE HAS ANSWERED, one way or the other. Distinct from
   *  `loading`, which is about what to paint: this one gates the 44-second
   *  fallback scan below, and without it that scan fires on EVERY page view —
   *  the cache read is asynchronous, so `fieldCurves` is null for the first
   *  frame whether or not the cache is about to fill it. Racing the two would
   *  make the cached path cost exactly what it exists to avoid. */
  const [cacheDone, setCacheDone] = useState(false);

  /** THE FIELD CURVES, KEYED BY CATEGORY. `null` until the measurement settles,
   *  `{}` once it has answered with nothing — the two are different facts and
   *  the tiles say so separately. */
  const [fieldCurves, setFieldCurves] = useState<Record<string, FieldCurveRow> | null>(null);
  /** The live RPC is the FALLBACK, and it is slow enough that a reader must be
   *  told rather than left watching a placeholder. See the effect below. */
  const [curveLive, setCurveLive] = useState(false);
  /** A READER HAS OPENED A FIELD, so the 44-second scan is something they asked
   *  for rather than something a page view charged them. Latched: it never goes
   *  back to false. Until it is set, an uncached lifecycle record is neither
   *  fetched nor described as loading — the tile says plainly that it has not
   *  been read yet, which is the one true statement available. */
  const [curveWanted, setCurveWanted] = useState(false);

  // The reader's slice: a field, then optionally a role inside it, then
  // optionally one constraint and one country. Every one of those is a real
  // filter the board applies, and the URL the page hands over carries all of
  // them through the same mapper that priced them.
  const [openField, setOpenField] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [rolePrices, setRolePrices] = useState<Record<string, Priced>>({});
  const [rolesPricing, setRolesPricing] = useState(false);
  const [chipPrices, setChipPrices] = useState<Record<string, Priced>>({});
  const [countryPrices, setCountryPrices] = useState<Record<string, Priced>>({});
  const [chipsPricing, setChipsPricing] = useState(false);
  const [closure, setClosure] = useState<ClosureRecord | null>(null);
  /** The closure call failed, which is OUR outage — kept apart from a closure
   *  record that came back empty, which is a fact about our log. The same
   *  distinction Jobs.tsx:4029-4067 draws with healthFailed, for the same
   *  reason: a resolved PostgREST error is still an error, and treating it as
   *  "no employer closes roles" makes a claim about employers out of an outage
   *  of ours. */
  const [closureFailed, setClosureFailed] = useState(false);
  const [closurePending, setClosurePending] = useState(false);
  /** Tokens we have already handed to the curve for the slice on screen, so a
   *  re-render never re-asks. Jobs.tsx's healthAttempted dedupe, scoped to a
   *  slice rather than to the session. */
  const closureAsked = useRef<string>("");

  // Employer lookup. Fires on keystroke only, never on load, and only at 3+
  // characters — a shorter one would scan the alphabet.
  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<SuggestHit[]>([]);
  /** THREE STATES, NOT TWO. A failed lookup once fell into the same branch as a
   *  genuine miss: searching "wegman" while the RPC was undeployed printed "We
   *  don't carry that employer's job board" about a company we hold 498 roles
   *  for. A broken instrument must never render as a fact about the thing it
   *  measures. */
  const [cState, setCState] = useState<"idle" | "ok" | "error">("idle");

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "exists" | "failed">("idle");

  // ── THE HOURLY CACHE, FOR THE THREE THINGS THIS PAGE STILL READS FROM IT ──
  // fields (per-field served counts), totals (the board denominator), and the
  // churn index the employer check carries. The five collections that fed the
  // deleted leaderboards are not requested and not read; RETIRED_CACHE_PARTS
  // keeps their names out of the staleness warning, because a collection this
  // page does not render cannot make this page stale.
  useEffect(() => {
    (async () => {
      try {
        const { data: cache } = await Promise.resolve(rpc("get_explore_cache")).catch(() => ({ data: null }));
        const c = cache as Record<string, unknown> | null;
        const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
        if (c && (obj(c.fields) || obj(c.totals))) {
          if (obj(c.fields)) setFields(c.fields as Record<string, number>);
          // THE CACHED FIELD CURVES, WRITTEN HOURLY BY refresh_explore_cache
          // SINCE 20260909130000. See the fallback effect below for why this key is the
          // one that matters: the live RPC is a 44-second scan and the cache is
          // where a 44-second scan belongs. Shaped as {category: row} in the
          // RPC's own column names, so the reader here is the same reader the
          // fallback feeds and neither can drift from the other.
          if (obj(c.field_curves)) setFieldCurves(c.field_curves as Record<string, FieldCurveRow>);
          // THE REACH SENTENCE'S ONE PASS. `fields` above is a PROJECTION of
          // this same object (refresh_explore_cache), so tiled_n and board.n
          // describe exactly the rows the tiles are drawn from — which is the
          // property the sentence's "same hourly scan" asserts.
          if (obj(c.field_grid)) setGrid(c.field_grid as FieldGrid);
          if (obj(c.totals)) setTotals(c.totals as Totals);
          if (obj(c.repost_index)) setRepostIndex(c.repost_index as RepostIndex);
          if (typeof c.computed_at === "string") setComputedAt(c.computed_at);
          if (Array.isArray(c.stale_parts)) {
            setStale((c.stale_parts as unknown[])
              .filter((x): x is string => typeof x === "string")
              .filter((x) => !RETIRED_CACHE_PARTS.has(x)));
          }
        }
      } catch { /* the tiles still render, without counts */ }
      setCacheDone(true);
      setLoading(false);
    })();
  }, []);

  // ── THE FIELD LIFECYCLE CURVES, CACHE FIRST AND LIVE ONLY AS A FALLBACK ───
  //
  // get_category_fill_curve already existed (20260906092000:110), is already
  // anon-granted (:505), already runs the same estimator under the same
  // sufficiency flag (:445), and is already fetched per mount by /jobs. This
  // page referenced it ZERO times, which is what this rebuild fixes.
  //
  // BUT IT IS A 44-SECOND SCAN. Measured live against production while this was
  // written: 44.3s, HTTP 200, eighteen rows, n_at_risk_14 in the ten thousands
  // and `sufficient` true — the estimator passes comfortably at field grain,
  // exactly as intended, and the query is simply expensive (three scans, a 60s
  // statement timeout). Putting that on the DEFAULT view of every visitor is
  // the same mistake this page already made once with get_transparent_employers,
  // where "every visitor paid 26s of database time for a section that had never
  // rendered". So:
  //
  //   • The hourly cache is the right home for it, under `field_curves`, read
  //     above. 20260909130000 now writes that block in refresh_explore_cache,
  //     so the steady state is a cached read costing nothing.
  //   • THE FALLBACK IS GATED ON AN EXPLICIT CLICK, NOT ON THE CACHE MISSING.
  //     This is the correction that matters, and it was shipped the other way
  //     round: the gate was `cache did not carry it`, and NOTHING wrote that
  //     key — no migration in the tree, which the SQL half confirms in words.
  //     A condition that is permanently true is not a fallback, it is the only
  //     path, so every visitor to the site's new DEFAULT view was going to pay
  //     44 seconds of database time against a 60-second statement timeout, on a
  //     page that is prerendered and sitemapped daily. That is precisely the
  //     get_transparent_employers failure quoted above, on far more traffic,
  //     with its own stated mitigation unshipped. The frontend deploys before
  //     migrations here, so "the migration will land" is not a defence: the
  //     unwritten key is the steady state for the whole of that window.
  //     So the scan fires only once a reader has OPENED a field — the same
  //     explicit-click rule sections 2-4 already follow — and never on a page
  //     view, a crawl, or a reader who came for the employer check.
  //   • It never blocks anything: the count on every tile, its link and the
  //     whole of sections 2-4 are usable while it is in flight.
  //   • And the placeholder SAYS HOW LONG, because a spinner with no stated
  //     cost is indistinguishable from one that is never going to finish.
  //
  // A RESOLVED ERROR IS STILL AN ERROR: supabase-js hands PostgREST failures
  // back through `error` and never by throwing, so the deploy window in which
  // the function is absent — and the 57014 a statement timeout produces — have
  // to be read explicitly, or every field would show the "record too thin"
  // refusal, which is a statement about the fields made out of an outage of
  // ours.
  useEffect(() => {
    // THREE CONDITIONS, AND THE THIRD IS THE ONE THAT KEEPS THIS OFF A PAGE
    // VIEW. Wait for the cache (`fieldCurves` is null on the first frame
    // regardless, so firing on it alone would run the 44-second query even
    // where the cache was about to answer); stop once we have an answer; and
    // never start at all until a reader has opened a field.
    if (!cacheDone || fieldCurves !== null || !curveWanted) return;
    let live = true;
    setCurveLive(true);
    void (async () => {
      const { data, error } = await Promise.resolve(rpc("get_category_fill_curve"))
        .then((r) => r as { data: unknown; error?: unknown })
        .catch(() => ({ data: null, error: true }));
      if (!live) return;
      if (error || !Array.isArray(data)) { setFieldCurves({}); return; }
      const map: Record<string, FieldCurveRow> = {};
      for (const r of data as FieldCurveRow[]) {
        if (r && typeof r.category === "string" && r.category) map[r.category] = r;
      }
      setFieldCurves(map);
    })();
    return () => { live = false; };
    // `fieldCurves` is both the dependency and the early return, so a cache row
    // that already carried the curves stops this from ever being asked, and a
    // completed fallback cannot re-trigger itself.
  }, [cacheDone, fieldCurves, curveWanted]);

  // THE CLICK THAT BUYS THE SCAN. Latched rather than tracked: once a reader
  // has opened any field they have asked for the lifecycle sentences, and
  // closing that field again must not cancel a query already in flight or
  // re-arm it on the next open.
  useEffect(() => { if (openField) setCurveWanted(true); }, [openField]);

  // The chosen answer lives in the URL, so it is shareable, survives Back, and
  // a crawler following ?i=check sees the employer check. A RETIRED id — the
  // five deleted leaderboards — is not an Intent and falls through to
  // DEFAULT_INTENT rather than landing a reader on something their link did not
  // name.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("i");
    if (isIntent(q)) setIntent(q);
  }, []);
  const chooseIntent = (next: Intent) => {
    setIntent(next);
    const u = new URL(window.location.href);
    u.searchParams.set("i", next);
    window.history.replaceState(null, "", u.toString());
  };

  // Debounced typeahead. 250ms and 3 chars keep this to roughly one request per
  // word typed, against a single-row lookup — no aggregate on the request path.
  useEffect(() => {
    const s = cq.trim();
    if (s.length < 3) { setCHits([]); setCState("idle"); return; }
    let alive = true;
    const id = setTimeout(() => {
      void Promise.resolve(rpc("get_company_suggest", { p_q: s }))
        .then((r: { data: unknown; error?: unknown }) => {
          if (!alive) return;
          // A non-array reply is a FAILURE, not an empty result. supabase-js
          // resolves rather than throws on a PostgREST error, so an undeployed
          // RPC arrives with data === null — and treating that as "no match" is
          // what printed "we don't carry that employer" over 498 open roles.
          if (r.error || !Array.isArray(r.data)) { setCHits([]); setCState("error"); return; }
          setCHits(r.data as SuggestHit[]);
          setCState("ok");
        })
        .catch(() => { if (alive) { setCHits([]); setCState("error"); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [cq]);

  const nf = useCallback((n: number) => n.toLocaleString(i18n.language), [i18n.language]);
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });

  /** THE COUNT ON A TILE, FORMATTED THROUGH THE SERVING CAP, so the number on
   *  the tile and the number on the page it opens are the same number in the
   *  same presentation. */
  const tileCount = useCallback(
    (n: number) => (n >= SERVE_COUNT_CAP ? `${SERVE_COUNT_CAP.toLocaleString(i18n.language)}+` : nf(n)),
    [i18n.language, nf],
  );

  /** A PRICED NUMBER, WITH ITS FLOOR MARKED IN THE VALUE. Returns null when the
   *  query could not produce a number at all, and every caller renders nothing
   *  in that case rather than a zero. */
  const pricedLabel = useCallback((p: Priced | undefined): string | null => {
    if (!p || p.failed) return null;
    if (p.capped) return `${SERVE_COUNT_CAP.toLocaleString(i18n.language)}+`;
    if (p.total === null) return p.atLeast !== null ? `${nf(p.atLeast)}+` : null;
    return nf(p.total);
  }, [i18n.language, nf]);

  /** THE EIGHTEEN TILES, ORDERED BY LIVE COUNT, WITH THE UNCATEGORISED BUCKET
   *  ALWAYS LAST.
   *
   *  Seventeen fields plus the bucket. The bucket does not compete for position
   *  by size — it is not a field, it is the rows whose field could not be read
   *  from the title, and sorting it into the middle of a list of fields would
   *  present it as one. */
  const tiles = useMemo(() => {
    const named = BOARD_CATEGORY_SLUGS.map((id) => ({ id, n: fields[id] }))
      .sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
    return [...named, { id: UNCATEGORISED, n: fields[UNCATEGORISED] }];
  }, [fields]);

  /** THE ONE REACH CLAIM ON THE PAGE, FROM ONE SCAN, AND WHY IT DOES NOT MATCH
   *  THE TILES.
   *
   *  The tiles are formatted through SERVE_COUNT_CAP so each one agrees with
   *  the page it opens; this line is the UNCAPPED pair from the same hourly
   *  scan. The two therefore do not add up, and the sentence beneath says so IN
   *  WORDS rather than leaving a reader to discover it.
   *
   *  BOTH HALVES COME OFF get_explore_field_grid, AND THAT IS THE FIX RATHER
   *  THAN A DETAIL. This used to sum the rendered tiles and divide by
   *  totals.postings_n — a number from get_explore_denominators, a different
   *  function on a different scan at a different instant — under a sentence
   *  ending "as counted in the same hourly scan". During an ingest tick that
   *  pair can come out either way: covered above board tripped the wholeness
   *  branch and published "every posting we can serve — all N of them" as an
   *  equality neither statement proved, and covered below board published a
   *  fraction whose whole shortfall was scan skew, hiding the one thing the
   *  sentence is for (the fields the scan's 50-posting floor dropped).
   *  get_explore_field_grid already publishes `tiled_n` and `board.n` over one
   *  pass for exactly this fraction.
   *
   *  Absent whenever either half is absent — including the whole deploy window
   *  before the grid is in the cache. A reach fraction with a missing half is
   *  not a smaller claim, it is a different one, and no sentence is the honest
   *  render of it. */
  const reach = useMemo(() => {
    const board = grid?.board?.n;
    const tiled = grid?.tiled_n;
    if (typeof board !== "number" || board <= 0) return null;
    if (typeof tiled !== "number" || tiled <= 0) return null;
    // WHOLE, WHEN ONE STATEMENT SAYS IT IS WHOLE. Measured live while this was
    // written, the two halves are the SAME NUMBER — every servable posting
    // carries a category and every category cleared the floor, so the eighteen
    // tiles partition the board rather than sampling it. "At least 805,927 of
    // the 805,927 postings — about 100%" is a true sentence that reads like a
    // rounding artefact, and dividing a number by itself publishes a fraction
    // carrying no information. The stronger claim is also the simpler one.
    //
    // tiled_n is a subset sum of board.n BY CONSTRUCTION now, so it can never
    // exceed it and there is no over-100% case left to report around.
    if (tiled >= board) return { covered: board, board, pct: 100, whole: true };
    return { covered: tiled, board, pct: Math.round((tiled / board) * 1000) / 10, whole: false };
  }, [grid]);

  /** THE SLICE, AS ONE OBJECT. Everything on this page that shows a number or
   *  opens a page is built from this, mapped twice — searchToBoardBody for the
   *  count, searchToQuery for the link. */
  const sliceParams = useCallback((extra?: JobSearchParams): JobSearchParams => ({
    ...(openField ? { category: openField } : {}),
    ...(role ? { q: role } : {}),
    ...extra,
  }), [openField, role]);

  const sliceLabel = useMemo(() => {
    const field = openField ? t(`jobsPage.categories.${openField}`, CATEGORY_LABELS[openField] ?? openField) : null;
    if (role && field) return `${role} · ${field}`;
    return role ?? field ?? "";
  }, [openField, role, t]);

  // ── PRICE THE ROLE ROWS FOR THE OPEN FIELD ────────────────────────────────
  // On an explicit click, never on a page view. A field with no role
  // vocabulary of ours (the uncategorised bucket) asks for nothing and says so.
  useEffect(() => {
    if (!openField) { setRolePrices({}); setRolesPricing(false); return; }
    const names = FIELD_ROLES[openField];
    if (!names || names.length === 0) { setRolePrices({}); setRolesPricing(false); return; }
    let live = true;
    setRolePrices({});
    setRolesPricing(true);
    void (async () => {
      const results = await inBatches(names, 4, async (name) => [name, await priceSlice({ category: openField, q: name }, null)] as const);
      if (!live) return;
      const map: Record<string, Priced> = {};
      for (const [name, p] of results) map[name] = p;
      setRolePrices(map);
      setRolesPricing(false);
    })();
    return () => { live = false; };
  }, [openField]);

  // ── PRICE THE CONSTRAINT AND COUNTRY CHIPS FOR THE CHOSEN SLICE ───────────
  useEffect(() => {
    if (!openField) { setChipPrices({}); setCountryPrices({}); setChipsPricing(false); return; }
    let live = true;
    setChipPrices({});
    setCountryPrices({});
    setChipsPricing(true);
    void (async () => {
      const base = { ...(openField ? { category: openField } : {}), ...(role ? { q: role } : {}) } as JobSearchParams;
      const chips = await inBatches(CONSTRAINT_CHIPS, 4, async (c) =>
        [c.id, await priceSlice({ ...base, ...c.patch }, c.coverageKey)] as const);
      if (!live) return;
      const cm: Record<string, Priced> = {};
      for (const [id, p] of chips) cm[id] = p;
      setChipPrices(cm);
      const countries = await inBatches(COUNTRY_CHIPS, 3, async (c) =>
        [c.id, await priceSlice({ ...base, country: c.id }, "country")] as const);
      if (!live) return;
      const km: Record<string, Priced> = {};
      for (const [id, p] of countries) km[id] = p;
      setCountryPrices(km);
      setChipsPricing(false);
    })();
    return () => { live = false; };
  }, [openField, role]);

  // ── THE CLOSURE RECORD FOR THE CHOSEN SLICE ───────────────────────────────
  // Two calls, in order: a page of the slice's OWN RESULTS, whose rows carry
  // the employer token each posting belongs to, then ONE batched
  // get_company_fill_curve over the distinct tokens among them — exactly as
  // Jobs.tsx:4051 does it, from exactly the same source. NO new table, NO sort,
  // NO migration.
  //
  // NOT THE `companies` FACET, WHICH IS BOARD-WIDE. That was the obvious source
  // and it is the wrong one: it returns the same 33,545 employers and the same
  // top row for a four-role slice as for the whole 805,926-row board, with each
  // employer's WHOLE-BOARD count beside it. The full measurement is on
  // ClosureRecord.inSlice. Result rows are slice-scoped by construction, which
  // is the property this section needs and the only one that survives a
  // narrowing.
  useEffect(() => {
    if (!openField) { setClosure(null); setClosureFailed(false); setClosurePending(false); closureAsked.current = ""; return; }
    const sig = `${openField}|${role ?? ""}`;
    if (closureAsked.current === sig) return;
    closureAsked.current = sig;
    let live = true;
    setClosure(null);
    setClosureFailed(false);
    setClosurePending(true);
    void (async () => {
      // A FAILURE HERE IS OURS AND SAYS SO. Released from the dedupe on the way
      // out, so a later slice change retries rather than the session inheriting
      // one 404 as "no employer closes roles here".
      const giveUp = () => {
        if (!live) return;
        closureAsked.current = "";
        setClosureFailed(true);
        setClosurePending(false);
      };
      let page: BoardCountReply | null = null;
      try {
        const { data, error } = await supabase.functions.invoke("job-board", {
          // includeFacets FALSE, deliberately: the facet this call would return
          // is the board-wide employer list, and asking for it would put a
          // number on the page that answers a different question.
          body: { action: "list", limit: CLOSURE_ROWS, includeFacets: false, ...searchToBoardBody({ category: openField, ...(role ? { q: role } : {}) }) },
        });
        if (error) { giveUp(); return; }
        page = (data ?? null) as BoardCountReply | null;
      } catch { giveUp(); return; }
      if (!live) return;
      if (!page) { giveUp(); return; }
      const rows = page.jobs ?? [];
      const tokens = [...new Set(rows
        .map((j) => (typeof j?.token === "string" ? j.token : ""))
        .filter(Boolean))];
      if (tokens.length === 0) {
        // NO EMPLOYER COUNT IS INVENTED HERE. See ClosureRecord.inSlice.
        setClosure({ inSlice: null, rowsRead: rows.length, asked: 0, readable: 0, closers: 0, tokens: [], capped: false });
        setClosurePending(false);
        return;
      }
      const { data: curve, error: curveErr } = await Promise.resolve(rpc("get_company_fill_curve", { p_tokens: tokens }))
        .then((r) => r as { data: unknown; error?: unknown })
        .catch(() => ({ data: null, error: true }));
      if (!live) return;
      if (curveErr || !Array.isArray(curve)) { giveUp(); return; }
      setClosure(closureRecordOf(null, rows.length, tokens, curve as CompanyCurveRow[]));
      setClosurePending(false);
    })();
    return () => { live = false; };
  }, [openField, role]);

  /** The churn warning for one employer, or null — POSITIVE FORM ONLY.
   *
   *  A hit means "this employer cleared a rate gate of 5 re-lists per affected
   *  role on 25+ events". A MISS means only that it did not, which includes
   *  every employer whose board we have watched for a week. So there is no "no
   *  re-posting detected", no green tick and no clean-bill styling anywhere. */
  const repostWarn = (token: string | undefined): string | null => {
    if (!token) return null;
    const hit = repostIndex[token];
    if (!Array.isArray(hit) || hit.length < 3) return null;
    const [events, roles, days] = hit;
    if (!(typeof events === "number" && events > 0 && typeof roles === "number" && roles > 0)) return null;
    // A FLOOR, MARKED IN THE VALUE RATHER THAN IN THE SENTENCE — this file's
    // own idiom ("10,000+" on the tiles), so every translation of
    // explore.repostWarn becomes a floor at once.
    return t("explore.repostWarn", "Re-lists roles: {{events}} re-postings across {{roles}} roles in {{d}}d", {
      events: `${nf(events)}+`, roles: `${nf(roles)}+`, d: days,
    });
  };

  /** THE SENTENCE UNDER A FIELD TILE. One of four, and three of them are
   *  refusals that say which side of the line the gap is on. */
  const lifecycleLine = (id: string): { text: string; muted: boolean } => {
    if (fieldCurves === null) {
      // NOT LOADING, AND NOT ABSENT. When the hourly cache did not carry the
      // curves and nobody has opened a field yet, we have not asked and are not
      // going to on a page view — so neither "reading…" (which promises an
      // answer that is not coming) nor fieldCurveAbsent (which is a claim about
      // the closure record) may render. The third sentence is about US.
      if (!curveWanted && cacheDone) {
        return { text: t("explore.fieldCurveDeferred", "open a field to read its closure record — that scan takes up to a minute, so we do not run it on arrival"), muted: true };
      }
      return {
        // THE COST, STATED. This scan runs for the better part of a minute when
        // it is not cached, and eighteen tiles all saying "reading…" with no
        // end in sight reads as a page that is broken rather than one that is
        // working. Everything else on the tile — the count, the link, the whole
        // panel behind it — is usable now.
        text: curveLive
          ? t("explore.fieldCurveSlow", "reading the closure record — this scan takes up to a minute")
          : t("explore.fieldCurveLoading", "reading the closure record…"),
        muted: true,
      };
    }
    const lc = fieldLifecycleOf(fieldCurves[id]);
    if (lc.kind === "absent") {
      return { text: t("explore.fieldCurveAbsent", "no closure record we can read for this field yet"), muted: true };
    }
    if (lc.kind === "window") {
      return { text: t("explore.fieldCurveWindow", "we have only watched this field for {{days}} days — not long enough to publish a figure", { days: lc.windowDays }), muted: true };
    }
    if (lc.kind === "thin") {
      return { text: t("explore.fieldCurveThin", "too few closures with a stated post date to publish a figure"), muted: true };
    }
    // NOT "TO FILL", AND NEVER "HIRED". What the lifecycle log observes is a
    // posting going away and not coming back, which can be a hire, a
    // withdrawal, a cancelled requisition or a retitle — those four are
    // indistinguishable to us and this page never picks one.
    // "GONE AND DID NOT COME BACK", WHICH IS EXACTLY WHAT THE MEDIAN IS OF.
    // median_days_to_fill is min{t : R(t) >= 0.5} over the FILL incidence, and
    // the estimator's "fill" is a closure that never returned. The first
    // spelling said only "were gone", which is TRUE but weaker than the number
    // supports — off-board incidence includes re-listings, so its median is at
    // or before this day — and the contract comment above rightly forbade the
    // weak S-form claim. It does NOT follow that the word to use is /jobs'
    // "filled": this page's standing rule is that a closure never means hired,
    // and a hire, a withdrawal, a cancelled requisition and a retitle are
    // indistinguishable to us. The exact claim needs neither word.
    const base = lc.kind === "median"
      ? t("explore.fieldCurveMedian2", "half of these roles were gone within {{n}} days of the employer's own post date and did not come back · {{days}}-day closure log", { n: nf(lc.days), days: lc.windowDays })
      // R(14) IS THE FALLBACK FIGURE, NOT A SECOND ONE. Where the incidence
      // never reaches half inside the thirty days we can observe there is no
      // median to print, and the day-14 incidence is the only thing the same
      // estimator can still say — so it appears HERE and nowhere else, rather
      // than riding alongside a median as a second number for the same
      // question. It is a CEILING and is rendered "up to": the collector logs
      // one superseded closure per title per 24h and DELETES the rest, so
      // re-listings it never saw are absent from the risk set and the closures
      // that remain take a larger share of a smaller cohort.
      : t("explore.fieldCurveCensored2", "we did not see half of these roles come down inside {{cap}} days · up to {{pct}}% were gone within {{h}} days and stayed gone · {{days}}-day closure log", {
          cap: FILL_SUPPORT_MAX_DAYS, pct: Math.round(lc.rate * 100), h: URGENT_FILL_MAX_DAYS, days: lc.windowDays,
        });
    const qualifier = lc.qualified
      ? ` · ${t("explore.fieldCurveCoverage", "across the {{pct}}% carrying the employer's own date", { pct: lc.coveragePct })}`
      : "";
    return { text: base + qualifier, muted: false };
  };

  /** SAVE THE SLICE THE READER ASSEMBLED.
   *
   *  Every slice built on this page was thrown away on navigation, while
   *  user_job_searches has persisted all 21 JobSearchParams (RLS-scoped) the
   *  whole time and src/lib/job-search-params.ts is the single mapper for them.
   *  The same insert /jobs performs, with the same name builder, so a search
   *  saved here is indistinguishable from one saved there — and reachable from
   *  the pills at the top of this section. */
  const saveSlice = async () => {
    if (!user || !openField) return;
    setSaveState("saving");
    const params = sliceParams();
    const name = searchName(params, t(`jobsPage.categories.${openField}`, CATEGORY_LABELS[openField] ?? openField));
    try {
      const { error } = await searchesTable().insert({ user_id: user.id, name, params });
      // 23505 is UNIQUE(user_id, name): the reader already has this exact
      // slice, which is a different message from a failure and must not borrow
      // its sentence.
      if (error) { setSaveState(error.code === "23505" ? "exists" : "failed"); return; }
      setSaveState("saved");
    } catch { setSaveState("failed"); }
  };

  useEffect(() => { setSaveState("idle"); }, [openField, role]);

  const INTENT_LABEL: Record<Intent, string> = {
    fields: t("explore.intentFields2", "Browse the whole board"),
    check: t("explore.intentCheck", "Check an employer"),
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NEW SEO KEYS. The old ones advertised, in seven languages, the five
          employer rankings this page no longer contains — and a crawler
          following that description would land on a field grid. */}
      <SEO
        title={t("explore.seoTitle4", "Explore Every Field on the Board — Live Counts, Real Role Sizes, and How Long Roles Last")}
        description={t("explore.seoDescription4", "Start from the field you work in, narrow to the actual role, then to remote, pay, experience or country — every number is a live count of the exact search the link runs, with how much of the board each filter can even see. Plus what our closure record does and does not say about the employers hiring in that slice.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline2", "Start with your field. Land on a list you can actually read.")}
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            {t("explore.subhead4", "Every field on the board, ordered by how many roles are open in it right now. Open one to see the roles inside it priced by real counts, then narrow by remote, pay, experience or country — each of those says how much of the board it can even see, because a filter over a column employers often leave blank hides roles rather than proving they are not there.")}
          </p>
          {computedAt && (
            <p className="text-xs text-muted-foreground/80 mt-2">
              {/* NARROWED, AND THE NARROWING IS THE POINT. "Everything you
                  open below is counted live" was false of one thing on the
                  page: a chip's COVERAGE percentage. The counts really are
                  live probes, but the percentage beside them comes from
                  coverageDisclosure, which reads the board's own cached
                  coverage block and falls back to pinned constants measured
                  2026-08-25 for four keys (hasStatedPay among them) on a pass
                  written before get_filter_coverage existed. This page cannot
                  tell a live figure from that fallback, so it must not claim
                  the figure is live — the sentence now covers the counts,
                  which are, and names the coverage figures' actual basis. */}
              {t("explore.asOfCounts2", "Field counts measured {{time}}, refreshed hourly. Every COUNT you open below is taken live, at the moment you click it. The coverage percentage beside a narrowing is not: it comes from the board's own hourly coverage scan of the whole board, not from your click.", {
                // i18n.language, not undefined. `undefined` resolves to the
                // BROWSER's locale, which is independent of the language the
                // reader picked — so a German page rendered its one visible
                // date in English.
                time: new Date(computedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
          {stale.length > 0 && (
            <p className="mt-1.5 text-xs text-warning">
              {t("explore.staleParts", "{{parts}} could not be recomputed in the last refresh and are shown from an earlier run.", { parts: stale.join(", ") })}
            </p>
          )}
          {computedAt && Date.now() - new Date(computedAt).getTime() > STALE_AFTER_MS && (
            <p className="mt-1.5 text-xs text-warning">
              {t("explore.staleAge", "The hourly refresh has not completed since then — everything below is from that run, not from now.")}
            </p>
          )}
        </div>

        {/* THE PAGE'S ONLY CONTROL, AND IT IS NOW TWO CHOICES RATHER THAN
            SEVEN. Five of the seven were rankings of twelve employers each;
            with them gone, the control is the field grid and the employer
            check, in that order. */}
        <div className="mb-8" role="tablist" aria-label={t("explore.intentAria", "What are you looking for?")}>
          <div className="flex flex-wrap gap-2">
            {INTENTS.map((i, idx) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={intent === i}
                // role="tablist" PROMISES arrow-key navigation. Shipping the
                // role without the keys is worse than shipping neither.
                tabIndex={intent === i ? 0 : -1}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const nextIdx = (idx + d + INTENTS.length) % INTENTS.length;
                  chooseIntent(INTENTS[nextIdx]);
                  const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  el?.[nextIdx]?.focus();
                }}
                onClick={() => chooseIntent(i)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium transition-colors min-h-[40px] ${
                  intent === i
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {INTENT_LABEL[i]}
              </button>
            ))}
            <Link
              to="/jobs"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-primary/40 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors min-h-[40px]"
            >
              <Briefcase className="w-3.5 h-3.5" />
              {t("explore.searchAll", "Search all jobs")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* ── 1. THE FIELD GRID — THE DEFAULT VIEW ──────────────────────────
            Eighteen tiles, ordered by live count, two lines each: the count,
            then the field's own lifecycle sentence. The eighteenth is the
            uncategorised bucket, which no field tile can reach. */}
        <div hidden={intent !== "fields"}>
          <Section
            icon={Layers}
            title={t("explore.fieldsTitle2", "Every field on the board")}
            blurb={t("explore.fieldsBlurb2", "Ordered by how many roles are open right now. Each one also says what our closure record can — and cannot — tell you about how long roles in that field last.")}
            note={reach
              ? (reach.whole
                ? t("explore.fieldsReachWhole", "Between them these tiles reach every posting we can serve — all {{board}} of them, as counted in the same hourly scan.", { board: nf(reach.board) })
                : t("explore.fieldsReach", "These tiles reach at least {{n}} of the {{board}} postings we can serve — about {{pct}}% — as counted in the same hourly scan.", { n: nf(reach.covered), board: nf(reach.board), pct: reach.pct }))
              : null}
          >
            <HowWeMeasure items={[
              {
                // {{cap}} IS THE SERVING WINDOW, NOT THE CURVE'S SUPPORT CAP.
                // See SERVE_WINDOW_DAYS: the two constants are both 30 and
                // move independently, and this sentence is about what the tile
                // COUNTS. The lifecycle sentences below are where
                // FILL_SUPPORT_MAX_DAYS belongs.
                term: t("explore.methodTileTerm", "The number on a tile"),
                method: t("explore.methodTileMethod", "An exact count of the postings we can serve in that field — open, and inside our {{cap}}-day freshness window — taken in the hourly scan whose time is printed at the top of this page. It is shown through the same {{n}} ceiling the serving API applies, so a tile reading “{{n}}+” opens a page that also reads “{{n}}+”. That ceiling is also why the tiles do not add up to the reach line above them: the reach line is the uncapped sum from the same scan, and the two are the same rows counted under two presentations.", { cap: SERVE_WINDOW_DAYS, n: SERVE_COUNT_CAP.toLocaleString(i18n.language) }),
              },
              {
                term: t("explore.methodLifecycleTerm", "The lifecycle line, and when it refuses"),
                method: t("explore.methodLifecycleMethod", "Half the roles we watched come down and stay down in that field were gone within this many days of the date the EMPLOYER put on the posting — never our own discovery date. It renders only when the field's own record clears the estimator's bar (at least 25 roles at risk, at least 5 observed closures, and an interval no wider than 15 points) AND at least {{cov}}% of the field's roles carry the employer's own date AND we have watched for at least {{days}} days. Below any of those we say so instead of showing a number. A closure is a posting going away and not coming back — a hire, a withdrawal, a cancelled requisition and a retitle are indistinguishable to us, and none of them is claimed here.", { cov: Math.round(FILL_COVERAGE_MIN * 100), days: FILL_RATE_MIN_TRACKING_DAYS }),
              },
              {
                term: t("explore.methodUncatTerm", "The last tile — the roles with no field"),
                method: t("explore.methodUncatMethod", "Where a posting lands when its field could not be read from its title. It is not a field and does not compete with the others for position, but it is a large part of the board and no field tile can reach it, so it gets a tile of its own."),
              },
            ]} />
            {loading && Object.keys(fields).length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" aria-hidden="true">
                <span className="sr-only" role="status" aria-live="polite">Loading fields…</span>
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/30 px-4 py-3">
                    <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${45 + ((i * 7) % 35)}%` }} />
                    <div className="mt-2 h-2.5 rounded bg-muted/60 animate-pulse" style={{ width: `${60 + ((i * 11) % 30)}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {tiles.map(({ id, n }) => {
                  const label = t(`jobsPage.categories.${id}`, CATEGORY_LABELS[id] ?? id);
                  const uncat = id === UNCATEGORISED;
                  const life = uncat ? null : lifecycleLine(id);
                  const open = openField === id;
                  return (
                    <li key={id} className={`rounded-xl border transition-colors ${open ? "border-primary/60 bg-card sm:col-span-2" : "border-border bg-card/60 hover:border-primary/50"}`}>
                      <div className="flex items-stretch">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => { setOpenField(open ? null : id); setRole(null); }}
                          className="min-w-0 flex-1 text-left px-4 py-3"
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-foreground">{label}</span>
                            {/* A field below the hourly scan's 50-posting floor
                                is absent from the payload entirely and renders
                                with NO number — the tile still works, it simply
                                makes no claim about depth. A thin field must
                                never render "0". */}
                            {typeof n === "number" && n > 0 && (
                              <span className="text-[12px] tabular-nums text-muted-foreground">{tileCount(n)}</span>
                            )}
                          </span>
                          {uncat ? (
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/80 italic">
                              {t("explore.uncatLine", "Roles whose field we could not read from the title — no field tile reaches these.")}
                            </span>
                          ) : (
                            <span className={`mt-0.5 block text-[11px] leading-snug ${life!.muted ? "text-muted-foreground/70 italic" : "text-muted-foreground"}`}>
                              {life!.text}
                            </span>
                          )}
                        </button>
                        {/* THE WAY STRAIGHT IN, kept beside the expander rather
                            than behind it: a reader who already knows their
                            field should not have to open a panel to reach the
                            board. Built through the same mapper that prices
                            everything else, so the link and any count of this
                            slice describe one query. */}
                        <Link
                          to={toBoard({ category: id })}
                          aria-label={t("explore.tileOpen", "Open {{field}} on the board", { field: label })}
                          className="flex items-center px-3 border-l border-border/60 text-muted-foreground/60 hover:text-primary transition-colors"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </div>

                      {open && (
                        <div className="border-t border-border/60 px-4 py-4">
                          {/* ── 2. PRICED ROLE ROWS ─────────────────────────
                              This adds no mass to the page. It changes the SIZE
                              of what a reader lands in, which is the actual
                              failure a field-sized list has. */}
                          <p className="text-[12px] font-semibold text-foreground">
                            {t("explore.rolesTitle", "The biggest roles in {{field}}", { field: label })}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t("explore.rolesNote", "Role names are ours, not the board's. Every count beside one is a live count of exactly the search that row opens, taken just now — a role we named that matches nothing here is left out rather than shown as zero.")}
                          </p>
                          {uncat ? (
                            <p className="mt-2 text-[12px] text-muted-foreground">
                              {t("explore.rolesUncat", "These roles have no field we could read, so we have no role list for them. Search by title on the board instead.")}
                            </p>
                          ) : rolesPricing && Object.keys(rolePrices).length === 0 ? (
                            <p className="mt-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.rolesPricing", "Counting each role…")}
                            </p>
                          ) : (
                            (() => {
                              const priced = (FIELD_ROLES[id] ?? [])
                                .map((name) => ({ name, p: rolePrices[name] }))
                                // A ROW WE COULD NOT PRICE DOES NOT RENDER. A
                                // failed probe is our instrument and a zero
                                // count is a role that is not here; neither is
                                // a row worth putting a reader through.
                                .filter((r) => r.p && !r.p.failed && ((r.p.total ?? 0) > 0 || r.p.capped || (r.p.atLeast ?? 0) > 0));
                              // AND A ROW BELOW THE FLOOR DOES NOT RENDER
                              // EITHER, which is a different refusal and is
                              // said separately below. This section's whole job
                              // is the SIZE of what a reader lands in;
                              // "database administrator 4" beside "data
                              // engineer 2,028" is an honest number attached to
                              // a click that reproduces the landing-size defect
                              // one grain down. A capped or floored count is
                              // above the bar by construction.
                              const rows = priced
                                .filter((r) => r.p!.capped || (r.p!.total ?? r.p!.atLeast ?? 0) >= ROLE_ROW_MIN)
                                .sort((a, b) => (b.p!.total ?? b.p!.atLeast ?? 0) - (a.p!.total ?? a.p!.atLeast ?? 0));
                              if (rows.length === 0) {
                                return (
                                  <p className="mt-2 text-[12px] text-muted-foreground">
                                    {rolesPricing
                                      ? t("explore.rolesPricing", "Counting each role…")
                                      // TWO DIFFERENT FACTS, TWO SENTENCES. "No
                                      // role name matched" and "every role name
                                      // matched too few to be worth a page" are
                                      // not the same statement about the board,
                                      // and letting the floor fall into the
                                      // first one would publish a falsehood
                                      // about a field that does have these
                                      // roles in it.
                                      : priced.length > 0
                                        ? t("explore.rolesBelowFloor", "Every role name we tried matched fewer than {{min}} roles in this field — too few to be worth a page of their own. Open the whole field instead, or search by title on the board.", { min: nf(ROLE_ROW_MIN) })
                                        : t("explore.rolesNone", "None of the role names we tried matched anything in this field right now.")}
                                  </p>
                                );
                              }
                              return (
                                <ul className="mt-2 divide-y divide-border/60">
                                  {rows.map(({ name, p }) => (
                                    <li key={name} className="flex items-center gap-2 py-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setRole(role === name ? null : name)}
                                        aria-pressed={role === name}
                                        className={`min-w-0 flex-1 text-left text-[13px] ${role === name ? "font-semibold text-primary" : "text-foreground/85 hover:text-primary"}`}
                                      >
                                        {name}
                                      </button>
                                      <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">{pricedLabel(p)}</span>
                                      <Link
                                        to={toBoard({ category: id, q: name })}
                                        aria-label={t("explore.roleOpen", "Open {{role}} on the board", { role: name })}
                                        className="shrink-0 text-muted-foreground/50 hover:text-primary transition-colors"
                                      >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              );
                            })()
                          )}

                          {/* ── 3. PRICED CONSTRAINT CHIPS ──────────────────
                              Under the chosen slice, each carrying its live
                              count AND the live coverage of the column it
                              filters on. */}
                          <p className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                            {sliceLabel
                              ? t("explore.chipsTitle", "Narrow “{{slice}}”", { slice: sliceLabel })
                              : t("explore.chipsTitleBare", "Narrow this field")}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {t("explore.chipsCoverageNote", "The percentage on a chip is how much of the board states that thing at all. A filter can only search what employers published — roles that did not say are hidden by it, not absent from the market. Where we hold no coverage reading for a filter, the chip shows its count and no percentage rather than a number we would have had to invent.")}
                          </p>
                          {chipsPricing && Object.keys(chipPrices).length === 0 ? (
                            <p className="mt-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.chipsPricing", "Counting each narrowing…")}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {CONSTRAINT_CHIPS.map((c) => {
                                const p = chipPrices[c.id];
                                if (!p || p.failed) return null;
                                // A CHIP WHOSE OWN FILTER THE SERVER DROPPED
                                // MUST NOT RENDER. normalizeFilters names what
                                // it refused in ignoredFilters, and a chip
                                // priced on a query the click will not run is
                                // the silent-filter failure this codebase has a
                                // contract against.
                                if (Object.keys(c.patch).some((k) => p.ignored.includes(k))) return null;
                                const label = pricedLabel(p);
                                if (label === null) return null;
                                if ((p.total ?? p.atLeast ?? 0) <= 0 && !p.capped) return null;
                                return (
                                  <Link
                                    key={c.id}
                                    to={toBoard({ category: id, ...(role ? { q: role } : {}), ...c.patch })}
                                    className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 text-[12px] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
                                  >
                                    <span>{t(`explore.chip.${c.id}`, c.label)}</span>
                                    <span className="tabular-nums text-muted-foreground">{label}</span>
                                    {c.coverageKey && p.coverage !== null && (
                                      <span className="text-[10px] text-muted-foreground/70">
                                        {t("explore.chipCoverage", "stated on {{pct}}%", { pct: Math.round(p.coverage * 100) })}
                                      </span>
                                    )}
                                    {c.coverageKey && p.coverage === null && (
                                      <span className="text-[10px] italic text-muted-foreground/60">
                                        {t("explore.chipCoverageUnknown", "coverage unknown")}
                                      </span>
                                    )}
                                    {/* THE EXCLUSION NO FIGURE MEASURES. Only
                                        the week chip carries one today, and it
                                        is the chip that hides the most: it
                                        binds posted_at, so every posting from a
                                        structurally undated vendor is dropped
                                        however new it is, and coverageDisclosure
                                        publishes no key for maxAgeDays to
                                        quantify it with. Rendering nothing here
                                        put the page's biggest silent exclusion
                                        under a note that reads silence as "we
                                        hold no reading". */}
                                    {c.note && (
                                      <span className="text-[10px] italic text-muted-foreground/60">
                                        {t(`explore.chipNote.${c.id}`, c.note)}
                                      </span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          )}

                          {/* WHERE. Country, because it is canonical and the
                              board publishes a coverage figure for it; a typed
                              city is neither. */}
                          <p className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                            <MapPin className="w-3.5 h-3.5 text-primary" />
                            {t("explore.whereTitle", "Where")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {COUNTRY_CHIPS.map((c) => {
                              const p = countryPrices[c.id];
                              if (!p || p.failed || p.ignored.includes("country")) return null;
                              const label = pricedLabel(p);
                              if (label === null) return null;
                              if ((p.total ?? p.atLeast ?? 0) <= 0 && !p.capped) return null;
                              return (
                                <Link
                                  key={c.id}
                                  to={toBoard({ category: id, ...(role ? { q: role } : {}), country: c.id })}
                                  className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card/60 text-[12px] text-foreground/85 hover:border-primary/50 hover:text-primary transition-colors"
                                >
                                  <span>{t(`explore.country.${c.id}`, c.label)}</span>
                                  <span className="tabular-nums text-muted-foreground">{label}</span>
                                  {p.coverage !== null && (
                                    <span className="text-[10px] text-muted-foreground/70">
                                      {t("explore.chipCoverage", "stated on {{pct}}%", { pct: Math.round(p.coverage * 100) })}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>

                          {/* ── 4. THE CLOSURE RECORD, AT SLICE GRAIN ───────
                              Not a leaderboard: a narrowing of the slice the
                              reader already has, with the gap in our record
                              stated as loudly as the finding. */}
                          <p className="mt-4 text-[12px] font-semibold text-foreground">
                            {t("explore.closureTitle", "What our closure record says about the employers here")}
                          </p>
                          {closureFailed ? (
                            <p className="mt-1 text-[12px] text-warning">
                              {t("explore.closureFailed", "We could not read our closure record just now. That is our measurement failing, and it says nothing about the employers in this slice.")}
                            </p>
                          ) : closurePending && !closure ? (
                            <p className="mt-1 text-[12px] text-muted-foreground" role="status" aria-live="polite">
                              {t("explore.closurePending", "Reading the closure record for this slice…")}
                            </p>
                          ) : closure && closure.asked > 0 ? (
                            <>
                              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                                {closure.inSlice !== null
                                  ? t("explore.closureBasis2", "{{inSlice}} employers have roles in this slice. We looked at {{asked}} of them and hold a readable closure record for {{readable}}.", {
                                      inSlice: nf(closure.inSlice), asked: nf(closure.asked), readable: nf(closure.readable),
                                    })
                                  : t("explore.closureBasisNoTotal2", "We read the first {{rows}} results for this slice, found {{asked}} employers among them, and hold a readable closure record for {{readable}} of those. This is not every employer hiring in the slice — the board publishes no count of those, and we are not going to guess one.", {
                                      rows: nf(closure.rowsRead), asked: nf(closure.asked), readable: nf(closure.readable),
                                    })}
                              </p>
                              {closure.readable > 0 && (
                                <p className="mt-1 text-[12px] leading-snug text-foreground/85">
                                  {t("explore.closureFinding", "{{closers}} of those {{readable}} have taken at least {{min}} roles down and not put them back up.", {
                                    closers: nf(closure.closers), readable: nf(closure.readable), min: CLOSURE_MIN_FILLS,
                                  })}
                                </p>
                              )}
                              <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
                                {/* THE BAR IS INTERPOLATED, NEVER TYPED. This sentence names the same
                                    number the finding above it takes from CLOSURE_MIN_FILLS, and a
                                    literal here is how a page goes on saying "three" after the bar
                                    moves. It matters most in a locale key: a translated VALUE beats
                                    the inline default, so a hardcoded three would survive in every
                                    language a change to the constant. */}
                                {t("explore.closureBasisNote2", "Counting, not estimating: taking {{min}} roles down and not re-listing them is arithmetic over closures we logged, and it stays true on a record far too thin to support a rate. It is not a claim that anyone was hired — a hire, a withdrawal, a cancelled requisition and a retitle look the same to us. The re-listing half is a floor, because we log one return per title per day and delete the rest, so this errs towards leaving employers out.", { min: CLOSURE_MIN_FILLS })}
                              </p>
                              {closure.tokens.length > 0 && (
                                <Link
                                  to={`/jobs?${new URLSearchParams({
                                    ...(role ? { q: role } : {}),
                                    category: id,
                                    company: closure.tokens.join(","),
                                    from: "explore",
                                  }).toString()}`}
                                  className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
                                >
                                  {/* "THOSE" HAS TO BE TRUE OF THE LINK. The
                                      finding above counts every closer;
                                      Jobs.tsx round-trips at most twelve tokens
                                      through the comma-separated `company`
                                      param, so on a live Design slice this read
                                      "27 of those 51 have taken roles down"
                                      followed by "open this slice at THOSE 12
                                      employers" — the same word, fifteen
                                      employers quietly dropped between one
                                      sentence and the next. The capped copy
                                      names both numbers; the uncapped copy is
                                      unchanged, because there the word is
                                      accurate. */}
                                  {closure.capped
                                    ? t("explore.closureOpenCapped", "Open this slice at {{n}} of those {{closers}} employers", { n: nf(closure.tokens.length), closers: nf(closure.closers) })
                                    : t("explore.closureOpen", "Open this slice at those {{n}} employers", { n: nf(closure.tokens.length) })}
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </Link>
                              )}
                            </>
                          ) : (
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {t("explore.closureNone", "We hold no readable closure record for the employers in this slice yet.")}
                            </p>
                          )}

                          {/* SAVE THE SLICE. Everything assembled above was
                              thrown away on navigation until this existed. */}
                          {user && (
                            <div className="mt-4 border-t border-border/60 pt-3">
                              <button
                                type="button"
                                onClick={() => { void saveSlice(); }}
                                disabled={saveState === "saving" || saveState === "saved"}
                                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline disabled:opacity-60 disabled:no-underline"
                              >
                                <Bookmark className="w-3.5 h-3.5" />
                                {saveState === "saved" ? t("explore.saveDone", "Saved to your searches")
                                  : saveState === "exists" ? t("explore.saveExists", "You already saved this search")
                                  : saveState === "failed" ? t("explore.saveFailed", "Couldn't save — try again")
                                  : saveState === "saving" ? t("explore.saving", "Saving…")
                                  : t("explore.saveSlice", "Save this slice")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        {/* ── 5. CHECK AN EMPLOYER, PLUS THE SEARCHES YOU ALREADY SAVED ─────
            MOVED TO LAST, deliberately. It is the answer for a reader who
            already has a name in mind; the field grid is the answer for
            everyone who does not, which is who arrives here. */}
        <div hidden={intent !== "check"}>
          <Section
            icon={Search}
            title={t("explore.checkTitle2", "Check an employer — and how much of them we actually see")}
            blurb={t("explore.checkBlurb3", "Every employer whose board we carry. We show how many of their roles we hold and, where their own feed publishes a total, how much of their hiring never reaches this page.")}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodHoldTerm", "“Roles open on our board”"),
                method: t("explore.methodHoldMethod", "An exact count of what we are serving for that employer right now — the same rows its company page shows, under both serving predicates. Nothing caps it. It is still a FLOOR on their hiring: paginated job boards are read a page at a time, so we hold what we have read, which is why so many of these land on multiples of twenty."),
              },
              {
                term: t("explore.methodFeedTerm2", "The employer's own advertised total, and the gap it opens"),
                method: t("explore.methodFeedMethod2", "Where the feed publishes its own count we show it with the day we last read it, because we keep one row per board and overwrite it on every fetch — there is no history, so a board that went dark would otherwise advertise its last total forever. THE GAP BETWEEN THE TWO IS THE MOST USEFUL THING THIS CARD CARRIES: it is how much of that employer's own advertising our reading of their board did not reach on the day shown. DO NOT DIVIDE THE TWO NUMBERS: ours is a floor on what we hold today, theirs is a single reading taken on the date shown, and their ratio is not a coverage percentage. Where we carry several boards for one employer we show no total at all, because adding figures read on different days produces a number with no date basis."),
              },
            ]} />
            {/* THE SEARCHES A READER ALREADY BUILT. user_job_searches persists
                all 21 JobSearchParams, RLS-scoped, and every Explore section
                before this one referenced it zero times — so a slice assembled
                here was thrown away the moment the reader navigated. Renders
                nothing when signed out or when there are none. */}
            <div className="mb-3">
              <SavedSearchPills />
            </div>
            <input
              type="search"
              value={cq}
              onChange={(e) => setCq(e.target.value)}
              placeholder={t("explore.checkPlaceholder", "Type a company name…")}
              aria-label={t("explore.checkTitle2", "Check an employer — and how much of them we actually see")}
              className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cHits.length > 0 && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cHits.map((h) => {
                  /* ACROSS ALL ITS FEEDS, worst first: an employer with four ATS
                     feeds merges into one row here (get_company_suggest groups by
                     display name) while the churn index is keyed by token, so
                     checking only tokens[0] would miss churn on a sibling feed. */
                  const worstToken = h.tokens
                    .filter((tk) => Array.isArray(repostIndex[tk]))
                    .sort((a, b) => (repostIndex[b]![0] ?? 0) - (repostIndex[a]![0] ?? 0))[0];
                  const worst = worstToken ? repostWarn(worstToken) : null;
                  const open = numOr(h.open_roles);
                  const single = h.tokens.length === 1;
                  // ONE GUARD, TWO CALL SITES. `single` is checked here as well
                  // as in the SQL: a later change that started summing several
                  // boards' advertised totals would otherwise reach the screen
                  // as one number carrying one board's date.
                  const feed = single ? feedTotalClaim(open, numOr(h.feed_total), typeof h.feed_total_at === "string" ? h.feed_total_at : null) : null;
                  /* A MISSING COLUMN IS OUR INSTRUMENT; A MISSING READING IS A
                     FACT ABOUT THE RECORD. get_company_suggest returned (name,
                     tokens) alone until 20260908136000, so every read below
                     resolved to undefined and the page told every single-board
                     reader "we hold no dated reading of this employer's own
                     total" — a confident falsehood about our own holdings.
                     PostgREST sends a NULL column as a present key, so
                     `undefined` here means the deployed function does not return
                     the column at all. */
                  const hasFeedColumn = h.feed_total !== undefined;
                  return (
                  <Link
                    key={h.name}
                    to={`/jobs/company/${encodeURIComponent(h.tokens[0])}?from=explore`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
                  >
                    <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
                      {h.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground truncate">{h.name}</span>
                      {/* OUR COUNT IS AN INSTANT and says so ("now"); the
                          employer's own total carries the day we read it. */}
                      {open !== null && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("explore.fillOpen", "{{n}} roles open on our board now", { n: nf(open) })}
                        </span>
                      )}
                      {feed && (
                        /* THE GAP, NAMED AS A COUNT AND NEVER AS A RATIO. The
                           subtraction is between two numbers we hold — how many
                           they advertised on the day shown, and how many we
                           serve — and it is the windowing story per employer:
                           what our reading of their board did not reach. It is
                           NOT a coverage percentage, which is why the sentence
                           states the difference and both of its terms rather
                           than dividing them. The gate only established that
                           their total EXCEEDS ours, so the inference stays
                           hedged: 101 against 100 satisfies it, and a "most of
                           their hiring is missing" claim would be a majority
                           assertion the gate never proved. */
                        <span className="block text-[11px] text-foreground/75 mt-0.5">
                          {t("explore.checkFeedGap2", "Their own feed advertised {{total}} roles when we read it on {{when}} — {{gap}} more than we serve for them here, so their board may show roles this page does not.", {
                            total: nf(feed.total), when: dateOf(feed.at), gap: nf(feed.total - feed.open),
                          })}
                        </span>
                      )}
                      {/* THE REFUSALS, STATED. Two different reasons, and they
                          must not borrow each other's sentence: a multi-feed
                          employer is a limit of what we may ADD UP, a missing
                          stamp is a limit of what we KNOW. */}
                      {!single && (
                        <span className="block text-[11px] text-muted-foreground/70 italic mt-0.5">
                          {t("explore.checkFeedMulti", "We carry {{n}} separate boards for this employer, read on different days, so we do not add their advertised totals together.", { n: h.tokens.length })}
                        </span>
                      )}
                      {single && !feed && hasFeedColumn && (
                        <span className="block text-[11px] text-muted-foreground/70 italic mt-0.5">
                          {t("explore.checkFeedUnknown", "We hold no dated reading of this employer's own total, so we cannot say how much of their hiring is missing here.")}
                        </span>
                      )}
                      {h.tokens.length > 1 && (
                        <span className="block text-[11px] text-muted-foreground">
                          {t("explore.checkFeeds", "{{n}} job boards", { n: h.tokens.length })}
                        </span>
                      )}
                      {worst && <span className="block text-[11px] text-warning mt-0.5">{worst}</span>}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </Link>
                  );
                })}
              </div>
            )}
            {/* A GENUINE MISS. Only reachable when the lookup actually answered
                and returned nothing — never when it failed. */}
            {cState === "ok" && cHits.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("explore.checkNone", "We don't carry that employer's job board — so we have nothing measured to show you.")}
              </p>
            )}
            {/* A BROKEN LOOKUP, said as such. This must never borrow the
                sentence above: "we don't carry them" is a claim about the
                employer, and we are in no position to make it when our own query
                did not answer. */}
            {cState === "error" && (
              <p className="mt-3 text-sm text-warning">
                {t("explore.checkErr", "Employer lookup is unavailable right now — this says nothing about that employer. Try again shortly.")}
              </p>
            )}
            {cState === "idle" && cq.trim().length === 0 && !user && (
              <div className="mt-4">
                <Refusal
                  title={t("explore.checkIdleTitle", "Nothing typed yet")}
                  body={t("explore.checkIdleBody", "This looks up one employer at a time. If you don't have a name in mind, the field grid above reaches far more of the board than any single employer can.")}
                />
              </div>
            )}
          </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
