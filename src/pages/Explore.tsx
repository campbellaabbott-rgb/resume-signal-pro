// Explore — browse/discovery surfaces for people who don't search. Every
// collection is COMPUTED from the board's own data (hiring-health, velocity,
// freshness, salary, entry-level), never curated by hand and never invented.
// Each card deep-links into the live board pre-filtered, so discovery flows
// straight into the real, verified listings.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
// Compass went with the header pill; Flame and Sparkles went with the trending
// and newest sections. Section's icon prop is typed off LucideIcon rather than
// off one of the icons it happens to receive, so removing a section no longer
// strands an import purely to satisfy a type.
import { LucideIcon, TrendingUp, GraduationCap, DollarSign, Activity, ArrowRight, Briefcase, Repeat, Building2, BadgeDollarSign, Search } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
// The methodology disclosure /ghost-jobs and /hiring-trends already use —
// native <details>, in the accessibility tree, zero JS. The hiring answer's
// method has not been cut, it has been moved one click down into the component
// the rest of this product states its method in.
import { HowWeMeasure } from "@/components/HowWeMeasure";
import { supabase } from "@/integrations/supabase/client";
// ONE BAR, ONE DECLARATION. These three numbers decide whether an employer's
// fill rate may be published at all, and /jobs declares them. They were re-typed
// here as FILL_COVERAGE_QUALIFY and FILL_HORIZON_DAYS, which is how two surfaces
// end up publishing and refusing the same employer: editing one file was silent
// on the other, and the observation-window floor existed in neither. Importing
// them is the point — a second literal is the drift.
// canStateFillRate and coverageBand come with them, for the same reason the
// constants do: the board's detail panel decides whether an employer's record
// may carry a fill claim with ONE predicate, and a second surface re-spelling
// its three terms is how /jobs and /explore end up publishing and refusing the
// same employer. This file asks that predicate now instead of re-deriving it.
import { canStateFillRate, coverageBand, FILL_COVERAGE_MIN, FILL_RATE_MIN_TRACKING_DAYS, URGENT_FILL_MAX_DAYS } from "@/pages/Jobs";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

interface CompanyRow { company: string; company_token: string; open_roles?: number; p50_days_open?: number | null; dated_n?: number; pay_pct?: number; median_usd_floor?: number | null; recent?: number; entry_roles?: number; tracking_days?: number; repost_events?: number; reposted_roles?: number; worst_title?: string; worst_count?: number; feed_total?: number | null; on_board?: number; company_total?: number | null;
  // ── MERGED IN FROM get_company_fill_curve, NOT CARRIED BY THE ROW ─────────
  // These five are never returned by get_actively_hiring_companies, and were
  // never going to be: its signature is (company, company_token, closed_90d,
  // open_roles, tracking_days, p50_days_open, dated_n) and the migration that
  // rebuilt it kept that signature deliberately, so the explore cache cannot
  // carry them either. Reading them off the row meant `sufficient === true` was
  // false for every row on every deploy and the badge could not render once —
  // the p50 clock was deleted and nothing took its place, with nine locales
  // translated for a string that had no call path. They are merged in below
  // from a second call to the curve, keyed by token, and every reader stays
  // gated so a failed or undeployed curve degrades to the plain badge.
  //
  // TYPED `number | string`, WHICH IS NOT PEDANTRY. Postgres `numeric` reaches
  // the client as a JSON number on one PostgREST build and as a STRING on
  // another, and every gate below is a comparison — `"0.42" >= 0.3` is true by
  // string collation for the wrong reason. Every read goes through numOr().
  fill_rate_14?: number | string | null; fill_rate_14_lo?: number | string | null; fill_rate_14_hi?: number | string | null;
  dated_coverage?: number | string | null; sufficient?: boolean;
  // The curve's own guarded 90-day counts, when it answered. Distinct names
  // from closed_90d/tracking_days because they are a DIFFERENT population: the
  // curve applies the retroactive feed-dark proxy to unstamped history, the
  // hiring RPC applies only the stamped `suspect` column, which is false on
  // every row written before the collector guard shipped.
  curve_fills_90d?: number; curve_tracking_days?: number;
  /** The curve's relist count over the same window. A FLOOR. */
  curve_relists_90d?: number;
  // ── AND THE SAME MEASURE UNDER THE NAMES THE REWRITTEN RPC RETURNS ───────
  //
  // 20260907010000 rebuilt get_actively_hiring_companies to count ROLES rather
  // than closure events, to rank on the curve's R(14), and to return the
  // measure on the row — so the merge above is now the fallback for a cache row
  // written before it, not the path. Names and meanings are the function's own
  // COMMENT ON, and each one is read for exactly what it says it is:
  //
  //   filled_roles_ceiling  distinct roles that closed once and did not come
  //                         back. A CEILING — the collector deletes deduped
  //                         re-lists, so re-lists it never saw are counted here
  //                         as fills. Renders "up to N", never "N".
  //   relisted_roles_floor  roles that closed twice, or were superseded, or are
  //                         serving again today. A FLOOR — renders "at least".
  //   fill_incidence_14d    the curve's R(14), the ranking key. Also a CEILING.
  //   dated_share           coverage; the RPC does NOT gate on it and its
  //                         COMMENT ON says the caller must (FILL_COVERAGE_MIN).
  //   fills_window_days     90 — the window every count above is measured over,
  //                         returned because closed_90d was a 30-day count
  //                         under a 90-day name.
  //
  // `closed_90d` is deliberately NOT read anywhere in this file. It is the
  // legacy name, kept for four consumers that read by column name, and it is
  // the number that put 4,331 "fills" on JLL's card.
  filled_roles_ceiling?: number | string | null; relisted_roles_floor?: number | string | null;
  relist_share_floor?: number | string | null; repost_events_floor?: number | string | null;
  fill_incidence_14d?: number | string | null; fill_incidence_14d_lo?: number | string | null;
  fill_incidence_14d_hi?: number | string | null; dated_share?: number | string | null;
  fills_window_days?: number | string | null; at_risk_14d?: number | string | null;
  /** When feed_total was last read. See FillClaim.feedTotalAt. */
  feed_total_at?: string | null }

/** COERCE AT THE BOUNDARY, ONCE — /jobs' own `num()`, for the same row shape.
 *  An absent column reads as null, which is a REFUSAL rather than a zero: a
 *  gate that cannot be evaluated must suppress the claim, not pass it. */
const numOr = (v: unknown, fallback: number | null = null): number | null => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** THE HIRING ROW AFTER THE CURVE HAS SPOKEN — or nothing at all.
 *
 *  Every field is a statement the row can support, and the two that qualify it
 *  travel with it rather than in a tooltip: a fill claim without the span it
 *  was measured over is a claim about an unknown window, and a rate over a
 *  third of an employer's board is not a fact about that employer. */
interface FillClaim {
  token: string;
  company: string;
  /** R(14) UNROUNDED, kept because the order is decided on it.
   *
   *  Sorting on `pct` alone re-ranked the list the server had just ranked:
   *  0.1841 and 0.1794 both round to 18%, so every adjacent pair inside one
   *  percentage point became a tie and fell to the `fills` tie-break — a SIZE
   *  ordering, inside a section whose entire purpose is to stop ranking by
   *  size. With twelve rows drawn from a narrow band most pairs collide. */
  rate: number;
  /** R(14) as whole percent, for display only. A CEILING — rendered "up to". */
  pct: number;
  lo: number | null;
  hi: number | null;
  /** Roles observed off the board and not back. A CEILING — "up to N".
   *
   *  NULL WHENEVER THE SOURCE COUNTS EVENTS RATHER THAN ROLES, which is the
   *  client-side curve fallback: get_company_fill_curve's fills_90d is
   *  `sum(is_fill)` over one row per closure EVENT, and its own body says so
   *  ("named for a window of events and stay a window of events"). Rendering
   *  that under the word "roles" is the 4,331-fills defect wearing a different
   *  column name — one card printed "up to 2,632 roles came down for good"
   *  beside "164 roles open", numbers that cannot both be true. The rate is
   *  still publishable from that source; the COUNTS are not, so they are
   *  refused rather than relabelled. */
  fills: number | null;
  /** Roles observed back. A FLOOR — "at least N", or not rendered. NULL on the
   *  event-counting source, for the same reason as `fills`, and worse there:
   *  "at least 465 of the roles came back" from 465 events spanning maybe 80
   *  roles overstates in the unsafe direction — it is the defamation shape
   *  repostWarn's own comment exists to prevent. */
  relists: number | null;
  /** Days we have actually watched this board. */
  windowDays: number;
  coverage: number | null;
  /** 0.30–0.60 coverage: the figure may be said, and must name what it covers. */
  qualified: boolean;
  /** Roles open ON OUR BOARD under both serving predicates — an exact count of
   *  what /jobs/company/{token} serves, and a floor on the employer's own
   *  opening count, which is what feedTotal carries when the feed states one. */
  open: number | null;
  feedTotal: number | null;
  /** When the employer's own feed total was last read. job_board_verifications
   *  keeps ONE ROW PER BOARD and is UPSERTed on every fetch, so it has no
   *  history: a board that went dark holds its last advertised total forever.
   *  Without this stamp feed_total is a number with no date basis, and the
   *  standing rule on this product is that a published statistic names one. */
  feedTotalAt: string | null;
}

/** The measure, from whichever of the two sources answered — the rewritten
 *  RPC's own columns first, the client-side curve merge second. Never mixed:
 *  a rate from one source beside a window from the other is the defect this
 *  page spent the week removing, one field at a time. */
const measureOf = (r: CompanyRow) => {
  const rate = numOr(r.fill_incidence_14d);
  if (rate !== null) {
    return {
      rate,
      lo: numOr(r.fill_incidence_14d_lo), hi: numOr(r.fill_incidence_14d_hi),
      coverage: numOr(r.dated_share),
      fills: numOr(r.filled_roles_ceiling),
      relists: numOr(r.relisted_roles_floor),
      days: numOr(r.tracking_days),
      // THE RPC RETURNS NO `sufficient` COLUMN, AND DOES NOT NEED TO. It gates
      // on the curve's flag in its own WHERE — "an employer whose curve refuses
      // to answer does not appear at all", with no fallback ordering — so a row
      // carrying an incidence at all IS the server's sufficiency finding. The
      // client half of the gate is the coverage floor, which that function's
      // COMMENT ON explicitly leaves to the caller, and the observation window,
      // which `sufficient` never looks at.
      sufficient: true,
      answered: true,
    };
  }
  // THE FALLBACK CARRIES THE RATE AND REFUSES THE COUNTS.
  //
  // get_company_fill_curve's fills_90d / relists_90d are `sum(is_fill)` and
  // `sum(is_relist)` over ONE ROW PER CLOSURE EVENT — its own body states it in
  // as many words: "named for a window of events and stay a window of events".
  // A role that closed twenty times contributes twenty. This page rendered them
  // as "up to {{n}} roles came down for good", which is the same
  // events-published-as-roles defect that put 4,331 fills on JLL's card, and it
  // is the path that runs on EVERY cache row written before 20260907010000 —
  // i.e. every row today. The rate is a share of a cohort and survives; the
  // counts do not, and are nulled rather than relabelled, because the card has
  // no honest sentence for "2,632 takedown events" that a reader would not read
  // as roles anyway.
  //
  // The durable fix is in get_company_fill_curve — collapse f90/r90 per
  // posting_id, which is also where /jobs/company reads them — and is not
  // this file's to make.
  return {
    rate: numOr(r.fill_rate_14),
    lo: numOr(r.fill_rate_14_lo), hi: numOr(r.fill_rate_14_hi),
    coverage: numOr(r.dated_coverage),
    fills: null,
    relists: null,
    days: numOr(r.curve_tracking_days),
    sufficient: r.sufficient === true,
    // Did the curve answer at all? Distinguishes "this employer publishes no
    // posting dates" (a fact about the employer's feed) from "our measurement
    // did not run" (a fact about us). `sufficient` is set by the merge effect
    // on every row the curve returned, true or false, and is absent otherwise.
    answered: r.sufficient !== undefined,
  };
};

/** DOES THIS ROW ALREADY CARRY A MEASURE, from either source?
 *
 *  One predicate, asked in two places that must never disagree: the curve
 *  effect's early-return, and the derived `measuring` flag that decides whether
 *  the section shows placeholders or a refusal. When those two were spelled
 *  separately, one frame rendered "No employer's record is deep enough" over
 *  rows that were about to qualify. `sufficient` is the witness for the merged
 *  path — it is set on every row the curve returned, true or false, and is
 *  undefined on a row the curve has not spoken for. */
const hasMeasure = (r: CompanyRow): boolean =>
  numOr(r.fill_incidence_14d) !== null || numOr(r.fill_rate_14) !== null || r.sufficient !== undefined;

/** Why an employer the RPC ranked does not appear. Published as counts, so a
 *  thin record reads as a thin record and an outage of ours reads as an outage
 *  of ours — neither as a verdict about the employer. */
type Held = "reposter" | "unmeasured" | "undated" | "window" | "estimate";

/**
 * THE ONE GATE, AND THE ONLY PLACE A CARD IS ALLOWED INTO THIS SECTION.
 *
 *   reposter   — the heading promises that employers whose takedowns are mostly
 *                re-listings appear under Serial re-posters instead, and four
 *                cards in this section were rendering that very warning. The
 *                RPC now disqualifies them server-side; this re-applies the
 *                warning's own predicate client-side so a cache row written
 *                before that migration cannot contradict the heading either.
 *   unmeasured — the row carries no measure and the curve never answered for it
 *                (an old cache row, a curve call that failed, a refresh that
 *                timed out). OUR instrument, and said as such.
 *   undated    — the curve DID answer and returned no rate. That happens for
 *                exactly one reason: the employer's feed states no posting
 *                dates, so there is no cohort to run lifetimes over. That is a
 *                fact about the employer's feed, not about our instrument, and
 *                folding it into `unmeasured` made the page apologise for an
 *                outage it did not have.
 *   window     — `sufficient` counts roles at risk, observed fills and interval
 *                width: statements about the sample, none about how long we
 *                watched. Lifetimes run from the employer's stated posted_at,
 *                so a ten-day-deep log can satisfy it and print a fourteen-day
 *                rate beside "10d tracked". This is that missing half.
 *   estimate   — sufficiency and the coverage floor, through /jobs' predicate.
 */
const heldFor = (r: CompanyRow, serialReposters: ReadonlySet<string>): Held | null => {
  if (serialReposters.has(r.company_token)) return "reposter";
  const m = measureOf(r);
  // `fills` is deliberately NOT part of this gate. The fallback source counts
  // closure events rather than roles, so its count is refused for RENDERING —
  // but the rate it carries is a cohort share and is publishable, and holding
  // the employer back for a count the card will not print would delete the
  // whole section on every pre-rewrite cache row.
  if (m.rate === null) return m.answered ? "undated" : "unmeasured";
  if (m.days === null) return "unmeasured";
  if (!(m.days >= FILL_RATE_MIN_TRACKING_DAYS)) return "window";
  if (!canStateFillRate({ sufficient: m.sufficient, dated_coverage: m.coverage ?? 0 }, m.days)) return "estimate";
  return null;
};

/**
 * THE SECTION'S CONTENTS AND ITS OMISSIONS, COMPUTED ONCE.
 *
 * ORDERED BY THE RATE, WHICH IS THE ONLY THING HERE COMPARABLE ACROSS ROWS.
 * The previous ordering was `filled * 100 / open_roles` — closure EVENTS over a
 * stock of open roles, which is not a rate of anything: Accenture scored
 * 2,496%, JLL implied 394 fills a day against 220 roles open, and a 50-day row
 * sat beside an 11-day row as though their counts were one measurement. R(14)
 * is a share of one employer's own risk set at one fixed horizon, so every card
 * answers the same question over the same number of days — and the days we
 * actually watched are printed on each card rather than assumed equal.
 *
 * The RPC already ranks this way. Re-sorting here is not a second opinion: it
 * keeps the order true when the payload is a cache row from before the rewrite,
 * and it costs twelve comparisons.
 */
function rankedFillClaims(rows: CompanyRow[], serialReposters: ReadonlySet<string>):
  { shown: FillClaim[]; held: Record<Held, number> } {
  const held: Record<Held, number> = { reposter: 0, unmeasured: 0, undated: 0, window: 0, estimate: 0 };
  const shown: FillClaim[] = [];
  for (const r of rows) {
    if (!r || typeof r.company_token !== "string") continue;
    const why = heldFor(r, serialReposters);
    if (why) { held[why] += 1; continue; }
    const m = measureOf(r);
    shown.push({
      token: r.company_token,
      company: r.company,
      // Clamped before rounding: an interval carried across from a second
      // estimator can land a hair outside [0,1], and 101% is a number this
      // model cannot produce.
      rate: Math.max(0, Math.min(1, m.rate as number)),
      pct: Math.round(Math.max(0, Math.min(1, m.rate as number)) * 100),
      lo: m.lo, hi: m.hi,
      fills: m.fills,
      relists: m.relists,
      windowDays: m.days as number,
      coverage: m.coverage,
      qualified: coverageBand(m.coverage) === "qualified",
      open: numOr(r.open_roles),
      feedTotal: numOr(r.feed_total),
      feedTotalAt: typeof r.feed_total_at === "string" ? r.feed_total_at : null,
    });
  }
  // MIRRORS THE SERVER'S ORDER, TERM FOR TERM: `cv.fill_rate_14 DESC,
  // (hi - lo) ASC, f.filled DESC`. On the UNROUNDED rate, because sorting on
  // the displayed percent turns every pair inside one point into a tie and
  // hands the order to the volume tie-break — putting the bigger, worse-
  // evidenced employer above the tighter-interval one the server had chosen,
  // which is precisely the size ranking this section exists to delete. The
  // interval width sorts second, and a row missing an interval sorts last
  // among its ties rather than first.
  const width = (c: FillClaim) => (c.lo === null || c.hi === null ? Infinity : c.hi - c.lo);
  shown.sort((a, b) => b.rate - a.rate || width(a) - width(b) || (b.fills ?? 0) - (a.fills ?? 0));
  return { shown, held };
}

interface SalaryRow { category: string; currency: string; n: number; median_annual_min: number }
interface Segment { companies: number; with_headcount?: number; open_roles: number; remote_pct: number | null; disclosed_pct?: number | null; disclosed_n?: number | null; entry_pct: number; median_usd_floor: number | null; usd_n: number | null; top: CompanyRow[] }

// KEYED BY WHATEVER THE RPC EMITS, not by a literal this file guesses.
//
// It was `Record<"enterprise" | "mid" | "small", Segment>`, and the RPC has
// emitted mega/large/mid/small since 20260727212029. "enterprise" simply never
// matched, so the largest band never rendered and nothing errored: 936
// companies and 305,631 open roles — 52% of the section, and every recognisable
// large employer — were invisible while the page looked healthy. Same shape as
// tracking_days -> observed_days on the Ghost Job Index. A renamed key must
// degrade to a plain label, never to silence.
type Segments = Record<string, Segment | undefined>;

/**
 * Bands in descending order of the thing they band ON — roles open per company
 * — derived from the payload rather than from a list that can fall out of step
 * with the RPC.
 *
 * NOT by total open roles, which was the first attempt and rendered
 * "200–999, Under 50, 1,000+, 50–199": the small band holds 15,513 companies,
 * so its aggregate outweighs the mega band's 212 even though every company in
 * it is tiny. Roles-per-company IS the banding dimension, so ordering by it
 * always yields biggest-first (mega 612, large 243, mid 70, small 10) without
 * naming a single band.
 */
const orderedBands = (segments: Segments): Array<[string, Segment]> =>
  Object.entries(segments)
    .filter((e): e is [string, Segment] => !!e[1] && (e[1].companies ?? 0) > 0)
    .sort((a, b) =>
      (b[1].open_roles ?? 0) / Math.max(b[1].companies, 1) -
      (a[1].open_roles ?? 0) / Math.max(a[1].companies, 1));

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
 *  The serving API stops counting at 10,000 and replies `countCapped: true`,
 *  so /jobs/field/marketing renders "10,000+" no matter how many roles are
 *  really there. get_explore_denominators counts in SQL and is NOT capped, so
 *  a chip printing its raw number would read "38,412" and open a page saying
 *  "10,000+" — the card-contradicts-destination defect, merely inverted.
 *
 *  So the chip formats through the SAME cap. Two runtimes, one number, and a
 *  cross-runtime test pins them together: this is the exact shape of the
 *  claim-drift failure where copy went false because the thing it described
 *  lived in a different runtime than the sentence about it. */
const SERVE_COUNT_CAP = 10_000;

/** MIRRORS refresh_explore_cache's `FILTER (WHERE r.rn <= 12)`
 *  (20260812230000) and the live fallback's `p_limit: 12` below.
 *
 *  It is the size of the SLICE the client can see, and the client's two extra
 *  gates — the coverage floor and the observation window — are applied to that
 *  slice alone. Every sentence counting cards or held-back employers is
 *  therefore a statement about twelve rows, and says so; the only number on
 *  this section that speaks for the whole qualifying population is
 *  totals.hiring_n, which the server computes over all of it. */
const HIRING_SLICE = 12;
const fieldCount = (n: number, loc: string) =>
  n >= SERVE_COUNT_CAP ? `${SERVE_COUNT_CAP.toLocaleString(loc)}+` : n.toLocaleString(loc);

/** How old the hourly cache may be before the page stops presenting it as the
 *  current state of the board. Three hours, not one: a single missed run is
 *  ordinary jitter, and crying stale on it would train readers to ignore the
 *  line that matters when pg_cron actually dies — which it did, for a day,
 *  while this page showed a fresh-looking "refreshed hourly" over frozen data. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** token -> [repost_events, reposted_roles, days_tracked]. */
type RepostIndex = Record<string, [number, number, number] | undefined>;
/** Pool sizes behind each collection. Every key is optional and every one is
 *  absent rather than zero when its scan failed — see the NULLIF/strip_nulls
 *  note in 20260812020000. Nothing here may render as "0". */
interface Totals {
  hiring_n?: number; repost_pool_n?: number; repost_flagged_n?: number;
  entry_n?: number; pay_n?: number; pay_pool_n?: number;
  employers_n?: number; postings_n?: number; postings_pay_n?: number;
}

/** THE ONLY PLACE THIS FILE BUILDS A /jobs URL.
 *
 *  Every card used to hardcode `/jobs/company/{token}?from=explore`, which is
 *  how the entry-level card came to promise "38 entry-level roles" over a
 *  destination showing 900 — the badge counted one thing and the page it opened
 *  counted another. A card's number and the filter its link carries are one
 *  decision, so they live in one function.
 *
 *  `experience=entry` is read by Jobs.tsx:315 and accepted by experience.ts —
 *  verified, not assumed. Nothing here appends a filter Jobs does not read: a
 *  `fresh=day` link was drafted for the ghost-job answer and dropped, because
 *  Jobs.tsx WRITES that param but never reads it back, so the button would have
 *  promised a 24-hour window and delivered an unfiltered board. */
const companyHref = (token: string, intent: Intent): string => {
  const base = `/jobs/company/${encodeURIComponent(token)}?from=explore`;
  return intent === "entry" ? `${base}&experience=entry` : base;
};

/** The six things a visitor might actually want, in chip order. Each renders
 *  one cached collection; none triggers a fetch. */
type Intent = "check" | "hiring" | "pay" | "entry" | "ghost" | "scale" | "fields";
/** `check` first, deliberately. The other six are browsing; this one answers the
 *  question a visitor most often actually arrives with — "should I trust this
 *  posting from THIS employer?" — and it is the only answer that covers all
 *  24,931 employers rather than the 85 that top a list. */
const INTENTS: readonly Intent[] = ["check", "hiring", "pay", "entry", "ghost", "scale", "fields"];
const isIntent = (v: string | null): v is Intent => !!v && (INTENTS as readonly string[]).includes(v);

// A collection of companies → each a deep-link into the board filtered to that
// company. One shared card grid so every section reads consistently.
function CompanyGrid({ rows, badge, intent, tone = "default", warn }: { rows: CompanyRow[]; badge?: (r: CompanyRow) => string | null; intent: Intent; tone?: "default" | "warning"; warn?: (r: CompanyRow) => string | null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {rows.map((r) => {
        const b = badge?.(r);
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
              {/* THE CHURN WARNING, WHEREVER THE EMPLOYER APPEARS.
                  Rendered only on a hit, and only ever as a positive statement
                  — a miss means "did not clear the rate gate", which includes
                  every employer we have watched for a week. Styled warning, not
                  muted, because it contradicts the recommendation the card it
                  sits inside is making. */}
              {w && <span className="block text-[11px] text-warning mt-0.5">{w}</span>}
            </span>
            {/* No arrow on the warning list. Every other collection is a
                recommendation and the arrow reads as "go here"; the re-poster
                list is the one that says "be careful", and it must not look
                like the five that say "apply". */}
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
 * THE FILL CARD — one number, at the weight of the decision it supports.
 *
 * What it replaces, verbatim from one card's subtitle: "4324 filled in 50d
 * tracked · 172 open now · up to 63% taken down for good within 14d". Three
 * numbers of equal weight in 11px grey, the first of them wrong, and the churn
 * caution below it in the same size and nearly the same colour as the praise.
 * Nothing was hidden and nothing was scannable.
 *
 * The hierarchy, in the order a job seeker reads it:
 *   1. WHO       — the employer.
 *   2. WHAT      — one figure, large: how much of its board comes down inside
 *                  the horizon and stays down.
 *   3. HOW SURE  — the interval, the roles behind it, and the days we watched,
 *                  in one quiet line. The window is never optional.
 *   4. THE CATCH — re-listings, behind a rule and in the warning colour, so the
 *                  caution cannot be read as more of the claim.
 */
function HiringGrid({ claims }: { claims: FillClaim[] }) {
  const { t, i18n } = useTranslation();
  const nf = (n: number) => n.toLocaleString(i18n.language);
  const pctOf = (x: number | null) => (x === null ? null : Math.round(Math.max(0, Math.min(1, x)) * 100));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {claims.map((c) => {
        const lo = pctOf(c.lo);
        const hi = pctOf(c.hi);
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
            {/* "UP TO" IS PART OF THE NUMBER, NOT A HEDGE BESIDE IT.
                R(14) is an upper bound on any employer that re-lists: the
                collector logs one superseded closure per title per 24h and
                DELETES the rest, so re-listings it never saw are absent from
                the risk set and the fills that remain take a larger share of a
                smaller cohort. Both the RPC's COMMENT ON and the curve's say
                so in as many words. Small and muted rather than dropped,
                because the figure is what a reader acts on and the direction
                of its error is knowable. */}
            <span className="mt-3 flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("explore.fillUpTo", "up to")}
              </span>
              <span className="text-3xl font-bold leading-none tabular-nums text-foreground">{c.pct}%</span>
            </span>
            {/* NOT "FILLED". What the lifecycle log observes is a posting going
                away and not coming back, which can be a hire, a cancelled req
                or a frozen budget — this page deleted "proven fill record" for
                exactly that reason. R(14) additionally holds re-listings out as
                a competing event, which is what "and stayed down" names. */}
            <span className="mt-1.5 block text-[12px] leading-snug text-foreground/75">
              {/* `{{h}}`, not `{{d}}`: on this card `d` is the tracking span
                  (50 days) one line below, and the horizon (14 days) is a
                  different number entirely. One letter for two quantities on
                  one card is how a translator puts the wrong one in the wrong
                  sentence. The constant is /jobs' own, imported, never a
                  literal — a page that keeps saying "within 14 days" after the
                  horizon moves is the drift this product has shipped before. */}
              {t("explore.fillLabel", "of its roles came down within {{h}} days and stayed down", { h: URGENT_FILL_MAX_DAYS })}
            </span>
            {/* THE WINDOW TRAVELS WITH THE CLAIM, ALWAYS — and the interval is
                labelled approximate, which is what the curve's own COMMENT ON
                requires of anything that renders it. */}
            <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
              {[
                lo !== null && hi !== null ? t("explore.fillInterval", "{{lo}}–{{hi}}% approx.", { lo, hi }) : "",
                /* THE COUNT RENDERS ONLY FROM A SOURCE THAT COUNTED ROLES.
                   `fills` is null whenever the measure came from the client
                   curve fallback, whose 90-day figures are closure EVENTS;
                   printing those under "roles" is the defect this section was
                   rebuilt to remove. The window is never optional and prints
                   either way, because a rate without its span is a claim about
                   an unknown stretch of time.

                   AND THE COUNT NAMES ITS OWN WINDOW, because it is not the
                   same population as the open count two lines down: this
                   accumulates over 90 days of paginated reads and can see far
                   more distinct roles than the board ever holds at once, while
                   "open on our board" is one instant of the slice we hold. Two
                   counts over two boards, adjacent, invite being read as a
                   ratio — so each says what it spans. */
                c.fills !== null
                  ? t("explore.fillEvidence", "up to {{n}} roles came down for good across {{d}}d of tracking", { n: nf(c.fills), d: c.windowDays })
                  : t("explore.fillWindow", "measured across {{d}}d of tracking", { d: c.windowDays }),
              ].filter(Boolean).join(" · ")}
            </span>
            {c.open !== null && (
              /* A COUNT, AND SAYING WHOSE BOARD IT COUNTS. Both serving
                 predicates, so it is exactly what /jobs/company/{token} shows.
                 It is not a cap — nothing on its path applies a LIMIT — but it
                 IS a floor on the employer's own advertised openings, because
                 paginated vendors are read a page at a time, which is why so
                 many of these land on multiples of twenty. Where the feed
                 states its own total and it is larger, both numbers render. */
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {/* THE EMPLOYER'S OWN TOTAL NAMES THE DAY IT WAS READ, or it is
                    not rendered. job_board_verifications holds one row per
                    board and is overwritten on every fetch, so it has no
                    history — a board whose ATS migrated three weeks ago keeps
                    advertising its last total forever, and printed bare it
                    reads as current. With no stamp there is no date basis, and
                    the rule on this page is that a statistic without one is not
                    published. Our own count beside it is an instant, so it
                    needs no date. */}
                {c.feedTotal !== null && c.feedTotal > c.open && c.feedTotalAt !== null
                  ? t("explore.fillOpenBoth", "{{n}} roles open on our board · {{total}} on the employer's own feed, read {{when}}", {
                      n: nf(c.open), total: nf(c.feedTotal),
                      when: new Date(c.feedTotalAt).toLocaleDateString(i18n.language, { dateStyle: "medium" }),
                    })
                  : t("explore.fillOpen", "{{n}} roles open on our board now", { n: nf(c.open) })}
              </span>
            )}
            {c.qualified && c.coverage !== null && (
              <span className="mt-1 block text-[10px] leading-snug text-muted-foreground/80">
                {t("explore.fillCoverage", "across the {{pct}}% of its roles that carry the company's own posting date", { pct: pctOf(c.coverage) })}
              </span>
            )}
            {/* THE CAUTION, AND IT DOES NOT LOOK LIKE THE CLAIM. Behind a rule,
                in the warning colour, carrying the same icon the Serial
                re-posters answer uses — and stated as a FLOOR, because a
                deduped count cannot produce an equality. */}
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

/** Twelve card-shaped placeholders, matching CompanyGrid's geometry — the
 *  COMPACT card, roughly 60px tall, used by every answer except the hiring one.
 *  HiringGrid's cards are ~200px and have their own skeleton below; standing in
 *  for them with these produced a ~1,700px growth on a single-column phone the
 *  moment the real cards arrived, which is the jump this component exists to
 *  prevent.
 *
 *  aria-hidden with a polite live region beside it: a screen reader should hear
 *  "loading employers" once, not twelve empty list items. */
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

/** The hiring answer's own placeholders, at the FILL CARD's geometry: the
 *  avatar row, the 3xl figure, the two-line label, the provenance line and the
 *  open-roles line. Same grid gap and same padding as HiringGrid, so the twelve
 *  boxes that stand in for the cards are the size of the cards. */
function HiringSkeleton() {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">Measuring employers…</span>
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
            <span className="mt-1 block h-2.5 rounded bg-muted/50 animate-pulse" style={{ width: `${40 + ((i * 3) % 30)}%` }} />
          </div>
        ))}
      </div>
    </>
  );
}

/** `note` is the denominator line — "the 12 best of N that qualify".
 *
 *  Twelve cards under "Companies that actually fill roles" is indistinguishable
 *  from "twelve companies fill roles". The collection is a top slice and has
 *  always been one; the page simply never said what it was a slice OF, which
 *  makes a leaderboard read as a census.
 *
 *  Optional, and absent whenever its counter is — a failed scan leaves the key
 *  stripped rather than zero, so a broken instrument renders no sentence rather
 *  than "the 12 best of 0 employers". */
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
  // ONE QUESTION AT A TIME.
  //
  // Measured before this change: the page was 31,935px — about forty screens —
  // with 120 company cards, ZERO interactive controls, and six of its eight
  // sections rendering the same 12-card grid differing only in sort order. A
  // visitor with no specific query had nothing to act on and no way to tell
  // why they should care about one leaderboard over the next.
  //
  // The collections are unchanged and still come from the single hourly cache
  // row. What changed is that one is visible at a time, chosen by the reader,
  // with the rest kept in the DOM under `hidden` — never conditionally
  // unmounted, because /explore is prerendered and sitemapped at priority 0.8
  // daily and every company link must stay crawlable and findable with Ctrl-F.
  const [intent, setIntent] = useState<Intent>("hiring");
  // Employer lookup state. The query fires on keystroke only, never on load,
  // and only at 3+ characters — a shorter one would scan the alphabet.
  const [cq, setCq] = useState("");
  const [cHits, setCHits] = useState<Array<{ name: string; tokens: string[] }>>([]);
  /** THREE STATES, NOT TWO — and the third is the whole point.
   *
   *  This was a boolean, and a failed lookup fell into the same branch as a
   *  genuine miss: searching "wegman" while the RPC was undeployed printed
   *  "We don't carry that employer's job board", which is a confident false
   *  statement about a company we carry 498 roles for. Caught by testing before
   *  the migration applied.
   *
   *  A broken instrument must never render as a fact about the thing it
   *  measures. That is the failure this whole page has been paying down: a
   *  section that timed out looked like a section with nothing to show. */
  const [cState, setCState] = useState<"idle" | "ok" | "error">("idle");
  // Which size band is expanded. Only one band's cards render at a time; the
  // four stat lines act as the selector, so 36 of 48 cards leave the viewport
  // while every band's aggregate stays on screen.
  const [band, setBand] = useState<string | null>(null);
  const [hiring, setHiring] = useState<CompanyRow[]>([]);
  const [reposters, setReposters] = useState<CompanyRow[]>([]);
  const [entry, setEntry] = useState<CompanyRow[]>([]);
  const [salary, setSalary] = useState<SalaryRow[]>([]);
  const [segments, setSegments] = useState<Segments | null>(null);
  // Transparent employers: companies stating pay on >=80% of a meaningful
  // board. Fetched live (not in the hourly cache yet); section hides on empty.
  const [transparent, setTransparent] = useState<CompanyRow[]>([]);
  // When the cached collections were computed. The cache has always carried
  // this; the page just never rendered it while claiming "computed live".
  const [computedAt, setComputedAt] = useState<string | null>(null);
  // WHICH COLLECTIONS THE LAST REFRESH COULD NOT RECOMPUTE.
  //
  // refresh_explore_cache has always written stale_parts and this page has
  // never read it: a collection whose scan timed out is served from the
  // previous run under a "Measured <time>, refreshed hourly" line that
  // describes neither. A statistic that could not be recomputed is a different
  // fact from one that was, and the reader is the one who has to know.
  const [stale, setStale] = useState<string[]>([]);
  // THE FALLBACK MEASUREMENT IS IN FLIGHT, WHICH IS NOT THE SAME AS NOTHING
  // QUALIFYING. Measured in a browser against the live cache: a row written
  // before 20260907010000 carries no incidence, so every row is held as
  // "unmeasured" for the ~600ms the curve call takes, and the section rendered
  // "No employer's record is deep enough to publish a fill figure right now"
  // and then replaced it with cards. A refusal that turns out to be false is
  // worse than a wait, and this page's whole argument is that it does not say
  // things it cannot stand behind — including for half a second.
  //
  // NOT useState, WHICH IS WHY IT DID NOT WORK. `setMeasuring(true)` lived in
  // the curve effect, and an effect runs AFTER the commit that painted the rows
  // — so React painted the refusal for one frame and only then swapped in the
  // skeleton, which is the exact false refusal the state was added to remove.
  // It is DERIVED below from the same predicate the effect's early-return
  // tests, so no frame can exist in which rows are on screen, no measure is in
  // hand and the page has already given its verdict. `curveDone` is the one
  // genuine piece of state: whether the second call has come back.
  const [curveDone, setCurveDone] = useState(false);
  // Per-field served counts, pool sizes, and the churn index. All three ride
  // the same cached row as the collections — no extra request, and no live
  // aggregate on the request path, which is the rule this page exists to keep.
  // All three default EMPTY and every render site is gated, so a cache row
  // written before this migration renders exactly today's page.
  const [fields, setFields] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Totals>({});
  const [repostIndex, setRepostIndex] = useState<RepostIndex>({});
  // THE PAGE USED TO RENDER EMPTY AND POP.
  //
  // Every answer is gated on `collection.length > 0`, so before the cache read
  // returns, a visitor sees a heading, six chips and nothing under them — which
  // is indistinguishable from "this section is broken" and is exactly the
  // reading this page has earned elsewhere. It resolves in well under a second
  // on a warm cache and noticeably longer on a cold one, which is precisely
  // when a visitor is most likely to conclude nothing works.
  //
  // Not a spinner: a spinner says "wait" without saying what for. Twelve
  // card-shaped placeholders say what is coming and stop the layout jumping
  // when it arrives.
  const [loading, setLoading] = useState(true);
  // The per-band drill-through state and loader were removed with the buttons
  // that drove them — get_size_segment_companies 57014s on every band, and
  // bands by a different definition than the section it sat under. See the
  // note at the render site.

  useEffect(() => {
    const applySalary = (rows: SalaryRow[]) =>
      // "other" is excluded everywhere else on this page (it's a catch-all,
      // not a field) — its card linked to a junk /jobs/field/other lander.
      setSalary(rows.filter((r) => r && r.median_annual_min > 0 && r.category !== "other").sort((a, b) => b.median_annual_min - a.median_annual_min).slice(0, 8));
    (async () => {
      // Fast path: the hourly-cached collections — one row read instead of five
      // full-table aggregates (measured 13s → <0.5s). Falls through to the live
      // RPCs only if the cache row doesn't exist yet (fresh deploy / miss).
      try {
        const { data: cache } = await Promise.resolve(rpc("get_explore_cache")).catch(() => ({ data: null }));
        const c = cache as Record<string, unknown> | null;
        // TRENDING AND NEWEST ARE NO LONGER READ, AND THAT IS THE POINT.
        //
        // Both answered a question nobody arrives with (a board adding roles
        // fast is not a board more likely to hire you), and both carried a live
        // honesty problem: their open_roles comes from
        // job_board_company_snapshots, whose writer applies neither serving
        // predicate — migration 20260811013000 says so in as many words under
        // "NOT INCLUDED, DELIBERATELY" — so their badges could overstate what
        // the click-through would show. "Just added" was worse still: its
        // "get in early" framing rested on first_added, which is when WE
        // discovered the board, not when the roles went up.
        //
        // The cache still carries both keys; this page simply stops rendering
        // claims it cannot stand behind.
        if (c && (Array.isArray(c.hiring) || Array.isArray(c.entry) || Array.isArray(c.transparent))) {
          if (Array.isArray(c.hiring)) setHiring(c.hiring as CompanyRow[]);
          if (Array.isArray(c.stale_parts)) setStale((c.stale_parts as unknown[]).filter((x): x is string => typeof x === "string"));
          if (Array.isArray(c.reposters)) setReposters(c.reposters as CompanyRow[]);
          if (Array.isArray(c.entry)) setEntry(c.entry as CompanyRow[]);
          if (Array.isArray(c.salary)) applySalary(c.salary as SalaryRow[]);
          if (c.segments && typeof c.segments === "object" && !Array.isArray(c.segments)) setSegments(c.segments as Segments);
          // FROM THE CACHE, not a live call. This used to fire
          // get_transparent_employers on every page view; measured 2026-08-10
          // it returns 57014 after ~27s, 100% of the time, so the section had
          // never rendered while every visitor paid 26s of database time for
          // it. It now rides the hourly refresh with the other collections.
          // Absent key (cache written before that migration) leaves the
          // section hidden, exactly as today — never a zero.
          if (Array.isArray(c.transparent)) setTransparent(c.transparent as CompanyRow[]);
          // Objects, not arrays — and checked as such. `typeof null === "object"`
          // is the trap that would put `null` into a Record and crash the first
          // Object.entries over it, so each is required to be a non-null,
          // non-array object before it is trusted.
          const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
          if (obj(c.fields)) setFields(c.fields as Record<string, number>);
          if (obj(c.totals)) setTotals(c.totals as Totals);
          if (obj(c.repost_index)) setRepostIndex(c.repost_index as RepostIndex);
          if (typeof c.computed_at === "string") setComputedAt(c.computed_at);
          setLoading(false);
          return;
        }
      } catch { /* fall through to live RPCs */ }
      // Two fewer RPCs on the fallback path than before: the trending and
      // newest collections are no longer rendered, so fetching them would only
      // spend request time to fill state nothing reads.
      const [hi, rp, en, sa] = await Promise.all([
        Promise.resolve(rpc("get_actively_hiring_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_repost_churn_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_entry_level_companies", { p_limit: 12 })).catch(() => ({ data: null })),
        Promise.resolve(rpc("get_salary_benchmarks")).catch(() => ({ data: null })),
      ]);
      // No live transparent-employers call on the fallback path either — the
      // RPC cannot complete inside a request, so attempting it only spends
      // database time to reach the same hidden section.
      // Segments live-fallback fires separately: its full-table aggregate is the
      // slowest collection and must never delay the five above.
      void Promise.resolve(rpc("get_size_segments")).then((r: { data: unknown }) => {
        if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) setSegments(r.data as Segments);
      }).catch(() => { /* section hides */ });
      if (Array.isArray(hi.data)) setHiring(hi.data as CompanyRow[]);
      if (Array.isArray(rp.data)) setReposters(rp.data as CompanyRow[]);
      if (Array.isArray(en.data)) setEntry(en.data as CompanyRow[]);
      if (Array.isArray(sa.data)) applySalary(sa.data as SalaryRow[]);
      // Cleared after the four that gate visible answers. The segments call
      // above resolves on its own schedule and must not hold the skeleton up —
      // it is the slowest collection and its band section appears when ready.
      setLoading(false);
    })();
  }, []);

  // THE FILL RATE, FETCHED RATHER THAN HOPED FOR.
  //
  // The badge below needs R(14), its interval, the stated-date coverage and the
  // RPC's own sufficiency flag. None of the four is returned by
  // get_actively_hiring_companies — live or through the hourly cache, which
  // serialises that function's rows with to_jsonb() and so cannot invent
  // columns it does not have. Reading them off the row was the whole reason the
  // clause was dead. They come from get_company_fill_curve, for exactly the
  // twelve tokens on screen, in a second request that runs after first paint
  // and costs the page nothing when it fails.
  //
  // The counts are re-read here too, and they are the curve's, because the two
  // functions apply different feed-dark rules: the curve drops any
  // (company_token, closed_at) batch that removed more than max(5, 0.30 × the
  // board's open roles) for the ~54 days of history the collector never
  // stamped, and the hiring RPC drops nothing there. Publishing a fill count on
  // this page that /jobs/company/{token} contradicts is the failure this whole
  // change exists to stop.
  useEffect(() => {
    if (hiring.length === 0) return;
    // Already merged (a re-render, not a new list) — nothing to fetch.
    // Already carried by the row, or already merged. The rewritten RPC returns
    // the incidence, the counts and the window itself, so on a current cache
    // row this fires ZERO times — which takes a 25-second grouped scan off
    // every page view. It stays for the deploy window and for a cache row
    // written before 20260907010000.
    if (hiring.some(hasMeasure)) return;
    const tokens = [...new Set(hiring.map((r) => r.company_token).filter(Boolean))];
    if (tokens.length === 0) { setCurveDone(true); return; }
    let live = true;
    void (async () => {
      const { data } = await Promise.resolve(rpc("get_company_fill_curve", { p_tokens: tokens }))
        .catch(() => ({ data: null }));
      // Marked done on EVERY exit, including the ones that return early below:
      // a failed curve call must fall through to the honest empty state, not
      // leave a skeleton spinning where a sentence belongs.
      if (live) setCurveDone(true);
      if (!live || !Array.isArray(data)) return;
      const by = new Map<string, Record<string, unknown>>();
      for (const r of data as Array<Record<string, unknown>>) {
        if (r && typeof r.company_token === "string") by.set(r.company_token, r);
      }
      if (by.size === 0) return;
      // numOr, not a typeof === "number" test. `numeric` arrives as a STRING on
      // some PostgREST builds, and a local coercion that rejected it turned
      // every row into "unmeasured" — a silent, whole-section refusal that
      // looks exactly like an employer having no record.
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
          curve_fills_90d: numOr(c.fills_90d) ?? undefined,
          // The relist floor, from the same population as the fills beside it —
          // the card states them in one breath, so they cannot come from two
          // different filters.
          curve_relists_90d: numOr(c.relists_90d) ?? undefined,
          curve_tracking_days: numOr(c.tracking_days) ?? undefined,
        };
      }));
    })();
    return () => { live = false; };
  }, [hiring]);

  // The chosen answer lives in the URL, so it is shareable, survives the back
  // button, and a crawler following ?i=pay sees the pay answer rather than
  // whatever happens to be first. replaceState rather than push: switching
  // answers is not a navigation, and stacking six entries would make Back feel
  // broken.
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
  // word typed, against a single-row PK lookup — no aggregate on the request
  // path, which is the rule this page exists to respect.
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
          // or erroring RPC arrives here with data === null — and treating that
          // as "no match" is what printed "we don't carry that employer" over a
          // company with 498 open roles.
          if (r.error || !Array.isArray(r.data)) { setCHits([]); setCState("error"); return; }
          setCHits(r.data as Array<{ name: string; tokens: string[] }>);
          setCState("ok");
        })
        .catch(() => { if (alive) { setCHits([]); setCState("error"); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [cq]);

  /** THE EMPLOYERS THE CHURN INDEX HAS ALREADY FLAGGED.
   *
   *  The index is the rate-gated one — 5+ re-lists per affected role on 25+
   *  events, never a top-N by raw volume — so membership is a finding about
   *  conduct rather than about size. The hiring answer excludes them rather
   *  than recommending them with a warning stapled underneath, because its own
   *  heading promises they appear under Serial re-posters instead. */
  const serialReposters = useMemo(
    () => new Set(Object.keys(repostIndex).filter((k) => Array.isArray(repostIndex[k]))),
    [repostIndex],
  );
  /** The fill answer's contents and its omissions, computed once per payload. */
  const fill = useMemo(() => rankedFillClaims(hiring, serialReposters), [hiring, serialReposters]);
  /** DERIVED, NEVER SET. Rows are on screen, none of them carries a measure
   *  yet, and the second call has not come back — the one state in which the
   *  section must show placeholders rather than a verdict. Computed during
   *  render, so there is no frame between the rows arriving and the skeleton. */
  const measuring = hiring.length > 0 && !curveDone && !hiring.some(hasMeasure);

  const bands = segments ? orderedBands(segments) : [];
  // Default to the biggest band, but only once the payload is in hand — a band
  // key hardcoded here is how half this section vanished the last time the SQL
  // renamed one.
  const activeBand = band ?? bands[0]?.[0] ?? null;

  // A chip is rendered only when its collection has something to show. An
  // answer that would open empty is worse than an answer that is not offered,
  // and a chip whose body is blank reads as breakage rather than as absence.
  const available: Record<Intent, boolean> = {
    // Always offered: it reads the facets row, which the edge-function refresh
    // pass maintains independently of the hourly cron. When pg_cron died today
    // every other answer froze; this one would have kept working.
    check: true,
    // ALWAYS OFFERED, WHICH IS A CORRECTION. It was `hiring.length > 0`, and
    // the rewritten RPC's most likely steady state is ZERO ROWS — every gate is
    // a hard gate now and there is no fallback ordering. In that state the chip
    // vanished, `active` fell through to another answer, and a visitor
    // arriving on the shared deep link /explore?i=hiring was silently shown
    // something else: the URL said one thing and the page showed another. The
    // honest empty state written for exactly that case was unreachable, because
    // it lived inside the guard that had just removed the section.
    //
    // The section now always renders and chooses its own contents — cards,
    // placeholders, "nothing qualifies", or "we could not measure this" — which
    // is where that distinction belongs.
    hiring: true,
    pay: transparent.length > 0 || salary.length > 0,
    entry: entry.length > 0,
    ghost: reposters.length > 0,
    scale: bands.length > 0,
    fields: true,
  };
  // WHILE LOADING, EVERY COLLECTION IS EMPTY — so availability is unknown, not
  // false. Deriving `shown` and `active` from it during load produced two
  // visible defects, both measured in a browser rather than reasoned about:
  //
  //   - the chip row rendered TWO chips (check, fields — the only two that do
  //     not depend on a collection) and then jumped to seven;
  //   - `active` fell back to `check`, so the hiring skeleton — which sits
  //     inside `hidden={active !== "hiring"}` — was hidden for the entire
  //     540ms it existed to cover, and the loading state I had just added
  //     never appeared once.
  //
  // Absence of data is not evidence of absence, which is the rule this page
  // applies to every number on it; it applies to its own controls too.
  const shown = loading ? INTENTS : INTENTS.filter((i) => available[i]);
  // Once loaded: if the chosen answer genuinely has no data, fall to the first
  // that does rather than rendering a heading over nothing.
  const active: Intent = loading ? intent : (available[intent] ? intent : (shown[0] ?? "fields"));

  /** Each answer's way into the board, turning an intent into JOBS rather than
   *  into twelve more company links.
   *
   *  Every one of these params is READ by Jobs.tsx — that is not decoration.
   *  A `fresh=day` action was drafted for the ghost answer and dropped, because
   *  Jobs WROTE that param and never read it back, so the button would have
   *  promised a 24-hour window over an unfiltered board. `fresh` and
   *  `activelyHiring` are now both read; `company` accepts a comma list, which
   *  the server has always supported.
   *
   *  NO COUNTS on these buttons. The collection holds 12 rows, which is not the
   *  size of the population the sentence would imply, and only a live aggregate
   *  could state the real number — the 26-seconds-per-view mistake. */
  const ACTION: Partial<Record<Intent, { to: string; label: string }>> = {
    // THE TOKENS ON SCREEN, NOT THE TOKENS IN THE PAYLOAD. This mapped the raw
    // rows, so the button opened a board filtered to employers this section had
    // just refused to show.
    hiring: fill.shown.length
      ? {
          to: `/jobs?company=${encodeURIComponent(fill.shown.map((c) => c.token).join(","))}&from=explore`,
          label: t("explore.actionHiring", "Open roles at all of these employers"),
        }
      : undefined,
    entry: { to: "/jobs?experience=entry&from=explore", label: t("explore.actionEntry", "All entry-level roles on the board") },
    // "Proven fill record" was a claim the data cannot support. What the
    // lifecycle log actually observes is a posting DISAPPEARING and not coming
    // back — which can be a fill, a cancelled req, or a paused budget.
    // Measured 2026-08-24 over the top 150 employers: of the 31 that qualify,
    // the median carries 60% superseded (reposted) closure activity and 68%
    // are majority-churn, so even the surviving signal is noisy. The label now
    // says exactly what is measured.
    ghost: { to: "/jobs?activelyHiring=1&from=explore", label: t("explore.actionGhost", "Show only employers whose roles close and stay closed") },
  };

  const INTENT_LABEL: Record<Intent, string> = {
    check: t("explore.intentCheck", "Check an employer"),
    hiring: t("explore.intentHiring", "Will actually hire me"),
    pay: t("explore.intentPay", "States the pay"),
    entry: t("explore.intentEntry", "Early career"),
    ghost: t("explore.intentGhost", "Watch out: ghost jobs"),
    scale: t("explore.intentScale", "Hiring at scale"),
    fields: t("explore.intentFields", "By field"),
  };

  const nf = (n: number) => n.toLocaleString(i18n.language);

  /** ONE SENTENCE ABOVE THE DATA. The rest of the method is in the disclosure
   *  under it — the fifty-word blurb and the denominator paragraph beside it
   *  said more than the twelve cards did, which is the wrong way round on a
   *  page whose whole claim is that it measures things.
   *
   *  New key: the sentence it replaces does not merely say less, it names a
   *  different measurement, and a locale VALUE silently overrides an inline
   *  default — so reusing the old key would leave nine languages describing the
   *  closure-count ranking this change exists to stop publishing. */
  // A NEW KEY FOR THE HEADING, FOR THE REASON THE BLURB GOT ONE.
  //
  // "Companies that actually fill roles" is the strongest claim on the page and
  // the only one with no evidence behind it: what the lifecycle log observes is
  // a posting going away and not coming back, which can be a hire, a cancelled
  // requisition or a frozen budget — this section deleted "proven fill record"
  // for precisely that reason, and its own methodology now says so two lines
  // under the heading. Careful cards beneath an overclaiming H2 is the worst of
  // both. A locale VALUE overrides an inline default, so the old sentence would
  // otherwise survive in nine languages no matter what this file says; the same
  // reason seoTitle2, subhead2 and hiringBlurbRanked are new keys rather than
  // edits. explore.hiringTitle retires with them.
  const hiringTitle = t("explore.hiringTitleRanked", "Companies whose roles come down and stay down");
  const hiringBlurb = t("explore.hiringBlurbRanked", "Ranked by how much of an employer's own board actually comes down and stays down within {{d}} days — not by how many closures we logged.", { d: URGENT_FILL_MAX_DAYS });

  /** The churn warning for one employer, or null — POSITIVE FORM ONLY.
   *
   *  A hit means "this employer cleared a rate gate of 5 re-lists per affected
   *  role on 25+ events". A MISS means only that it did not, which includes
   *  every employer whose board we have watched for a week. So there is no
   *  "no re-posting detected", no green tick, no clean-bill styling anywhere
   *  in this file: absence of evidence is not evidence of absence, and this
   *  page applies that rule to its own numbers everywhere else.
   *
   *  "across {{roles}} roles" is not decoration — it is what separates a
   *  diagnosis from a libel. 581 re-lists across 3 roles is one job advertised
   *  forever; 769 across 298 is a large employer with ordinary churn. Read as
   *  a bare count they look identical and the second employer is defamed. It
   *  travels in the same sentence, never a tooltip.
   *
   *  Not on the ghost answer: that card's own badge already states these
   *  numbers, and repeating them under it would read as two findings. */
  const repostWarn = (token: string | undefined, on: Intent): string | null => {
    if (!token || on === "ghost") return null;
    const hit = repostIndex[token];
    // Shape-checked, not just presence-checked: the payload is JSON from a
    // cache row that may predate the migration, and destructuring a non-array
    // would print "undefined re-postings across undefined roles".
    if (!Array.isArray(hit) || hit.length < 3) return null;
    const [events, roles, days] = hit;
    if (!(typeof events === "number" && events > 0 && typeof roles === "number" && roles > 0)) return null;
    // A FLOOR, MARKED IN THE VALUE RATHER THAN IN THE SENTENCE.
    //
    // The collector logs only the FIRST superseded closure per normalised title
    // per employer per 24h and DELETES the rest, so both counts are lower
    // bounds and neither may render as "=". The "+" goes on the interpolated
    // number, which is this file's own floor idiom (10,000+ on the field chips,
    // "{{n}}+×" on the capped re-post badge) — and it means all nine
    // translations of explore.repostWarn become floors at once, instead of
    // eight of them stating an equality until a translation pass lands.
    return t("explore.repostWarn", "Re-lists roles: {{events}} re-postings across {{roles}} roles in {{d}}d", {
      events: `${nf(events)}+`, roles: `${nf(roles)}+`, d: days,
    });
  };

  /** The denominator under each answer. Rendered only when its counter is
   *  present — see the strip_nulls note in the migration; a missing key is a
   *  failed scan and must produce silence, not a zero. */
  const NOTE: Partial<Record<Intent, string | null>> = {
    // NEW KEY, because the old sentence counted the wrong thing twice: "the 12"
    // was the payload's size rather than the number of employers whose record
    // can carry a claim, and "the strongest fill rate" described an ordering by
    // closures-per-open-role, which is not a rate. Both halves are now the
    // numbers actually on screen.
    // EVERY NUMBER HERE NAMES THE POPULATION IT WAS COMPUTED OVER, because
    // neither of these two is computed over the same one and the first draft
    // printed them as though they were.
    //
    //   fill.shown / fill.held are computed over the ROWS IN THE CACHE, which
    //   refresh_explore_cache caps at twelve (`FILTER (WHERE r.rn <= 12)`), and
    //   the live fallback asks for twelve. The client gates behind them — the
    //   coverage floor and the observation window — were never applied to rows
    //   thirteen and up, because the client never saw them. So a sentence like
    //   "One employer has a record deep enough right now" was a claim about
    //   every employer we carry, produced by testing twelve.
    //
    //   totals.hiring_n is count(*) over get_actively_hiring_companies(2000),
    //   and after 20260907010000 every row in it has ALREADY passed the
    //   sufficiency, churn and open-roles gates server-side. Describing it as
    //   "employers with a measurable takedown record and 100+ roles open" — the
    //   pre-gate description — overstated the pool by about two orders of
    //   magnitude and contradicted the sentence beside it, which said only a
    //   few of them qualified.
    //
    // Both are now stated for what they are: N employers clear the server's
    // bars, we rank the top twelve of them, and M of those twelve clear the two
    // bars only the client can apply.
    hiring: totals.hiring_n
      ? [
          // TWO SENTENCES AND TWO KEYS, because "The 1 employers" is what one
          // qualifying employer produced live. i18next plurals need the key in
          // a resource file, which this change cannot write, so the singular is
          // its own key — and a translator gets a grammatical string to work
          // from in both languages rather than an English fragment with a
          // number wedged into it.
          t("explore.noteHiringPoolGated", "{{n}} employers clear our fill-measurement bars right now; we rank the strongest {{cap}}.", { n: nf(totals.hiring_n), cap: nf(Math.min(totals.hiring_n, hiring.length || HIRING_SLICE)) }),
          fill.shown.length === 1
            ? t("explore.noteHiringShownOne", "One of those carries a figure here; the rest are accounted for below.")
            : t("explore.noteHiringShown", "{{shown}} of those carry a figure here; the rest are accounted for below.", { shown: nf(fill.shown.length) }),
        ].join(" ")
      : null,
    // TWO SENTENCES, because the second is what makes the first mean anything.
    // "41 employers state pay on 80%+ of their roles" sounds thin until you
    // know the board-wide rate; together they say how unusual the badge is.
    pay: totals.pay_n && totals.pay_pool_n
      ? [
          t("explore.notePay", "{{n}} of the {{pool}} employers with 20+ open roles state pay on at least 80% of them.", { n: nf(totals.pay_n), pool: nf(totals.pay_pool_n) }),
          totals.postings_pay_n && totals.postings_n
            ? t("explore.notePayBoard", "Board-wide, {{pct}}% of open postings state pay at all.", { pct: Math.round(100 * totals.postings_pay_n / totals.postings_n) })
            : "",
        ].filter(Boolean).join(" ")
      : null,
    entry: totals.entry_n
      ? t("explore.noteEntry", "The 12 with the most, out of {{n}} employers with 5 or more entry-level roles open.", { n: nf(totals.entry_n) })
      : null,
    ghost: totals.repost_pool_n
      ? [
          t("explore.noteGhost", "The 12 with the most re-listings, out of {{n}} employers with 20 or more tracked.", { n: nf(totals.repost_pool_n) }),
          // The flagged count is the population behind the warning that now
          // follows employers onto the other answers, so this is where it is
          // explained rather than appearing unannounced under a pay card.
          totals.repost_flagged_n
            ? t("explore.noteGhostFlagged", "{{n}} re-list often enough to carry a warning on the other answers.", { n: nf(totals.repost_flagged_n) })
            : "",
        ].filter(Boolean).join(" ")
      : null,
    fields: totals.postings_n
      ? t("explore.noteFields", "{{n}} roles open across the board right now.", { n: nf(totals.postings_n) })
      : null,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NEW KEYS, because the old copy described sections that no longer
          exist. seoTitle led with "Trending Companies" and seoDescription
          promised "companies hiring fastest right now" and "newly added company
          boards" — both collections were removed above for having counts their
          click-through could contradict. Leaving the old strings would have the
          page advertise, to crawlers and in nine languages, two things it does
          not contain: the same claim-drift defect the collections were removed
          FOR. */}
      <SEO
        title={t("explore.seoTitle2", "Explore Employers — Who Fills Roles, Who States Pay, Who Re-posts")}
        description={t("explore.seoDescription2", "Pick what you're looking for: employers that actually fill the roles they post, companies that state pay up front, entry-level friendly boards, serial re-posters to avoid, and the highest-paying fields — all measured from companies' own job boards and our own daily tracking, refreshed hourly.")}
        path="/explore"
      />
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">
        {/* The Compass pill is gone. It said "Explore the board" directly above
            an H1 saying much the same thing, and on a 375px screen it cost
            ~56px of the only fold a visitor is guaranteed to see. */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-2">
            {t("explore.headline", "Find your next role by what actually matters")}
          </h1>
          <p className="text-base text-muted-foreground max-w-2xl">
            {/* Same reason as the SEO strings: the old subhead named "who's
                hiring fastest" and "who's new", which are exactly the two
                collections deleted above. */}
            {t("explore.subhead2", "Pick what you're actually looking for. Every answer is measured from our own daily tracking of what happens to each posting — not from what employers claim.")}
          </p>
          {/* "computed live" was false: these collections come from a cache
              refreshed hourly, and the cache has carried its own computed_at
              all along while the page never showed it. Every other measured
              surface in this product states when it was measured; this one
              asserted something stronger than the truth instead. Renders only
              once a real timestamp is in hand — no timestamp, no claim. */}
          {computedAt && (
            <p className="text-xs text-muted-foreground/80 mt-2">
              {t("explore.asOf", "Measured {{time}}, refreshed hourly.", {
                // i18n.language, not undefined. `undefined` resolves to the
                // BROWSER's locale, which is independent of the language the
                // reader picked — so a German page rendered "Aug 11, 2026,
                // 10:07 PM" in English while every word around it was German.
                // The one visible date on the page belonged to a different
                // language than the sentence containing it.
                time: new Date(computedAt).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          )}
          {/* A REFRESH THAT DID NOT FINISH MUST NOT LOOK LIKE ONE THAT DID.
              Two independent signals, because the cache fails in two ways and
              the sentence above covers neither:
                • stale_parts names the collections that timed out and were
                  served from the previous run. The page has never read it.
                • computed_at going stale is the only evidence a reader gets
                  when the whole hourly job stops — the cron death that froze
                  every answer on this page for a day while it looked healthy.
              Both are stated as facts about OUR instrument, never about the
              employers, and both are silent when there is nothing to report. */}
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

        {/* THE PAGE'S ONLY CONTROL, and the fix for "zero interactive inputs".
            Wrapped, never a horizontal scroller: all six choices are visible on
            a 375px screen without a gesture. A nowrap row would hide half the
            options behind a swipe nobody knows to make, which is the same class
            of defect as the header nav being `hidden sm:flex` with no
            hamburger — the reason /explore was unreachable on a phone at all
            until today.

            No counts on the chips. A number here would be the size of a
            collection capped at 12, not the size of the population it implies,
            and this page has already shipped one heading whose number its own
            contents contradicted. */}
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
                // screen reader announces "tab, 1 of 7" and the arrow keys a
                // user is then told to press do nothing. Roving tabindex so
                // Tab enters the group once and arrows move within it, which is
                // the behaviour the role advertises.
                tabIndex={active === i ? 0 : -1}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = shown[(idx + d + shown.length) % shown.length];
                  chooseIntent(next);
                  // Move focus with selection, or the ring stays on a chip that
                  // is no longer the selected one.
                  const el = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                  el?.[(idx + d + shown.length) % shown.length]?.focus();
                }}
                onClick={() => chooseIntent(i)}
                className={`inline-flex items-center px-3.5 py-2 rounded-full border text-sm font-medium transition-colors min-h-[40px] ${
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

        {/* "Fastest-growing boards" was here. Removed, not hidden: it answered
            no question a job seeker arrives with, and its counts came from the
            snapshot path that applies neither serving predicate. */}

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

        {/* CHECK AN EMPLOYER — the only answer that covers all 24,931 boards
            rather than the 85 that top a list. Selecting a match NAVIGATES to
            /jobs/company/{token} rather than rendering a verdict here: that
            page already states these sentences from nine translated locales,
            and rebuilding them on Explore would be eight new sentence keys x
            nine languages to reach a page one click away. */}
        <div hidden={active !== "check"}>
          <Section
            icon={Search}
            title={t("explore.checkTitle", "Check a specific employer")}
            blurb={t("explore.checkBlurb", "Every employer on the board — not just the ones on these lists. See how many roles they have open, how many they've actually filled, and whether they re-list the same job.")}
          >
            <input
              type="search"
              value={cq}
              onChange={(e) => setCq(e.target.value)}
              placeholder={t("explore.checkPlaceholder", "Type a company name…")}
              aria-label={t("explore.checkTitle", "Check a specific employer")}
              className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {cHits.length > 0 && (
              <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {cHits.map((h) => {
                  /* THE WARNING'S MOST USEFUL HOME. A reader typing a company
                     name has already decided to consider that employer; this is
                     the last moment before they leave for its board, and it is
                     the one place on the page where the answer covers all
                     24,931 employers rather than a twelve-row slice.
                     ACROSS ALL ITS FEEDS, worst first. An employer with four
                     ATS feeds merges into one row here (get_company_suggest
                     groups by display name), and the churn index is keyed by
                     token — so checking only tokens[0] would miss the churn
                     whenever it lives on a sibling feed. The one shown is the
                     highest-event token, so the sentence and the token that
                     earned it are the same. */
                  const worstToken = h.tokens
                    .filter((tk) => Array.isArray(repostIndex[tk]))
                    .sort((a, b) => (repostIndex[b]![0] ?? 0) - (repostIndex[a]![0] ?? 0))[0];
                  const worst = worstToken ? repostWarn(worstToken, "check") : null;
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
                      {/* NO COUNT HERE. The facet's count applies neither serving
                          predicate, so printing it would state a number the
                          destination contradicts — the defect this page spent
                          the week removing. The company page carries the real
                          figures. */}
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
                employer, and we are in no position to make it when our own
                query did not answer. */}
            {cState === "error" && (
              <p className="mt-3 text-sm text-warning">
                {t("explore.checkErr", "Employer lookup is unavailable right now — this says nothing about that employer. Try again shortly.")}
              </p>
            )}
          </Section>
        </div>

        <div hidden={active !== "hiring"}>
        {/* The default answer, so this skeleton is the one a first-time visitor
            sees. Rendered under the real heading and blurb, which are static —
            only the cards are unknown, so only the cards are placeholders. */}
        {loading && hiring.length === 0 && (
          <Section icon={Activity} title={hiringTitle} blurb={hiringBlurb}>
            <HiringSkeleton />
          </Section>
        )}
        {!loading && (
          /* THE HEADING, THE BLURB AND THE CARDS NOW AGREE, AND THE METHOD IS
             ONE CLICK AWAY INSTEAD OF TWO PARAGRAPHS TALL.

             What was here: a fifty-word blurb, a denominator sentence under it,
             and twelve cards whose subtitle read "4324 filled in 50d tracked ·
             172 open now · up to 63% taken down for good within 14d" — three
             numbers of equal weight in 11px grey, the first of them a count of
             closure events, with the churn caution beneath in the same size as
             the praise. A reader had to parse two paragraphs to reach a
             leaderboard whose headline number was wrong.

             What is here: one sentence, the method behind a disclosure, and one
             figure per card at the size of the decision it supports. */
          <Section icon={Activity} note={fill.shown.length > 0 ? NOTE.hiring : null} title={hiringTitle} blurb={hiringBlurb}>
            {/* THE METHODOLOGY, MOVED RATHER THAN DROPPED. Not one caveat was
                cut: what counts as a fill and who is disqualified, why this is
                a share rather than a count of roles, the three floors that
                suppress a figure entirely, why every re-listing number carries
                a "+", and whose board the open count describes. */}
            <HowWeMeasure items={[
              {
                term: t("explore.methodFillTerm", "What counts as a fill — and who is left out"),
                // The retained sentence. It is exactly true of the gate now
                // that the gate enforces it, and it belongs beside the method
                // rather than above the data.
                method: t("explore.hiringBlurbCurve", "Companies whose roles come down and stay down — a real fill signal from our own lifecycle tracking, counted over the days we have actually watched each board. Companies whose takedowns are mostly re-listings are disqualified (they appear under Serial re-posters instead)."),
              },
              {
                term: t("explore.methodRankTerm", "Why a share, and not a number of roles filled"),
                method: t("explore.methodRankMethod", "Every card states the same quantity over the same horizon: the share of that employer's own roles, dated by the employer, that came off the board within {{d}} days and did not come back. A role that returns is counted as a re-listing rather than as a fill, and roles still up — or past our 30-day serving cap — are counted as unfinished rather than dropped. We do not rank by how many closures we logged: that count is dominated by re-listings, and dividing it by the roles an employer has open today is not a rate of anything.", { d: URGENT_FILL_MAX_DAYS }),
              },
              {
                term: t("explore.methodGateTerm", "When we publish no figure at all"),
                // The gate, published rather than merely applied — and stated
                // from the constants /jobs enforces, so this sentence cannot
                // drift from the code that refuses the employer.
                method: t("explore.methodGateMethod", "Three separate bars, and a miss on any one means no figure rather than a hedged one: our estimate must be stable enough on its own terms (enough roles at risk at day {{d}}, enough observed takedowns, and an interval no wider than 15 points), we must have watched that board for at least {{days}} days, and at least {{cov}}% of the roles behind the figure must carry a posting date from the employer itself. Our own discovery date is never used as a posting age.", { d: URGENT_FILL_MAX_DAYS, days: FILL_RATE_MIN_TRACKING_DAYS, cov: Math.round(FILL_COVERAGE_MIN * 100) }),
              },
              {
                term: t("explore.methodRelistTerm", "Why every re-listing number carries a “+”"),
                method: t("explore.methodRelistMethod", "Our collector records only the first re-listing of a given job title at a given employer in any 24 hours and discards the rest, so every re-listing count here is a lower bound and none can be stated exactly. The same dedupe makes the fill figures upper bounds — the re-listings we never saw are missing from the pool the share is computed over — which is why each one reads “up to”. The interval beside it is an approximation, not an exact confidence interval."),
              },
              {
                // THE LIMIT OF THE RANKING, STATED WHERE THE RANKING IS.
                //
                // The bound above is not uniform: the more an employer re-lists
                // the same titles, the more of its churn the 24h dedupe throws
                // away, and the higher its published rate goes. Every bar that
                // could catch it — the churn share, the re-post gate, the
                // curve's own sufficiency test — reads the same post-dedupe
                // floor, so an employer whose re-listing we cannot see clears
                // all three and can rank above an honest one. The repair is in
                // the collector, which has to keep one row per deduped re-list;
                // until it lands this is a known blind spot, and a reader is
                // told rather than left to infer it from a "+".
                term: t("explore.methodBlindTerm", "What this ranking cannot see"),
                method: t("explore.methodBlindMethod", "Because we discard repeat re-listings of the same title within a day, an employer that re-lists heavily looks better here than it is, and the ones we never logged are invisible to every check on this page. A high figure means we saw those roles come down and not come back — it is not proof that they were not quietly re-posted under the same title. We would rather say that than imply a precision we do not have."),
              },
              {
                term: t("explore.methodOpenTerm", "“Roles open on our board”"),
                method: t("explore.methodOpenMethod", "An exact count of the roles we are serving for that employer right now — the same rows its company page shows. Nothing caps it. It is still a floor on the employer's own hiring: paginated job boards are read a page at a time, so we hold what we have read, and where the feed publishes its own total we show that too, with the date we last read it. Do not divide one figure on a card by another: the takedown count accumulates over 90 days of reads across the whole board, while the open count is a single instant of what we hold today. They are two different populations and their ratio is not a rate."),
              },
            ]} />

            {fill.shown.length > 0 ? (
              <HiringGrid claims={fill.shown} />
            ) : measuring ? (
              /* Rows in hand, the measure still being fetched. Twelve
                 placeholders at the fill card's own geometry — the reader sees
                 "coming", never a verdict we are about to contradict. */
              <HiringSkeleton />
            ) : hiring.length === 0 ? (
              /* NO ROWS AT ALL, WHICH IS A DIFFERENT FACT AND MUST NOT BORROW
                 THE SENTENCE BELOW. The ranking query either returned nothing
                 or did not complete: refresh_explore_cache's hiring block
                 catches QUERY_CANCELED, and until 20260907020000 it wrote an
                 empty list with no mark. "No employer's record is deep enough"
                 would be a verdict on 934 employers drawn from zero
                 observations — the precise shape of claim this section was
                 rebuilt to stop making. So this branch talks about US, and the
                 staleness line at the top of the page names 'hiring' beside
                 it once that migration is deployed. */
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">
                  {t("explore.hiringOutTitle", "We could not measure this in the last refresh")}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t("explore.hiringOutBody", "The fill ranking did not complete, so there is nothing to show here — that is our instrument, and it says nothing about any employer. Every other answer on this page still works.")}
                </p>
                <button
                  type="button"
                  onClick={() => chooseIntent("check")}
                  className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Search className="w-3.5 h-3.5" />
                  {t("explore.intentCheck", "Check an employer")}
                </button>
              </div>
            ) : (
              /* THE HONEST EMPTY STATE, WHICH IS WHAT THE GATES ARE FOR.
                 A section that cannot support a single fill claim has to say
                 so in its own words. Before this it filled itself with whatever
                 the closure count returned — which is how a leaderboard of
                 churn came to sit under this heading — and a reader could not
                 tell a thin record from a strong one.

                 AND IT SPEAKS ONLY FOR THE ROWS IT TESTED. The two client-side
                 bars behind this refusal were applied to the twelve rows the
                 cache carries, never to the rest of the pool, so the sentence
                 names those twelve rather than every employer we track. */
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-4">
                <p className="text-sm font-semibold text-foreground">
                  {t("explore.hiringNoneRankedTitle", "None of the {{n}} employers we ranked has a record deep enough to publish a figure", { n: nf(hiring.length) })}
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {t("explore.hiringNoneBody", "This says nothing about the employers themselves — it says our lifecycle log is not yet deep enough on any board that qualifies. Every other answer on this page still works.")}
                </p>
                <button
                  type="button"
                  onClick={() => chooseIntent("check")}
                  className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <Search className="w-3.5 h-3.5" />
                  {t("explore.intentCheck", "Check an employer")}
                </button>
              </div>
            )}

            {/* WHAT IS NOT ON SCREEN, AND WHY — counted, never silent.
                An employer missing from a leaderboard is unreadable on its own:
                it can mean a weak record, a short one, or a broken instrument
                of ours, and those must not look alike. Each line renders only
                when its count is non-zero, and the last one is deliberately a
                statement about US. */}
            {!measuring && (fill.held.reposter + fill.held.window + fill.held.estimate + fill.held.unmeasured + fill.held.undated) > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                {[
                  fill.held.reposter > 0
                    ? t("explore.hiringHeldReposter", "{{n}} ranked employers are left out for serial re-listing — they appear under “Watch out: ghost jobs”.", { n: nf(fill.held.reposter) })
                    : "",
                  fill.held.window > 0
                    ? t("explore.hiringHeldWindow", "{{n}} have takedowns we can see but a board we have watched for fewer than {{d}} days, so no rate is published for them.", { n: nf(fill.held.window), d: FILL_RATE_MIN_TRACKING_DAYS })
                    : "",
                  fill.held.estimate > 0
                    ? t("explore.hiringHeldEstimate", "{{n}} have a record too thin or too uneven to carry a stable figure.", { n: nf(fill.held.estimate) })
                    : "",
                  /* SPLIT FROM "unmeasured", BECAUSE THEY ARE OPPOSITE
                     FACTS. A curve that answered with no rate means the
                     employer's feed states no posting dates, so there is no
                     cohort to measure lifetimes over — that is about their
                     feed. A curve that did not answer at all is about our
                     instrument. Folding the first into the second had the page
                     apologise for an outage it was not having, and inflated the
                     count of the sentence that IS about us. */
                  fill.held.undated > 0
                    ? t("explore.hiringHeldUndated", "{{n}} publish no posting dates on their own feed, so there is nothing to measure a fill against.", { n: nf(fill.held.undated) })
                    : "",
                  fill.held.unmeasured > 0
                    ? t("explore.hiringHeldUnmeasured", "{{n}} could not be measured in this refresh — that is our instrument, and it says nothing about those employers.", { n: nf(fill.held.unmeasured) })
                    : "",
                  /* AND THE SENTENCE NAMES ITS OWN DENOMINATOR. Every count
                     above is over the rows this page holds, which the cache
                     caps at twelve — not over the pool the line under the
                     heading counts. */
                  t("explore.hiringHeldOf", "(Counted over the {{n}} employers ranked here.)", { n: nf(hiring.length) }),
                ].filter(Boolean).join(" ")}
              </p>
            )}
          </Section>
        )}
        </div>

        <div hidden={active !== "pay"}>
        {transparent.length > 0 && (
          <Section icon={BadgeDollarSign} note={NOTE.pay} title={t("explore.transparentTitle", "Transparent about pay")} blurb={t("explore.transparentBlurb", "Companies stating pay on at least 80% of their open roles — counted from their own posting text and ATS fields. A badge no one can buy: the only way in is to actually state pay.")}>
            {/* No salaryFloor on this link. "States pay" and "pays at least
                $X" are different populations, and salary_min_annual is
                annualised in the posting's own currency and never converted —
                a floor filter would quietly mean different things per row. */}
            <CompanyGrid rows={transparent} intent="pay" warn={(r) => repostWarn(r.company_token, "pay")} badge={(r) => {
              const parts = [t("explore.transparentBadge", "{{pct}}% of {{n}} roles state pay", { pct: r.pay_pct ?? 0, n: r.open_roles ?? 0 })];
              // A MEDIAN NEEDS A SAMPLE. The SQL computes this over whichever
              // of the employer's roles state USD pay, with no floor — so one
              // USD posting was enough to publish "median floor $X" beside a
              // company whose other 300 roles say nothing. The row carries no
              // usd_n, so the honest available gate is the employer's own
              // served-role count: below 20 the median is omitted rather than
              // shown with invisible uncertainty. Omission is the correct
              // degradation; a number with no sample behind it is not.
              if (r.median_usd_floor != null && (r.open_roles ?? 0) >= 20) {
                parts.push(t("explore.transparentMedian", "median floor ${{m}}", { m: Math.round(r.median_usd_floor).toLocaleString() }));
              }
              return parts.join(" · ");
            }} />
          </Section>
        )}
        </div>

        <div hidden={active !== "ghost"}>
        {reposters.length > 0 && (
          <Section icon={Repeat} note={NOTE.ghost} title={t("explore.repostTitle", "Serial re-posters")} blurb={t("explore.repostBlurb", "Companies that take roles down and re-list them again and again — measured from our own lifecycle tracking. Re-listing resets the posted date, so an opening can look brand-new long after it first appeared.")}>
            <CompanyGrid rows={reposters} intent="ghost" tone="warning" badge={(r) => {
              // A re-list count far above the tracking window is a data artifact
              // (bulk feed churn re-stamping ids), not something a reader should
              // take literally — audit 2026-07-26 measured "289× in 8d". Cap the
              // stated count at one re-list per tracked day and mark it as a
              // floor rather than printing an impossible number.
              const days = Math.max(1, r.tracking_days ?? 0);
              const raw = r.worst_count ?? 0;
              const capped = Math.min(raw, days);
              // THE FLOOR FORM IS NOW THE ONLY FORM. The uncapped branch printed
              // "re-listed 41× · 2,242 total in 49d" — three equalities over
              // counts the collector deduped before they were ever written.
              // explore.repostBadge (the "=" sentence) is retired rather than
              // reworded, because a locale VALUE overrides an inline default
              // and nine of them carry the equality.
              const core = t("explore.repostBadgeCapped",
                "“{{title}}” re-listed {{n}}+× · {{events}} total in {{d}}d",
                { title: (r.worst_title ?? "").slice(0, 34), n: capped, events: `${nf(r.repost_events ?? 0)}+`, d: r.tracking_days ?? 0 });
              // ACROSS HOW MANY ROLES — the number that turns a count into a
              // diagnosis. 581 re-lists across 3 roles is one job advertised
              // forever; 769 across 298 is a big employer with ordinary churn.
              // Read as one number those look identical and the second company
              // is unfairly damned. reposted_roles is already in the cached
              // payload, so this costs nothing.
              //
              // Appended as its own key rather than reworded into the existing
              // badge: a locale VALUE overrides the inline default, and all
              // nine locales already carry the current sentence. Editing it
              // here would leave nine translations rendering the old string.
              return r.reposted_roles
                ? `${core} · ${t("explore.repostAcross", "across {{roles}} roles", { roles: `${nf(r.reposted_roles)}+` })}`
                : core;
            }} />
          </Section>
        )}
        </div>

        {/* "Just added to the board" was here. Removed: same uncorrected
            snapshot counts as trending, and its "get in early" promise rested
            on first_added — the date WE discovered the board, not the date the
            roles went up. */}

        <div hidden={active !== "scale"}>
        {segments && orderedBands(segments).length > 0 && (
          <Section icon={Building2} title={t("explore.segTitle", "By how much they're hiring")} blurb={t("explore.segBlurb", "Banded by how many roles each company currently has open on our board — not by company size. A company with a thousand openings might be an employer of a hundred thousand, or a smaller one hiring hard.")}>
            {/* EVERY BAND'S AGGREGATE STAYS; ONLY ONE BAND'S CARDS RENDER.
                The four stat lines were already the most carefully-built
                sentences on this page, so they become the selector rather than
                headers over four stacked grids. 36 of 48 cards leave the
                viewport and nothing measured is lost. */}
            <div className="space-y-2">
              {orderedBands(segments).map(([band, s]) => {
                // LABELS DESCRIBE WHAT IS MEASURED: open roles on this board.
                // They used to say "Enterprise — 1,000+ employees" over bands
                // computed from GREATEST(on_board, feed_total) — a posting
                // count — under a blurb promising sourced headcounts and
                // "Nothing is guessed". No row in the payload carries an
                // employee count at all, so the page was asserting three
                // things that were each untrue, and filing Epic Games under
                // "under 100 employees".
                //
                // An unrecognised key falls back to a label built from the
                // band's own numbers rather than vanishing, so the next rename
                // costs a generic heading instead of half the section.
                const label = band === "mega"
                  ? t("explore.segMega", "1,000+ open roles")
                  : band === "large"
                    ? t("explore.segLarge", "200–999 open roles")
                    : band === "mid"
                      ? t("explore.segMid", "50–199 open roles")
                      : band === "small"
                        ? t("explore.segSmall", "Under 50 open roles")
                        : t("explore.segOther", "{{n}} companies", { n: s.companies.toLocaleString() });
                const open = activeBand === band;
                return (
                  <div key={band} className={`rounded-xl border transition-colors ${open ? "border-primary/40 bg-card/40" : "border-border"}`}>
                    <button
                      type="button"
                      onClick={() => setBand(open ? null : band)}
                      aria-expanded={open}
                      className="w-full text-left px-4 py-3"
                    >
                    <h3 className="text-sm font-bold text-foreground mb-1">{label}</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {t("explore.segStatsBase", "{{companies}} companies · {{roles}} open roles · {{entry}}% entry-level", {
                        companies: s.companies.toLocaleString(), roles: s.open_roles.toLocaleString(),
                        entry: s.entry_pct,
                      })}
                      {/* remote_pct now divides by postings that actually state
                          a work mode — 87% of the corpus states none, and the
                          old all-postings denominator made a segment that is
                          ~60% remote among those who say read as ~8%, as if it
                          were a fact about the employers. It is null when
                          nobody in the band disclosed: "none are remote" and
                          "nobody said" must not look the same. */}
                      {s.remote_pct != null && (
                        <> · {t("explore.segRemoteDisclosed", "{{remote}}% remote of the {{n}} that state a work mode", {
                          remote: s.remote_pct, n: (s.disclosed_n ?? 0).toLocaleString(),
                        })}</>
                      )}
                      {s.median_usd_floor != null && (s.usd_n ?? 0) >= 50 && (
                        <> · {t("explore.segSalary", "median stated floor ${{m}} ({{n}} USD postings)", { m: Math.round(s.median_usd_floor).toLocaleString(), n: s.usd_n })}</>
                      )}
                      {/* The "N with stated headcount" clause was removed with
                          the headcount framing: the live RPC emits no
                          with_headcount field at all, so the branch was dead,
                          and its wording implied a sourcing step that does not
                          happen. */}
                    </p>
                    </button>
                    {/* Two-number badge: our verified count and the company's own
                        advertised total when it exceeds it — the band label and
                        badge can never contradict each other. (Fallback fields
                        cover a frontend-before-migration deploy window.) */}
                    {(() => {
                      const segBadge = (r: CompanyRow) => {
                        const onBoard = r.on_board ?? r.open_roles ?? 0;
                        const total = r.company_total ?? r.feed_total ?? 0;
                        // BOTH numbers grouped. This read "3842 on our board ·
                        // 12,000 company-wide" — one raw, one grouped, in one
                        // sentence — because only `total` had .toLocaleString().
                        return total > onBoard
                          ? t("explore.segOpenBoth", "{{n}} on our board · {{total}} company-wide", { n: onBoard.toLocaleString(), total: total.toLocaleString() })
                          : t("explore.segOpen", "{{n}} open roles", { n: onBoard.toLocaleString() });
                        // THE EMPLOYEES AND YC-BATCH CHIPS ARE GONE, because
                        // they could never render. get_size_segments' `top`
                        // object emits exactly four keys — company,
                        // company_token, on_board, company_total
                        // (20260727212029:105-108). The 2026-07-27 rewrite
                        // dropped the company_profiles join and with it
                        // employees / employee_basis / yc_batch; the frontend
                        // was never updated, so `r.employees != null` and
                        // `r.yc_batch` have been dead since that day and
                        // ycAbbrev never executed once.
                        //
                        // This is the third field of the same rewrite to be
                        // caught: the comment above already records removing
                        // `with_headcount` for exactly this reason. One of
                        // three was removed and two were left, which is why the
                        // rule is now a test rather than a code comment.
                      };
                      // THE "See all N companies" BUTTONS ARE GONE.
                      //
                      // They called get_size_segment_companies, which returns
                      // 57014 for every band — measured 25.2s, 26.6s and 26.6s
                      // — and the click handler swallowed the error, so the
                      // label just reverted and nothing happened. Every press
                      // spent 25 seconds of a Postgres worker to achieve that.
                      //
                      // It was also paging a DIFFERENT population: that RPC
                      // still bands by employee headcount and requires
                      // `employees IS NOT NULL`, while the band above it is
                      // open roles. Even repaired, "See all 1,724 companies"
                      // would have returned a disjoint set under a total that
                      // did not describe it. A control that cannot keep its
                      // own promise is worse than no control.
                      return open ? (
                        <div className="px-4 pb-4">
                          <CompanyGrid rows={s.top} intent="scale" warn={(r) => repostWarn(r.company_token, "scale")} badge={segBadge} />
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        </div>

        <div hidden={active !== "entry"}>
        {entry.length > 0 && (
          <Section icon={GraduationCap} note={NOTE.entry} title={t("explore.entryTitle", "Entry-level friendly")} blurb={t("explore.entryBlurb", "Companies with the most roles open to people early in their careers.")}>
            {/* THE RATIO, NOT THE COUNT — and a link that carries the filter.
                This badge said "38 entry-level roles" and opened the company's
                whole board showing 900, so the number a reader clicked was not
                the number they landed on. Both figures are already in the
                payload, and the ratio is the actual signal: 40 entry roles out
                of 2,000 is not an entry-friendly employer, while 40 out of 60
                is. The link now carries ?experience=entry, which Jobs.tsx
                reads, so the destination shows what the card counted.

                New key, not a reworded one: all nine locales carry
                explore.entryBadge with a single {{n}}, and a locale value beats
                the inline default — editing in place would render the old
                sentence with a hole in it in nine languages. */}
            <CompanyGrid rows={entry} intent="entry" warn={(r) => repostWarn(r.company_token, "entry")} badge={(r) => (r.open_roles
              ? t("explore.entryBadgeRatio", "{{entry}} of {{open}} roles are entry-level", { entry: (r.entry_roles ?? 0).toLocaleString(), open: r.open_roles.toLocaleString() })
              : t("explore.entryBadge", "{{n}} entry-level roles", { n: r.entry_roles ?? 0 }))} />
          </Section>
        )}
        </div>

        {/* Folded into the pay answer. "Which employers state pay" and "which
            fields pay" are one question, and rendering them as two sections
            twenty screens apart made a reader choose between halves of the same
            answer. Everything between this and the transparent block is hidden
            whenever `pay` is active, so the two render adjacent without moving
            the code.

            No currency control here, deliberately: get_salary_benchmarks does
            DISTINCT ON (category), so each field appears exactly once in its
            dominant currency, and all 18 live rows are USD. A USD/EUR/GBP
            toggle would be a control with one real option — the dead-branch
            class this page has spent the week removing. */}
        <div hidden={active !== "pay"}>
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

        {/* Browse by field — the classic taxonomy entry point, now its own
            answer rather than a footer.

            THE CHIPS NOW CARRY COUNTS. The note here used to read "a correct
            per-category number is a database change, and it is worth doing and
            not worth faking meanwhile" — get_explore_denominators is that
            change, and it counts under the SERVING predicates only
            (missing_since IS NULL, effective_posted within 30 days), which is
            exactly what job-board/index.ts:5529-5539 applies and nothing more.
            The chip's number and the page it opens count the same rows.

            Formatted through SERVE_COUNT_CAP, because the serving API stops
            counting at 10,000: an uncapped "38,412" here would open a page
            reading "10,000+". Same number, same presentation, both runtimes.

            Ordered biggest-first when counts are in hand — the point of a
            count on a browse control is to show where the board is deep — and
            falling back to the declared order when they are not, so a cache
            row written before this migration renders exactly today's page. */}
        <div hidden={active !== "fields"}>
        <Section icon={Briefcase} note={NOTE.fields} title={t("explore.fieldsTitle", "Browse by field")} blurb={t("explore.fieldsBlurb", "Jump straight into any field's live openings.")}>
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
                        still works, it simply makes no claim about depth. A
                        thin field must not render "0". */}
                    {typeof n === "number" && n > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground/70">{fieldCount(n, i18n.language)}</span>
                    )}
                  </Link>
                );
              })}
          </div>
        </Section>

        </div>

        {/* The bottom CTA card is gone. "Know what you're looking for?" was the
            last thing a visitor read on a discovery page — an odd note to end
            on — and it sat forty screens below the fold where the people who
            did know what they wanted had long since left. The same escape now
            rides beside the chips, where it is reachable in one tap. */}
      </main>
      <Footer />
    </div>
  );
}
