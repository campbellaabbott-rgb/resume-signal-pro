import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE ESTIMATOR THAT MUST AGREE WITH ARITHMETIC.
 *
 * WHAT BROKE. `get_category_fill_speed` published a median_days_open between
 * 14.9 and 16.3 days for all eighteen categories over ~600k closures. Nursing,
 * securities law, retail and ML research agreed to within 1.4 days. At those
 * sample sizes the standard error on each median is well under a day, so the
 * agreement was not noise: the observable support was [7, 30] days BY
 * CONSTRUCTION. The ingest ages a posting out at FRESH_WINDOW_DAYS = 30, and
 * every fill surface then filtered `closed_at - origin >= interval '7 days'`.
 * A median drawn from [7, 30] lands near 15 whatever employers do. We were
 * publishing half of our own retention cap and calling it time-to-fill. The
 * denominator flaw showed in the open: get_company_hiring_health('gici~wd5~
 * Careers') returned closed_90d = 41 beside median_days_to_close = null, a
 * count and a median computed over different populations and rendered as one
 * fact.
 *
 * WHY THE OBVIOUS FIX IS NOT THE FIX. Deleting the 7-day floor and widening the
 * window does not help: roles that never closed are still ABSENT from the
 * estimator rather than censored in it, and long-running roles are exactly the
 * ones most likely to be absent. That is truncation, not censoring, and
 * truncation biases the centre downward without widening any interval to warn
 * you. Nor is a plain Kaplan-Meier the fix: a relist is evidence the role did
 * NOT fill, so censoring it asserts it would have filled at the same rate as
 * everything still at risk, which is exactly backwards. The estimator has to be
 * Aalen-Johansen cumulative incidence with relist as a COMPETING event.
 *
 * WHY THIS GUARD EXISTS AT ALL. The estimator ships as SQL and there is no
 * local Postgres and no service key anywhere in CI, so the SQL cannot be
 * executed here or anywhere else before production. Its arithmetic is otherwise
 * unverified until it is serving numbers to readers. This file therefore
 * carries a pure-TypeScript REFERENCE IMPLEMENTATION of the estimator, checked
 * against synthetic datasets whose answers are worked out by hand in the
 * comments beside them, and then asserts that the shipped SQL mirrors that
 * reference clause by clause.
 *
 * THE PROPERTY THIS GUARD STATES. (1) The reference agrees with hand
 * arithmetic, including at every degenerate boundary: R + X + S = 1, the
 * censored-at-t_j convention, the genuine lag, the ln(0) clamp, the median that
 * must not be manufactured, and the sufficiency gate at its exact thresholds.
 * (2) The SQL spells the same estimator: the lag, the GREATEST clamp, the
 * DESC-ordered risk set, +1.96 as the LOWER bound on S, no coalesced origin
 * inside a duration, and no 7-day floor.
 *
 * COMMENT-STRIPPED FOR CODE, RAW FOR PROSE. This repo has been bitten seven
 * times by a guard that passed because the spelling it pinned appeared in a
 * COMMENT while the code beneath it was dead or wrong. Every assertion about
 * what the SQL DOES runs against CODE (comments removed); assertions about what
 * the SQL SAYS run against RAW. The "has teeth" block below proves each check
 * fires against the pre-fix spelling, and proves the comment-stripping matters
 * by feeding it a fixture whose only correct spelling is inside a comment.
 */

// ---------------------------------------------------------------------------
// THE REFERENCE IMPLEMENTATION
//
// Transcribed from the frozen contract. Observation rows carry a whole-day time
// and exactly one of three roles:
//   fill   -> event of interest
//   relist -> competing event
//   censor -> age-out (CAP) or still-live (LIVE); removed from the risk set
//             AFTER t_j, so it is at risk AT t_j
// Rows with t < 0 are dropped.
// ---------------------------------------------------------------------------

type Ev = "fill" | "relist" | "censor";
type Obs = { t: number; ev: Ev };

/** One distinct observation day, with everything the contract computes there. */
type Row = {
  t: number;
  dFill: number;
  dRelist: number;
  cnt: number;
  /** d_j = d_fill_j + d_relist_j */
  d: number;
  /** n_j = observations with t >= t_j; censored-at-t_j COUNT as at risk. */
  n: number;
  /** S(t_j), event-free survival for both competing causes. */
  s: number;
  /** S(t_{j-1}); 1.0 before the first observation day. */
  sPrev: number;
  /** Greenwood running sum; null while every summand so far has been skipped. */
  gw: number | null;
  /** R(t_j), the fill cumulative incidence. */
  r: number;
  /** X(t_j), the relist cumulative incidence. */
  x: number;
};

/**
 * The clamp is required, not defensive. When every remaining observation has an
 * event on the same day, d_j = n_j, the factor is 0, ln(0) is -Infinity and the
 * whole row comes back NULL in SQL -- silently, as an absence rather than an
 * error. Clamping the factor at 1e-12 keeps S finite and negligible. Its only
 * cost is that R + X + S is off by S_{j-1} * 1e-12 in that degenerate case.
 */
const LN_CLAMP = 1e-12;

function buildCurve(obs: Obs[]): Row[] {
  const kept = obs.filter((o) => o.t >= 0);
  const days = [...new Set(kept.map((o) => o.t))].sort((a, b) => a - b);

  const grouped = days.map((t) => {
    const at = kept.filter((o) => o.t === t);
    const dFill = at.filter((o) => o.ev === "fill").length;
    const dRelist = at.filter((o) => o.ev === "relist").length;
    return { t, dFill, dRelist, cnt: at.length, d: dFill + dRelist };
  });

  // n_j = sum(cnt) OVER (ORDER BY t DESC ROWS UNBOUNDED PRECEDING) -- the
  // descending cumulative count, so a row censored at t_j is still at risk at
  // t_j and leaves only afterwards.
  const nByIndex: number[] = new Array(grouped.length).fill(0);
  let running = 0;
  for (let i = grouped.length - 1; i >= 0; i--) {
    running += grouped[i].cnt;
    nByIndex[i] = running;
  }

  const rows: Row[] = [];
  let lnAcc = 0;
  let gwAcc: number | null = null;
  let rAcc = 0;
  let xAcc = 0;
  let sPrev = 1.0;

  grouped.forEach((g, i) => {
    const n = nByIndex[i];
    // R and X accrue with S(t_{j-1}), NOT S(t_j). Using S(t_j) is the silent
    // botch: it multiplies in this day's own drop twice.
    rAcc += (sPrev * g.dFill) / n;
    xAcc += (sPrev * g.dRelist) / n;

    lnAcc += Math.log(Math.max(1 - g.d / n, LN_CLAMP));
    const s = Math.exp(lnAcc);

    // Greenwood's summand divides by (n_j - d_j) and is NULL at n_j = d_j;
    // SQL's sum() skips NULLs, so the variance is understated in exactly that
    // case -- where S is already ~0 and the interval has collapsed anyway.
    if (n - g.d !== 0) gwAcc = (gwAcc ?? 0) + g.d / (n * (n - g.d));

    rows.push({ ...g, n, s, sPrev, gw: gwAcc, r: rAcc, x: xAcc });
    sPrev = s;
  });

  return rows;
}

/**
 * R and X are non-decreasing and S is non-increasing, so max/max/min over
 * t <= h all read the same row -- the last observation day at or before h --
 * and the three published values stay mutually consistent.
 */
function at(rows: Row[], h: number) {
  const upto = rows.filter((r) => r.t <= h);
  const gws = upto.map((r) => r.gw).filter((g): g is number => g !== null);
  return {
    r: upto.length ? Math.max(...upto.map((x) => x.r)) : 0,
    x: upto.length ? Math.max(...upto.map((x) => x.x)) : 0,
    s: upto.length ? Math.min(...upto.map((x) => x.s)) : 1,
    gw: gws.length ? Math.max(...gws) : 0,
    fills: upto.reduce((a, x) => a + x.dFill, 0),
    relists: upto.reduce((a, x) => a + x.dRelist, 0),
  };
}

/** n_at_risk_14: observations with t >= 14. */
function nAtRisk(rows: Row[], h: number): number {
  return rows.filter((r) => r.t >= h).reduce((a, r) => a + r.cnt, 0);
}

/**
 * Greenwood on the complementary log-log scale, which stays inside [0,1] at
 * small n. S^a is DECREASING in a for 0 < S < 1 and exp(+1.96*sqrt(v)) > 1, so
 * the +1.96 branch is the LOWER bound on S. Writing it the other way round
 * produces an inverted interval that still looks plausible.
 */
function survivalBand(s14: number, gw14: number) {
  const v = s14 >= 1 || s14 <= 0 ? 0 : Math.min(gw14 / (Math.log(s14) * Math.log(s14)), 4.0);
  if (v <= 0) return { v, sLo: s14, sHi: s14 };
  return {
    v,
    sLo: Math.pow(s14, Math.min(Math.exp(1.96 * Math.sqrt(v)), 50.0)),
    sHi: Math.pow(s14, Math.max(Math.exp(-1.96 * Math.sqrt(v)), 0.02)),
  };
}

const clamp01 = (v: number) => Math.max(Math.min(v, 1), 0);

/**
 * The interval on R(14), carried across from S by the observed fill share.
 * THIS IS AN APPROXIMATION. It is exact only when the fill share is constant in
 * t, because then R(t) = f * (1 - S(t)) identically. It is the authorised
 * replacement for the withdrawn nightly bootstrap rollup and must be published
 * as an approximation, never as an exact Aalen-Johansen interval.
 */
function fillBand(fills14: number, relists14: number, sLo: number, sHi: number) {
  const denom = fills14 + relists14;
  const fshare = denom === 0 ? 0 : fills14 / denom;
  return { fshare, rLo: clamp01(fshare * (1 - sHi)), rHi: clamp01(fshare * (1 - sLo)) };
}

/**
 * TWO MEDIAN RULES, DELIBERATELY BOTH IMPLEMENTED.
 *
 * "survival" is the frozen contract's rule, min{t <= 30 : S(t) <= 0.5}.
 * "cif" is what actually shipped, min{t <= 30 : R(t) >= 0.5}, and the migration
 * headers argue the deviation: S falls on relists as well as fills, so the
 * survival form publishes a short "fill median" beside a low fill rate -- the
 * manufactured median this whole change exists to delete, rebuilt one layer up.
 * Both are here so the difference is a tested fact rather than a claim, and so
 * the SQL mirror below can pin WHICH one ships.
 *
 * Neither rule ever interpolates, and neither ever looks past day 30.
 */
function median(rows: Row[], rule: "cif" | "survival"): number | null {
  const hit = rows.find((r) => r.t <= 30 && (rule === "cif" ? r.r >= 0.5 : r.s <= 0.5));
  return hit ? hit.t : null;
}

/**
 * The honesty gate. `withRelistClause` is the fourth condition the shipped SQL
 * added on top of the contract's three: observed relists at or before day 14
 * must not outnumber observed fills there. It is a partial guard against the
 * collector's relist dedupe -- which DELETES deduped relists rather than
 * logging them, making fill_rate_14 an upper bound -- and not a fix.
 *
 * dated_coverage is deliberately NOT an input: it is returned separately and
 * banded by the caller (>=0.60 plain, 0.30-0.60 qualified, <0.30 suppressed).
 */
function sufficient(
  g: { nAtRisk14: number; fills14: number; relists14: number; rLo: number; rHi: number },
  withRelistClause = true,
): boolean {
  const base = g.nAtRisk14 >= 25 && g.fills14 >= 5 && (g.rHi - g.rLo) / 2 <= 0.15;
  return withRelistClause ? base && g.relists14 <= g.fills14 : base;
}

/** dated / (dated + undated); NULL when the employer has no observations. */
function datedCoverage(dated: number, undated: number): number | null {
  return dated + undated === 0 ? null : dated / (dated + undated);
}

/** The whole estimate, as one call, for the datasets below. */
function estimate(obs: Obs[], rule: "cif" | "survival" = "cif") {
  const rows = buildCurve(obs);
  const h14 = at(rows, 14);
  const band = survivalBand(h14.s, h14.gw);
  const fb = fillBand(h14.fills, h14.relists, band.sLo, band.sHi);
  const med = median(rows, rule);
  const gate = {
    nAtRisk14: nAtRisk(rows, 14),
    fills14: h14.fills,
    relists14: h14.relists,
    rLo: fb.rLo,
    rHi: fb.rHi,
  };
  return {
    rows,
    fillRate14: h14.r,
    relistRate14: h14.x,
    stillOpen14: h14.s,
    fillRate7: at(rows, 7).r,
    fillRate30: at(rows, 30).r,
    ...band,
    ...fb,
    ...gate,
    medianDaysToFill: med,
    medianCensored: med === null,
    sufficient: sufficient(gate),
  };
}

/**
 * The specific way this estimator gets silently botched: 1 - Kaplan-Meier with
 * relists treated as ORDINARY CENSORING. It is not part of the estimator. It
 * exists here only so a dataset can prove the reference does NOT return it.
 */
function oneMinusKmTreatingRelistsAsCensored(obs: Obs[], h: number): number {
  const kept = obs.filter((o) => o.t >= 0);
  const days = [...new Set(kept.map((o) => o.t))].sort((a, b) => a - b);
  let s = 1;
  for (const t of days) {
    if (t > h) break;
    const dFill = kept.filter((o) => o.t === t && o.ev === "fill").length;
    const n = kept.filter((o) => o.t >= t).length;
    s *= 1 - dFill / n;
  }
  return 1 - s;
}

const rep = (n: number, t: number, ev: Ev): Obs[] => Array.from({ length: n }, () => ({ t, ev }));
const near = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThan(eps);

// ---------------------------------------------------------------------------
// PART ONE: the reference against arithmetic worked out by hand.
// ---------------------------------------------------------------------------

describe("the reference estimator agrees with hand arithmetic", () => {
  /**
   * DATASET A -- all four observation types present.
   *
   *   t=5   2 FILL, 1 RELIST                 cnt 3, d 3
   *   t=10  1 FILL, 1 CAP (age-out censor)   cnt 2, d 1
   *   t=20  2 LIVE (still-open censor)       cnt 2, d 0
   *
   * Risk sets, descending cumulative:  n(20)=2, n(10)=2+2=4, n(5)=3+4=7.
   *
   *   S(5)  = 1 - 3/7            = 4/7
   *   R(5)  = 1 * 2/7            = 2/7
   *   X(5)  = 1 * 1/7            = 1/7        2/7 + 1/7 + 4/7 = 1
   *
   *   S(10) = 4/7 * (1 - 1/4)    = 3/7
   *   R(10) = 2/7 + (4/7)*(1/4)  = 3/7
   *   X(10) = 1/7                             3/7 + 1/7 + 3/7 = 1
   *
   *   S(20) = 3/7 (no events),   R(20)=3/7, X(20)=1/7
   */
  const A: Obs[] = [
    ...rep(2, 5, "fill"),
    ...rep(1, 5, "relist"),
    ...rep(1, 10, "fill"),
    ...rep(1, 10, "censor"),
    ...rep(2, 20, "censor"),
  ];

  it("computes S, R and X by hand on a dataset with fills, relists, caps and live roles", () => {
    const rows = buildCurve(A);
    expect(rows.map((r) => r.t)).toEqual([5, 10, 20]);
    expect(rows.map((r) => r.n)).toEqual([7, 4, 2]);
    expect(rows.map((r) => r.d)).toEqual([3, 1, 0]);

    near(rows[0].s, 4 / 7);
    near(rows[0].r, 2 / 7);
    near(rows[0].x, 1 / 7);

    near(rows[1].s, 3 / 7);
    near(rows[1].r, 3 / 7);
    near(rows[1].x, 1 / 7);

    near(rows[2].s, 3 / 7);
    near(rows[2].r, 3 / 7);
  });

  it("holds R(t) + X(t) + S(t) = 1 at every t, which is the property the old model lacked", () => {
    // Checked at the event days and between them, including before any event
    // (t=0, where R=X=0 and S=1) and past the last one.
    for (const t of [0, 4, 5, 7, 9, 10, 14, 19, 20, 30]) {
      const h = at(buildCurve(A), t);
      near(h.r + h.x + h.s, 1, 1e-12);
    }
  });

  it("R(t) is NOT 1 - S(t): the relist arm is a competing event, not part of the fill arm", () => {
    const h = at(buildCurve(A), 10);
    near(h.r, 3 / 7);
    near(1 - h.s, 4 / 7); // what a one-minus-survival reading would publish
    expect(h.r).not.toBeCloseTo(1 - h.s, 6);
  });

  /**
   * DATASET B -- 1-KM and Aalen-Johansen DIFFER. This is the specific way the
   * estimator gets silently botched, so the reference has to land on the AJ
   * value and not on either near-miss.
   *
   *   t=1   1 FILL, 8 RELIST      cnt 9
   *   t=2   1 FILL                cnt 1
   *   t=10  10 LIVE censor        cnt 10
   *
   * n(10)=10, n(2)=11, n(1)=20.
   *
   *   AJ:   S(1) = 1 - 9/20 = 0.55
   *         R(1) = 1/20 = 0.05,  X(1) = 8/20 = 0.40      sum with S = 1
   *         S(2) = 0.55 * (1 - 1/11) = 0.50
   *         R(2) = 0.05 + 0.55*(1/11) = 0.10,  X(2) = 0.40   sum = 1
   *
   *   1-KM with relists censored:
   *         S_km(1) = 1 - 1/20 = 0.95
   *         S_km(2) = 0.95 * (1 - 1/11) = 0.8636...
   *         1 - S_km(2) = 0.13636...     <-- 36% too high
   *
   *   1 - S_AJ(2) = 0.50                 <-- five times too high
   *
   * Three different numbers. Only 0.10 is the fill rate.
   */
  const B: Obs[] = [
    ...rep(1, 1, "fill"),
    ...rep(8, 1, "relist"),
    ...rep(1, 2, "fill"),
    ...rep(10, 10, "censor"),
  ];

  it("returns the Aalen-Johansen value where 1-KM and 1-S both differ from it", () => {
    const h = at(buildCurve(B), 2);
    near(h.r, 0.1, 1e-12);
    near(h.x, 0.4, 1e-12);
    near(h.s, 0.5, 1e-12);
    near(h.r + h.x + h.s, 1, 1e-12);

    const km = oneMinusKmTreatingRelistsAsCensored(B, 2);
    expect(km).toBeCloseTo(0.13636363, 7);
    expect(h.r).toBeLessThan(km); // censoring a relist assumes it would have filled
    expect(h.r).toBeLessThan(1 - h.s);
  });

  /**
   * DATASET C -- censored-at-t_j observations are AT RISK at t_j.
   *
   *   t=3   1 FILL and 4 censors, all on the same day.  cnt 5, d 1, n 5
   *   S(3) = 1 - 1/5 = 0.8,  R(3) = 0.2
   *
   * If censored rows at t_j were excluded from n_j, n would be 1, S would be 0
   * and R would be 1.0 -- an employer that filled one role in five reported as
   * having filled everything.
   */
  it("counts censored-at-t_j observations inside the risk set at t_j", () => {
    const C: Obs[] = [...rep(1, 3, "fill"), ...rep(4, 3, "censor")];
    const rows = buildCurve(C);
    expect(rows[0].n).toBe(5);
    near(rows[0].s, 0.8);
    near(rows[0].r, 0.2);
    expect(rows[0].r).not.toBeCloseTo(1.0, 6);
  });

  /**
   * S(t_{j-1}) IS GENUINELY LAGGED. On dataset A the day-10 increment is
   * S(5)*(1/4) = (4/7)/4 = 1/7, giving R(10) = 3/7 = 0.428571...
   * Using S(10) instead gives 2/7 + (3/7)/4 = 11/28 = 0.392857..., which is
   * wrong by 8% and looks entirely reasonable on a chart.
   */
  it("accrues each increment with S(t_{j-1}) and not with S(t_j)", () => {
    const rows = buildCurve(A);
    expect(rows[0].sPrev).toBe(1.0);
    near(rows[1].sPrev, 4 / 7);
    near(rows[2].sPrev, 3 / 7);

    near(rows[1].r, 3 / 7);
    const botched = 2 / 7 + (3 / 7) * (1 / 4);
    expect(botched).toBeCloseTo(0.39285714, 7);
    expect(rows[1].r).not.toBeCloseTo(botched, 6);
  });

  /**
   * DATASET E -- n_j = d_j, the ln(0) case. Three fills on day 4 and nothing
   * else: the factor is 1 - 3/3 = 0, ln(0) = -Infinity, and without the clamp
   * S is NaN/-Infinity and the entire row NULLs out in SQL, silently.
   */
  it("survives n_j = d_j through the 1e-12 clamp instead of NULLing the row", () => {
    const E: Obs[] = rep(3, 4, "fill");
    const rows = buildCurve(E);
    expect(rows[0].n).toBe(3);
    expect(rows[0].d).toBe(3);
    expect(Number.isFinite(rows[0].s)).toBe(true);
    near(rows[0].s, LN_CLAMP, 1e-18);
    near(rows[0].r, 1.0);
    // The documented cost of the clamp: the identity is off by S_prev * 1e-12.
    near(rows[0].r + rows[0].x + rows[0].s, 1, 1e-11);
    expect(rows[0].r + rows[0].x + rows[0].s).toBeGreaterThan(1);
    // Greenwood's summand is skipped there, so gw stays null rather than Inf.
    expect(rows[0].gw).toBeNull();
    expect(survivalBand(rows[0].s, 0).v).toBe(0);
  });

  it("handles zero observations, one event, all-censored and no dated postings", () => {
    // No observations at all: nothing published, nothing asserted, not
    // sufficient. In particular fill_rate_14 is 0 and still_open_14 is 1 rather
    // than NULL-shaped nonsense.
    const empty = estimate([]);
    expect(empty.rows).toEqual([]);
    expect(empty.fillRate14).toBe(0);
    expect(empty.relistRate14).toBe(0);
    expect(empty.stillOpen14).toBe(1);
    expect(empty.nAtRisk14).toBe(0);
    expect(empty.medianDaysToFill).toBeNull();
    expect(empty.sufficient).toBe(false);

    // One event, alone. n=1, d=1 -- the clamp again, at the smallest sample
    // that can reach it.
    const one = estimate([{ t: 6, ev: "fill" }]);
    near(one.fillRate14, 1.0);
    expect(one.sufficient).toBe(false); // fills14 = 1 < 5

    // All censored: no events anywhere, so S stays 1 and both incidences stay
    // 0. This is the "we have tracked this board and nothing has resolved"
    // case, and it must not read as a fill rate of anything.
    const allCensored = estimate(rep(40, 9, "censor"));
    expect(allCensored.fillRate14).toBe(0);
    expect(allCensored.relistRate14).toBe(0);
    expect(allCensored.stillOpen14).toBe(1);
    expect(allCensored.medianDaysToFill).toBeNull();
    expect(allCensored.medianCensored).toBe(true);
    expect(allCensored.sufficient).toBe(false);

    // No dated postings: durations have no cohort at all, and coverage is NULL
    // rather than 0 or 1. Origin is the employer's stated posted_at ALONE --
    // coalescing it with first_seen is the failure this change exists to
    // remove, so an undated board contributes to counts and to nothing else.
    expect(datedCoverage(0, 0)).toBeNull();
    expect(datedCoverage(0, 120)).toBe(0);
    expect(datedCoverage(30, 20)).toBeCloseTo(0.6, 12);
    expect(estimate([]).fillRate14).toBe(0);
  });

  it("keeps the complementary log-log interval inside [0,1] with +1.96 as the LOWER bound", () => {
    // s14 = 0.5, gw = 0.02 -> v = 0.02 / (ln 0.5)^2 = 0.0416...
    const b = survivalBand(0.5, 0.02);
    expect(b.sLo).toBeLessThan(0.5);
    expect(b.sHi).toBeGreaterThan(0.5);
    expect(b.sLo).toBeGreaterThan(0);
    expect(b.sHi).toBeLessThan(1);
    // The sign trap: S^a is DECREASING in a, so exp(+1.96*sqrt(v)) > 1 gives the
    // LOWER bound. Getting it backwards yields an inverted but plausible band.
    expect(Math.exp(1.96 * Math.sqrt(b.v))).toBeGreaterThan(1);

    // Carried across to R by the observed fill share; ordering must survive.
    const fb = fillBand(30, 10, b.sLo, b.sHi);
    expect(fb.fshare).toBeCloseTo(0.75, 12);
    expect(fb.rLo).toBeLessThan(fb.rHi);
    expect(fb.rLo).toBeGreaterThanOrEqual(0);
    expect(fb.rHi).toBeLessThanOrEqual(1);
    // With no observed events at all the share is 0 and the band collapses to
    // [0,0] rather than to a confident [1,1].
    const none = fillBand(0, 0, 0.2, 0.9);
    expect(none.fshare).toBe(0);
    expect(none.rLo).toBe(0);
    expect(none.rHi).toBe(0);
  });
});

describe("the median is never manufactured from a window that cannot hold one", () => {
  /**
   * DATASET G -- one fill in ten, everything else censored at day 20.
   *   n(5)=10, S(5)=0.9, R(5)=0.1; n(20)=9, no events.
   * S(30) = 0.9 > 0.5 and R(30) = 0.1 < 0.5, so NEITHER rule yields a median.
   * The honest output is "> 30 days", never a number.
   */
  const G: Obs[] = [...rep(1, 5, "fill"), ...rep(9, 20, "censor")];

  it("returns NULL when S(30) > 0.5 -- the headline bug, stated as a property", () => {
    const rows = buildCurve(G);
    near(at(rows, 30).s, 0.9);
    expect(median(rows, "survival")).toBeNull();
    expect(median(rows, "cif")).toBeNull();
    expect(estimate(G).medianCensored).toBe(true);
  });

  it("returns the day when the threshold is genuinely reached inside the window", () => {
    // 6 fills of 10 on day 3: S(3) = 0.4 <= 0.5 and R(3) = 0.6 >= 0.5, so both
    // rules return 3, and neither interpolates to a fractional day.
    const H: Obs[] = [...rep(6, 3, "fill"), ...rep(4, 20, "censor")];
    const rows = buildCurve(H);
    near(rows[0].s, 0.4);
    near(rows[0].r, 0.6);
    expect(median(rows, "survival")).toBe(3);
    expect(median(rows, "cif")).toBe(3);
    expect(Number.isInteger(median(rows, "cif") as number)).toBe(true);
  });

  it("never looks past day 30 even when the threshold is crossed at day 31", () => {
    const late: Obs[] = rep(5, 31, "fill");
    const rows = buildCurve(late);
    near(rows[0].r, 1.0);
    expect(median(rows, "cif")).toBeNull();
    expect(median(rows, "survival")).toBeNull();
  });

  /**
   * THE DEVIATION FROM THE FROZEN CONTRACT, PINNED AS A NUMBER.
   *
   * Dataset B again: 1 fill and 8 relists on day 1, 1 fill on day 2, 10 live.
   * S(2) = 0.50, so the contract's survival rule returns a "median days to
   * fill" of 2 -- for an employer whose fill rate at day 14 is 0.10. The CIF
   * rule returns NULL, because the fill incidence never reaches one half.
   *
   * The shipped SQL uses the CIF rule and argues the deviation in its header.
   * This test is what makes the difference a fact instead of an argument, and
   * the SQL mirror below pins which of the two is actually in the file.
   */
  it("shows why the shipped CIF median differs from the contract's survival median", () => {
    const B: Obs[] = [
      ...rep(1, 1, "fill"),
      ...rep(8, 1, "relist"),
      ...rep(1, 2, "fill"),
      ...rep(10, 10, "censor"),
    ];
    const rows = buildCurve(B);
    near(at(rows, 14).r, 0.1, 1e-12);
    expect(median(rows, "survival")).toBe(2);
    expect(median(rows, "cif")).toBeNull();
  });
});

describe("the sufficiency gate at its exact boundaries", () => {
  // Half-width is (rHi - rLo) / 2. rLo = 0 and rHi = 0.3 is exactly 0.15 in
  // IEEE754; rHi = 0.302 is exactly 0.151. Both verified, so these boundaries
  // are real thresholds and not floating-point luck.
  const base = { nAtRisk14: 25, fills14: 5, relists14: 0, rLo: 0, rHi: 0.3 };

  it("passes at n=25, fills=5, half-width=0.15", () => {
    expect((base.rHi - base.rLo) / 2).toBe(0.15);
    expect(sufficient(base)).toBe(true);
  });

  it("fails at n=24 and passes at n=25", () => {
    expect(sufficient({ ...base, nAtRisk14: 24 })).toBe(false);
    expect(sufficient({ ...base, nAtRisk14: 25 })).toBe(true);
  });

  it("fails at fills=4 and passes at fills=5", () => {
    expect(sufficient({ ...base, fills14: 4 })).toBe(false);
    expect(sufficient({ ...base, fills14: 5 })).toBe(true);
  });

  it("passes at half-width 0.15 and fails at 0.151", () => {
    expect((0.302 - 0) / 2).toBe(0.151);
    expect(sufficient({ ...base, rHi: 0.3 })).toBe(true);
    expect(sufficient({ ...base, rHi: 0.302 })).toBe(false);
  });

  it("applies the shipped fourth clause: visible relists must not outnumber fills", () => {
    // The contract had three conditions. The SQL added a fourth as a partial
    // guard against the collector's relist dedupe, which DELETES deduped
    // relists rather than logging them and so biases fill_rate_14 upward.
    expect(sufficient({ ...base, relists14: 5 })).toBe(true);
    expect(sufficient({ ...base, relists14: 6 })).toBe(false);
    // Without the clause -- the frozen contract's own gate -- 6 relists pass.
    expect(sufficient({ ...base, relists14: 6 }, false)).toBe(true);
  });

  it("keeps dated_coverage out of the gate so the caller can band it", () => {
    // Coverage is returned separately: >=0.60 plain, 0.30-0.60 qualified,
    // <0.30 suppressed. Folding it into `sufficient` throws away the middle
    // case, where the number is sound and simply needs to name its population.
    expect(sufficient(base)).toBe(true);
    expect(datedCoverage(1, 99)).toBeCloseTo(0.01, 12);
    expect(sufficient(base)).toBe(true); // unchanged by any coverage figure
  });
});

// ---------------------------------------------------------------------------
// PART TWO: the shipped SQL must spell the same estimator.
//
// CODE assertions run against comment-stripped source, because a guard that
// pins a spelling and finds it in a COMMENT has no teeth. Prose assertions run
// against RAW.
// ---------------------------------------------------------------------------

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const COMPANY_SQL = "20260906091000_censoring_is_not_truncation.sql";
const CATEGORY_SQL = "20260906092000_a_median_from_a_window_that_cannot_hold_one.sql";

const readRaw = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");
const stripComments = (raw: string) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

/** The CASE arm that produces one bound, isolated from the arm beside it. */
function boundArm(code: string, marker: string): string {
  const end = code.indexOf(marker);
  if (end < 0) return "";
  const start = code.lastIndexOf("CASE WHEN", end);
  return start < 0 ? "" : code.slice(start, end);
}

/**
 * The `sufficient` boolean itself, extracted by walking back from `AS
 * sufficient` to the paren that opens it. A fixed-width slice was tried first
 * and read whatever column happened to sit above it, which is how a guard ends
 * up asserting something about its neighbour instead of its subject.
 */
function sufficientExpr(code: string): string {
  const marker = code.indexOf("AS sufficient");
  if (marker < 0) return "";
  const close = code.lastIndexOf(")", marker);
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === ")") depth++;
    else if (code[i] === "(") {
      depth--;
      if (depth === 0) return code.slice(i, close + 1);
    }
  }
  return "";
}

/**
 * Every mirror check in one place, returning the violations it found, so the
 * same function can be pointed at the real migrations (expecting none) and at
 * doctored pre-fix fixtures (expecting the specific ones). That is what makes
 * this guard provably able to fire.
 */
function mirrorViolations(code: string): string[] {
  const v: string[] = [];

  // S(t_{j-1}) genuinely lagged, defaulting to 1.0 before the first event day.
  if (!/lag\(\s*[\w.]+\s*,\s*1\s*,\s*1\.0\s*\)\s*OVER/.test(code)) v.push("lag");

  // The ln(0) clamp, without which n_j = d_j NULLs the whole row silently.
  if (!/ln\(\s*GREATEST\(\s*1\.0\s*-\s*[\w.]+\.d::numeric\s*\/\s*[\w.]+\.n\s*,\s*1e-12\s*\)\s*\)/.test(code))
    v.push("clamp");

  // n_j = sum(cnt) OVER (ORDER BY t DESC ...) -- censored-at-t_j at risk at t_j.
  if (
    !/sum\(\s*[\w.]+\.cnt\s*\)\s*OVER\s*\(\s*PARTITION BY [\w.]+\.(?:tok|cat)\s+ORDER BY [\w.]+\.tt DESC\s+ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/.test(
      code,
    )
  )
    v.push("risk-set-desc");

  // +1.96 is the LOWER bound on S; -1.96 is the upper.
  const lo = boundArm(code, "AS s_lo");
  const hi = boundArm(code, "AS s_hi");
  if (!lo || !/exp\(1\.96 \* sqrt\(/.test(lo) || /exp\(-1\.96/.test(lo)) v.push("s_lo-branch");
  if (!hi || !/exp\(-1\.96 \* sqrt\(/.test(hi)) v.push("s_hi-branch");

  // R and X accrue with s_prev, not with s.
  if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_fill::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(code))
    v.push("r-uses-s_prev");
  if (!/sum\(\s*[\w.]+\.s_prev \* [\w.]+\.d_relist::numeric \/ [\w.]+\.n\s*\)\s*OVER/.test(code))
    v.push("x-uses-s_prev");

  // The origin is never coalesced with our own first sighting inside a
  // duration. This is the exact failure the whole change exists to remove.
  if (/COALESCE\(\s*[\w.]*posted_at\s*,\s*[\w.]*first_seen\s*\)/i.test(code)) v.push("coalesced-origin");

  // The 7-day floor deleted exactly the fast fills.
  if (/interval\s+'7\s+days'/i.test(code)) v.push("seven-day-floor");

  // The median never leaves the observable window and is never interpolated.
  if (!/min\(\s*[\w.]+\.tt\s*\)\s*FILTER \(WHERE [\w.]+\.tt <= 30/.test(code)) v.push("median-horizon");

  return v;
}

describe("the shipped SQL mirrors the reference estimator", () => {
  for (const file of [COMPANY_SQL, CATEGORY_SQL]) {
    describe(file, () => {
      const RAW = readRaw(file);
      const CODE = stripComments(RAW);

      it("passes every mirror check against comment-stripped code", () => {
        expect(mirrorViolations(CODE), `${file} drifted from the reference estimator`).toEqual([]);
      });

      it("computes the median from the FILL incidence, the deviation the header argues", () => {
        // The frozen contract said min{t <= 30 : S(t) <= 0.5}. The SQL ships
        // min{t <= 30 : R(t) >= 0.5} because S falls on relists too, which
        // publishes a short fill median beside a low fill rate. If someone
        // flips it back silently, this fires.
        expect(CODE).toMatch(/min\([\w.]+\.tt\) FILTER \(WHERE [\w.]+\.tt <= 30 AND [\w.]+\.r_cif >= 0\.5\)/);
        expect(CODE).not.toMatch(/FILTER \(WHERE [\w.]+\.tt <= 30 AND [\w.]+\.s <= 0\.5\)/);
        expect(CODE).toMatch(/\(\s*[\w.]+\.med IS NULL\s*\)\s+AS median_censored|med IS NULL\)\s*AS median_censored/);
      });

      it("gates on the contract's three thresholds plus the shipped relist clause", () => {
        expect(CODE).toMatch(/n14, 0\) >= 25|n14 >= 25/);
        expect(CODE).toMatch(/fills14, 0\) >= 5|fills14 >= 5/);
        expect(CODE).toMatch(/\(\s*[\w.]+\.r_hi - [\w.]+\.r_lo\s*\)\s*\/\s*2 <= 0\.15/);
        expect(CODE).toMatch(/relists14, 0\) <= COALESCE\([\w.]+\.fills14, 0\)|relists14 <= [\w.]+\.fills14/);
        // dated_coverage is returned but is NOT part of the gate: folding
        // coverage into `sufficient` throws away the middle band, where the
        // estimate is sound and simply needs to name its population.
        expect(CODE).toMatch(/AS dated_coverage/);
        const gate = sufficientExpr(CODE);
        expect(gate, "the sufficient expression could not be located").not.toBe("");
        expect(gate).toMatch(/>= 25/);
        expect(gate).not.toMatch(/dated_coverage|d_n|u_n/);
      });

      it("publishes the interval as an approximation in its own COMMENT ON", () => {
        // Prose, so this one reads RAW. The closed form replaced a withdrawn
        // bootstrap rollup and is exact only if the fill share is constant in
        // t; presenting it as an exact Aalen-Johansen interval is the lie this
        // sentence prevents.
        const comment = RAW.slice(RAW.indexOf("COMMENT ON FUNCTION"));
        expect(comment).toMatch(/APPROXIMATION|approximation/);
        expect(comment).toMatch(/fill share/);
      });

      it("carries the interval across to R by the observed fill share, crossed over", () => {
        // The fill share may be a named column or inlined; what must not move
        // is the CROSSOVER. R_lo takes S_hi and R_hi takes S_lo, because R
        // rises as S falls. Getting that pair straight-through produces an
        // interval that is inverted and entirely plausible-looking.
        expect(CODE).toMatch(/fills14::numeric \/ NULLIF\([\w.]+\.fills14 \+ [\w.]+\.relists14, 0\)/);
        expect(CODE).toMatch(/\* \(1 - [\w.]+\.s_hi\)[\s\S]{0,30}AS r_lo/);
        expect(CODE).toMatch(/\* \(1 - [\w.]+\.s_lo\)[\s\S]{0,30}AS r_hi/);
        expect(CODE).not.toMatch(/\* \(1 - [\w.]+\.s_lo\)[\s\S]{0,30}AS r_lo/);
      });
    });
  }
});

describe("the mirror checks have teeth", () => {
  // Each fixture is the real estimator with ONE clause spelled the pre-fix way.
  // If a check cannot fire, it is decoration, and this repo has shipped
  // decoration seven times.
  const GOOD = `
    curve AS (
      SELECT a.tok, a.tt, a.d_fill, a.d_relist, a.cnt,
        (a.d_fill + a.d_relist) AS d,
        (sum(a.cnt) OVER (
          PARTITION BY a.tok ORDER BY a.tt DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ))::int AS n
      FROM agg a
    ),
    surv AS (
      SELECT c.*,
        exp(sum(ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))) OVER (
          PARTITION BY c.tok ORDER BY c.tt
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS s
      FROM curve c
    ),
    lagged AS (SELECT s.*, lag(s.s, 1, 1.0) OVER (PARTITION BY s.tok ORDER BY s.tt) AS s_prev FROM surv s),
    cum AS (
      SELECT l.*,
        sum(l.s_prev * l.d_fill::numeric / l.n) OVER (PARTITION BY l.tok ORDER BY l.tt) AS r_cif,
        sum(l.s_prev * l.d_relist::numeric / l.n) OVER (PARTITION BY l.tok ORDER BY l.tt) AS x_cif
      FROM lagged l
    ),
    at_h AS (SELECT c.tok, min(c.tt) FILTER (WHERE c.tt <= 30 AND c.r_cif >= 0.5) AS med FROM cum c GROUP BY c.tok),
    ci AS (
      SELECT b.*,
        CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ LEAST(exp(1.96 * sqrt(b.v)), 50.0) END AS s_lo,
        CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ GREATEST(exp(-1.96 * sqrt(b.v)), 0.02) END AS s_hi
      FROM band b
    )
  `;

  it("the fixture that mirrors the estimator reports no violations", () => {
    expect(mirrorViolations(GOOD)).toEqual([]);
  });

  it("fires when the lag default or the lag itself is dropped", () => {
    expect(mirrorViolations(GOOD.replace("lag(s.s, 1, 1.0)", "lag(s.s, 1, 0)"))).toContain("lag");
    expect(mirrorViolations(GOOD.replace("lag(s.s, 1, 1.0) OVER", "s.s OVER"))).toContain("lag");
  });

  it("fires when the ln(0) clamp is removed", () => {
    const noClamp = GOOD.replace("ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))", "ln(1.0 - c.d::numeric / c.n)");
    expect(mirrorViolations(noClamp)).toContain("clamp");
  });

  it("fires when the risk-set window loses its DESC ordering", () => {
    const asc = GOOD.replace("ORDER BY a.tt DESC", "ORDER BY a.tt");
    expect(mirrorViolations(asc)).toContain("risk-set-desc");
  });

  it("fires when the +/-1.96 branches are swapped, the inverted-but-plausible band", () => {
    const swapped = GOOD.replace(
      "CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ LEAST(exp(1.96 * sqrt(b.v)), 50.0) END AS s_lo,\n        CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ GREATEST(exp(-1.96 * sqrt(b.v)), 0.02) END AS s_hi",
      "CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ GREATEST(exp(-1.96 * sqrt(b.v)), 0.02) END AS s_lo,\n        CASE WHEN b.v <= 0 THEN b.s14 ELSE b.s14 ^ LEAST(exp(1.96 * sqrt(b.v)), 50.0) END AS s_hi",
    );
    expect(mirrorViolations(swapped)).toContain("s_lo-branch");
    expect(mirrorViolations(swapped)).toContain("s_hi-branch");
  });

  it("fires when an increment accrues with S(t_j) instead of S(t_{j-1})", () => {
    const unlagged = GOOD.replace("sum(l.s_prev * l.d_fill::numeric / l.n)", "sum(l.s * l.d_fill::numeric / l.n)");
    expect(mirrorViolations(unlagged)).toContain("r-uses-s_prev");
  });

  it("fires on a coalesced origin and on the seven-day floor", () => {
    expect(
      mirrorViolations(`${GOOD}\nWHERE c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'`),
    ).toEqual(expect.arrayContaining(["coalesced-origin", "seven-day-floor"]));
  });

  it("fires when the median is allowed to run past day 30", () => {
    const past30 = GOOD.replace("FILTER (WHERE c.tt <= 30 AND c.r_cif >= 0.5)", "FILTER (WHERE c.r_cif >= 0.5)");
    expect(mirrorViolations(past30)).toContain("median-horizon");
  });

  it("is not satisfied by a correct spelling that only appears in a COMMENT", () => {
    // The trap this repo has fallen into seven times: the guard passes because
    // the string it pins lives in a comment while the code beneath it is wrong.
    const commentOnly = `
      -- n_j must be sum(a.cnt) OVER (PARTITION BY a.tok ORDER BY a.tt DESC
      --   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      -- and S must be exp(sum(ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))))
      -- with lag(s.s, 1, 1.0) OVER (PARTITION BY s.tok ORDER BY s.tt).
      ${GOOD.replace("lag(s.s, 1, 1.0)", "lag(s.s, 1, 0)")
        .replace("ORDER BY a.tt DESC", "ORDER BY a.tt")
        .replace("ln(GREATEST(1.0 - c.d::numeric / c.n, 1e-12))", "ln(1.0 - c.d::numeric / c.n)")}
    `;
    // Against RAW the comment alone would satisfy all three checks...
    expect(mirrorViolations(commentOnly)).not.toContain("lag");
    // ...which is precisely why every code assertion runs comment-stripped.
    const stripped = stripComments(commentOnly);
    expect(mirrorViolations(stripped)).toEqual(
      expect.arrayContaining(["lag", "clamp", "risk-set-desc"]),
    );
  });
});
