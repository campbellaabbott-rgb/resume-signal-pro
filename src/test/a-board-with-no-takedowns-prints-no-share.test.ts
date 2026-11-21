/**
 * A BOARD WITH NO TAKEDOWNS PRINTS NO SHARE (the dominos control).
 *
 * WHAT HAPPENED. On 2026-09-27 the day-30 share passed its sufficiency test
 * vacuously on a board that showed us no takedown at all: dominos printed
 * "100% still advertised at day 30, CI [1, 1]" over 21,708 observations,
 * which says nothing about the employer and everything about a board we read
 * in laps (memory: S(30) positive control). The fill curve now refuses that
 * row itself (live 2026-11-18: dominos sufficient_30 false, reason lap,
 * bucket lap_proven), and the API4 design printed the share "wherever
 * sufficient_30 holds" (critique-api B-2).
 *
 * THE PROPERTY, on the check's employer block (public-api/posting-truth.ts):
 *   - the dominos row as measured prints no share and no median, and says
 *     why with the hiring-record gate's own reason and sentence (lap);
 *   - a row that claims sufficiency over no takedown event at all still
 *     prints no share, refused with the gate's term 'events', on a board
 *     read in full;
 *   - the controls: anthropic's record as measured (full_read, 121 events)
 *     prints its share with its interval, cohort and counts, scoped to the
 *     board; facts not computed this minute print nothing and say so.
 * The teeth: a shaper that prints whatever sufficient_30 allows prints a
 * share for the vacuous row and for dominos read as full.
 */
import { describe, expect, it } from "vitest";
import {
  EMPLOYER_COPY,
  EMPLOYER_SCOPE,
  NOT_COMPUTED_YET,
  employerFactsOf,
  type CompanyFactsRow,
  type EmployerFacts,
} from "../../supabase/functions/public-api/posting-truth";
import { DAY_30_REASONS, HIRING_RECORD_GATE_COPY } from "../../supabase/functions/_shared/hiring-record-gate";

/** One get_company_fill_curve row, as company_facts caches it (numerics may arrive as strings). */
const DOMINOS = {
  company_token: "dominos", observability_bucket: "lap_proven", watched_from: null, tracking_days: 74,
  sufficient: false, dated_coverage: "0.99", sufficient_30: false, insufficient_reason_30: "lap",
  still_open_30: "1.0000", still_open_30_lo: "1.0000", still_open_30_hi: "1.0000", events_30: 0, fills_30: 0, relists_30: 0,
  n_at_risk_30: 21708, taken_down_30: "0.0000", cohort_from: "2026-08-20", cohort_to: "2026-10-19",
  median_censored: true, median_days_to_fill: null, filled_roles_90d: 23594, relisted_roles_90d: 0,
  multi_site_title_share: "0.15", fill_rate_14: "0", fill_rate_14_lo: "0", fill_rate_14_hi: "0", still_open_14: "1",
};
const ANTHROPIC = {
  company_token: "anthropic", observability_bucket: "full_read", watched_from: "2026-09-10", tracking_days: 69,
  sufficient: true, dated_coverage: "0.97", sufficient_30: true, insufficient_reason_30: null,
  still_open_30: "0.6660", still_open_30_lo: "0.6100", still_open_30_hi: "0.7200", events_30: 121, fills_30: 98, relists_30: 23,
  n_at_risk_30: 172, taken_down_30: "0.3340", cohort_from: "2026-09-11", cohort_to: "2026-10-19",
  median_censored: false, median_days_to_fill: "19.0", filled_roles_90d: 140, relisted_roles_90d: 31,
  multi_site_title_share: "0.04", fill_rate_14: "0.21", fill_rate_14_lo: "0.17", fill_rate_14_hi: "0.25", still_open_14: "0.74",
};
/** A board read in full whose record says "sufficient" over not one takedown. */
const VACUOUS = {
  ...ANTHROPIC, company_token: "vacuous", events_30: 0, fills_30: 0, relists_30: 0,
  still_open_30: "1.0000", still_open_30_lo: "1.0000", still_open_30_hi: "1.0000", taken_down_30: "0.0000",
  fill_rate_14: "0", fill_rate_14_lo: "0", fill_rate_14_hi: "0", still_open_14: "1", median_censored: true, median_days_to_fill: null,
};

const cached = (facts: Record<string, unknown>): CompanyFactsRow => ({
  cf_token: String(facts.company_token), cf_state: "cached", cf_facts: facts, cf_computed_at: "2026-12-06T10:00:00Z",
});

/** The control's predicate: no share, no median, and a stated reason with a sentence. */
function printsNoShare(f: Pick<EmployerFacts, "stillAdvertisedAtDay30" | "medianDaysToTakedown" | "unknownReason" | "sentence">): boolean {
  return f.stillAdvertisedAtDay30 === null && f.medianDaysToTakedown === null
    && typeof f.unknownReason === "string" && f.unknownReason.length > 0
    && typeof f.sentence === "string" && f.sentence.length > 0;
}

describe("a board with no takedowns prints no share", () => {
  it("dominos as measured: no share, no median, the gate's reason and its sentence", () => {
    const f = employerFactsOf("dominos", cached(DOMINOS));
    expect(printsNoShare(f)).toBe(true);
    expect(f.unknownReason).toBe("lap");
    expect(f.sentence).toBe(HIRING_RECORD_GATE_COPY.lap);
    expect(f.medianUnknownReason).toBe("lap");
    expect(f.scope).toBe(EMPLOYER_SCOPE);
  });

  it("a full-read row that claims sufficiency over no event prints no share, refused as 'events'", () => {
    const f = employerFactsOf("vacuous", cached(VACUOUS));
    expect(printsNoShare(f)).toBe(true);
    expect(f.medianCensored, "no takedown, so the median was never reached").toBe(true);
    expect(f.unknownReason).toBe("events");
    expect(DAY_30_REASONS).toContain("events");
    expect(f.sentence).toBe(EMPLOYER_COPY.noEvents);
  });

  it("control: anthropic as measured prints its share, interval, cohort and counts, for this board only", () => {
    const f = employerFactsOf("anthropic", cached(ANTHROPIC));
    expect(f.unknownReason).toBeNull();
    expect(f.sentence).toBeNull();
    expect(f.stillAdvertisedAtDay30).toEqual({
      share: 0.666, lo: 0.61, hi: 0.72, cohortFrom: "2026-09-11", cohortTo: "2026-10-19",
      events: 121, takenDown: 0.334, relists: 23, n: 172,
    });
    expect(f.medianDaysToTakedown).toBe(19);
    expect(f).toMatchObject({ scope: "all roles on this board", computedAt: "2026-12-06T10:00:00Z", companyToken: "anthropic" });
  });

  it("control: facts the budget did not reach this minute print nothing and say so", () => {
    for (const row of [null, { cf_token: "x", cf_state: NOT_COMPUTED_YET, cf_facts: null, cf_computed_at: null }]) {
      const f = employerFactsOf("x", row);
      expect(printsNoShare(f)).toBe(true);
      expect(f.unknownReason).toBe(NOT_COMPUTED_YET);
      expect(f.sentence).toBe(EMPLOYER_COPY.notComputedYet);
    }
  });
});

describe("teeth", () => {
  /** What the design first wrote: print the share wherever sufficient_30 holds. */
  const naive = (facts: Record<string, unknown>) => ({
    stillAdvertisedAtDay30: facts.sufficient_30 === true ? { share: Number(facts.still_open_30) } : null,
    medianDaysToTakedown: null, unknownReason: facts.sufficient_30 === true ? null : String(facts.insufficient_reason_30),
    sentence: facts.sufficient_30 === true ? null : "refused",
  });

  it("the naive shaper prints a share for the vacuous row, which the predicate catches", () => {
    expect(printsNoShare(naive(VACUOUS) as never)).toBe(false);
  });

  it("and for dominos the day its record reads sufficient", () => {
    const readAsFull = { ...DOMINOS, observability_bucket: "full_read", watched_from: "2026-09-01", sufficient_30: true, insufficient_reason_30: null };
    expect(printsNoShare(naive(readAsFull) as never)).toBe(false);
    expect(printsNoShare(employerFactsOf("dominos", cached(readAsFull))), "the real shaper still refuses it: no event").toBe(true);
  });
});
