// Explore — six answers, each one a sentence that changes a decision with its
// evidence attached beneath it in a fixed form: FIGURE, WINDOW, SAMPLE, DATE
// BASIS, and every floor marked in the number itself.
//
// Everything here is COMPUTED from the board's own lifecycle tracking. Nothing
// is curated and nothing is inferred from our own discovery dates. Where a gate
// refuses, the page says so in words — a refusal is a statement about our
// evidence, never a silence a reader will read as "no data".
//
// WHAT LEFT THIS PAGE, AND WHY (all five removals are load-bearing):
//   • "Hiring at scale" (get_size_segments) — the bands are cut on
//     sum(on_board) while the card prints max(on_board), so four feeds of 300
//     landed under "1,000+ open roles" printing "300 on our board". Its one
//     useful number — the employer's own advertised total — moved into the
//     employer check, under the date gate, where it can only render with the
//     day it was read.
//   • The "By field" note line — it printed get_explore_denominators' UNCAPPED
//     count as "open across the board right now" while the chips beneath it are
//     formatted through SERVE_COUNT_CAP. One sentence, two runtimes, two
//     numbers. The chips stay; the sentence is gone.
//   • R(14) as a headline — demoted to the evidence line under the median.
//   • "Serial re-posters" — heading, ranking, per-card window and the client
//     clamp, all four. Replaced by "The dates here are not what they look
//     like", which groups on the SQL normalisation of the title rather than on
//     the raw string. See the note on that section: under an
//     events-per-affected-role ranking, raw-title grouping hands the top score
//     to whichever employer varies its titles LEAST.
//   • trending and newest — already unread here; the cache-side computation is
//     retired with them (this file's contract asks for neither key).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
// Building2 went with "Hiring at scale". Hourglass leads the duration answer,
// CalendarClock the re-listing answer, AlarmClock the age-out answer — Section's
// icon prop is typed off LucideIcon rather than off an icon it happens to
// receive, so a removed section never strands an import to satisfy a type.
import { LucideIcon, TrendingUp, GraduationCap, DollarSign, Hourglass, ArrowRight, Briefcase, Repeat, CalendarClock, AlarmClock, BadgeDollarSign, Search } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
// The methodology disclosure /ghost-jobs and /hiring-trends already use —
// native <details>, in the accessibility tree, zero JS.
import { HowWeMeasure } from "@/components/HowWeMeasure";
import { supabase } from "@/integrations/supabase/client";
// ONE BAR, ONE DECLARATION. These constants and the two predicates over them
// decide whether an employer's record may carry a published claim, and /jobs
// declares them. A second literal here is the drift: editing one file would be
// silent on the other, and the two surfaces would publish and refuse the same
// employer. FILL_SUPPORT_MAX_DAYS is the serving cap the medians are censored
// at — the reason p50_days_open is a LOWER bound and prints with a "+".
import { canStateFillRate, coverageBand, FILL_COVERAGE_MIN, FILL_RATE_MIN_TRACKING_DAYS, FILL_SUPPORT_MAX_DAYS, URGENT_FILL_MAX_DAYS } from "@/pages/Jobs";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

/** COERCE AT THE BOUNDARY, ONCE — /jobs' own `num()`, for the same row shape.
 *  An absent column reads as null, which is a REFUSAL rather than a zero: a
 *  gate that cannot be evaluated must suppress the claim, not pass it.
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

interface CompanyRow {
  company: string; company_token: string;
  open_roles?: number;
  /** Median days a FILLED role stayed up, from the employer's own posted_at
   *  alone. A LOWER BOUND: we stop serving a posting at FILL_SUPPORT_MAX_DAYS,
   *  so no closure can be observed later than that and roles that outlived the
   *  cap cannot enter the median. Rendered with a "+" on the number itself. */
  p50_days_open?: number | null;
  /** The sample behind p50_days_open: filled roles carrying a stated post date.
   *  NOT n_at_risk_14, which is the survivors at day 14 and is a gate input. */
  dated_n?: number;
  pay_pct?: number; median_usd_floor?: number | null;
  /** NEW ON get_transparent_employers. How many of the employer's served
   *  postings carry a PARSED USD ANNUAL FLOOR (salary_currency = 'USD' AND
   *  salary_min_annual > 0) — the sample the median floor is computed over, and
   *  NOT the same population as pay_pct's, which counts any pay statement in any
   *  currency or period. Copy that calls this "roles that state pay in US
   *  dollars" prints a number an order of magnitude below the badge beside it.
   *  Without it this page gated the median on TOTAL open roles, which is not
   *  the median's sample: one USD posting on a 300-role board published a
   *  "median floor" with a sample of one. */
  usd_n?: number | null;
  entry_roles?: number; tracking_days?: number;
  feed_total?: number | null;
  /** When feed_total was last read. job_board_verifications keeps ONE ROW PER
   *  BOARD and is UPSERTed on every fetch, so it has no history: a board that
   *  went dark holds its last advertised total forever. Without this stamp
   *  feed_total is a number with no date basis and is not published. */
  feed_total_at?: string | null;

  // ── THE MEASURE, AS THE REWRITTEN RPC RETURNS IT ────────────────────────
  // Names and meanings are get_actively_hiring_companies' own COMMENT ON:
  //   filled_roles_ceiling  roles that closed once and did not come back. A
  //                         CEILING — the collector deletes deduped re-lists.
  //   relisted_roles_floor  roles that closed twice, were superseded, or serve
  //                         again today. A FLOOR.
  //   fill_incidence_14d    the curve's R(14). Also a CEILING.
  //   dated_share           coverage; the RPC does NOT gate on it and its
  //                         COMMENT ON says the caller must (FILL_COVERAGE_MIN).
  // `closed_90d` is deliberately never read here: it is the legacy name that
  // put 4,331 "fills" on JLL's card.
  //
  // TYPED `number | string` for the PostgREST numeric-as-string build; every
  // read goes through numOr().
  filled_roles_ceiling?: number | string | null; relisted_roles_floor?: number | string | null;
  fill_incidence_14d?: number | string | null; fill_incidence_14d_lo?: number | string | null;
  fill_incidence_14d_hi?: number | string | null; dated_share?: number | string | null;
  fills_window_days?: number | string | null; at_risk_14d?: number | string | null;

  // ── THE CURVE'S OWN COUNTS, FROM ONE SOURCE ─────────────────────────────
  // Merged either by refresh_explore_cache (server-side, per ranked token) or
  // by the fallback effect below for a cache row written before that. Distinct
  // names from the RPC's columns because they are a DIFFERENT POPULATION: the
  // curve applies the retroactive feed-dark proxy to unstamped history, the
  // hiring RPC applies only the stamped `suspect` column. The age-out answer
  // reads all three together and never mixes them with the RPC's role counts —
  // these are windows of EVENTS ("named for a window of events and stay a
  // window of events", 20260906091000), the RPC's are windows of ROLES.
  fill_rate_14?: number | string | null; fill_rate_14_lo?: number | string | null;
  fill_rate_14_hi?: number | string | null; dated_coverage?: number | string | null;
  sufficient?: boolean;
  curve_fills_90d?: number; curve_relists_90d?: number;
  /** Postings still advertised when they crossed our serving cap. Counts exit
   *  ledger rows with exit_reason 'aged_out' ALONE — 'backdated' rows are OUR
   *  late knowledge of an old posting, not the employer leaving it up. A FLOOR:
   *  batches the collector marked feed-dark are censored out of it. */
  curve_ageouts_90d?: number;
  curve_tracking_days?: number;
}

/** ONE ROW OF THE RE-LISTING ANSWER, from get_relisting_employers.
 *
 *  THE TITLE PORT IS THE WHOLE POINT. job_board_closures.title is RAW
 *  (job-board/index.ts:5410) while `superseded` and the 24h dedupe both key on
 *  normalizeCloseTitle (index.ts:5385/5425). Grouping the ranking on the raw
 *  string, once the key is events-per-affected-role, hands the top score to
 *  whichever employer varies its titles LEAST — every requisition-number
 *  variant becomes its own "role", inflating the denominator of exactly the
 *  employers this section names. The SQL groups on an IMMUTABLE
 *  normalize_close_title(text) carrying the same two regexes. */
interface RecyclingRow {
  company: string; company_token: string;
  /** Superseded closures in the window, grouped by normalize_close_title. A
   *  FLOOR — the collector logs the first per normalised title per employer per
   *  24h and deletes the rest. */
  relist_events_floor?: number | string | null;
  /** Distinct NORMALISED titles that came back at least once. A FLOOR: the 24h
   *  dedupe never removes a title, but a feed-dark batch drop can take a
   *  title's only event with it. */
  relisted_titles?: number | string | null;
  /** The ranking key, computed server-side: events per normalised title. NOT a
   *  floor, and the column name no longer says one. The 24h dedupe alone would
   *  leave the denominator whole — the first event of every title always logs —
   *  but the feed-dark rule drops WHOLE BATCHES, and a title whose only logged
   *  event was in a dropped batch leaves the title count as well as the event
   *  count. Removing (e events, 1 title) from (E, T) moves E/T up when e < E/T
   *  and down when e > E/T, so the direction is unknowable and the card prints
   *  no "+" on it. Never derived here — the number the cards are ordered by is
   *  the number the query grouped by. */
  events_per_title?: number | string | null;
  /** The most re-listed title in the group and its count (a FLOOR), plus the
   *  first time we saw that particular title recycled. `worst_title` is one of
   *  the RAW strings from the group (the modal spelling), shown because a
   *  reader recognises a real title — the GROUPING behind the count is the
   *  normalised one. */
  worst_title?: string | null; worst_title_events_floor?: number | string | null;
  worst_title_first_at?: string | null;
  /** The first date we saw ANY title recycled at this employer. */
  first_relisted_at?: string | null;
  /** Days since this employer's own first re-listing. Distinct from
   *  window_days, which is the board-wide span this measurement covers. */
  observed_days?: number | string | null;
  /** ONE WINDOW, COMMON TO EVERY CARD — days of closure log this measurement
   *  covers. The log began 2026-07-14; "90 days of watching" is a watch we did
   *  not perform, so the number comes from the query rather than a constant.
   *  No window, no card. */
  window_days?: number | string | null;
  /** The board-wide median and ninetieth percentile of events-per-title,
   *  RE-MEASURED in this same window under this same grouping, over
   *  board_pool_n employers. Never the 2.7 from 20260812130736: that was
   *  measured 2026-08-12, on RAW titles, on the old unbounded window at 29 days
   *  of log. A measured number may not be reused under a definition it was not
   *  measured under. */
  board_median_per_title?: number | string | null;
  board_p90_per_title?: number | string | null;
  board_pool_n?: number | string | null;
}

/** The age-out series' DATE BASIS, board-wide, from get_ageout_basis. It
 *  publishes no count deliberately: get_company_fill_curve.ageouts_90d is the
 *  single owner of that quantity and a second copy would drift from it. The
 *  column is named for ninety days; the exit ledger began 2026-07-26 and is
 *  pruned at ninety, so the record is SHORTER than the name and a card that
 *  prints the count has to say how much ledger there is. Both keys are absent
 *  (never zero) on an empty ledger. */
interface AgeoutBasis { ageout_log_start?: string; ageout_log_days?: number }

/** ONE HIT FROM get_company_suggest, with the two counts the check answer needs.
 *
 *  `open_roles` is an EXACT count of what /jobs/company/{token} serves (both
 *  serving predicates) and a FLOOR on the employer's own hiring, because
 *  paginated vendors are read a page at a time. `feed_total` is the employer's
 *  own advertised number and `feed_total_at` the day we read it — and the SQL
 *  returns both ONLY for an employer we carry a single board for, because
 *  summing several boards' totals read on different days is a figure with no
 *  date basis. `boards` is checked here too, so a later SQL change cannot slip
 *  a mixed-date sum onto the page. */
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

/** THE ONLY PATH feed_total TAKES ONTO THIS PAGE — lifted out of the hiring
 *  card, where it was the single guarded call site, so the employer check can
 *  make the same statement under the same three conditions and no third call
 *  site can invent a fourth rule.
 *
 *  1. The employer's own total must be larger than what we hold, or there is no
 *     gap to report and printing it invites the comparison anyway.
 *  2. It must carry the day it was read. job_board_verifications has no
 *     history; without the stamp the number reads as current when it may be
 *     three weeks stale, and the standing rule on this product is that a
 *     published statistic names its date basis.
 *  3. We must know our own count, because the sentence is a comparison.
 *
 *  IT RETURNS TWO NUMBERS AND NEVER A RATIO. Ours is a floor on what they have;
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

interface SalaryRow { category: string; currency: string; n: number; median_annual_min: number }

const CATEGORY_LABELS: Record<string, string> = {
  engineering: "Engineering & IT", data_ai: "Data & AI", design: "Design", product: "Product",
  marketing: "Marketing & Comms", sales: "Sales & Partnerships", customer: "Customer Success",
  finance: "Finance & Accounting", legal: "Legal & Compliance", people_hr: "People & Recruiting",
  operations: "Operations & Logistics", healthcare: "Healthcare & Clinical", science: "Science & Research",
  education: "Education", hospitality_retail: "Hospitality & Retail", security: "Security & Trust",
  admin: "Administrative", other: "Other",
};
const CCY: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** MIRRORS `COUNT_CAP` in supabase/functions/job-board/index.ts:5626.
 *
 *  The serving API stops counting at 10,000 and replies `countCapped: true`, so
 *  /jobs/field/marketing renders "10,000+" no matter how many roles are there.
 *  A chip printing an uncapped SQL count would open a page saying "10,000+" —
 *  same number, two runtimes, two presentations. */
const SERVE_COUNT_CAP = 10_000;

/** MIRRORS the >= 20 served-postings floor get_transparent_employers already
 *  applies to an employer's board, applied here to the MEDIAN'S OWN SAMPLE.
 *
 *  Until the row carried usd_n there was no honest way to gate it, so the gate
 *  read `open_roles >= 20` — the size of a different population than the one
 *  the median was computed over. One USD posting among 300 published a median
 *  floor with a sample of one and no way for a reader to see it. */
const PAY_MEDIAN_MIN_USD_N = 20;

/** THE ENTRY-LEVEL FLOORS, MIRRORING get_entry_level_companies' own HAVING.
 *
 *  Applied here as well as there for the deploy window, and permanently for the
 *  same reason every other bar on this page is re-applied client-side: the card
 *  states the floors in words, so a payload written before the migration must
 *  not put a row under that sentence which does not clear them. Ranking on the
 *  share without them would hand the top of the list to a three-role board with
 *  a perfect ratio. */
const ENTRY_MIN_ENTRY_ROLES = 10;
const ENTRY_MIN_OPEN_ROLES = 50;

/** ORDERED BY THE SHARE, WHICH IS THE FIGURE THE CARD PRINTS.
 *
 *  Measured live before this was written: get_entry_level_companies still
 *  ordered by COUNT, so the twelve rows arrived 39%, 17%, 17%, 44%, 86% — under
 *  a heading that promised a ranking by share. A page whose order contradicts
 *  its own sentence is the defect this rebuild exists to remove, so the order on
 *  screen is enforced here rather than assumed from the payload. Which twelve
 *  employers arrive is still the server's decision, and the note under the
 *  heading says so rather than implying these are the top twelve on the board. */
export const rankEntry = (rows: CompanyRow[]): CompanyRow[] =>
  rows.filter((r) => {
    const open = numOr(r.open_roles);
    const ent = numOr(r.entry_roles);
    return open !== null && ent !== null
      && ent >= ENTRY_MIN_ENTRY_ROLES && open >= ENTRY_MIN_OPEN_ROLES;
  }).sort((a, b) =>
    // The server's ORDER BY, term for term: share DESC, then the raw entry
    // count DESC. Mirrored rather than invented, so a cache row and a live row
    // cannot produce two different pages.
    (numOr(b.entry_roles) as number) / (numOr(b.open_roles) as number) -
    (numOr(a.entry_roles) as number) / (numOr(a.open_roles) as number)
    || (numOr(b.entry_roles) as number) - (numOr(a.entry_roles) as number)
    || a.company_token.localeCompare(b.company_token));

/** MIRRORS refresh_explore_cache's `FILTER (WHERE r.rn <= 12)` and the live
 *  fallback's `p_limit: 12`. It is the size of the SLICE the client can see,
 *  and every client-side gate is applied to that slice alone — so every
 *  sentence counting cards or held-back employers is a statement about twelve
 *  rows and says so. */
const HIRING_SLICE = 12;
const fieldCount = (n: number, loc: string) =>
  n >= SERVE_COUNT_CAP ? `${SERVE_COUNT_CAP.toLocaleString(loc)}+` : n.toLocaleString(loc);

/** How old the hourly cache may be before the page stops presenting it as the
 *  current state of the board. Three hours, not one: a single missed run is
 *  ordinary jitter, and crying stale on it would train readers to ignore the
 *  line that matters when pg_cron actually dies — which it did, for a day. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** Collections this page no longer renders. A refresh that could not recompute
 *  one of them says nothing about what is on this screen, and naming it in the
 *  staleness warning is a false alarm about a section that does not exist.
 *  Unknown names are KEPT — a part we have not heard of may well be one we
 *  render tomorrow, and swallowing it would hide a real failure. */
const RETIRED_CACHE_PARTS = new Set(["trending", "newest", "segments", "reposters"]);

/** token -> [repost_events, reposted_roles, days_tracked]. */
type RepostIndex = Record<string, [number, number, number] | undefined>;

/** Pool sizes behind each collection. Every key is optional and every one is
 *  ABSENT rather than zero when its scan failed (NULLIF/strip_nulls in the
 *  cache builder). Nothing here may render as "0". */
interface Totals {
  hiring_n?: number; repost_pool_n?: number; repost_flagged_n?: number;
  relisting_pool_n?: number;
  entry_n?: number;
  /** THE GATE entry_n WAS COUNTED UNDER, published as data by
   *  get_explore_denominators. entry_n exists under BOTH the deployed five-role
   *  floor and this rebuild's 10-entry/50-open pair, so its PRESENCE cannot say
   *  which one produced it — and the frontend deploys before migrations apply.
   *  Every other new quantity here degrades to silence because its key is new;
   *  without these two, entry_n would degrade to a WRONG NUMBER under a sentence
   *  naming floors it was not counted under. */
  entry_min_entry?: number; entry_min_open?: number;
  pay_n?: number; pay_pool_n?: number;
  employers_n?: number; postings_n?: number; postings_pay_n?: number;
}

/** THE ONLY PLACE THIS FILE BUILDS A /jobs URL. Every card used to hardcode its
 *  own, which is how the entry-level card promised "38 entry-level roles" over
 *  a destination showing 900. A card's number and the filter its link carries
 *  are one decision, so they live in one function. `experience=entry` is read
 *  by Jobs.tsx:315 — verified, not assumed. */
const companyHref = (token: string, intent: Intent): string => {
  const base = `/jobs/company/${encodeURIComponent(token)}?from=explore`;
  return intent === "entry" ? `${base}&experience=entry` : base;
};

/** The seven answers, in the order they are asked and rendered. `ghost` and
 *  `hiring` keep their ids through the rebuild so every shared /explore?i=…
 *  link still lands on the answer it named; `scale` is gone, and isIntent
 *  rejects it rather than silently showing something else. */
type Intent = "check" | "hiring" | "ghost" | "aged" | "pay" | "entry" | "fields";
const INTENTS: readonly Intent[] = ["check", "hiring", "ghost", "aged", "pay", "entry", "fields"];
const isIntent = (v: string | null): v is Intent => !!v && (INTENTS as readonly string[]).includes(v);

// ─────────────────────────────────────────────────────────────────────────────
// THE CLAIMS. Each builder returns a fully-formed statement or null, and null
// is a refusal the section then STATES. No renderer below composes a figure
// from a row directly, so there is no path on which a number reaches the screen
// without the window it was measured over.
// ─────────────────────────────────────────────────────────────────────────────

/** The measure, from whichever of the two sources answered — the rewritten
 *  RPC's own columns first, the curve merge second. NEVER MIXED: a rate from
 *  one source beside a window from the other is the defect this page spent a
 *  week removing, one field at a time. */
const measureOf = (r: CompanyRow) => {
  const rate = numOr(r.fill_incidence_14d);
  if (rate !== null) {
    return {
      rate,
      lo: numOr(r.fill_incidence_14d_lo), hi: numOr(r.fill_incidence_14d_hi),
      coverage: numOr(r.dated_share),
      days: numOr(r.tracking_days),
      // The RPC returns no `sufficient` column and does not need to: it gates
      // on the curve's flag in its own WHERE, so a row carrying an incidence at
      // all IS the server's sufficiency finding. The client half of the gate is
      // the coverage floor (which its COMMENT ON leaves to the caller) and the
      // observation window, which `sufficient` never looks at.
      sufficient: true,
      answered: true,
    };
  }
  return {
    rate: numOr(r.fill_rate_14),
    lo: numOr(r.fill_rate_14_lo), hi: numOr(r.fill_rate_14_hi),
    coverage: numOr(r.dated_coverage),
    days: numOr(r.curve_tracking_days),
    sufficient: r.sufficient === true,
    // Did the curve answer at all? Distinguishes "this employer publishes no
    // posting dates" (a fact about their feed) from "our measurement did not
    // run" (a fact about us).
    answered: r.sufficient !== undefined,
  };
};

/** DOES THIS ROW ALREADY CARRY A MEASURE, from either source? One predicate,
 *  asked by the fallback effect's early return and by the derived `measuring`
 *  flag, which must never disagree. */
const hasMeasure = (r: CompanyRow): boolean =>
  numOr(r.fill_incidence_14d) !== null || numOr(r.fill_rate_14) !== null || r.sufficient !== undefined;

/** Why an employer the RPC ranked does not appear. Published as counts, so a
 *  thin record reads as a thin record and an outage of ours reads as an outage
 *  of ours — neither as a verdict about the employer. */
export type Held = "reposter" | "unmeasured" | "undated" | "window" | "estimate" | "duration";

/** THE DURATION CLAIM — the sentence this answer leads with, and the one figure
 *  on it big enough to act on.
 *
 *  Every field here is required to render, which is the design: `windowDays`
 *  and `sample` are not decoration beside the median, they are what makes it a
 *  measurement rather than a number. A median over an unknown span, or over an
 *  unstated number of roles, is refused. */
export interface DurationClaim {
  token: string; company: string;
  /** Median days a filled role stayed up, from the employer's own posted_at. A
   *  LOWER BOUND — rendered with the "+" ON THE NUMBER, because we stop serving
   *  at FILL_SUPPORT_MAX_DAYS and roles that outlived the cap cannot enter it. */
  p50: number;
  /** dated_n: filled roles carrying the employer's own post date. */
  sample: number;
  /** tracking_days: days we have watched THIS board, clamped [1,90] by the RPC.
   *  The employer's own span — never "90 days of watching", which is a watch we
   *  did not perform on a log that began 2026-07-14. */
  windowDays: number;
  coverage: number | null;
  /** 0.30–0.60 coverage: the figure may be said, and must name what it covers. */
  qualified: boolean;
  /** R(14), demoted to the evidence line. A CEILING — rendered "up to". */
  rate: number; lo: number | null; hi: number | null;
  /** Roles open on our board now. An exact count of what /jobs/company/{token}
   *  serves and a floor on the employer's own openings. */
  open: number | null;
  feedTotal: number | null; feedTotalAt: string | null;
  /** Roles observed back. A FLOOR — "at least N", or not rendered. */
  relists: number | null;
}

/**
 * THE ONE GATE, AND THE ONLY WAY A CARD ENTERS THE DURATION ANSWER.
 *
 *   reposter   — employers whose takedowns are mostly re-listings appear under
 *                the re-listing answer instead, never here with a warning
 *                stapled underneath.
 *   unmeasured — no measure and the curve never answered (an old cache row, a
 *                failed call, a refresh that timed out). OUR instrument.
 *   undated    — the curve DID answer and returned no rate: the employer's feed
 *                states no posting dates, so there is no cohort to run
 *                lifetimes over. A fact about their feed, not our instrument.
 *   window     — `sufficient` counts roles at risk, observed fills and interval
 *                width: statements about the sample, none about how long we
 *                watched. Lifetimes run from the employer's stated posted_at,
 *                so a ten-day-deep log can satisfy it. This is that missing half.
 *   estimate   — sufficiency and the coverage floor, through /jobs' predicate.
 *   duration   — everything above passed and the row still carries no median or
 *                no sample for one: too few of its closed roles carry a date
 *                from the employer. The rate survives that; a median does not.
 */
export const heldFor = (r: CompanyRow, serialReposters: ReadonlySet<string>): Held | null => {
  if (serialReposters.has(r.company_token)) return "reposter";
  const m = measureOf(r);
  if (m.rate === null) return m.answered ? "undated" : "unmeasured";
  if (m.days === null) return "unmeasured";
  if (!(m.days >= FILL_RATE_MIN_TRACKING_DAYS)) return "window";
  if (!canStateFillRate({ sufficient: m.sufficient, dated_coverage: m.coverage ?? 0 }, m.days)) return "estimate";
  const p50 = numOr(r.p50_days_open);
  const sample = numOr(r.dated_n);
  if (p50 === null || p50 <= 0 || sample === null || sample <= 0) return "duration";
  return null;
};

/**
 * THE DURATION ANSWER'S CONTENTS AND ITS OMISSIONS, COMPUTED ONCE.
 *
 * ORDERED BY THE FIGURE THE CARD LEADS WITH, which is not the order the server
 * chose and says so under the heading. The server decides WHICH twelve appear
 * (by fill incidence, over gates this page cannot re-run); this page decides
 * the order WITHIN them, by how quickly the median role came down, because that
 * is the question the heading asks. Ties fall to the larger sample, never to
 * the larger employer — a size tie-break inside a section about time is how the
 * previous ranking turned into a leaderboard of bigness.
 */
export function rankedDurationClaims(rows: CompanyRow[], serialReposters: ReadonlySet<string>):
  { shown: DurationClaim[]; held: Record<Held, number> } {
  const held: Record<Held, number> = { reposter: 0, unmeasured: 0, undated: 0, window: 0, estimate: 0, duration: 0 };
  const shown: DurationClaim[] = [];
  for (const r of rows) {
    if (!r || typeof r.company_token !== "string") continue;
    const why = heldFor(r, serialReposters);
    if (why) { held[why] += 1; continue; }
    const m = measureOf(r);
    shown.push({
      token: r.company_token,
      company: r.company,
      p50: numOr(r.p50_days_open) as number,
      sample: numOr(r.dated_n) as number,
      windowDays: m.days as number,
      coverage: m.coverage,
      qualified: coverageBand(m.coverage) === "qualified",
      // Clamped before rounding: an interval carried across from a second
      // estimator can land a hair outside [0,1], and 101% is a number this
      // model cannot produce.
      rate: Math.max(0, Math.min(1, m.rate as number)),
      lo: m.lo, hi: m.hi,
      open: numOr(r.open_roles),
      feedTotal: numOr(r.feed_total),
      feedTotalAt: typeof r.feed_total_at === "string" ? r.feed_total_at : null,
      // ONLY FROM THE SOURCE THAT COUNTED ROLES. relisted_roles_floor is roles;
      // the curve's relists_90d is EVENTS ("at least 465 of the roles came
      // back" from 465 events spanning maybe 80 roles overstates in the unsafe
      // direction — the defamation shape). Absent rather than relabelled.
      relists: numOr(r.relisted_roles_floor),
    });
  }
  shown.sort((a, b) => a.p50 - b.p50 || b.sample - a.sample || a.token.localeCompare(b.token));
  return { shown, held };
}

/** THE RE-LISTING CLAIM. Refused unless the query supplied its own ranking key,
 *  its own window and its own first-seen date — a card here accuses an employer
 *  of conduct, and every number in that accusation must be one the query
 *  produced. */
export interface RecyclingClaim {
  token: string; company: string;
  /** Re-lists per affected title — the ranking key, and NOT a floor: it is a
   *  ratio of two floors deflated by the same batch drops, so it moves up when
   *  the dropped title was quiet and down when it was loud. Rendered with no
   *  marker, because a "+" here would be a claim about direction on the one
   *  number this section ranks employers by, under a heading naming conduct. */
  perRole: number;
  events: number; roles: number;
  worstTitle: string | null; worstEvents: number | null;
  firstAt: string;
  windowDays: number;
  baseline: number | null; baselineP90: number | null; baselinePool: number | null;
}

export function recyclingClaimOf(r: RecyclingRow): RecyclingClaim | null {
  if (!r || typeof r.company_token !== "string" || !r.company_token) return null;
  const perRole = numOr(r.events_per_title);
  const events = numOr(r.relist_events_floor);
  const roles = numOr(r.relisted_titles);
  const windowDays = numOr(r.window_days);
  const firstAt = typeof r.first_relisted_at === "string" ? r.first_relisted_at : null;
  // NO WINDOW, NO CARD — and no derived ranking key either. Deriving
  // events/titles here would publish a number under a definition this page
  // chose rather than the one the query grouped by.
  if (perRole === null || events === null || roles === null) return null;
  if (!(events > 0 && roles > 0 && perRole > 0)) return null;
  if (windowDays === null || !(windowDays > 0)) return null;
  if (firstAt === null) return null;
  // AN INCOHERENT ROW IS NOT PUBLISHED. With at least one affected title the
  // ratio can never exceed the event count, so a row where it does is not a
  // strong finding — it is two numbers from two different queries, and the card
  // would assert something neither of them says. One judged draft of this
  // section shipped exactly that shape: 581 events across 3 roles on a card
  // whose own worst role showed 41.
  if (perRole > events) return null;
  const worstEvents = numOr(r.worst_title_events_floor);
  // AND THE INVARIANT THAT ACTUALLY BINDS. worst_title is the modal-maximum
  // group, so no other normalised title in the employer's set can hold more
  // events than it: the sum over titles cannot exceed titles x the largest
  // title. `perRole > events` does not catch that — 193.7 <= 581 passes, and so
  // does 41 <= 581 — which is how the judged draft's row (581 events across 3
  // titles whose own worst title showed 41; three titles capped at 41 hold 123)
  // would still have rendered. The WHOLE CARD drops, not just the worst-title
  // line: the incoherence is in the headline pair, and a card printing
  // "193.7x · 581+ across 3+ titles" is the accusation, with or without the
  // detail line beneath it.
  if (worstEvents !== null && events > roles * worstEvents) return null;
  return {
    token: r.company_token, company: r.company,
    perRole, events, roles,
    worstTitle: typeof r.worst_title === "string" && r.worst_title ? r.worst_title : null,
    // The worst single title cannot hold more re-lists than the employer's
    // whole total. Where it does, the line is dropped rather than printed: a
    // per-title figure larger than the sum it belongs to is a number the query
    // could not have produced.
    worstEvents: worstEvents !== null && worstEvents > 0 && worstEvents <= events ? worstEvents : null,
    firstAt, windowDays,
    baseline: numOr(r.board_median_per_title),
    baselineP90: numOr(r.board_p90_per_title),
    baselinePool: numOr(r.board_pool_n),
  };
}

/** RANKED ON THE RATE, WHICH IS COMPULSORY HERE. The heading makes a
 *  comparative claim about conduct, and ranking conduct by volume defames: a
 *  raw event count grows with board size, so a leaderboard of it is a
 *  leaderboard of bigness wearing an accusation. A rate does not.
 *
 *  THE FIGURES THAT USED TO SIT IN THIS COMMENT HAVE BEEN CUT, and the reason
 *  is the reason this section exists. "ALTEN 769 events at 2.6 per role,
 *  BAYADA 594 at 2.2, BoxLunch & Hot Topic 193.7 across three titles" were
 *  measured on 2026-08-12 by get_repost_churn_companies, on RAW titles, over an
 *  unbounded window, at 29 days of log — three definitions this section does
 *  not use. get_relisting_employers has never been executed (job_board_closures
 *  has no anon read path and no service key is available here), which is
 *  exactly why board_median_per_title is re-measured in-query rather than
 *  quoted. Restating old numbers as if they came from the new grouping is the
 *  provenance error this rebuild removes, and 193.7 x 3 = 581 is also the
 *  incoherent row recyclingClaimOf now refuses.
 *
 *  Mirrors the server's order so a pre-migration cache row cannot re-rank the
 *  page. */
export const rankRecycling = (rows: RecyclingRow[]): RecyclingClaim[] =>
  rows.map(recyclingClaimOf)
    .filter((c): c is RecyclingClaim => c !== null)
    .sort((a, b) => b.perRole - a.perRole || b.events - a.events || a.token.localeCompare(b.token));

/** THE AGE-OUT CLAIM — "still advertised when it crossed day 30".
 *
 *  ALL FOUR NUMBERS COME FROM THE CURVE AND NOTHING ELSE. Its fills_90d,
 *  relists_90d and ageouts_90d are one population under one feed-dark policy,
 *  and all three are windows of EVENTS. Taking the numerator from the curve and
 *  the denominator from get_actively_hiring_companies' role counts would be two
 *  populations in one ratio — the same defect as dividing our open count by the
 *  employer's advertised total, wearing different column names.
 *
 *  The share is of departures we LOGGED, not of the employer's roles: an
 *  age-out is our serving cap being reached, not the employer taking anything
 *  down, which is exactly why it is worth telling a reader about. */
export interface AgedClaim {
  token: string; company: string;
  /** exit_reason 'aged_out' alone. A FLOOR: the collector writes exit rows
   *  best-effort and logs a failed insert non-fatally, and feed-dark batches are
   *  censored out (20260908137000 brought the age-out arm under the same
   *  feed-dark policy as the other two — before it, this was the one count in
   *  the curve outside that policy, and the share below was an uncensored
   *  numerator over a partly censored denominator). */
  ageouts: number;
  /** The takedowns, re-listings and age-outs we logged for this board in the
   *  window, from the one measurement. ALSO A FLOOR: the 24h dedupe deletes
   *  repeat re-listings of a title outright. Exits we recorded as our own — a
   *  board we stopped tracking, a feed gone dormant — are in neither term. */
  departures: number;
  /** ageouts / departures, 0..1. A RATIO OF TWO FLOORS, so it carries NO
   *  direction marker: the dedupe understates the denominator (pushing it up),
   *  a missed exit row understates the numerator (pushing it down), and the two
   *  do not cancel by any argument available here. */
  share: number;
  /** curve_tracking_days: days since this employer's first logged CLOSURE. The
   *  age-out ledger began later than the closure log (2026-07-26 against
   *  2026-07-14) and is board-wide, so the card prints both spans rather than
   *  one span for a pair drawn from two ledgers. */
  windowDays: number;
}

export function agedClaimOf(r: CompanyRow): AgedClaim | null {
  if (!r || typeof r.company_token !== "string" || !r.company_token) return null;
  const ageouts = numOr(r.curve_ageouts_90d);
  const fills = numOr(r.curve_fills_90d);
  const relists = numOr(r.curve_relists_90d);
  const windowDays = numOr(r.curve_tracking_days);
  if (ageouts === null || fills === null || relists === null) return null;
  if (windowDays === null || !(windowDays > 0)) return null;
  const departures = ageouts + fills + relists;
  if (!(departures > 0) || !(ageouts > 0)) return null;
  return {
    token: r.company_token, company: r.company,
    ageouts, departures,
    share: Math.max(0, Math.min(1, ageouts / departures)),
    windowDays,
  };
}

/** THE AGE-OUT ANSWER'S POPULATION IS THE DURATION ANSWER'S POPULATION.
 *
 *  Only employers whose record already cleared the sufficiency, coverage and
 *  observation-window bars appear, so no card here rests on evidence the page
 *  refused one answer earlier. Ordered by the share, never by the count: a
 *  count of age-outs is a count of postings, and ranking employers by it is a
 *  ranking by size under a heading about conduct. */
export const rankAged = (rows: CompanyRow[], serialReposters: ReadonlySet<string>): AgedClaim[] =>
  rows.filter((r) => heldFor(r, serialReposters) === null)
    .map(agedClaimOf)
    .filter((c): c is AgedClaim => c !== null)
    .sort((a, b) => b.share - a.share || b.departures - a.departures || a.token.localeCompare(b.token));

// ─────────────────────────────────────────────────────────────────────────────
// RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

/** A collection of companies → each a deep-link into the board filtered to that
 *  company. One shared card grid so every section reads consistently. */
function CompanyGrid({ rows, badge, note, intent, tone = "default", warn }: {
  rows: CompanyRow[]; badge?: (r: CompanyRow) => string | null; note?: (r: CompanyRow) => string | null;
  intent: Intent; tone?: "default" | "warning"; warn?: (r: CompanyRow) => string | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {rows.map((r) => {
        const b = badge?.(r);
        const n = note?.(r);
        const w = warn?.(r);
        return (
          <Link
            key={r.company_token}
            to={companyHref(r.company_token, intent)}
            className={`group flex items-center gap-3 rounded-xl border bg-card/60 px-4 py-3 transition-colors ${
              tone === "warning"
                ? "border-warning/40 hover:border-warning hover:bg-warning/5"
                : "border-border hover:border-primary/50 hover:bg-card"
            }`}
          >
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary font-bold text-sm shrink-0">
              {r.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground truncate">{r.company}</span>
              {b && <span className="block text-[11px] text-muted-foreground">{b}</span>}
              {/* A REFUSAL RENDERS. A gate that suppresses a figure prints the
                  reason in its place, because a missing line reads as "no data"
                  when what happened is "we will not guess". */}
              {n && <span className="block text-[11px] text-muted-foreground/70 italic">{n}</span>}
              {/* THE CHURN WARNING, WHEREVER THE EMPLOYER APPEARS. Rendered only
                  on a hit, and only ever as a positive statement — a miss means
                  "did not clear the rate gate", which includes every employer we
                  have watched for a week. */}
              {w && <span className="block text-[11px] text-warning mt-0.5">{w}</span>}
            </span>
            {tone !== "warning" && (
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * THE DURATION CARD — one number, at the weight of the decision it supports.
 *
 * The hierarchy, in the order a job seeker reads it:
 *   1. WHO      — the employer.
 *   2. WHAT     — how long the median role stayed up, from the employer's own
 *                 date. The "+" is part of the number: the median is censored
 *                 at our serving cap and can only be longer.
 *   3. HOW SURE — the sample, the span we watched, and the coverage of the
 *                 employer's own dates, in one quiet line. The window is never
 *                 optional and never separable from the figure.
 *   4. THE REST — R(14), demoted to evidence; the open counts; the re-listing
 *                 caution behind a rule and in the warning colour.
 */
function DurationGrid({ claims }: { claims: DurationClaim[] }) {
  const { t, i18n } = useTranslation();
  const nf = (n: number) => n.toLocaleString(i18n.language);
  const pctOf = (x: number | null) => (x === null ? null : Math.round(Math.max(0, Math.min(1, x)) * 100));
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {claims.map((c) => {
        const lo = pctOf(c.lo);
        const hi = pctOf(c.hi);
        const feed = feedTotalClaim(c.open, c.feedTotal, c.feedTotalAt);
        return (
          <Link
            key={c.token}
            to={companyHref(c.token, "hiring")}
            className="group flex flex-col rounded-xl border border-border bg-card/60 px-4 py-3.5 transition-colors hover:border-primary/50 hover:bg-card"
          >
            <span className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-xs shrink-0">
                {c.company.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{c.company}</span>
              <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground/50 transition-all group-hover:text-primary group-hover:translate-x-0.5" />
            </span>
            {/* THE "+" IS PART OF THE NUMBER, NOT A HEDGE BESIDE IT. We stop
                serving a posting at FILL_SUPPORT_MAX_DAYS, so a role that stayed
                up longer can never contribute a duration: every long life is
                missing from the sample and the median can only be understated.
                Printing "9 days" flat would be a claim we cannot support in the
                direction that matters to someone deciding whether to hurry. */}
            <span className="mt-3 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold leading-none tabular-nums text-foreground">{nf(c.p50)}+</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("explore.durUnit", "days")}
              </span>
            </span>
            {/* NOT "TO FILL". What the lifecycle log observes is a posting going
                away and not coming back, which can be a hire, a withdrawal, a
                cancelled requisition or a retitle — those four are
                indistinguishable to us and this page never picks one. */}
            <span className="mt-1.5 block text-[12px] leading-snug text-foreground/75">
              {t("explore.durHeadline", "Half the roles we saw come down and stay down were gone this fast — measured from the date the employer itself put on them.")}
            </span>
            {/* FIGURE, WINDOW, SAMPLE, DATE BASIS — one line, always present,
                never a tooltip. A median without its span is a claim about an
                unknown stretch of time, and without its sample it is a claim
                about an unknown number of roles. */}
            <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
              {t("explore.durEvidence", "median over {{n}} roles carrying the employer's own post date · across the {{days}} days we have watched this board", { n: nf(c.sample), days: c.windowDays })}
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">
              {t("explore.durFloor", "A floor: we stop serving a posting at {{cap}} days, so roles that stayed up longer cannot enter this median.", { cap: FILL_SUPPORT_MAX_DAYS })}
            </span>
            {c.qualified && c.coverage !== null && (
              <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">
                {t("explore.fillCoverage", "across the {{pct}}% of its roles that carry the company's own posting date", { pct: pctOf(c.coverage) })}
              </span>
            )}
            {/* R(14), NOW THE SMALLER EVIDENCE LINE. It was the headline, and a
                14-day incidence answered a different question than the one a
                reader arrives with. Still a CEILING and still says so: the
                collector logs one superseded closure per title per 24h and
                DELETES the rest, so re-listings it never saw are absent from the
                risk set and the fills that remain take a larger share of a
                smaller cohort. */}
            <span className="mt-2 block text-[11px] leading-snug text-muted-foreground">
              {t("explore.durRate", "Up to {{pct}}% of its roles came down within {{h}} days and stayed down", { pct: Math.round(c.rate * 100), h: URGENT_FILL_MAX_DAYS })}
              {lo !== null && hi !== null
                ? ` · ${t("explore.fillInterval", "{{lo}}–{{hi}}% approx.", { lo, hi })}`
                : ""}
            </span>
            {c.open !== null && (
              /* OUR COUNT, AND WHOSE BOARD IT COUNTS. Both serving predicates,
                 so it is exactly what /jobs/company/{token} shows. Where the
                 employer's own feed states a larger total AND we know the day we
                 read it, both numbers render — through the one guard, and never
                 as a ratio. */
              <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                {feed
                  ? t("explore.openBoth", "{{n}} roles open on our board · {{total}} on the employer's own feed, read {{when}}", {
                      n: nf(feed.open), total: nf(feed.total), when: dateOf(feed.at),
                    })
                  : t("explore.fillOpen", "{{n}} roles open on our board now", { n: nf(c.open) })}
              </span>
            )}
            {/* THE CAUTION, AND IT DOES NOT LOOK LIKE THE CLAIM. Behind a rule,
                in the warning colour, and stated as a FLOOR — a deduped count
                cannot produce an equality. */}
            {c.relists !== null && c.relists > 0 && (
              <span className="mt-2.5 flex items-start gap-1.5 border-t border-border/60 pt-2 text-[11px] leading-snug text-warning">
                <Repeat className="mt-[2px] w-3 h-3 shrink-0" aria-hidden="true" />
                <span>
                  {t("explore.fillRelistFloor", "at least {{n}} of the roles it took down came back", { n: nf(c.relists) })}
                </span>
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** THE RE-LISTING CARD. The figure is a RATE — re-lists per affected title —
 *  because the heading names conduct, and a count ranks employers by size.
 *  Every number on it is a floor and carries its "+". */
function RecyclingGrid({ claims }: { claims: RecyclingClaim[] }) {
  const { t, i18n } = useTranslation();
  const nf = (n: number) => n.toLocaleString(i18n.language);
  const ratio = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {claims.map((c) => (
        <Link
          key={c.token}
          to={companyHref(c.token, "ghost")}
          className="group flex flex-col rounded-xl border border-warning/40 bg-card/60 px-4 py-3.5 transition-colors hover:border-warning hover:bg-warning/5"
        >
          <span className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-warning/10 text-warning font-bold text-xs shrink-0">
              {c.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{c.company}</span>
          </span>
          {/* NO "+" ON THE RATIO, AND THE COUNTS BENEATH IT KEEP THEIRS. Both
              terms are floors — the 24h dedupe deletes events, and a feed-dark
              batch drop can delete a title's only event with it — and a ratio of
              two floors has no known direction. A "+" here would be a claim
              about direction on the number this section ranks employers by,
              under a heading that names conduct. */}
          <span className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold leading-none tabular-nums text-foreground">{ratio(c.perRole)}×</span>
          </span>
          <span className="mt-1.5 block text-[12px] leading-snug text-foreground/75">
            {t("explore.recycleHeadline", "The same title came back this many times, per title that came back at all — each return resets the posted date, so the opening looks new.")}
          </span>
          {/* FIGURE, WINDOW, SAMPLE, DATE BASIS. The window is the same on every
              card in this section — one window, from the query, never "90 days"
              over a log that began part-way through it. */}
          <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
            {t("explore.recycleEvidence", "{{events}} re-listings across {{roles}} titles · in the {{days}} days of closure log this window covers · first seen {{when}}", {
              events: `${nf(c.events)}+`, roles: `${nf(c.roles)}+`, days: c.windowDays, when: dateOf(c.firstAt),
            })}
          </span>
          {c.worstTitle && c.worstEvents !== null && (
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
              {t("explore.recycleWorst", "most re-listed: “{{title}}” — {{n}} times", {
                title: c.worstTitle.slice(0, 34), n: `${nf(c.worstEvents)}+`,
              })}
            </span>
          )}
          {/* THE BASELINE, RE-MEASURED IN THIS WINDOW UNDER THIS GROUPING. A
              card that says "9.4 per title" means nothing without what ordinary
              looks like, and the old 2.7 was measured on 2026-08-12 over raw
              titles on an unbounded window at 29 days of log — a number
              measured under a definition this section does not use. It renders
              only when the query supplied it. */}
          {c.baseline !== null && c.baselinePool !== null && (
            <span className="mt-1.5 block text-[10px] leading-snug text-muted-foreground/80">
              {c.baselineP90 !== null
                ? t("explore.recycleBaselineP90", "board-wide in the same window: median {{base}}× per affected title, top tenth above {{p90}}×, across {{pool}} employers", {
                    base: ratio(c.baseline), p90: ratio(c.baselineP90), pool: nf(c.baselinePool),
                  })
                : t("explore.recycleBaseline", "board-wide median in the same window: {{base}}× per affected title, across {{pool}} employers", {
                    base: ratio(c.baseline), pool: nf(c.baselinePool),
                  })}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

/** THE AGE-OUT CARD. The share leads, because it is what makes one board
 *  comparable to another; the counts sit under it with the span they cover. */
function AgedGrid({ claims, basis }: { claims: AgedClaim[]; basis: AgeoutBasis }) {
  const { t, i18n } = useTranslation();
  const nf = (n: number) => n.toLocaleString(i18n.language);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {claims.map((c) => (
        <Link
          key={c.token}
          to={companyHref(c.token, "aged")}
          className="group flex flex-col rounded-xl border border-border bg-card/60 px-4 py-3.5 transition-colors hover:border-primary/50 hover:bg-card"
        >
          <span className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-xs shrink-0">
              {c.company.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{c.company}</span>
            <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground/50 transition-all group-hover:text-primary group-hover:translate-x-0.5" />
          </span>
          <span className="mt-3 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold leading-none tabular-nums text-foreground">{Math.round(c.share * 100)}%</span>
          </span>
          {/* "EVERYTHING WE WATCHED LEAVE" WAS TOO BROAD. The denominator is
              the takedowns, re-listings and age-outs we logged — exits we
              recorded as our own (a board we stopped tracking, a feed gone
              dormant) are roles that left and are in none of the three, so the
              sentence names the three rather than claiming the set. */}
          <span className="mt-1.5 block text-[12px] leading-snug text-foreground/75">
            {t("explore.agedHeadline2", "of the takedowns, re-listings and age-outs we logged for this board was still advertised when it crossed day {{cap}} — it did not come down, we stopped serving it.", { cap: FILL_SUPPORT_MAX_DAYS })}
          </span>
          {/* TWO LEDGERS, TWO SPANS, AND THE CARD PRINTS BOTH. The takedowns and
              re-listings come from the closure log (this employer's own span
              since its first logged closure); the age-outs come from the exit
              ledger, which is board-wide and began later. One span printed over
              a pair drawn from two records is the "90 days of watching" defect
              again, in miniature. */}
          <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
            {t("explore.agedEvidence2", "{{n}}+ roles still up at the cap, of {{m}}+ takedowns, re-listings and age-outs · the closure half across the {{days}} days we have watched this board", {
              n: nf(c.ageouts), m: nf(c.departures), days: c.windowDays,
            })}
          </span>
          {/* NO "+" ON THE SHARE, AND THE CARD SAYS WHY. Both terms are floors —
              our 24-hour dedupe deletes repeat re-listings, and an age-out row
              we failed to write is one we cannot see — and a ratio of two floors
              has no known direction. Marking it either way would be the claim
              this line refuses to make. */}
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">
            {t("explore.agedFloors", "Both counts are floors, and they understate in opposite directions, so the share itself carries no “at least”.")}
          </span>
          {/* THE LEDGER'S OWN SPAN, board-wide. The count comes off a column
              named for ninety days, and the exit ledger does not hold ninety:
              it began 2026-07-26 and is pruned at ninety, so a card printing
              the count beside a _90d name invites a division by a watch we did
              not perform — the same shape as "90 days of watching" over a
              56-day closure log. Absent key, absent sentence; never "0 days". */}
          {typeof basis.ageout_log_days === "number" && basis.ageout_log_days > 0 && (
            <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">
              {t("explore.agedLedger2", "The age-out half comes from an exit ledger that holds {{n}} days in all — shorter than the closure log above it, and never ninety.", { n: basis.ageout_log_days })}
            </span>
          )}
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground/80">
            {t("explore.agedBasis", "Age-outs alone. Postings we back-dated after finding them late are our late knowledge, not the employer leaving something up, and are not counted here.")}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Card-shaped placeholders at the COMPACT card's geometry (~60px). The tall
 *  cards have their own skeleton below; standing in for them with these grew
 *  the page ~1,700px on a phone the moment the real cards arrived. */
function GridSkeleton() {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">Loading employers…</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card/30 px-4 py-3">
            <div className="w-9 h-9 rounded-lg bg-muted animate-pulse shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${55 + ((i * 7) % 35)}%` }} />
              <div className="h-2.5 rounded bg-muted/60 animate-pulse" style={{ width: `${35 + ((i * 11) % 40)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** The tall cards' placeholders, at their real geometry: avatar row, the 3xl
 *  figure, the two-line label, the evidence line and the counts. */
function TallSkeleton({ label }: { label: string }) {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">{label}</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex flex-col rounded-xl border border-border bg-card/30 px-4 py-3.5">
            <span className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-muted animate-pulse shrink-0" />
              <span className="h-3.5 flex-1 rounded bg-muted animate-pulse" style={{ width: `${50 + ((i * 7) % 35)}%` }} />
            </span>
            <span className="mt-3 block h-7 w-20 rounded bg-muted animate-pulse" />
            <span className="mt-1.5 block h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${70 + ((i * 5) % 25)}%` }} />
            <span className="mt-1 block h-3 rounded bg-muted/60 animate-pulse" style={{ width: `${55 + ((i * 11) % 30)}%` }} />
            <span className="mt-1.5 block h-2.5 rounded bg-muted/50 animate-pulse" style={{ width: `${45 + ((i * 13) % 30)}%` }} />
          </div>
        ))}
      </div>
    </>
  );
}

/** A STATED REFUSAL, never a gap. Two flavours in one component because the
 *  distinction is the whole point: `about` is "us" when our instrument did not
 *  answer and "them" when the evidence about the employers is genuinely thin.
 *  Folding the first into the second makes the page apologise for an outage it
 *  is not having; folding the second into the first passes a verdict on
 *  employers we never measured. */
function Refusal({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/** `note` is the denominator line — "the 12 best of N that qualify". Twelve
 *  cards under a heading is indistinguishable from "twelve companies do this";
 *  the collection is a top slice and has to say what it is a slice OF.
 *  Optional, and absent whenever its counter is — a failed scan leaves the key
 *  stripped rather than zero. */
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
  // ONE QUESTION AT A TIME. Every answer stays in the DOM under `hidden` —
  // never conditionally unmounted, because /explore is prerendered and
  // sitemapped, and every company link must stay crawlable and Ctrl-F-able.
  const [intent, setIntent] = useState<Intent>("hiring");
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
  const [hiring, setHiring] = useState<CompanyRow[]>([]);
  const [relisting, setRelisting] = useState<RecyclingRow[]>([]);
  /** The age-out series' span, board-wide. Absent until the cache carries it,
   *  and absent on an empty ledger — never rendered as zero. */
  const [ageoutBasis, setAgeoutBasis] = useState<AgeoutBasis>({});
  const [entry, setEntry] = useState<CompanyRow[]>([]);
  const [salary, setSalary] = useState<SalaryRow[]>([]);
  const [transparent, setTransparent] = useState<CompanyRow[]>([]);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  // WHICH COLLECTIONS THE LAST REFRESH COULD NOT RECOMPUTE. A statistic that
  // could not be recomputed is a different fact from one that was, and the
  // reader is the one who has to know.
  const [stale, setStale] = useState<string[]>([]);
  // THE FALLBACK MEASUREMENT IS IN FLIGHT, WHICH IS NOT THE SAME AS NOTHING
  // QUALIFYING. Derived below, never set from an effect: `setMeasuring(true)`
  // inside the curve effect ran AFTER the commit that painted the rows, so
  // React painted a refusal for one frame and only then swapped in the
  // skeleton. `curveDone` is the one genuine piece of state.
  const [curveDone, setCurveDone] = useState(false);
  const [fields, setFields] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Totals>({});
  const [repostIndex, setRepostIndex] = useState<RepostIndex>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const applySalary = (rows: SalaryRow[]) =>
      // "other" is excluded everywhere else on this page (it's a catch-all, not
      // a field) — its card linked to a junk /jobs/field/other lander.
      setSalary(rows.filter((r) => r && r.median_annual_min > 0 && r.category !== "other").sort((a, b) => b.median_annual_min - a.median_annual_min).slice(0, 8));
    (async () => {
      // Fast path: the hourly-cached collections — one row read instead of five
      // full-table aggregates (measured 13s → <0.5s).
      try {
        const { data: cache } = await Promise.resolve(rpc("get_explore_cache")).catch(() => ({ data: null }));
        const c = cache as Record<string, unknown> | null;
        // NEITHER `trending` NOR `newest` IS READ, AND THE CACHE NO LONGER
        // COMPUTES THEM. Both answered a question nobody arrives with, and both
        // derived a posting age from first_seen — OUR discovery date, not when
        // the roles went up. They were removed from the page months ago while
        // the hourly job kept computing, caching and spending stale_parts slots
        // on them; this file's contract asks for neither key.
        if (c && (Array.isArray(c.hiring) || Array.isArray(c.entry) || Array.isArray(c.transparent))) {
          if (Array.isArray(c.hiring)) setHiring(c.hiring as CompanyRow[]);
          if (Array.isArray(c.stale_parts)) {
            setStale((c.stale_parts as unknown[])
              .filter((x): x is string => typeof x === "string")
              // A collection this page does not render cannot make this page
              // stale, and naming it would be a warning about nothing.
              .filter((x) => !RETIRED_CACHE_PARTS.has(x)));
          }
          if (Array.isArray(c.relisting)) setRelisting(c.relisting as RecyclingRow[]);
          if (Array.isArray(c.entry)) setEntry(c.entry as CompanyRow[]);
          if (Array.isArray(c.salary)) applySalary(c.salary as SalaryRow[]);
          // FROM THE CACHE, not a live call: get_transparent_employers returns
          // 57014 after ~27s, 100% of the time, so the section had never
          // rendered while every visitor paid 26s of database time for it.
          if (Array.isArray(c.transparent)) setTransparent(c.transparent as CompanyRow[]);
          // Objects, not arrays — and checked as such. `typeof null === "object"`
          // is the trap that would put `null` into a Record and crash the first
          // Object.entries over it.
          const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
          if (obj(c.ageout_basis)) setAgeoutBasis(c.ageout_basis as AgeoutBasis);
          if (obj(c.fields)) setFields(c.fields as Record<string, number>);
          if (obj(c.totals)) setTotals(c.totals as Totals);
          if (obj(c.repost_index)) setRepostIndex(c.repost_index as RepostIndex);
          if (typeof c.computed_at === "string") setComputedAt(c.computed_at);
          setLoading(false);
          return;
        }
      } catch { /* fall through to live RPCs */ }
      // The live fallback asks for exactly the two collections this page can
      // render without the cache. No get_size_segments (the section is gone),
      // no get_repost_churn_companies (its ranking and its raw-title grouping
      // are what this rebuild removed), no trending/newest — and neither
      // get_transparent_employers nor get_relisting_employers, both of which
      // are REVOKED FROM anon and cron-only: they group the whole closure set
      // and cannot complete inside a request, so calling them would spend
      // database time to arrive at the same refusal the section already
      // states.
      const [hi, en, sa] = await Promise.all([
        Promise.resolve(rpc("get_actively_hiring_companies", { p_limit: HIRING_SLICE })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_entry_level_companies", { p_limit: HIRING_SLICE })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_salary_benchmarks")).catch(() => ({ data: null })),
      ]);
      if (Array.isArray(hi.data)) setHiring(hi.data as CompanyRow[]);
      if (Array.isArray(en.data)) setEntry(en.data as CompanyRow[]);
      if (Array.isArray(sa.data)) applySalary(sa.data as SalaryRow[]);
      setLoading(false);
    })();
  }, []);

  // THE CURVE, FETCHED RATHER THAN HOPED FOR — and only when the rows do not
  // already carry it.
  //
  // On a current cache row the rewritten RPC already carries the incidence, its
  // interval and the window, so the FIRST reason to call is the deploy window
  // and old cache rows only.
  //
  // THE SECOND REASON IS THE ONLY PATH THE AGE-OUT COUNTS HAVE. There is no
  // server-side merge of them: refresh_explore_cache (20260907020000, re-issued
  // 20260908135000) never calls get_company_fill_curve, and deliberately caches
  // the age-out DATE BASIS rather than a copy of the count, because the curve is
  // that quantity's single owner and a second copy would drift. So this fetch is
  // not a deploy-window remnant — it is how curve_ageouts_90d reaches the page,
  // and it is paid once, only when a reader actually opens that answer, rather
  // than on every default page view.
  useEffect(() => {
    if (hiring.length === 0 || curveDone) return;
    // TWO REASONS TO ASK, ONE CALL, AND NEVER ON A PAGE VIEW THAT DOES NOT NEED
    // IT. The rewritten RPC carries the measure, so the first reason is now the
    // deploy window and old cache rows only. The second is the age-out answer:
    // get_company_fill_curve is the SINGLE OWNER of ageouts_90d — a second
    // count of the same quantity anywhere would drift from it, which is why the
    // hourly cache deliberately carries its DATE BASIS and not a copy of the
    // number. So the count is fetched, once, WHEN A READER ACTUALLY OPENS THAT
    // ANSWER: a 25-second grouped scan stays off every default page view, and
    // the section renders a measurement instead of a refusal.
    const needsMeasure = !hiring.some(hasMeasure);
    const needsAgeouts = intent === "aged" && !hiring.some((r) => r.curve_ageouts_90d !== undefined);
    if (!needsMeasure && !needsAgeouts) return;
    const tokens = [...new Set(hiring.map((r) => r.company_token).filter(Boolean))];
    if (tokens.length === 0) { setCurveDone(true); return; }
    let live = true;
    void (async () => {
      const { data } = await Promise.resolve(rpc("get_company_fill_curve", { p_tokens: tokens }))
        .catch(() => ({ data: null }));
      // Marked done on EVERY exit: a failed curve call must fall through to the
      // honest empty state, not leave a skeleton spinning where a sentence
      // belongs.
      if (live) setCurveDone(true);
      if (!live || !Array.isArray(data)) return;
      const by = new Map<string, Record<string, unknown>>();
      for (const r of data as Array<Record<string, unknown>>) {
        if (r && typeof r.company_token === "string") by.set(r.company_token, r);
      }
      if (by.size === 0) return;
      // numOr, not a typeof === "number" test: `numeric` arrives as a STRING on
      // some PostgREST builds, and a local coercion that rejected it turned
      // every row into "unmeasured" — a silent whole-section refusal that looks
      // exactly like an employer having no record.
      setHiring((prev) => prev.map((r) => {
        const c = by.get(r.company_token);
        if (!c) return r;
        return {
          ...r,
          fill_rate_14: numOr(c.fill_rate_14),
          fill_rate_14_lo: numOr(c.fill_rate_14_lo),
          fill_rate_14_hi: numOr(c.fill_rate_14_hi),
          dated_coverage: numOr(c.dated_coverage),
          sufficient: c.sufficient === true,
          // All four from the one call, because the age-out share divides three
          // of them by each other and a ratio across two populations is not a
          // rate of anything.
          curve_fills_90d: numOr(c.fills_90d) ?? undefined,
          curve_relists_90d: numOr(c.relists_90d) ?? undefined,
          curve_ageouts_90d: numOr(c.ageouts_90d) ?? undefined,
          curve_tracking_days: numOr(c.tracking_days) ?? undefined,
        };
      }));
    })();
    return () => { live = false; };
    // `curveDone` is both a dependency and the early return above, so the merge
    // cannot re-trigger itself: setHiring produces a new array, the effect
    // re-runs, and the flag stops it. Without that, a curve that answered for
    // none of the twelve tokens would loop forever on the age-out branch.
  }, [hiring, intent, curveDone]);

  // The chosen answer lives in the URL, so it is shareable, survives Back, and
  // a crawler following ?i=pay sees the pay answer. replaceState rather than
  // push: switching answers is not a navigation.
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

  /** THE EMPLOYERS THE CHURN INDEX HAS ALREADY FLAGGED. The index is the
   *  rate-gated one — 5+ re-lists per affected role on 25+ events, never a
   *  top-N by raw volume — so membership is a finding about conduct rather than
   *  about size. The duration answer excludes them rather than recommending
   *  them with a warning stapled underneath. */
  const serialReposters = useMemo(
    () => new Set(Object.keys(repostIndex).filter((k) => Array.isArray(repostIndex[k]))),
    [repostIndex],
  );
  const duration = useMemo(() => rankedDurationClaims(hiring, serialReposters), [hiring, serialReposters]);
  const aged = useMemo(() => rankAged(hiring, serialReposters), [hiring, serialReposters]);
  const recycled = useMemo(() => rankRecycling(relisting), [relisting]);
  /** DID THE AGE-OUT MEASUREMENT ANSWER AT ALL? Distinguishes "the curve ran and
   *  returned no age-outs for any of these employers" (a finding, floored) from
   *  "the curve did not reach this page" (our instrument). Derived from the
   *  merged column's presence rather than from the claim list, because
   *  agedClaimOf requires ageouts > 0 and would fold the first case into the
   *  second — the exact us/them confusion the duration answer separates. */
  const ageoutsMeasured = useMemo(
    () => hiring.some((r) => r.curve_ageouts_90d !== undefined), [hiring],
  );
  /** The entry answer's rows, floored and ordered by the share each card prints
   *  — never trusted from the payload's own order, which is a count ranking
   *  until the migration behind this rebuild lands. */
  const entryShown = useMemo(() => rankEntry(entry), [entry]);
  /** DERIVED, NEVER SET. Rows are on screen, none carries a measure yet, and
   *  the second call has not come back — the one state in which the section
   *  must show placeholders rather than a verdict. */
  const measuring = hiring.length > 0 && !curveDone && !hiring.some(hasMeasure);

  // EVERY ANSWER IS ALWAYS OFFERED, AND EVERY ANSWER CAN SAY "NOTHING HERE".
  //
  // Chips used to appear only when their collection had rows, which produced
  // two defects at once: the chip row rendered two chips during load and then
  // jumped to seven, and a visitor arriving on a shared /explore?i=hiring was
  // silently shown a different answer when that collection came back empty —
  // the URL said one thing and the page showed another. Since every section now
  // owns a written refusal, an empty collection is a sentence rather than a
  // disappearance, and the mapping from URL to answer is total.
  const shown = INTENTS;
  const active: Intent = intent;

  /** Each answer's way into the board — turning an intent into JOBS rather than
   *  into twelve more company links. Every param here is READ by Jobs.tsx: a
   *  `fresh=day` action was drafted and dropped because Jobs WRITES that param
   *  and never reads it back, so the button would have promised a 24-hour
   *  window over an unfiltered board. NO COUNTS on these buttons: the
   *  collection holds twelve rows, which is not the size of the population the
   *  sentence would imply. */
  const ACTION: Partial<Record<Intent, { to: string; label: string }>> = {
    // THE TOKENS ON SCREEN, NOT THE TOKENS IN THE PAYLOAD — this once mapped
    // the raw rows, so the button opened a board filtered to employers the
    // section had just refused to show.
    hiring: duration.shown.length
      ? {
          to: `/jobs?company=${encodeURIComponent(duration.shown.map((c) => c.token).join(","))}&from=explore`,
          label: t("explore.actionHiring", "Open roles at all of these employers"),
        }
      : undefined,
    entry: { to: "/jobs?experience=entry&from=explore", label: t("explore.actionEntry", "All entry-level roles on the board") },
    ghost: { to: "/jobs?activelyHiring=1&from=explore", label: t("explore.actionGhost", "Show only employers whose roles close and stay closed") },
  };

  const INTENT_LABEL: Record<Intent, string> = {
    check: t("explore.intentCheck", "Check an employer"),
    // NEW KEYS FOR THE THREE ANSWERS THAT CHANGED WHAT THEY MEASURE. A locale
    // VALUE overrides an inline English default, and nine locales carry the old
    // sentences — reusing explore.intentHiring ("Will actually hire me") would
    // leave eight languages advertising a claim this page stopped making.
    hiring: t("explore.intentDuration", "How long do I have"),
    ghost: t("explore.intentDates", "Watch out: recycled dates"),
    // THE CAP IS INTERPOLATED, NEVER TYPED. This chip names the same number
    // the section's own heading takes from FILL_SUPPORT_MAX_DAYS
    // ("Still advertised when it crossed day {{cap}}"), and a literal here is
    // how a page goes on saying "day 30" after the serving cap moves — the
    // drift the {{h}} horizon on the duration card already carries a comment
    // about. It matters more in a locale key than anywhere else: a translated
    // VALUE beats the inline default, so a hardcoded 30 would survive in nine
    // languages a change to the constant.
    aged: t("explore.intentAged", "Still up at day {{cap}}", { cap: FILL_SUPPORT_MAX_DAYS }),
    pay: t("explore.intentPay", "States the pay"),
    entry: t("explore.intentEntry", "Early career"),
    fields: t("explore.intentFields", "By field"),
  };

  const nf = (n: number) => n.toLocaleString(i18n.language);
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: "medium" });

  /** The churn warning for one employer, or null — POSITIVE FORM ONLY.
   *
   *  A hit means "this employer cleared a rate gate of 5 re-lists per affected
   *  role on 25+ events". A MISS means only that it did not, which includes
   *  every employer whose board we have watched for a week. So there is no "no
   *  re-posting detected", no green tick and no clean-bill styling anywhere in
   *  this file.
   *
   *  "across {{roles}} roles" is not decoration — it is what separates a
   *  diagnosis from a libel. 581 re-lists across 3 roles is one job advertised
   *  forever; 769 across 298 is a large employer with ordinary churn. */
  const repostWarn = (token: string | undefined, on: Intent): string | null => {
    // Not on the re-listing answer: those cards state these numbers themselves,
    // in a better-grouped form, and repeating them would read as two findings.
    if (!token || on === "ghost") return null;
    const hit = repostIndex[token];
    // Shape-checked, not just presence-checked: the payload is JSON from a
    // cache row that may predate the migration, and destructuring a non-array
    // would print "undefined re-postings across undefined roles".
    if (!Array.isArray(hit) || hit.length < 3) return null;
    const [events, roles, days] = hit;
    if (!(typeof events === "number" && events > 0 && typeof roles === "number" && roles > 0)) return null;
    // A FLOOR, MARKED IN THE VALUE RATHER THAN IN THE SENTENCE — this file's
    // own idiom ("10,000+" on the field chips), so all nine translations of
    // explore.repostWarn become floors at once.
    return t("explore.repostWarn", "Re-lists roles: {{events}} re-postings across {{roles}} roles in {{d}}d", {
      events: `${nf(events)}+`, roles: `${nf(roles)}+`, d: days,
    });
  };

  /** The denominator under each answer. Rendered only when its counter is
   *  present — a missing key is a failed scan and must produce silence, not a
   *  zero.
   *
   *  THE "BY FIELD" NOTE IS GONE AND IS NOT COMING BACK. It printed
   *  get_explore_denominators' UNCAPPED count as "{{n}} roles open across the
   *  board right now" while every chip beneath it is formatted through
   *  SERVE_COUNT_CAP — one sentence contradicting the eighteen numbers under
   *  it, and contradicting the page each chip opens. The chips stay; the
   *  sentence had no cap-aware form worth writing. */
  const NOTE: Partial<Record<Intent, string | null>> = {
    // EVERY NUMBER NAMES THE POPULATION IT WAS COMPUTED OVER, because these two
    // are not computed over the same one. duration.shown / duration.held are
    // over the ROWS IN THE CACHE (capped at twelve), so the client gates behind
    // them were never applied to rows thirteen and up. totals.hiring_n is
    // count(*) over get_actively_hiring_companies(2000), where every row has
    // already passed the server's gates.
    hiring: totals.hiring_n
      ? [
          t("explore.noteDurationPool", "{{n}} employers clear our measurement bars right now; we take the {{cap}} strongest-evidenced and order them here by how quickly the median role came down.", { n: nf(totals.hiring_n), cap: nf(Math.min(totals.hiring_n, hiring.length || HIRING_SLICE)) }),
          // TWO KEYS FOR ONE SENTENCE, because "The 1 employers" is what one
          // qualifying employer produced live. i18next plurals need the key in
          // a resource file, which this change cannot write, so the singular is
          // its own key and a translator gets a grammatical string in both.
          duration.shown.length === 1
            ? t("explore.noteDurationShownOne", "One of those carries a median here; the rest are accounted for below.")
            : t("explore.noteDurationShown", "{{shown}} of those carry a median here; the rest are accounted for below.", { shown: nf(duration.shown.length) }),
        ].join(" ")
      : null,
    // GATED ON THE CARDS, LIKE ITS SIBLINGS. relisting_pool_n comes off the raw
    // RPC rows (max(board_pool_n)) BEFORE recyclingClaimOf applies its six
    // refusals, so a payload whose rows all lack a window or a first-seen date
    // yields a pool of 1,204 and zero cards — a denominator printed directly
    // above the panel saying the section holds no measurement. NOTE.hiring and
    // NOTE.aged are already gated at their call sites; this one was not.
    ghost: recycled.length === 0 ? null : [
      totals.relisting_pool_n
        ? t("explore.noteRecyclePool", "{{n}} employers cleared the re-listing floor in this window; we rank the {{cap}} with the most re-lists per affected title — never the ones with the most re-lists.", { n: nf(totals.relisting_pool_n), cap: nf(Math.min(totals.relisting_pool_n, recycled.length || HIRING_SLICE)) })
        : "",
      // The flagged count is the population behind the warning that follows
      // employers onto the other answers, so this is where it is explained
      // rather than appearing unannounced under a pay card. It is a SEPARATE
      // measurement from the ranking above — same log, different gate — and the
      // sentence says so rather than letting a reader fold the two numbers
      // together.
      totals.repost_flagged_n
        ? t("explore.noteRecycleFlagged", "Separately, {{n}} employers re-list often enough to carry a warning on the other answers.", { n: nf(totals.repost_flagged_n) })
        : "",
    ].filter(Boolean).join(" ") || null,
    aged: duration.shown.length
      ? t("explore.noteAged", "Counted only for the {{n}} employers whose record already cleared the bars on the previous answer, so no card here rests on evidence this page refused one question earlier.", { n: nf(duration.shown.length) })
      : null,
    // TWO SENTENCES, because the second is what makes the first mean anything.
    // "41 employers state pay on 80%+ of their roles" sounds thin until you
    // know the board-wide rate.
    pay: totals.pay_n && totals.pay_pool_n
      ? [
          t("explore.notePay", "{{n}} of the {{pool}} employers with 20+ open roles state pay on at least 80% of them.", { n: nf(totals.pay_n), pool: nf(totals.pay_pool_n) }),
          totals.postings_pay_n && totals.postings_n
            ? t("explore.notePayBoard", "Board-wide, {{pct}}% of open postings state pay at all.", { pct: Math.round(100 * totals.postings_pay_n / totals.postings_n) })
            : "",
        ].filter(Boolean).join(" ")
      : null,
    // NEW KEY, AND NO POOL NUMBER. The old sentence described a ranking by
    // COUNT ("The 12 with the most") over a pool floored at five entry-level
    // roles — and totals.entry_n is still counted under THAT floor, so quoting
    // it beside these floors would publish a measured number under a definition
    // it was not measured under. The sentence states only what is true of what
    // is on screen: the order, and the bars every card here clears.
    // THE POOL MAY BE NAMED ONLY WHEN THE SERVER SAYS WHICH GATE COUNTED IT,
    // and the sentence interpolates the SERVER'S floors rather than this file's.
    // Key presence is not enough: entry_n is returned under the deployed
    // five-role floor too, so a page that ships ahead of the migration — the
    // expected order, since the frontend deploys in minutes and migrations
    // apply only through a session — would print a pool of employers with 5+
    // entry roles and no board floor beneath a sentence naming 10 and 50, over
    // twelve cards this page filtered to 10 and 50 client-side. That is the
    // stat-provenance defect verbatim. Absent markers, absent sentence.
    entry: totals.entry_n
      && totals.entry_min_entry === ENTRY_MIN_ENTRY_ROLES
      && totals.entry_min_open === ENTRY_MIN_OPEN_ROLES
      ? t("explore.noteEntryShare", "{{n}} employers clear our floors of at least {{e}} entry-level roles and {{o}} roles open; these are ordered by the share of each one's board that is entry-level.", { n: nf(totals.entry_n), e: totals.entry_min_entry, o: totals.entry_min_open })
      : null,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NEW SEO KEYS, because the old ones described sections that no longer
          exist. seoTitle2 led with "Who Fills Roles" — a ranking this page
          stopped publishing — and the page must not advertise to crawlers, in
          nine languages, two things it does not contain. */}
      <SEO
        title={t("explore.seoTitle3", "Explore Employers — How Long Roles Stay Up, Who Recycles Dates, Who States Pay")}
        description={t("explore.seoDescription3", "Pick what you're looking for: how long an employer's roles actually stay up, which boards re-list the same title under a fresh date, which roles were still advertised when they passed our 30-day cap, who states pay you can compare, and where a beginner has a real chance — all measured from companies' own job boards and our own daily tracking.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline", "Find your next role by what actually matters")}
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            {/* NEW KEY. explore.subhead2 said "not from what employers claim",
                which this rebuild makes false three times over: the check
                answer publishes the employer's own advertised feed total, the
                duration answer is anchored on the employer's own posted_at, and
                the entry answer reads the employer's own posting text. The
                sentence is absent from all nine locales, so the inline default
                was the only thing rendering it — in every language. */}
            {t("explore.subhead3", "Pick what you're actually looking for. Every answer is measured from our own daily tracking of what happens to each posting, anchored where an employer states its own posting date — and where a number is the employer's own, it is labelled as theirs with the day we read it.")}
          </p>
          {/* "computed live" was false: these collections come from a cache
              refreshed hourly, and the cache has carried its own computed_at all
              along while the page never showed it. Renders only once a real
              timestamp is in hand — no timestamp, no claim. */}
          {computedAt && (
            <p className="text-xs text-muted-foreground/80 mt-2">
              {t("explore.asOf", "Measured {{time}}, refreshed hourly.", {
                // i18n.language, not undefined. `undefined` resolves to the
                // BROWSER's locale, which is independent of the language the
                // reader picked — so a German page rendered its one visible
                // date in English.
                time: new Date(computedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
          {/* A REFRESH THAT DID NOT FINISH MUST NOT LOOK LIKE ONE THAT DID. Two
              independent signals: stale_parts names the collections served from
              the previous run, and computed_at going stale is the only evidence
              a reader gets when the whole hourly job stops — the cron death that
              froze every answer here for a day while the page looked healthy. */}
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

        {/* THE PAGE'S ONLY CONTROL. Wrapped, never a horizontal scroller: all
            seven choices are visible on a 375px screen without a gesture. No
            counts on the chips — a number here would be the size of a
            collection capped at twelve, not the size of the population it
            implies. */}
        <div className="mb-8" role="tablist" aria-label={t("explore.intentAria", "What are you looking for?")}>
          <div className="flex flex-wrap gap-2">
            {shown.map((i, idx) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active === i}
                // role="tablist" PROMISES arrow-key navigation. Shipping the
                // role without the keys is worse than shipping neither: a
                // screen reader announces "tab, 1 of 7" and the arrow keys the
                // user is then told to press do nothing.
                tabIndex={active === i ? 0 : -1}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = shown[(idx + d + shown.length) % shown.length];
                  chooseIntent(next);
                  const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  el?.[(idx + d + shown.length) % shown.length]?.focus();
                }}
                onClick={() => chooseIntent(i)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium transition-colors min-h-[40px] ${
                  active === i
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {INTENT_LABEL[i]}
              </button>
            ))}
            {/* The way out, kept beside the choices rather than buried at the
                bottom of a long page. /jobs does search, filters and sorting
                well; Explore is for people who do not yet have a query, and the
                ones who do should not have to scroll to leave. */}
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

        {/* The answer's action, rendered once for whichever answer is showing
            rather than repeated inside six bodies. */}
        {ACTION[active] && (
          <Link
            to={ACTION[active]!.to}
            className="flex items-center justify-center gap-2 mb-6 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {ACTION[active]!.label}
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}

        {/* ── 1. CHECK AN EMPLOYER — AND HOW MUCH OF THEM WE ACTUALLY SEE ────
            The only answer that covers every board we carry rather than the
            twelve that top a list, and the only place the employer's own
            advertised total belongs. That number arrived here from the deleted
            "Hiring at scale" section, where it was the one useful thing on a
            card whose band and badge counted different quantities. Here it
            renders through the single guard, with the day it was read, beside
            our own count — and never divided by it. */}
        <div hidden={active !== "check"}>
          <Section
            icon={Search}
            title={t("explore.checkTitle2", "Check an employer — and how much of them we actually see")}
            blurb={t("explore.checkBlurb2", "Every employer whose board we carry. We show how many of their roles we hold and, where their own feed states a total, how much of their hiring is not on this page.")}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodHoldTerm", "“Roles open on our board”"),
                method: t("explore.methodHoldMethod", "An exact count of what we are serving for that employer right now — the same rows its company page shows, under both serving predicates. Nothing caps it. It is still a FLOOR on their hiring: paginated job boards are read a page at a time, so we hold what we have read, which is why so many of these land on multiples of twenty."),
              },
              {
                term: t("explore.methodFeedTerm", "The employer's own advertised total"),
                method: t("explore.methodFeedMethod", "Where the feed publishes its own count we show it with the day we last read it, because we keep one row per board and overwrite it on every fetch — there is no history, so a board that went dark would otherwise advertise its last total forever. DO NOT DIVIDE THE TWO NUMBERS: ours is a floor on what we hold today, theirs is a single reading taken on the date shown, and their ratio is not a coverage percentage. Where we carry several boards for one employer we show no total at all, because adding figures read on different days produces a number with no date basis."),
              },
            ]} />
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
                  /* THE WARNING'S MOST USEFUL HOME. A reader typing a company
                     name has already decided to consider that employer, and this
                     is the last moment before they leave for its board.
                     ACROSS ALL ITS FEEDS, worst first: an employer with four ATS
                     feeds merges into one row here (get_company_suggest groups by
                     display name) while the churn index is keyed by token, so
                     checking only tokens[0] would miss churn on a sibling feed. */
                  const worstToken = h.tokens
                    .filter((tk) => Array.isArray(repostIndex[tk]))
                    .sort((a, b) => (repostIndex[b]![0] ?? 0) - (repostIndex[a]![0] ?? 0))[0];
                  const worst = worstToken ? repostWarn(worstToken, "check") : null;
                  const open = numOr(h.open_roles);
                  const single = h.tokens.length === 1;
                  // ONE GUARD, TWO CALL SITES. `single` is checked here as well
                  // as in the SQL: a later change that started summing several
                  // boards' advertised totals would otherwise reach the screen
                  // as one number carrying one board's date.
                  const feed = single ? feedTotalClaim(open, numOr(h.feed_total), typeof h.feed_total_at === "string" ? h.feed_total_at : null) : null;
                  /* A MISSING COLUMN IS OUR INSTRUMENT; A MISSING READING IS A
                     FACT ABOUT THE RECORD. The two must never share a sentence.
                     get_company_suggest returned (name, tokens) alone until
                     20260908136000, so every read below resolved to undefined
                     and the page told every single-board reader "we hold no
                     dated reading of this employer's own total" — a confident
                     falsehood about our own holdings, since
                     job_board_verifications holds exactly that reading and
                     get_actively_hiring_companies already returns it. PostgREST
                     sends a NULL column as a present key, so `undefined` here
                     means the deployed function does not return the column at
                     all — the deploy window, and nothing about the employer. */
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
                        /* THE SENTENCE MAY NOT SAY MORE THAN THE GATE PROVED.
                           feedTotalClaim asks only that their advertised total
                           EXCEED our count, so 101 against 100 satisfies it —
                           and this line shipped reading "most of what they have
                           open is not on this page", a majority claim about a
                           named employer that the gate never established. It
                           is also the division the disclosure two inches above
                           forbids: "most" is open/total < 0.5, computed across
                           two figures measured on different days under
                           different definitions, which is precisely the ratio
                           feedTotalClaim exists to refuse. What we know is the
                           comparison, so that is what it now states, with the
                           inference hedged rather than asserted. */
                        <span className="block text-[11px] text-foreground/75 mt-0.5">
                          {t("explore.checkFeedGap", "Their own feed advertised {{total}} roles when we last read it on {{when}} — more than we hold for them here, so their own board may show roles this page does not.", {
                            total: nf(feed.total), when: dateOf(feed.at),
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
          </Section>
        </div>

        {/* ── 2. HOW LONG DO I HAVE ─────────────────────────────────────────
            The median lifetime of a role, from the employer's own posted date,
            with R(14) demoted to the evidence line under it. */}
        <div hidden={active !== "hiring"}>
        {loading && hiring.length === 0 && (
          <Section icon={Hourglass} title={t("explore.durTitle", "How long do I have")} blurb={t("explore.durBlurb", "How quickly each employer's roles came down, measured from the date the employer itself put on them — so you can tell a board where you have a week from one where you have a month.")}>
            <TallSkeleton label="Measuring employers…" />
          </Section>
        )}
        {!loading && (
          <Section
            icon={Hourglass}
            note={duration.shown.length > 0 ? NOTE.hiring : null}
            title={t("explore.durTitle", "How long do I have")}
            blurb={t("explore.durBlurb", "How quickly each employer's roles came down, measured from the date the employer itself put on them — so you can tell a board where you have a week from one where you have a month.")}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodMedianTerm", "What the median counts, and what it cannot"),
                method: t("explore.methodMedianMethod", "Half the roles we watched come down and stay down were gone within this many days of the date the EMPLOYER put on the posting — never our own discovery date. It is a FLOOR: we stop serving a posting at {{cap}} days, so a role that stayed up longer never produces a duration and the true median can only be larger. Roles that came back are counted as re-listings rather than as fills, and a closure never means “hired”: a hire, a withdrawal, a cancelled requisition and a retitle are indistinguishable to us.", { cap: FILL_SUPPORT_MAX_DAYS }),
              },
              {
                term: t("explore.methodSampleTerm", "The sample and the span, on every card"),
                method: t("explore.methodSampleMethod", "The count beside each median is the number of that employer's closed roles carrying its own posting date — the sample the median was actually computed over, not the roles still at risk at day {{d}}. The span beside it is how long we have watched THAT board, from its own first logged closure. Our closure log began on 14 July 2026, so no employer here has been watched for longer than that, and none of these numbers describes 90 days of anything.", { d: URGENT_FILL_MAX_DAYS }),
              },
              {
                term: t("explore.methodGateTerm", "When we publish no figure at all"),
                method: t("explore.methodGateMethod", "Three separate bars, and a miss on any one means no figure rather than a hedged one: our estimate must be stable enough on its own terms (enough roles at risk at day {{d}}, enough observed takedowns, and an interval no wider than 15 points), we must have watched that board for at least {{days}} days, and at least {{cov}}% of the roles behind the figure must carry a posting date from the employer itself. Our own discovery date is never used as a posting age.", { d: URGENT_FILL_MAX_DAYS, days: FILL_RATE_MIN_TRACKING_DAYS, cov: Math.round(FILL_COVERAGE_MIN * 100) }),
              },
              {
                term: t("explore.methodRelistTerm", "Why every re-listing number carries a “+”"),
                method: t("explore.methodRelistMethod", "Our collector records only the first re-listing of a given job title at a given employer in any 24 hours and discards the rest, so every re-listing count here is a lower bound and none can be stated exactly. The same dedupe makes the {{d}}-day share an upper bound — the re-listings we never saw are missing from the pool it is computed over — which is why it reads “up to”. The interval beside it is an approximation, not an exact confidence interval.", { d: URGENT_FILL_MAX_DAYS }),
              },
              {
                term: t("explore.methodBlindTerm", "What this ranking cannot see"),
                method: t("explore.methodBlindMethod", "Because we discard repeat re-listings of the same title within a day, an employer that re-lists heavily looks better here than it is, and the ones we never logged are invisible to every check on this page. We would rather say that than imply a precision we do not have."),
              },
              {
                // WHO IS LEFT OUT IS PART OF WHO IS HERE, AND IT IS SAID
                // UNCONDITIONALLY. The deleted "Hiring at scale" rewrite
                // carried the exclusion in explore.hiringBlurbCurve
                // ("...are disqualified (they appear under Serial re-posters
                // instead)"), which was a permanent sentence in the
                // methodology. The rebuild left only the held-back accounting
                // line beneath the cards, and that renders solely when
                // held.reposter > 0 — so on a refresh where none of the ranked
                // twelve happened to be flagged, a section that RECOMMENDS
                // employers stopped saying that serial re-listers are kept out
                // of it. A selection rule a reader can only learn from a
                // conditional line is a selection rule they may never learn.
                term: t("explore.methodOrderTerm", "Who is here, and in what order"),
                method: t("explore.methodOrderMethod", "Which employers appear is decided by our fill measurement, over the whole qualifying pool. Employers whose takedowns are mostly re-listings are kept out of this answer entirely rather than listed here with a warning attached — they appear under “The dates here are not what they look like” — and where any of the employers we ranked were held back for it, the count is stated beneath these cards. The ORDER on this screen is ours: quickest median first, because that is the question the heading asks. Ties go to the larger sample, never to the larger employer."),
              },
              {
                // THE OPEN COUNT'S OWN CAVEAT, BACK IN THE SECTION THAT PRINTS
                // IT. explore.openBoth renders "N roles open on our board · M on
                // the employer's own feed" ON THIS CARD, and the rule that
                // governs that pair — a floor beside one dated reading, never a
                // ratio — moved with the feed total into the employer check,
                // one tab away, where a reader of this section never sees it.
                // The old page kept both in one place (explore.methodOpenMethod,
                // HEAD:1582) and the sentence it guarded did not move.
                //
                // NEW KEYS. methodOpenTerm/methodOpenMethod are retired: their
                // last clause described dividing a 90-day takedown count by the
                // open count, which is not a pair this card prints any more, and
                // a locale value would answer the old key with the old wording.
                term: t("explore.methodOpenTerm2", "“Roles open on our board”, and what not to do with it"),
                method: t("explore.methodOpenMethod2", "An exact count of what we are serving for that employer right now — the same rows its company page shows, under both serving predicates. Nothing caps it, and it is still a FLOOR on their hiring: paginated job boards are read a page at a time, so we hold what we have read. Where the employer's own feed states a larger total we print that beside it with the day we read it, because we keep one row per board and overwrite it on every fetch. DO NOT DIVIDE ONE NUMBER ON THIS CARD BY ANOTHER: our count is a single instant of what we hold, the employer's total is one reading taken on the date shown, and the median, its sample and the re-listing count accumulate over the days we have watched that board. They are different populations over different spans, and no ratio between them is a rate of anything."),
              },
            ]} />

            {duration.shown.length > 0 ? (
              <DurationGrid claims={duration.shown} />
            ) : measuring ? (
              /* Rows in hand, the measure still being fetched. Placeholders at
                 the card's own geometry — the reader sees "coming", never a
                 verdict we are about to contradict. */
              <TallSkeleton label="Measuring employers…" />
            ) : hiring.length === 0 ? (
              /* NO ROWS AT ALL, WHICH IS A DIFFERENT FACT and must not borrow
                 the sentence below. "No employer's record is deep enough" would
                 be a verdict on hundreds of employers drawn from zero
                 observations. This branch talks about US. */
              <Refusal
                title={t("explore.hiringOutTitle", "We could not measure this in the last refresh")}
                body={t("explore.hiringOutBody", "The fill ranking did not complete, so there is nothing to show here — that is our instrument, and it says nothing about any employer. Every other answer on this page still works.")}
                action={
                  <button
                    type="button"
                    onClick={() => chooseIntent("check")}
                    className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {t("explore.intentCheck", "Check an employer")}
                  </button>
                }
              />
            ) : (
              /* THE HONEST EMPTY STATE, WHICH IS WHAT THE GATES ARE FOR — and it
                 speaks only for the rows it tested. The client bars behind this
                 refusal were applied to the twelve rows the cache carries, never
                 to the rest of the pool. */
              <Refusal
                title={t("explore.durNoneTitle", "None of the {{n}} employers we ranked has a record deep enough to publish a median", { n: nf(hiring.length) })}
                body={t("explore.durNoneBody", "This says nothing about the employers themselves — it says our lifecycle log is not yet deep enough, or too few of their closed roles carry a date from the employer. Every other answer on this page still works.")}
                action={
                  <button
                    type="button"
                    onClick={() => chooseIntent("check")}
                    className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Search className="w-3.5 h-3.5" />
                    {t("explore.intentCheck", "Check an employer")}
                  </button>
                }
              />
            )}

            {/* WHAT IS NOT ON SCREEN, AND WHY — counted, never silent. An
                employer missing from a leaderboard is unreadable on its own: it
                can mean a weak record, a short one, or a broken instrument of
                ours, and those must not look alike. */}
            {!measuring && (duration.held.reposter + duration.held.window + duration.held.estimate + duration.held.unmeasured + duration.held.undated + duration.held.duration) > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                {[
                  duration.held.reposter > 0
                    ? t("explore.hiringHeldReposter2", "{{n}} ranked employers are left out for serial re-listing — they appear under “Watch out: recycled dates”.", { n: nf(duration.held.reposter) })
                    : "",
                  duration.held.window > 0
                    ? t("explore.hiringHeldWindow", "{{n}} have takedowns we can see but a board we have watched for fewer than {{d}} days, so no rate is published for them.", { n: nf(duration.held.window), d: FILL_RATE_MIN_TRACKING_DAYS })
                    : "",
                  duration.held.estimate > 0
                    ? t("explore.hiringHeldEstimate", "{{n}} have a record too thin or too uneven to carry a stable figure.", { n: nf(duration.held.estimate) })
                    : "",
                  // A CURVE THAT ANSWERED WITH NO RATE IS ABOUT THEIR FEED; a
                  // curve that did not answer is about our instrument. Folding
                  // the first into the second had the page apologise for an
                  // outage it was not having.
                  duration.held.undated > 0
                    ? t("explore.hiringHeldUndated", "{{n}} publish no posting dates on their own feed, so there is nothing to measure a fill against.", { n: nf(duration.held.undated) })
                    : "",
                  duration.held.duration > 0
                    ? t("explore.hiringHeldDuration", "{{n}} clear those bars but carry no median: too few of their closed roles state a date from the employer for one.", { n: nf(duration.held.duration) })
                    : "",
                  duration.held.unmeasured > 0
                    ? t("explore.hiringHeldUnmeasured", "{{n}} could not be measured in this refresh — that is our instrument, and it says nothing about those employers.", { n: nf(duration.held.unmeasured) })
                    : "",
                  t("explore.hiringHeldOf", "(Counted over the {{n}} employers ranked here.)", { n: nf(hiring.length) }),
                ].filter(Boolean).join(" ")}
              </p>
            )}
          </Section>
        )}
        </div>

        {/* ── 3. THE DATES HERE ARE NOT WHAT THEY LOOK LIKE ─────────────────
            Replaces "Serial re-posters" entirely: its heading, its ranking by
            raw event volume, its per-card tracking window and the client clamp
            that capped a stated count at one re-list per tracked day. */}
        <div hidden={active !== "ghost"}>
        {loading && relisting.length === 0 ? (
          <Section icon={CalendarClock} title={t("explore.recycleTitle", "The dates here are not what they look like")} blurb={t("explore.recycleBlurb", "Employers that take a role down and put the same title back up. Each return resets the posted date, so an opening can look brand new long after it first appeared.")}>
            <TallSkeleton label="Measuring re-listings…" />
          </Section>
        ) : (
          <Section
            icon={CalendarClock}
            note={NOTE.ghost}
            title={t("explore.recycleTitle", "The dates here are not what they look like")}
            blurb={t("explore.recycleBlurb", "Employers that take a role down and put the same title back up. Each return resets the posted date, so an opening can look brand new long after it first appeared.")}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodTitleTerm", "How two postings count as the same role"),
                method: t("explore.methodTitleMethod", "We group titles exactly the way our collector decides a posting was superseded: bracketed segments containing digits and trailing requisition numbers are stripped, and nothing else — a Senior Engineer closing while an Engineer stays live is not a re-listing. That grouping is the measurement. Ranked on the RAW title, this list would score whichever employer varies its wording least as the worst offender, because every requisition-number variant would count as a separate role and divide the ratio down."),
              },
              {
                term: t("explore.methodRateTerm", "Why a rate, and never a count"),
                method: t("explore.methodRateMethod", "Re-listing events per affected title, not events. A raw event count grows with the size of a board — a large employer accumulates re-listings by existing — so ranking on it would put the biggest boards at the top of a list about conduct. A rate does not grow with size. Where each employer sits against ordinary behaviour is on its own card, as the board-wide median and top tenth measured in this same window under this same grouping."),
              },
              {
                term: t("explore.methodFloorTerm", "Every number here is a floor"),
                method: t("explore.methodFloorMethod", "Our collector logs only the first re-listing of a normalised title at an employer in any 24 hours and DELETES the rest, so the re-listings and the affected titles are both lower bounds and both carry a “+” on the number itself. THE RATIO BETWEEN THEM DOES NOT, and that is not an oversight: passes where our own fetch went dark are dropped whole, taking a title's only re-listing with them, so both terms are understated by an unknown amount and their ratio can move either way. The window is the same on every card and comes from the query: it is how much closure log this measurement covers, and our log began on 14 July 2026."),
              },
              {
                term: t("explore.methodBaseTerm", "What ordinary looks like"),
                method: t("explore.methodBaseMethod", "The board-wide median on each card is re-measured inside this same window, under this same title grouping, over the employers in the same pool. An older figure measured on raw titles over a different window is not comparable to these and is not used."),
              },
            ]} />
            {recycled.length > 0 ? (
              <RecyclingGrid claims={recycled} />
            ) : (
              /* A REFUSAL, NOT A GAP. The section cannot fall back to the old
                 raw-title collection: that ranking is the thing this answer
                 exists to stop publishing, and serving it under this heading
                 would put the employers who vary their wording least at the top
                 of a list about recycled dates. */
              <Refusal
                title={t("explore.recycleOutTitle", "We have no re-listing measurement in this refresh")}
                body={t("explore.recycleOutBody", "This ranking needs titles grouped the way our collector groups them, and that measurement did not reach this page. That is our instrument, and it says nothing about any employer — we would rather show nothing than rank this by how many re-listings we happened to log.")}
              />
            )}
          </Section>
        )}
        </div>

        {/* ── 4. STILL ADVERTISED WHEN IT CROSSED DAY 30 ────────────────────
            From the curve's age-out count alone. 'backdated' exits are OUR late
            knowledge of an old posting and are not employer conduct; they are
            not in this number. */}
        <div hidden={active !== "aged"}>
        {loading && hiring.length === 0 ? (
          <Section icon={AlarmClock} title={t("explore.agedTitle", "Still advertised when it crossed day {{cap}}", { cap: FILL_SUPPORT_MAX_DAYS })} blurb={t("explore.agedBlurb", "Roles that never came down — we simply stopped serving them at our {{cap}}-day cap while the employer was still advertising them.", { cap: FILL_SUPPORT_MAX_DAYS })}>
            <TallSkeleton label="Measuring age-outs…" />
          </Section>
        ) : (
          <Section
            icon={AlarmClock}
            note={aged.length > 0 ? NOTE.aged : null}
            title={t("explore.agedTitle", "Still advertised when it crossed day {{cap}}", { cap: FILL_SUPPORT_MAX_DAYS })}
            blurb={t("explore.agedBlurb", "Roles that never came down — we simply stopped serving them at our {{cap}}-day cap while the employer was still advertising them.", { cap: FILL_SUPPORT_MAX_DAYS })}
          >
            <HowWeMeasure items={[
              {
                term: t("explore.methodAgedTerm", "What an age-out is, and what it is not"),
                method: t("explore.methodAgedMethod", "A posting we watched stay up until it crossed our {{cap}}-day serving cap. It is OUR cap being reached, not the employer taking anything down — which is exactly why it is worth knowing: those roles were still being advertised. Counted from age-outs alone. Postings we back-dated after discovering them late are our own late knowledge of an old advert, not an employer leaving something up, and they are excluded.", { cap: FILL_SUPPORT_MAX_DAYS }),
              },
              {
                term: t("explore.methodAgedRateTerm", "The share, and what it is a share of"),
                method: t("explore.methodAgedRateMethod2", "Age-outs as a share of the takedowns, re-listings and age-outs we logged for that board — all three from the same measurement of the same board. They are counts of DEPARTURES, not of distinct roles: a role that came down twice contributed twice. Exits we recorded as our own — a board we stopped tracking, a feed gone dormant — are in none of the three, so this is not “everything that left”. EACH OF THE THREE IS A FLOOR: our 24-hour dedupe deletes repeat re-listings of a title, and an age-out row we failed to write is one we cannot see. A ratio of floors has no known direction, so the share carries no “at least” — the missing re-listings push it up and the missing age-outs push it down. Batches where our own fetch went dark are censored out rather than counted, because our collection failing is not an employer's conduct; where a whole board pass produced age-outs alone there is no takedown batch to judge it by, and those are counted."),
              },
              {
                term: t("explore.methodAgedWhoTerm", "Who is counted here"),
                method: t("explore.methodAgedWhoMethod", "Only employers whose record already cleared the bars on the previous answer, so nothing here rests on evidence this page refused one question earlier. The span on each card is how long we have watched that board, never a fixed 90 days."),
              },
            ]} />
            {aged.length > 0 ? (
              <AgedGrid claims={aged} basis={ageoutBasis} />
            ) : ageoutsMeasured ? (
              /* THE MEASUREMENT RAN AND CAME BACK EMPTY, which is a finding and
                 not an outage. agedClaimOf requires ageouts > 0, so a curve that
                 answered zero for every ranked token lands here — and telling a
                 reader "the measurement did not reach this page" would blame our
                 instrument for a state it reached successfully. The same us/them
                 split the duration answer draws with `unmeasured` against
                 `undated`, drawn here too. Still not a clean bill: the count is a
                 floor, so "none logged" is not "none happened". */
              <Refusal
                title={t("explore.agedZeroTitle", "None of the employers ranked here logged a role still up at our cap")}
                body={t("explore.agedZeroBody", "The measurement ran and returned no age-outs for any of them in its window. That is not a clean bill: the count is a floor — an age-out row we failed to write is one we cannot see — and it speaks only for the employers this page ranked.")}
              />
            ) : (
              <Refusal
                title={t("explore.agedNoneTitle", "We hold no age-out counts for the employers ranked here")}
                body={t("explore.agedNoneBody", "The lifecycle measurement behind this answer did not reach this page in the last refresh. That is our instrument, and it says nothing about any employer — an employer with no age-out count here has not been found clean, it has not been measured.")}
              />
            )}
          </Section>
        )}
        </div>

        {/* ── 5. WHO STATES PAY — AND WHO STATES A NUMBER YOU CAN COMPARE ───
            THE ORDER BY IS NOT pay_pct AND WILL NOT BECOME pay_pct. That revert
            was tried and measured on 2026-08-11: rate-ranking under LIMIT 12
            returned twelve exactly-100% boards whose largest held 267 roles, so
            the badge became unwinnable by any employer a reader has heard of.
            Rate-ranking is compulsory where a HEADING MAKES A COMPARATIVE CLAIM
            ABOUT CONDUCT — the re-listing answer above — and optional here,
            where every row has already cleared the same stated bar and prints
            its own ratio on the card. */}
        <div hidden={active !== "pay"}>
        {transparent.length > 0 ? (
          <Section icon={BadgeDollarSign} note={NOTE.pay} title={t("explore.payTitle", "Who states pay — and who states a number you can compare")} blurb={t("explore.payBlurb", "Employers stating pay on at least 80% of a board of 20 or more, counted from their own posting text and ATS fields. A badge no one can buy: the only way in is to actually state pay.")}>
            <HowWeMeasure items={[
              {
                term: t("explore.methodPayOrderTerm", "Why the biggest states-pay boards come first"),
                method: t("explore.methodPayOrderMethod", "Every employer here has already cleared the same bar — pay stated on at least 80% of at least 20 served roles — and every card prints its own ratio, so the order carries no claim the card does not. Ranking by percentage instead gave all twelve places to boards at exactly 100%, the largest of them 267 roles, which made the badge unwinnable by any employer a reader recognises without making a single sentence truer."),
              },
              {
                term: t("explore.methodPayMedianTerm", "When a median floor is shown"),
                method: t("explore.methodPayMedianMethod2", "Only where at least {{n}} of that employer's served postings carry a pay figure we could READ AS A US-DOLLAR ANNUAL FLOOR — the median's own sample, not the size of its board and not the same thing as stating pay. The badge above counts any pay statement, in any currency and any period; this counts the strict subset our parser resolved to an annual minimum in USD, which is frequently far smaller, so an employer stating pay on 92% of 400 roles can still have too few here. Below the floor we say so instead of showing a number: one such posting among three hundred used to publish a “median floor” with a sample of one. Nothing is converted between currencies.", { n: PAY_MEDIAN_MIN_USD_N }),
              },
            ]} />
            {/* No salaryFloor on this link: "states pay" and "pays at least $X"
                are different populations, and salary_min_annual is annualised in
                the posting's own currency and never converted. */}
            <CompanyGrid
              rows={transparent}
              intent="pay"
              warn={(r) => repostWarn(r.company_token, "pay")}
              // BOTH NUMBERS GROUPED. This read "82% of 16708 roles" live —
              // one formatted, one raw, in one sentence — because only the
              // percentage went through a formatter.
              badge={(r) => t("explore.transparentBadge", "{{pct}}% of {{n}} roles state pay", { pct: r.pay_pct ?? 0, n: nf(r.open_roles ?? 0) })}
              note={(r) => {
                // THE MEDIAN NEEDS ITS OWN SAMPLE, AND NOW HAS ONE. The gate was
                // `open_roles >= 20` because the row carried no usd_n — the size
                // of a different population than the one the median came from.
                const usdN = numOr(r.usd_n);
                const med = numOr(r.median_usd_floor);
                // THE SAMPLE IS ASKED ABOUT FIRST, because the SQL now nulls
                // the median itself below the floor ("a median of three
                // salaries is not a smaller fact, it is a different one"). If
                // the null were tested first, an employer with three USD
                // postings would render NO LINE — a silence a reader takes for
                // "states no pay", which is the opposite of what membership in
                // this list means. The refusal has to outlive the number it
                // refuses.
                // TWO REFUSALS, AND THEY ARE OPPOSITE FACTS. A row with no
                // usd_n at all is a row from a function that does not yet
                // return it — OUR instrument — and saying "fewer than 20 of its
                // roles state pay" there is a confident falsehood about an
                // employer we listed precisely because it states pay on 80% of
                // its board. Only a usd_n we actually hold may carry the
                // sentence about the employer.
                if (usdN === null) {
                  return t("explore.payMedianUnknown2", "no median: we hold no count of how many of its roles carry a pay figure we could read as a US-dollar annual floor");
                }
                // THE COLUMN'S OWN DEFINITION, NOT A PARAPHRASE OF THE BADGE.
                // usd_n is count(*) WHERE salary_currency = 'USD' AND
                // salary_min_annual > 0 — a PARSED ANNUAL FLOOR, which
                // 20260908133000's COMMENT ON calls "a strict subset and
                // frequently far smaller". salary_min_annual is populated on
                // about a fifth of servable rows while the badge's basis is
                // `salary IS NOT NULL` at 80%+ for every employer listed here.
                // Calling usd_n "roles that state pay in US dollars" printed
                // "only 15 of its roles state pay in US dollars" directly under
                // a badge reading 368 — two numbers, one sentence, two
                // populations.
                if (usdN < PAY_MEDIAN_MIN_USD_N) {
                  return t("explore.payMedianHeld2", "no median: only {{n}} of its roles carry a pay figure we could read as a US-dollar annual floor, fewer than the {{min}} we require", { n: nf(usdN), min: PAY_MEDIAN_MIN_USD_N });
                }
                // Sample cleared and still no median: the server computed none
                // for this row. That is our side of the line, so it says so
                // rather than implying anything about the employer.
                if (med === null) return t("explore.payMedianMissing", "no median: we could not compute one for this employer in the last refresh");
                return t("explore.payMedianN2", "median stated floor ${{m}} across the {{n}} of its postings we could read as a US-dollar annual floor", {
                  m: Math.round(med).toLocaleString(i18n.language), n: nf(usdN),
                });
              }}
            />
          </Section>
        ) : (
          <Section icon={BadgeDollarSign} title={t("explore.payTitle", "Who states pay — and who states a number you can compare")} blurb={t("explore.payBlurb", "Employers stating pay on at least 80% of a board of 20 or more, counted from their own posting text and ATS fields. A badge no one can buy: the only way in is to actually state pay.")}>
            {loading ? <GridSkeleton /> : (
              <Refusal
                title={t("explore.payOutTitle", "The pay-transparency list is not in this refresh")}
                body={t("explore.payOutBody", "This collection is computed once an hour and could not be recomputed — it is too slow to run while you wait, and we will not run it on the request path. That is our schedule, not a finding about any employer.")}
              />
            )}
          </Section>
        )}

        {/* Folded into the pay answer: "which employers state pay" and "which
            fields pay" are one question, and rendering them as two sections
            twenty screens apart made a reader choose between halves of it.
            No currency control, deliberately: get_salary_benchmarks does
            DISTINCT ON (category), so each field appears once in its dominant
            currency and all live rows are USD — a toggle with one real option is
            the dead-branch class this page has spent the week removing. */}
        {salary.length > 0 && (
          <Section icon={DollarSign} title={t("explore.salaryTitle", "Where the pay is")} blurb={t("explore.salaryBlurb", "Fields ranked by the median advertised floor — from postings that state pay, in each field's dominant currency. Never converted, never mixed.")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {salary.map((s) => (
                <Link
                  key={`${s.category}-${s.currency}`}
                  to={`/jobs/field/${s.category}?sort=salary&from=explore`}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-primary/50 hover:bg-card transition-colors"
                >
                  <TrendingUp className="w-4 h-4 text-success shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{t(`jobsPage.categories.${s.category}`, CATEGORY_LABELS[s.category] ?? s.category)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t("explore.salaryBadge", "median floor {{sym}}{{median}} ({{ccy}}) · {{n}} postings", { sym: CCY[s.currency] ?? "", median: Math.round(s.median_annual_min).toLocaleString(), ccy: s.currency, n: s.n })}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                </Link>
              ))}
            </div>
          </Section>
        )}
        </div>

        {/* ── 6. WHERE A BEGINNER ACTUALLY HAS A CHANCE ─────────────────────
            Ranked by entry_roles / open_roles, over employers with at least 10
            entry-level roles and 50 open. Forty entry roles out of 2,000 is not
            an entry-friendly employer; forty out of sixty is. */}
        <div hidden={active !== "entry"}>
        {entryShown.length > 0 ? (
          <Section icon={GraduationCap} note={NOTE.entry} title={t("explore.entryTitle2", "Where a beginner actually has a chance")} blurb={t("explore.entryBlurb2", "Ranked by the share of an employer's open roles that are open to people early in their careers — not by how many it has.")}>
            <HowWeMeasure items={[
              {
                term: t("explore.methodEntryTerm", "“Entry-level” is our word, not the employer's"),
                method: t("explore.methodEntryMethod", "We classify a role as entry-level by reading its title with our own classifier. No employer told us that; it is our reading of their wording, and employers who describe junior roles unusually are undercounted by it. The link on each card carries the same filter the card counted, so the board you land on shows exactly the roles behind the number."),
              },
              {
                term: t("explore.methodEntryRankTerm", "Why a share, and where the floor is"),
                method: t("explore.methodEntryRankMethod", "Ranked on entry-level roles as a share of that employer's open roles, among employers with at least {{e}} entry-level roles and at least {{o}} roles open. Ranking on the count alone puts the largest boards on top no matter how small a fraction of their hiring is open to a beginner; the floors keep a three-role board from topping the list on a perfect ratio.", { e: ENTRY_MIN_ENTRY_ROLES, o: ENTRY_MIN_OPEN_ROLES }),
              },
            ]} />
            <CompanyGrid rows={entryShown} intent="entry" warn={(r) => repostWarn(r.company_token, "entry")} badge={(r) => {
              const open = numOr(r.open_roles);
              const ent = numOr(r.entry_roles);
              // NEW KEY, NOT A REWORDED ONE. All nine locales carry
              // explore.entryBadge with a single {{n}}, and a locale value beats
              // the inline default — editing in place renders the old sentence
              // with a hole in it in nine languages.
              if (open !== null && open > 0 && ent !== null) {
                return t("explore.entryBadgeShare", "{{pct}}% of its {{open}} open roles are entry-level ({{entry}} roles)", {
                  pct: Math.round((ent / open) * 100), open: nf(open), entry: nf(ent),
                });
              }
              return null;
            }} />
          </Section>
        ) : (
          <Section icon={GraduationCap} title={t("explore.entryTitle2", "Where a beginner actually has a chance")} blurb={t("explore.entryBlurb2", "Ranked by the share of an employer's open roles that are open to people early in their careers — not by how many it has.")}>
            {loading ? <GridSkeleton /> : entry.length > 0 ? (
              /* ROWS ARRIVED AND NONE CLEARED THE FLOORS — which is a fact
                 about those employers' boards, not about our refresh, and must
                 not borrow the sentence below. */
              <Refusal
                title={t("explore.entryThinTitle", "None of the {{n}} employers we ranked clears our floors for this answer", { n: nf(entry.length) })}
                body={t("explore.entryThinBody", "A share is only worth ranking on a board big enough to mean something: at least {{e}} entry-level roles out of at least {{o}} open. None of the employers in this refresh has both.", { e: ENTRY_MIN_ENTRY_ROLES, o: ENTRY_MIN_OPEN_ROLES })}
              />
            ) : (
              <Refusal
                title={t("explore.entryOutTitle", "The entry-level ranking is not in this refresh")}
                body={t("explore.entryOutBody", "This collection could not be recomputed in the last hourly run, so there is nothing to show — our instrument, not a finding about any employer.")}
              />
            )}
          </Section>
        )}
        </div>

        {/* Browse by field. The chips carry counts formatted through the same
            cap the serving API applies, so a chip's number and the page it
            opens count the same rows in the same presentation.

            THE NOTE LINE IS GONE. It printed get_explore_denominators' uncapped
            total as "open across the board right now" directly above chips
            formatted through SERVE_COUNT_CAP — one sentence contradicting the
            eighteen numbers beneath it. */}
        <div hidden={active !== "fields"}>
        <Section icon={Briefcase} title={t("explore.fieldsTitle", "Browse by field")} blurb={t("explore.fieldsBlurb", "Jump straight into any field's live openings.")}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATEGORY_LABELS)
              .filter(([id]) => id !== "other")
              .sort((a, b) => (fields[b[0]] ?? 0) - (fields[a[0]] ?? 0))
              .map(([id, label]) => {
                const n = fields[id];
                return (
                  <Link
                    key={id}
                    to={`/jobs/field/${id}?from=explore`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-border bg-card/60 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                  >
                    {t(`jobsPage.categories.${id}`, label)}
                    {/* A field below the 50-posting floor is absent from the
                        payload entirely and renders as a bare chip — the link
                        still works, it simply makes no claim about depth. A thin
                        field must not render "0". */}
                    {typeof n === "number" && n > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground/70">{fieldCount(n, i18n.language)}</span>
                    )}
                  </Link>
                );
              })}
          </div>
        </Section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
