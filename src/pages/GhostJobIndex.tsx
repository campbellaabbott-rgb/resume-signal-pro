// The Ghost Job Index — a public transparency page built on the board's own
// lifecycle data (open roles now + when roles actually close). Every number is
// real and computed live; nothing is invented. Closure data accrues from when we
// started logging it, so the "how fast roles close" figures fill in over time —
// we say so plainly rather than faking a history.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, ShieldCheck, Clock, Briefcase } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { VIZ_SERIES_A } from "@/components/DataViz";
import { HowWeMeasure } from "@/components/HowWeMeasure";
// One declaration of the observation-window floor, in /jobs, read by every
// surface that publishes a fourteen-day fill claim. Re-typing 21 here is how
// this table and the board start disagreeing about which fields may speak.
import { FILL_RATE_MIN_TRACKING_DAYS } from "@/pages/Jobs";

interface Stats {
  total_open: number;
  total_companies: number;
  closed_90d: number;
  /** Median AGE of a posting that is open right now. Still rendered — it is a
   *  fact about the board's stock, not a duration to a fill. */
  median_days_open: number | null;
  /** NO LONGER RENDERED. A median time-to-close taken over closures only, with
   *  postings that outlive the 30-day cap absent from the sample rather than
   *  censored within it. Support bounded at 30 pins it near 15 for every
   *  cohort. Kept on the type because the RPC still returns it and a stale
   *  ghost_stats cache row still carries it; the page publishes the fill curve
   *  instead. */
  median_days_to_close: number | null;
  // Share of open postings whose company states its own post date — the
  // measured basis for every age stat on this page. Optional: absent until
  // the stated-date-medians migration is applied.
  posted_coverage_pct?: number | null;
  // Days the closure record actually spans.
  //
  // THE COLUMN WAS RENAMED AND THIS PAGE WAS NOT. `tracking_days` was returned
  // by get_ghost_job_index_stats up to 20260721260000; every signature since
  // calls it `observed_days`. The page kept reading the old name, so it has
  // been `undefined` ever since — which silently disabled BOTH things gated on
  // it: the "In the N days we've kept this record" opener fell back to its
  // vaguer form, and the time-to-close sentence, gated on `>= 21`, could never
  // be true and has not rendered once since the rename.
  //
  // Same shape as the posted_coverage_pct incident on this very page: the
  // number was fine, the field feeding the gate was gone, and the absence
  // looked exactly like a deliberately withheld stat. Both names are read
  // below, because stats_cache can still hold an old-shaped ghost_stats row.
  observed_days?: number;
  tracking_days?: number;
}
interface Leader {
  company: string;
  company_token: string;
  /** LEGACY NAME, NOT READ ANYWHERE ON THIS PAGE ANY MORE. Until
   *  20260907010000 it was a count of closure EVENTS and this page rendered it
   *  as "{{n}} filled" — the number that put 4,331 fills on an employer holding
   *  220 open roles across 11 days. It is now a count of roles, but it is still
   *  a 90-day accumulation printed beside a single-instant open count, and the
   *  figure this list ranks on is the incidence below. Kept in the type so the
   *  shape matches the RPC; deliberately unused. */
  closed_90d: number;
  open_roles: number;
  /** Actual measured window in days (ships with the genuine-fills RPC rebuild;
      absent from older cached rows — omit the fill claim then). */
  tracking_days?: number;
  // ── FROM 20260907010000, WHICH IS WHAT THIS LIST NOW STATES ──────────────
  // The RPC ranks on the cumulative-incidence fill rate at 14 days and returns
  // it on the row, with `sufficient` already applied server-side (no row can
  // come back without it). numeric arrives as a JSON number on one PostgREST
  // build and a STRING on another, so every read goes through numOr.
  /** R(14). A CEILING — renders "up to". */
  fill_incidence_14d?: number | string | null;
  /** Distinct roles that closed once and did not come back. A CEILING. */
  filled_roles_ceiling?: number | string | null;
  /** Share of the risk set carrying the employer's own posting date. */
  dated_share?: number | string | null;
}

/** COERCE AT THE BOUNDARY. `"0.42" >= 0.3` is true by string collation, for
 *  the wrong reason, and every gate below is a comparison. */
const numOr = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** The two columns of get_company_fill_curve this page uses to re-state the
 *  leaderboard's count on the SAME population the curve publishes.
 *
 *  WHY THE COUNT IS RE-READ RATHER THAN TRUSTED. get_actively_hiring_companies
 *  excludes only batches the collector STAMPED suspect — a column that is false
 *  on every row written before the collector guard shipped. The curve applies
 *  the retroactive proxy as well, dropping any (company_token, closed_at) batch
 *  that removed more than max(5, 0.30 × the board's current open roles). So for
 *  the ~54 days of unstamped history the two functions count different
 *  populations, and a board that answered 200 with a near-empty feed can rank
 *  first here on several hundred logged removals while /jobs/company/{token}
 *  reports that it has taken down nothing. Two of our own surfaces, opposite
 *  answers, both presented as measurements — on the page whose entire subject
 *  is whether job numbers can be trusted.
 *
 *  Where the curve answers, its count is what renders. Where it does not (RPC
 *  not deployed, request failed), the row shows open roles alone rather than a
 *  fill claim from the unguarded source. */
interface LeaderCurve {
  company_token: string;
  /** ONE ROW PER CLOSURE EVENT, NOT PER ROLE — the curve's own body says so:
   *  "named for a window of events and stay a window of events". This page
   *  printed it as "{{n}} filled" for weeks. It is read only to decide whether
   *  the curve answered at all; it is never rendered. */
  fills_90d: number;
  tracking_days: number;
  fill_rate_14: number | string | null;
  fill_rate_14_lo?: number | string | null;
  fill_rate_14_hi?: number | string | null;
  dated_coverage: number | string | null;
  sufficient: boolean;
}
/** One category's row from get_category_fill_curve — the Aalen–Johansen
 *  cumulative incidence of a genuine fill, per docs/hiring-health-model.md §4.
 *  This is what replaced `median_days_open` on this page. */
interface FillCurveRow {
  category: string;
  n_at_risk_14: number;
  fills_le_14: number;
  fill_rate_14: number;
  fill_rate_14_lo: number;
  fill_rate_14_hi: number;
  relist_rate_14: number;
  still_open_14: number;
  /** NULL whenever the median is not reached inside the 30-day support. */
  median_days_to_fill: number | null;
  /** true => S(30) > 0.5. Render "> 30 days"; never a number. */
  median_censored: boolean;
  dated_coverage: number;
  window_days: number;
  /** n_at_risk_14 >= 25 AND fills_le_14 >= 5 AND CI half-width <= 0.15. */
  sufficient: boolean;
  // ── STILL ADVERTISED AT DAY 30, appended by 20260909217500 ────────────────
  // Every column below is OPTIONAL on the type because the deployed RPC may
  // predate it, and every one may be NULL on a row the RPC did answer: the
  // day-30 cohort is empty by design at p_days 30, and the day-30 risk set
  // admits only postings on boards whose observability bucket is full_read or
  // lap_proven, because a takedown on a windowed board is invisible and every
  // posting there would seem to reach the cap. NULL, never 1.0, is what the
  // RPC returns when the gate admitted nothing. numeric arrives as a JSON
  // number on one PostgREST build and a STRING on another, so every read goes
  // through numOr, and the render is gated on sufficient_30 alone — see
  // day30Reading below, the one path a day-30 figure can reach the screen by.
  /** Share of the field's dated day-30 cohort that sat on boards we read to the end. */
  gate_share_30?: number | string | null;
  /** S(30): the share still advertised on reaching the cap. */
  still_open_30?: number | string | null;
  still_open_30_lo?: number | string | null;
  still_open_30_hi?: number | string | null;
  /** R(30): taken down for good. A CEILING, for the relist-dedupe reason R(14) is one. */
  taken_down_30?: number | string | null;
  /** X(30): re-listed. A FLOOR. */
  relist_rate_30?: number | string | null;
  n_at_risk_30?: number | string | null;
  /** OUR sweep's takedowns at the cap — our action, never an employer event. */
  ageouts_at_30?: number | string | null;
  /** The cohort's edges as the RPC computed them, ISO dates. Printed from the row, never typed. */
  cohort_from?: string | null;
  cohort_to?: string | null;
  /** n_at_risk_30 >= 25 AND half-width <= 0.15 AND R + X + S = 1 within 1e-6, over admitted boards. */
  sufficient_30?: boolean | null;
}
/** THE DAY-30 READING FOR ONE ROW, or null. This is the ONLY route by which a
 *  day-30 figure reaches the screen, and it renders on exactly one condition:
 *  the RPC's own sufficiency finding is the boolean true. An absent column
 *  (old RPC), a NULL (gate admitted nothing, or the cohort is empty), and an
 *  explicit false all come out as null here, and null draws nothing — no dash,
 *  no "n/a" — because a windowed board would read 1.0 by construction and a
 *  placeholder beside a field name reads as a finding about that field.
 *  Every number is coerced at the boundary and the cohort edges are carried
 *  through as the row states them. */
export interface Day30Reading {
  /** S(30), R(30), X(30) and the interval, as whole percentages. */
  pct: number;
  lo: number;
  hi: number;
  /** Half the interval's width, in points. */
  hw: number;
  r: number;
  x: number;
  n: number;
  cohortFrom: string;
  cohortTo: string;
}
export const day30Reading = (row: Pick<FillCurveRow,
  "sufficient_30" | "still_open_30" | "still_open_30_lo" | "still_open_30_hi"
  | "taken_down_30" | "relist_rate_30" | "n_at_risk_30" | "cohort_from" | "cohort_to">): Day30Reading | null => {
  if (row.sufficient_30 !== true) return null;
  const s = numOr(row.still_open_30);
  const lo = numOr(row.still_open_30_lo);
  const hi = numOr(row.still_open_30_hi);
  const r = numOr(row.taken_down_30);
  const x = numOr(row.relist_rate_30);
  const n = numOr(row.n_at_risk_30);
  if (s === null || lo === null || hi === null || r === null || x === null || n === null) return null;
  if (typeof row.cohort_from !== "string" || typeof row.cohort_to !== "string") return null;
  if (row.cohort_from.length === 0 || row.cohort_to.length === 0) return null;
  const pc = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
  return {
    pct: pc(s), lo: pc(lo), hi: pc(hi), hw: Math.round(((hi - lo) / 2) * 100),
    r: pc(r), x: pc(x), n: Math.round(n), cohortFrom: row.cohort_from, cohortTo: row.cohort_to,
  };
};
/** Whether the RPC that answered carries the day-30 columns at all. The
 *  disclosure of WHICH fields lack a reading is only true once the function
 *  that decides it has run; against an old RPC it would name every field as
 *  unread, which is a claim the response cannot support. */
export const day30ColumnPresent = (rows: Array<Pick<FillCurveRow, "sufficient_30">>): boolean =>
  rows.some((r) => typeof r.sufficient_30 === "boolean");
/** docs/hiring-health-model.md §4/§5. The horizon sits strictly inside the
 *  observable window for every dated posting; the coverage bands say what
 *  population the rate speaks for and are NOT part of `sufficient`. */
const FILL_HORIZON_DAYS = 14;
const FILL_COVERAGE_PLAIN = 0.6;
const FILL_COVERAGE_QUALIFY = 0.3;

interface AuditResult {
  at: string;
  sampled: number;
  live: number;
  gone: number;
  unknown: number;
  /** The share of `unknown` where the board answered fine and we simply could
   *  not read past our own page cap. Absent on audits written before .64. */
  pageCapped?: number;
  /** `unknown` minus `pageCapped` — probes where the fetch genuinely failed. */
  unreachable?: number;
  /** live + gone: the probes the accuracy figure below is actually computed on. */
  decided?: number;
  decidedPct?: number | null;
  accuracyPct: number | null;
  /** Rolling ~30-day history of daily audits, oldest first. */
  history?: Array<{ at: string; sampled: number; accuracyPct: number | null }>;
  /** What share of the corpus the sample actually reached, and what it missed. */
  coverage?: {
    coveredSharePct: number | null;
    /** Coverage shares come from planner estimates, not a census. */
    basis?: string;
    sourcesSampled: number;
    sourcesWithRows: number;
    missingSources: Array<{ source: string; postings: number | null; sharePct: number | null; reason: string }>;
    /** Systems whose posting count could not be read at all this run. */
    countsUnavailable?: string[];
  };
  /** Stratified per-vendor results (the audit samples every hiring system). */
  byVendor?: Record<string, { sampled: number; accuracyPct: number | null }>;
  /** Systems that looked low on the even draw and were re-checked deeper before
   *  their figure was published. `sampled` above stays the even draw. */
  deepened?: Array<{ source: string; firstPassPct: number; added: number }>;
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(fn, args);

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString() : "—");
/** A tile that has not been answered yet. Drawn INSTEAD of "—" while the
 *  stats read is in flight, so an unanswered tile cannot be mistaken for an
 *  empty one. Sized to the number it stands in for. */
const Skel = () => <span aria-hidden="true" className="inline-block h-7 w-20 rounded bg-muted animate-pulse align-middle" />;

interface FreshnessStats {
  boards: number;
  p50_min: number | null;
  p95_min: number | null;
}

export default function GhostJobIndex() {
  const [stats, setStats] = useState<Stats | null>(null);
  // LOADING IS NOT "NO DATA". fmt() renders "—" for a missing number, and for
  // the first several seconds of every visit every number is missing — so the
  // page opened on three dashes beside a hardcoded "30 days", indistinguishable
  // from a failed read, on a page whose subject is whether numbers can be
  // trusted. While this is true the tiles draw a skeleton instead.
  const [statsLoading, setStatsLoading] = useState(true);
  /** When the cached figures were computed. Null when they were read live. */
  const [statsComputedAt, setStatsComputedAt] = useState<string | null>(null);
  /** Hours since those figures were computed; null when they are live. */
  const statsStaleHours = statsComputedAt
    ? (Date.now() - new Date(statsComputedAt).getTime()) / 3_600_000
    : null;
  const [leaders, setLeaders] = useState<Leader[]>([]);
  /** Guarded fill counts for the leaderboard, keyed by token. Empty until the
   *  curve answers; `curveGuardRan` says which of "not yet" and "cannot" we are
   *  in, so the rows degrade to a count-free badge rather than to a stale one. */
  const [leaderCurve, setLeaderCurve] = useState<Record<string, LeaderCurve>>({});
  const [curveGuardRan, setCurveGuardRan] = useState(false);
  // WAS get_employer_benchmarks — a median over "roles that stayed posted at
  // least a week", which is to say a median drawn from a window of [7, 30]
  // days by construction. It could not have come out anywhere but ~15 whatever
  // employers did, and the caption beneath it published the two things that
  // made it wrong as if they were method: the seven-day floor, and an origin
  // that fell back to our own first sighting when the employer stated no date.
  // Replaced by the fill curve, which censors rather than deletes.
  const [fillCurve, setFillCurve] = useState<FillCurveRow[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  // Distinguishes "audit could not be read" from "not fetched yet", so the
  // page can say which rather than showing a confident blank.
  const [auditUnavailable, setAuditUnavailable] = useState(false);
  const [freshness, setFreshness] = useState<FreshnessStats | null>(null);
  // Per-vendor company-stated date coverage — the same probe the ops
  // heartbeat reads, published as a trust stat: it names exactly which
  // hiring systems state post dates and how much of the corpus that covers.
  const [dateCov, setDateCov] = useState<Array<{ source: string; total: number; datedPct: number }>>([]);

  useEffect(() => {
    (async () => {
      try {
        // Fast path: the hourly stats cache supplies the two slow aggregates
        // (ghost_stats ~4.9s live, date_coverage which otherwise 500s). The
        // fast calls (leaders, freshness, audit) always run live below.
        const { data: cacheRaw } = await Promise.resolve(rpc("get_stats_cache")).catch(() => ({ data: null }));
        const cache = (cacheRaw && typeof cacheRaw === "object" && !Array.isArray(cacheRaw)) ? (cacheRaw as Record<string, unknown>) : null;
        const [s, l, a, f, b] = await Promise.all([
          cache?.ghost_stats ? Promise.resolve({ data: [cache.ghost_stats] }) : rpc("get_ghost_job_index_stats"),
          // THE ONE CALL IN THIS ARRAY WITH NO .catch. Every sibling is wrapped
          // in Promise.resolve(...).catch(() => ({ data: null })) for the reason
          // the comment two entries down records: a PostgREST thenable that
          // rejects kills the whole Promise.all, and "verified live: every tile
          // went —". This one was left bare, so a single failed leaderboard read
          // blanked total_open, total_companies and median_days_open — three
          // numbers that were sitting in the stats cache the whole time.
          Promise.resolve(rpc("get_actively_hiring_companies", { p_limit: 20 })).catch(() => ({ data: null })),
          // The daily self-audit result. This was a direct table read on
          // job_board_meta, under a comment asserting the table was
          // public-read. It is not — anon gets 42501 permission denied — so
          // `audit` was ALWAYS null and the panel below (gated on `audit &&`)
          // has never rendered for a single visitor, while the methodology
          // section promised the results were "published above, unedited".
          // get_stats_cache() exists for exactly this reason; the audit now
          // has its own accessor (migration 20260727180000).
          Promise.resolve(rpc("get_audit_result")).catch(() => ({ data: null })),
          // PostgREST builders are thenables WITHOUT .catch — calling .catch on
          // one throws synchronously and would kill this whole Promise.all
          // (verified live: every tile went "—"). Promise.resolve assimilates
          // the thenable into a real Promise first.
          Promise.resolve(rpc("get_freshness_stats")).catch(() => ({ data: null })),
          // The fill curve by field — returns [] (or 404s, caught here) until
          // the migration lands, and the section simply doesn't render. Never
          // awaited into anything the rest of the page needs.
          Promise.resolve(rpc("get_category_fill_curve", { p_days: 90, p_min_n: 300 })).catch(() => ({ data: null })),
        ]);
        // WHEN THESE NUMBERS WERE COMPUTED, carried alongside them.
        //
        // The cache is the fast path and is normally an hour old, which nobody
        // needs told. It is not always an hour old: on 2026-08-07 it was 4.3
        // days stale, because get_ghost_job_index_stats() had started timing
        // out (57014 at 60s) as the corpus passed 590k postings, and the hourly
        // refresh had been failing silently since 2026-08-03. The page went on
        // publishing 562,873 open jobs against a real 590,870 — understating
        // its own board by 28,000 — with nothing on screen dating the claim.
        //
        // A stale statistic that names its date is honest. The same number
        // presented as current is not, and this page's entire subject is
        // whether job numbers can be trusted.
        const cachedAt = typeof cache?.computed_at === "string" ? cache.computed_at : null;
        setStatsComputedAt(cache?.ghost_stats ? cachedAt : null);
        let srow = Array.isArray(s.data) ? (s.data[0] as Stats) : null;
        // The stats RPC can time out on a cold cache and succeed warm — one
        // spaced retry turns a half-blank page into a reliably full one.
        if (!srow) {
          await new Promise((r) => setTimeout(r, 1500));
          const s2 = await rpc("get_ghost_job_index_stats");
          srow = Array.isArray(s2.data) ? (s2.data[0] as Stats) : null;
        }
        if (srow) setStats(srow);
        if (Array.isArray(l.data)) setLeaders(l.data as Leader[]);
        if (Array.isArray(b.data)) setFillCurve(b.data as FillCurveRow[]);
        const frow = Array.isArray(f.data) ? (f.data[0] as FreshnessStats) : null;
        if (frow && typeof frow.p50_min === "number") setFreshness(frow);
        // The RPC returns the stored value directly; the old table read
        // returned a row wrapper. Accept either so a stale deploy of one half
        // still renders rather than silently blanking again.
        const araw = a.data as (AuditResult & { v?: AuditResult }) | null;
        const av = araw?.v ?? araw;
        if (av && typeof av.accuracyPct === "number") setAudit(av);
        else setAuditUnavailable(true);
        // RPC shape is (source, total, dated) — the pct is ours to compute.
        // Prefer the cache (the live RPC full-scans 557k rows); fall back live.
        const dc = cache?.date_coverage
          ? { data: cache.date_coverage }
          : await Promise.resolve(rpc("get_date_coverage")).catch(() => ({ data: null }));
        if (Array.isArray(dc.data)) {
          setDateCov((dc.data as Array<{ source: string; total: number; dated: number }>)
            .filter((r) => r && typeof r.total === "number" && r.total > 0)
            .map((r) => ({ source: r.source, total: r.total, datedPct: (Number(r.dated) / Number(r.total)) * 100 }))
            .sort((x, y) => y.total - x.total));
        }
      } catch {
        /* RPCs not deployed yet — page still renders its explainer */
      } finally {
        setStatsLoading(false);
      }
    })();
  }, []);

  // THE LEADERBOARD'S COUNT, RE-READ THROUGH THE FEED-DARK GUARD.
  //
  // Deliberately a second, later request rather than part of the batch above:
  // it depends on which tokens came back, it must never delay first paint, and
  // its failure must cost the page nothing but the fill claim itself. Twenty
  // tokens against a function budgeted for two hundred.
  useEffect(() => {
    if (leaders.length === 0) return;
    let live = true;
    void (async () => {
      const { data } = await Promise.resolve(
        rpc("get_company_fill_curve", { p_tokens: leaders.map((l) => l.company_token) }),
      ).catch(() => ({ data: null }));
      if (!live) return;
      if (!Array.isArray(data)) { setCurveGuardRan(false); return; }
      const next: Record<string, LeaderCurve> = {};
      for (const r of data as LeaderCurve[]) {
        if (r && typeof r.company_token === "string" && typeof r.fills_90d === "number") next[r.company_token] = r;
      }
      setLeaderCurve(next);
      setCurveGuardRan(true);
    })();
    return () => { live = false; };
  }, [leaders]);

  const hasClosureData = !!stats && stats.closed_90d > 0;
  /** The fill-curve rows this page actually LISTS. Hoisted so the table, the
   *  censored-median count and the coverage qualifier all describe the same
   *  population — they were three separate filters over the same array, and the
   *  two captions omitted the coverage predicate the table applies, so the page
   *  could say "in 3 of these fields…" about fields the sentence above had just
   *  promised were not listed. That is the closed_90d / median_days_to_close
   *  denominator split — the defect this whole change exists to remove —
   *  rebuilt in JSX. */
  // The third predicate is the observation window, and `sufficient` cannot
  // supply it: it counts roles at risk, observed fills and interval width, none
  // of which is a statement about how deep the log is. Lifetimes are measured
  // from the employer's stated posted_at rather than from our first sighting, so
  // a field we have watched for ten days can still put 25 roles at risk at day
  // 14 and pass every server term — and this table would then print "N% filled
  // by day 14" under a caption saying we watched for ten days. window_days is
  // the RPC's OBSERVED depth (LEAST(requested, age of the oldest closure)), so
  // it is the right thing to hold against the floor /jobs declares.
  const shownCurve = fillCurve.filter((r) => r.sufficient
    && r.dated_coverage >= FILL_COVERAGE_QUALIFY
    && r.window_days >= FILL_RATE_MIN_TRACKING_DAYS);
  /** The day-30 reading per LISTED row, through the one gate. A row without
   *  one draws nothing for day 30; the fields that lack one are named once
   *  above the table, and only when the RPC actually carried the columns. */
  const { t } = useTranslation();
  const day30Rows = shownCurve.map((r) => ({ r, d: day30Reading(r) }));
  const anyDay30 = day30Rows.some((x) => x.d !== null);
  const day30Unread = day30ColumnPresent(fillCurve)
    ? day30Rows.filter((x) => x.d === null).map((x) => x.r.category.replace(/_/g, " "))
    : [];
  /** The leaders this page lists. Until the guard answers, today's list in the
   *  RPC's own order; after it, only boards with a fill the guard stands behind,
   *  ORDERED BY THE SAME COUNT THAT RENDERS. Ranking on one population while
   *  printing another is how a reader ends up looking at "40 filled" above
   *  "60 filled" under a heading that says the list is ranked by fills — the
   *  leaderboard RPC ranks on a 30-day window and the curve counts 90 days, so
   *  the two orders genuinely differ. Sorting here is within the twenty rows
   *  the RPC already chose; it does not claim to be the guarded top twenty of
   *  the whole board, and the footnote does not say that it is. */
  /** THE MEASURE FOR ONE LEADER, from the row first and the curve second —
   *  the same two-source rule /explore applies, and never mixed.
   *
   *  What this replaces: `fills_90d / open_roles`, a closure-EVENT count over a
   *  stock of open roles. It is the ranking 20260907010000 exists to delete —
   *  unbounded (2,496% on the live data), with a per-employer denominator, and
   *  mixing an 11-day row with a 50-day one as if the counts were comparable.
   *  Worse, `fills_90d` is not deduped by posting_id, so a role that closed
   *  twenty times contributed twenty "fills"; ranking on it ranked churn.
   *
   *  R(14) is a share of one employer's own risk set at one fixed horizon, so
   *  every row answers the same question over the same number of days. */
  const leaderRate = (c: Leader): { rate: number; ceiling: number | null; days: number | null; coverage: number | null } | null => {
    const own = numOr(c.fill_incidence_14d);
    if (own !== null) {
      // The RPC gates on the curve's `sufficient` in its own WHERE and has no
      // fallback ordering, so a row carrying an incidence IS the server's
      // sufficiency finding. The coverage floor and the observation window are
      // the two halves it explicitly leaves to the caller.
      return { rate: own, ceiling: numOr(c.filled_roles_ceiling), days: c.tracking_days ?? null, coverage: numOr(c.dated_share) };
    }
    const g = leaderCurve[c.company_token];
    if (!g || g.sufficient !== true) return null;
    const r = numOr(g.fill_rate_14);
    if (r === null) return null;
    // NO COUNT FROM THIS SOURCE. fills_90d is a closure-event count and would
    // render under the word "roles"; the rate is a cohort share and survives.
    return { rate: r, ceiling: null, days: g.tracking_days ?? null, coverage: numOr(g.dated_coverage) };
  };
  /** The leaders this page lists, and the three bars they clear to be listed —
   *  the same three `shownCurve` applies to the field table ten lines above,
   *  which were never applied here. Ranked on the rate that renders. */
  const shownLeaders = (curveGuardRan || leaders.some((c) => numOr(c.fill_incidence_14d) !== null))
    ? leaders
        .map((c) => ({ c, m: leaderRate(c) }))
        .filter((x): x is { c: Leader; m: NonNullable<ReturnType<typeof leaderRate>> } =>
          !!x.m
          && x.m.coverage !== null && x.m.coverage >= FILL_COVERAGE_QUALIFY
          && x.m.days !== null && x.m.days >= FILL_RATE_MIN_TRACKING_DAYS)
        .sort((a, b) => b.m.rate - a.m.rate)
        .map((x) => x.c)
    : leaders;
  // Current name first, old name second. See the note on the interface: the
  // RPC renamed tracking_days -> observed_days and this page kept reading the
  // retired one, so everything gated on it went quietly dark. Reading both
  // keeps a stats_cache row written before the rename working too.
  const trackedDays = stats?.observed_days ?? stats?.tracking_days;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="The Ghost Job Index — how many job postings are actually real?"
        description="A live, honest look at job-posting freshness: how many roles are open right now, how long they stay open, and which companies actually fill roles — computed from companies' official job boards, not aggregators or scrapes."
        path="/ghost-job-index"
      />
      <Header />
      {/* pt-24, NOT py-10: the header is a fixed h-16 bar that emits no spacer,
          so with py-10 the H1 "The Ghost Job Index" began under its blur and the
          owner could not see the title. Jobs/Explore compensate the same way.
          id + tabIndex: index.html ships href="#main-content" as the first
          focusable element of every page; this page had no target, so a keyboard
          reader's first keystroke moved nothing. */}
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 pt-24 pb-10 focus:outline-none">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-6 h-6 text-primary" />
          <h1 className="text-3xl md:text-4xl font-bold">The Ghost Job Index</h1>
        </div>
        <p className="text-muted-foreground mb-1">
          Ghost jobs — postings that are stale, already filled, or never real — waste job seekers' time everywhere.
          This is our live, honest measure of the opposite: postings that are verified, fresh, and from companies actually hiring.
        </p>
        <p className="text-xs text-muted-foreground mb-8">
          Every figure below is computed from the full lifecycle of postings on companies' <b>official</b> job boards
          (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, Workday, iCIMS, Oracle, Pinpoint) — never an aggregator or a scrape.
        </p>

        {/* Headline stats — always true */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{statsLoading && !stats ? <Skel /> : fmt(stats?.total_open)}</div>
            {/* "right now" WAS A CLAIM, and for four days it was a false one.
                These figures come from an hourly cache; when that cache is
                current the wording is true and saying so costs nothing. When
                the refresh has stalled — 4.3 days on 2026-08-07, while this
                tile still said "right now" — the caption has to date itself.
                A page arguing that job numbers cannot be trusted cannot be
                sloppy about its own. */}
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {statsStaleHours !== null && statsStaleHours >= 3
                ? `verified open roles, as of ${new Date(statsComputedAt as string).toLocaleDateString()}`
                : "verified open roles right now"}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">{statsLoading && !stats ? <Skel /> : fmt(stats?.total_companies)}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">companies, each from its own feed</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-success">30 days</div>
            {/* THE CAP, AND WHERE THE READING AT THE CAP IS. The second
                sentence points at the field table's day-30 line, so it may
                only appear when at least one listed field publishes that
                line; pointing a reader at a reading that is not there is the
                "published above, unedited" audit panel all over again. */}
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {anyDay30
                ? t("ghostIndex.capTileWithReading", "our freshness cap — a posting whose company-stated date passes 30 days leaves the board. The share still advertised on reaching the cap is the day-30 line in the field table below.")
                : "hard freshness cap — older postings auto-dropped"}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-2xl font-bold text-foreground">
              {statsLoading && !stats ? <Skel /> : stats?.median_days_open != null ? `${stats.median_days_open}d` : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              median age of an open posting, by the company's own stated post date
              {stats?.posted_coverage_pct != null && (
                <> — {Math.round(stats.posted_coverage_pct)}% of postings state one; the rest are excluded, never estimated</>
              )}
            </div>
          </div>
        </div>

        {/* Measured freshness. This is no longer the number BEHIND a claim —
            since the "re-verified within a few hours" promise was retracted
            (2026-09-06) it IS the claim: llms.txt, the field landers and
            jobsPage.sourceNote all now say "the live median and 95th-percentile
            re-check ages are published on the Ghost Job Index" and point here.
            Computed from per-board verification stamps at page load. Shown only
            when measured; never an aspiration — if this block stops rendering,
            those surfaces are pointing at nothing. */}
        {freshness && (
          <p className="text-xs text-muted-foreground -mt-5 mb-8">
            Measured right now across {freshness.boards.toLocaleString()} company feeds: the median feed was re-checked{" "}
            <b className="text-foreground">{Math.round(freshness.p50_min ?? 0)} minutes ago</b>
            {typeof freshness.p95_min === "number" && (
              <> — 95% of all feeds within <b className="text-foreground">{(freshness.p95_min / 60).toFixed(1)} hours</b></>
            )}
            .
          </p>
        )}

        {/* The measured accuracy stat — we audit ourselves daily and publish the
            number. Shown only when a real audit result exists; never estimated. */}
        {!audit && auditUnavailable && (
          <div className="rounded-2xl border border-border bg-muted/20 p-5 mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" /> Today's self-audit could not be loaded
            </h2>
            <p className="text-sm text-muted-foreground">
              The daily accuracy check runs regardless, but we could not read its result to show you just now.
              We would rather say that than print a number we have not verified — so this space stays empty
              until the real one is available.
            </p>
          </div>
        )}

        {audit && (
          <div className="rounded-2xl border border-success/30 bg-success/5 p-5 mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-success" /> We audit ourselves — here's the number
            </h2>
            <p className="text-sm text-muted-foreground">
              On {new Date(audit.at).toLocaleDateString()}, we sampled <b className="text-foreground">{audit.sampled}</b>{" "}
              listings from this board — drawn evenly across hiring systems, not at random, so a single
              broken vendor cannot hide inside a large one — and re-checked each against the company's own system:{" "}
              <b className="text-success">{audit.accuracyPct}% were confirmed live at the source</b>
              {" "}({audit.live} live, {audit.gone} already taken down
              {audit.unknown > 0 && (() => {
                // TWO REASONS A PROBE DOES NOT DECIDE, and they are opposite
                // facts about the vendor. "Unreachable" means the fetch failed.
                // A page-capped feed is the other thing entirely: it answered,
                // it parsed, and it is simply larger than one read — roughly
                // 4,300 of our 44,500 boards are on capped fetchers, so this is
                // the common case and printing it as "unreachable" would be a
                // false statement about a vendor that served every request.
                const w = audit.pageCapped ?? 0;
                const u = audit.unreachable ?? (audit.unknown - w);
                const parts: string[] = [];
                if (u > 0) parts.push(`${u} we could not reach`);
                if (w > 0) parts.push(`${w} we could not decide (their feed is larger than one read)`);
                return `, ${parts.length > 0 ? parts.join(", ") : `${audit.unknown} undecided`}`;
              })()}).
              {" "}The percentage is computed only over the probes that decided
              {typeof audit.decided === "number" ? ` (${audit.decided} of ${audit.sampled}` : ""}
              {typeof audit.decided === "number" && typeof audit.decidedPct === "number" ? `, ${audit.decidedPct}%)` : typeof audit.decided === "number" ? ")" : ""}
              {" "}— undecidable probes leave the denominator rather than counting as passes.
              The handful already taken down are pruned by the next refresh cycle. We run this audit every day.
            </p>
            {/* An accuracy figure that quietly skips a hiring system is a figure
                about a different board. If a stratum was missed, the number
                says so itself rather than leaving the reader to spot a gap in
                the table below. */}
            {audit.coverage && audit.coverage.missingSources.length > 0 && (
              <p className="text-sm mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <b className="text-foreground">Read this number narrowly.</b> This run reached{" "}
                <b className="text-foreground">{audit.coverage.coveredSharePct}%</b> of the board
                ({audit.coverage.sourcesSampled} of {audit.coverage.sourcesWithRows} hiring systems).
                Not covered:{" "}
                {audit.coverage.missingSources.map((m, i) => (
                  <span key={m.source}>
                    {i > 0 && ", "}
                    <b className="text-foreground">{m.source}</b>{" "}
                    ({typeof m.sharePct === "number" ? `${m.sharePct}% of postings` : "size unknown"})
                  </span>
                ))}
                . The figure above describes only the systems that were sampled, so treat it as a
                floor for those and as unmeasured for the rest.
              </p>
            )}
            {audit.coverage && audit.coverage.missingSources.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                This run reached every hiring system with postings on the board
                ({audit.coverage.sourcesSampled} of {audit.coverage.sourcesWithRows}).
              </p>
            )}
            {/* Per-vendor accuracy — the audit samples every hiring system
                (stratified), so a single broken vendor can't hide inside a
                healthy blended number. Shown only for real samples. */}
            {audit.byVendor && Object.keys(audit.byVendor).length > 1 && (
              <p className="text-[11px] text-muted-foreground mt-2">
                By hiring system:{" "}
                {Object.entries(audit.byVendor)
                  .filter(([, b]) => b.sampled >= 4 && typeof b.accuracyPct === "number")
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([v, b]) => `${v} ${b.accuracyPct}%`)
                  .join(" · ")}
              </p>
            )}
            {/* An even draw gives each system only ~6 probes, where one dead
                listing swings the figure 17 points. Any system that looked low
                is re-drawn deeper before we publish its number — so the reader
                is told which figures rest on a bigger sample than the rest,
                rather than seeing two differently-earned numbers side by side. */}
            {(audit.deepened?.length ?? 0) > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {audit.deepened!.map((d) => `${d.source} looked low (${d.firstPassPct}%) on the even draw, so we re-checked ${d.added} more of its listings before publishing the figure above`).join("; ")}.
              </p>
            )}
            {/* The daily-audit trend — only once there are at least two real
                audits to show. Every bar is a published, dated measurement. */}
            {(audit.history?.length ?? 0) >= 2 && (
              <div className="mt-3">
                <div className="flex items-end gap-0.5">
                  {audit.history!.slice(-14).map((h) => (
                    <div
                      key={h.at}
                      className="w-5 rounded-t"
                      style={{ height: `${Math.max(6, Math.round((h.accuracyPct ?? 0) * 0.4))}px`, backgroundColor: VIZ_SERIES_A }}
                      title={`${new Date(h.at).toLocaleDateString()}: ${h.accuracyPct ?? "—"}% of ${h.sampled} sampled confirmed live`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Daily audit results, most recent {Math.min(audit.history!.length, 14)} days — hover any bar for the dated measurement.
                </p>
              </div>
            )}
          </div>
        )}

        <HowWeMeasure
          items={[
            { term: "Verified open roles", method: "A live count of postings currently served from companies' official hiring systems (Greenhouse, Lever, Ashby and 8 more) — never aggregators or scrapes. Postings a feed stops serving are removed after a confirmation pass." },
            { term: "30-day freshness cap", method: "Postings whose company-stated date is older than 30 days are dropped at ingestion AND filtered at read time — the board cannot serve a stale posting even mid-sweep. Undated postings can't be judged old, so they're kept and simply show no age. Past the cap a posting is deleted, not watched, so nothing on this page says how long postings stay up beyond it. What can be measured is how many reach it: for each field, the share of dated roles from a stated posting window that were still advertised when they reached day 30, with its interval, and beside it the share taken down for good (a ceiling: a takedown we have not yet seen re-listed counts there) and the share re-listed (a floor). The three sum to one before each is rounded to the nearest point, so the printed figures can add to one more or less than a hundred. That line is counted only on boards we read to the end — on a board we can only read part of, a takedown is invisible and every posting would seem to reach the cap — and fields where too few roles sat on such boards are named above the table rather than given a figure. A role still advertised at day 30 is a fact about that posting, not proof of anything about the employer: a role can be genuinely open for longer than a month." },
            { term: "Median posting age", method: "Computed only from postings whose company states its own post date (the coverage share is shown next to the number). Undated postings are excluded from age stats, never estimated. We never use our own discovery time as a posting age." },
            { term: "How often roles are actually filled", method: "The share of a field's roles taken down for good — down, and not re-listed under the same title — within 14 days of the date the company itself published, never our discovery date, and never a median. Roles that come back up are counted as re-listings and shown separately; the two together are the share that left the board at all, so the fill figure is always the smaller number. We used to publish a median time to close and state its window beside it; the window was the problem. The board drops any posting older than 30 days, so a role that stays up longer leaves the board instead of being recorded as closed, and every fill surface then required a posting to have stood a week before it counted at all. A median drawn from a window of [7, 30] days lands near 15 whatever employers do — measured 2026-09-06, eighteen fields spanning nursing, law, retail and ML research agreed to within 1.4 days across roughly 600,000 closures. Roles that outlive the cap, and roles still up today, are now counted as unfinished rather than dropped from the sample, which is what that figure got wrong: dropping the slowest cases and taking a median of the rest is not censoring, it is truncation, and it biases the answer down without bound. Same-title relistings are held out as their own outcome, not counted as fills. Where fewer than half of a field's roles had been taken down for good by day 30 there is no typical figure to give and we say so instead of manufacturing one." },
            { term: "Confirmed-live accuracy", method: "Every day we draw ~100 served postings and re-check each at the company's own system. Draws are spread evenly across hiring systems rather than taken at random from the corpus, so a small vendor is checked as hard as a large one — which also means the blended figure weights systems equally, not by how many postings each contributes. Per-vendor results are published unedited alongside it, including runs that fail or miss a system. The percentage is a share of the probes that DECIDED, and the count it was computed on is printed beside it: a probe we could not reach, and a probe on a feed larger than one read of ours, both leave the denominator instead of being scored either way. That exclusion is not a rounding detail — around a tenth of our boards page short of the vendor's own advertised total, and on those a posting's absence from our read is evidence about our page cap, not about the employer. Saying 'we could not decide' is the only honest answer there, and it is why this figure is published with its own basis attached." },
            { term: "Re-verification freshness", method: "Every board carries a verification stamp from the refresh loop; the median and 95th-percentile ages shown are computed from those stamps at page load — a measurement, not a promise." },
          ]}
        />

        {/* Closure-derived stats — the moat, staged honestly */}
        <div className="rounded-2xl border border-border bg-card p-5 mb-8">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-primary" /> Do these companies take their roles down?
          </h2>
          {hasClosureData ? (
            <p className="text-sm text-muted-foreground">
              {trackedDays ? `In the ${trackedDays} days we've kept this record` : "Since we started keeping this record"} we've
              watched <b className="text-foreground">{fmt(stats?.closed_90d)}</b> roles
              come down across the board. Postings that never close are exactly the ghost jobs we drop.{" "}
              {/* WHAT THIS NUMBER COUNTS, SAID ON THE PAGE.
                  It held NEITHER a superseded test nor a suspect test until
                  20260906094000 added both to the cache arm that builds it, so
                  it was the one closure figure in the system that counted a
                  dark feed's several hundred logged removals as takedowns while
                  every other surface excluded them. It now holds out re-listings
                  and the batches the collector stamped at the time.
                  ONE DIFFERENCE REMAINS, and it is worth a clause rather than a
                  silence: the field figures below also apply the retroactive
                  proxy, which catches dark batches in the ~54 days of history
                  written before the collector stamped anything. This headline
                  cannot — it is a single board-wide count with no per-employer
                  open-roles denominator to compare a batch against. So the two
                  can still differ, in one direction, for one stated reason. */}
              <span className="text-muted-foreground/80">
                That count is roles an employer took down: same-title re-listings and batches we flagged as bad feeds
                at the time are excluded. The per-field figures below go one step further and also drop batches we can
                only recognise in hindsight, from before we started stamping them — so where the two differ, this one
                is the larger.
              </span>
              {/* THE MEDIAN IS GONE, AND NAMING ITS WINDOW WAS NOT ENOUGH.
                  This sentence used to add "among roles that close within 30
                  days of being posted, a typical one goes in about N days",
                  with the window stated so the reader could discount it. The
                  disclosure was true and the number was still not a fact about
                  hiring. Two things guaranteed it:
                    1. The observable support is bounded at both ends. The board
                       drops a posting once its stated date passes 30 days, and
                       every fill surface then required the posting to have
                       stood a week before it counted. A median drawn from a
                       window of [7, 30] lands near 15 whatever employers do —
                       measured 2026-09-06, eighteen categories spanning
                       nursing, law, retail and ML research agreed to within
                       1.4 days over ~600k closures. That is not signal.
                    2. Roles that outlived the cap were not censored, they were
                       ABSENT. Dropping the slowest cases and taking a median of
                       what remains is truncation, not censoring, and it biases
                       the answer down without bound.
                  What replaces it is below: the share of roles taken down for
                  good — down and not re-listed — by day 14, with roles still
                  up and roles that passed the cap counted as unfinished rather
                  than deleted. That is R(14), the fill arm alone; the share
                  that left the board at all is larger by the relist rate,
                  which is published in its own column. Where fewer than half
                  had been taken down for good by day 30 there is no median to
                  give, and we say that instead of manufacturing one. */}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              We log every posting the moment a company takes it down — the only way to know which employers truly
              hire versus perpetually collect applications. We started keeping that record recently, so this fills in
              over the coming weeks. We'd rather show it honestly than fake a history.
            </p>
          )}
        </div>

        {/* THE TAKE-DOWN LEADERBOARD. Headed "Actively hiring right now" until
            2026-09-09, retitled "Most roles taken down and not re-listed" that
            morning, and headed "Actively hiring" again by owner decision the
            same day — with the measurement stated in the heading itself and
            the paragraph below naming both the exclusion and what is not yet
            counted. It ranks the share of an employer's roles we WATCHED come
            down and stay down, so a board we cannot read to the end produces
            no closures, cannot rank at all, and must not be captioned as
            though it were not hiring; and no count of NEW postings is in it
            yet — that joins once the openings series holds enough days.
            `shownLeaders` is the list once the guard has answered: a board
            whose logged takedowns were all in feed-dark batches has no fills
            to rank and is not listed. The leaderboard's own RPC cannot make
            that cut — it excludes only batches the collector stamped, and
            nothing before the collector guard shipped is stamped — so ranking
            on it alone put "N filled" beside boards the company page says took
            nothing down. Note the RPC also requires 100+ open roles to appear
            here, so the proxy's threshold is at least 30 removals in one pass:
            a genuine hiring class is not what this drops. */}
        {shownLeaders.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Briefcase className="w-4 h-4 text-primary" /> Actively hiring
              <span className="text-xs font-normal text-muted-foreground">— measured as roles taken down and not re-listed</span>
            </h2>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {shownLeaders.map((c, i) => (
                <Link
                  key={c.company_token}
                  to={`/jobs/company/${c.company_token}`}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors ${i > 0 ? "border-t border-border/60" : ""}`}
                >
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{c.company}</span>
                  {(() => {
                    // THE FIGURE IS THE RATE, AND IT IS THE ONE THE LIST IS
                    // ORDERED BY. What was here: "{{n}} filled in {{d}}d
                    // tracked", from get_company_fill_curve's fills_90d — a
                    // count of closure EVENTS with no posting_id dedupe, which
                    // rendered "6406 filled in 11d tracked · 420 open now" for
                    // an employer that would have to fill 582 roles a day for
                    // it to be true. Ranking and rendering are one quantity
                    // now, and the count is dropped rather than corrected: a
                    // 90-day accumulation printed beside a single-instant open
                    // count invites a division that is not a rate of anything.
                    const m = leaderRate(c);
                    if (!m || m.days === null) return null;
                    const pct = Math.round(Math.max(0, Math.min(1, m.rate)) * 100);
                    return (
                      <span className="text-[11px] text-success font-semibold shrink-0">
                        up to {pct}% came down within {FILL_HORIZON_DAYS}d, in {m.days}d tracked
                      </span>
                    );
                  })()}
                  <span className="text-[11px] text-muted-foreground shrink-0 w-24 text-right">{c.open_roles} open now</span>
                </Link>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Ranked by the share of each employer's own roles — dated by the employer — that came off the board
              within {FILL_HORIZON_DAYS} days and did not come back, with a role that returns counted as a
              re-listing rather than a fill and roles still up counted as unfinished rather than dropped. That is
              one question over one horizon for every row, which a count of takedowns divided by roles open today
              is not: that ratio is unbounded, has a different denominator for every company, and was putting a
              50-day row beside an 11-day one as though their counts were comparable. Boards where fewer than{" "}
              {Math.round(FILL_COVERAGE_QUALIFY * 100)}% of roles carry a company-stated date, or that we have
              watched for fewer than {FILL_RATE_MIN_TRACKING_DAYS} days, or whose sample is too thin to give a
              stable estimate, are not ranked on a fill claim at all. Each is re-read through the same feed-dark
              guard the field figures use, so a board that answered with a near-empty feed is not credited with
              taking its whole board down in one second. Every figure reads “up to”: our collector records only
              the first re-listing of a title per day and discards the rest, so re-listings we never saw are
              missing from the pool the share is computed over. It is a share, not a duration — nothing here
              claims how fast those roles moved. And the exclusion this list cannot show you: a board too
              big for us to read in one visit produces no observable closure at all until we complete a
              provable full pass over it, so the largest paginated employers on the board — several of them
              with thousands of open roles — are absent from this ranking by construction rather than by
              inactivity. The heading says “Actively hiring”, and here that means exactly one observed thing:
              roles we watched taken down and not re-listed. A takedown is not a hire — a filled role, a
              cancelled one and a withdrawn one look identical from here — and how many new roles an employer
              is posting is not yet part of this ranking; that joins once we hold enough days of our own
              counts. Until then the employers above are the ones whose takedowns we could see, not the ones
              hiring most.
            </p>
          </div>
        )}

        {/* HOW FAST ROLES COME DOWN, BY FIELD — the fill curve, not a median.
            This slot used to hold "Fastest measured fills": a per-employer
            median over roles that had stood at least seven days, measured from
            the employer's stated date OR from our own first sighting where the
            employer stated none. Three defects in one list. The seven-day floor
            deleted the fast fills the ranking claimed to find. The coalesced
            origin meant a role that had been up for two months before we found
            it read as newborn. And roles that outlived our 30-day cap left the
            sample entirely instead of counting as unfinished, so the slowest
            employers looked fastest.
            What is published now is R(14) from the Aalen-Johansen cumulative
            incidence: of the roles a field posted, the share taken down for
            good by day 14, with re-listings held out as a competing event —
            so the figure is the fill arm alone, strictly smaller than the
            share that left the board — and with roles still up, and roles that
            passed the cap, counted as unfinished rather than dropped. Every row states its own interval,
            its own sample, and the share of that field's roles that carry a
            company-stated posting date. Rows the estimator cannot stand behind
            are not shown at all. */}
        {shownCurve.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Briefcase className="w-4 h-4 text-primary" /> How often roles are actually filled, by field
            </h2>
            {/* WHICH LISTED FIELDS HAVE NO DAY-30 LINE, said once, and only
                when the RPC carried the columns that decide it. The count and
                the names are the rows day30Reading returned null for: the
                gate admitted no board we read to the end, or too few of the
                field's roles reached the cap on the ones it did. */}
            {day30Unread.length > 0 && (
              <p className="text-[11px] text-muted-foreground mb-2">
                {t("ghostIndex.stillUp30Unread",
                  "{{n}} of the fields listed here — {{fields}} — have no reading of the share still advertised at our 30-day cap: on the boards we can read to the end, too few of their dated roles reached the cap for a share we would stand behind.",
                  { n: day30Unread.length, fields: day30Unread.join(", ") })}
              </p>
            )}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {[...day30Rows]
                .sort((x, y) => y.r.fill_rate_14 - x.r.fill_rate_14)
                .map(({ r, d }, i) => (
                  <div key={r.category} className={i > 0 ? "border-t border-border/60" : ""}>
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium text-foreground truncate">{r.category.replace(/_/g, " ")}</span>
                    {/* R(14), NOT 1 − S(14). This prints the cumulative
                        incidence of a FILL, with same-title re-listings held
                        out as a competing event — so it is strictly smaller
                        than the share of roles that left the board, by exactly
                        the relist rate. "down by day 14" named the composite
                        and published the component: a field with R(14) = 0.30
                        and X(14) = 0.25 had 55% of its roles off the board and
                        this said 30%. The share that left is 1 − still_open_14
                        and is stated in the caption; the number here is the
                        one that means a job was actually filled. */}
                    <span className="text-[11px] text-success font-semibold shrink-0">
                      {Math.round(r.fill_rate_14 * 100)}% filled by day {FILL_HORIZON_DAYS}
                    </span>
                    {/* The competing event, rendered rather than fetched and
                        dropped. It is a FLOOR: the collector logs at most one
                        superseded closure per title per employer per day, so
                        the true recycling share is at least this. Without it
                        on screen the reader has no way to see that the fill
                        figure beside it is the smaller half of what left. */}
                    <span className="text-[11px] text-muted-foreground shrink-0 w-16 text-right hidden sm:inline">
                      ≥{Math.round(r.relist_rate_14 * 100)}% re-listed
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0 w-32 text-right">
                      {Math.round(r.fill_rate_14_lo * 100)}–{Math.round(r.fill_rate_14_hi * 100)}% · {r.n_at_risk_14.toLocaleString()} tracked
                    </span>
                  </div>
                  {/* STILL ADVERTISED AT DAY 30 — S(30) with its interval,
                      R(30) as a ceiling and X(30) as a floor, drawn only when the row's
                      own sufficiency finding is true, which is the one thing
                      day30Reading checks. The cohort's edges are the row's:
                      the floor is the date our exit log began holding what
                      the estimator needs, and it retires itself as the window
                      moves, so a typed date here would go stale by itself.
                      ISO dates are printed as the RPC states them — parsing a
                      date-only string lands at UTC midnight and shifts a day
                      in every western timezone. */}
                  {d && (
                    <p className="px-4 pb-2.5 pl-12 text-[11px] text-muted-foreground -mt-1">
                      {t("ghostIndex.stillUp30Row",
                        "{{pct}}% of dated {{field}} roles posted {{cohortFrom}} to {{cohortTo}} were still advertised when they reached our 30-day cap (n={{n}}, ±{{hw}} points); at most {{r}}% had been taken down for good and at least {{x}}% re-listed. Counted only on boards we read to the end.",
                        { pct: d.pct, field: r.category.replace(/_/g, " "), cohortFrom: d.cohortFrom, cohortTo: d.cohortTo, n: d.n.toLocaleString(), hw: d.hw, r: d.r, x: d.x })}
                    </p>
                  )}
                  </div>
                ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Share of a field's roles <strong>taken down for good</strong> — down and not re-listed — within{" "}
              {FILL_HORIZON_DAYS} days of the date the company itself published, never our discovery date. A role that
              comes down and goes straight back up under the same title is counted as a re-listing, in the column
              beside it, and never as a fill; the two together are the share that left the board at all, and the fill
              figure alone is always the smaller of the two. Roles still up, and roles that passed our 30-day cap, are
              counted as unfinished rather than left out; leaving them out is what made the old figure come out the
              same in every field. The range beside each figure is a 95% interval from Greenwood's formula carried
              across by the observed fill share — an approximation, exact only where that share holds steady over the
              window. Fields whose record is too thin to stand behind, where fewer than{" "}
              {Math.round(FILL_COVERAGE_QUALIFY * 100)}% of roles carry a company-stated date, or where we have watched
              the field for fewer than {FILL_RATE_MIN_TRACKING_DAYS} days — too short a window to answer a{" "}
              {FILL_HORIZON_DAYS}-day question — are not listed.{" "}
              {/* BOTH CAPTIONS COUNT THE LISTED ROWS AND NOTHING ELSE. They
                  used to filter `fillCurve` on `sufficient` alone while the
                  table filtered on sufficiency AND coverage, so this sentence
                  could report "in 3 of these fields…" about three fields the
                  sentence above had just said were not listed. */}
              {/* WHAT median_censored MEASURES, said as measured. It is true
                  when R(30) — the share taken down for good by day 30 — is
                  below one half, so the median time to a fill is not reached
                  inside our record. It is NOT the share still advertised at
                  the cap: a field can have R(30) = 0.45 with 30% re-listed and
                  only 25% still up. That share is the day-30 line on each row
                  above, and it has its own name. */}
              {shownCurve.some((r) => r.median_censored) && (
                <>
                  In{" "}
                  <strong>{shownCurve.filter((r) => r.median_censored).length}</strong>{" "}
                  of the fields listed here fewer than half the roles we tracked had been taken down for good by day 30,
                  so there is no typical time to a fill to give for them — only "more than 30 days", which is where our
                  own record ends.{" "}
                </>
              )}
              {shownCurve.some((r) => r.dated_coverage < FILL_COVERAGE_PLAIN) && (
                <>
                  Some fields listed here state a posting date on well under all of their roles; the figure speaks only
                  for the share that do.{" "}
                </>
              )}
              Measured from our own lifecycle log over the last {shownCurve[0]?.window_days ?? 90} days — never an estimate.
            </p>
          </div>
        )}

        {/* Methodology */}
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-success" /> How we measure it
          </h2>
          <ul className="text-[13px] text-muted-foreground space-y-1.5">
            <li>· Every posting is pulled straight from a company's official applicant-tracking feed — never an aggregator or a scraped copy.</li>
            <li>· Any role whose <em>stated</em> posting date passes 30 days is automatically dropped, so dated ghost/pipeline postings other boards leave up for months never appear. Postings whose company publishes no date cannot be judged old — those we keep, and they show no age rather than a guessed one.</li>
            <li>· When a company removes a role, it disappears here within one refresh cycle — and we log the closure, which is how the "actually fills roles" figures are built.</li>
            <li>· Every posting is re-checked live the moment you click Apply.</li>
          </ul>
          {/* Date-provenance table: which hiring systems state their own post
              dates, measured live from the corpus. Undated postings never show
              an age here — and the "posted today / this week" filters cover
              only the date-stating share below. Saying so IS the feature. */}
          {dateCov.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] font-semibold text-foreground mb-1.5">Which postings carry a real posted date?</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Only dates companies state themselves count — we never invent one from when we first saw a posting.
                Postings without a stated date show no age anywhere on the board, and date filters simply don't include them.
              </p>
              <div className="overflow-x-auto">
                <table className="text-[12px] text-muted-foreground w-full max-w-md">
                  <thead>
                    <tr className="text-left border-b border-border/60">
                      <th className="py-1 pr-4 font-medium">Hiring system</th>
                      <th className="py-1 pr-4 font-medium text-right">Open postings</th>
                      <th className="py-1 font-medium text-right">State a post date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dateCov.map((r) => (
                      <tr key={r.source} className="border-b border-border/30 last:border-0">
                        <td className="py-1 pr-4 capitalize text-foreground">{r.source}</td>
                        <td className="py-1 pr-4 text-right">{r.total.toLocaleString()}</td>
                        <td className="py-1 text-right">{Math.round(r.datedPct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-4">
            <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              Browse the live board →
            </Link>
            <Link to="/entry-level-index" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              The Entry-Level Index
            </Link>
            <Link to="/hiring-trends" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              Weekly hiring trends
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
