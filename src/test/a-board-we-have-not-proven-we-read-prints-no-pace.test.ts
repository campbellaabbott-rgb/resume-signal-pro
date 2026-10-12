/**
 * A BOARD WE HAVE NOT PROVEN WE READ PRINTS NO PACE (Track 1, A1).
 *
 * The shared hiring-record gate (src/lib/hiring-record-gate.ts, byte-identical
 * in supabase/functions/_shared/) refused the fourteen-day share, the median
 * and the thirty-day share only on lap_proven boards, so every other bucket
 * passed: on 2026-10-11, eleven lap_pending boards printed a 14-day share
 * (Oracle tenants egud, ejwl, eluq, hcbt; Driven Brands; Leidos), and the
 * 2026-10-12 replies recorded in fixtures/ghost-track1-live-2026-10-12.json
 * still carry nine of them. Now the gate is a whitelist:
 *
 *   - the share, the median and the thirty-day share print only on a board
 *     read to its end (full_read) that has a watch floor; lap_proven keeps
 *     'lap', every other bucket, an absent one and an unknown word refuse
 *     with 'unproven read';
 *   - the ninety-day counts refuse on every lap-read board (owner decision
 *     GD5(a)) with the reason section 91 reads, on an unproven read, on a row
 *     without the multi-site column ('unread'), and where the re-post test
 *     reads other sites ('relist test reads other sites');
 *   - "never half" is read from S: it needs a stated thirty-day share whose
 *     lower bound is above one half (Databricks: still_open_30 0.44);
 *   - the "up to" ceiling is every takedown (1 - S14) where fills are filed
 *     as re-posts;
 *   - a share outside its own interval is refused ('interval').
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HIRING_RECORD_GATE_COPY,
  canStateFillRate,
  hiringRecordGate,
  relistTestUnreliable,
  type HiringRecordRow,
} from "@/lib/hiring-record-gate";

type LiveRow = HiringRecordRow & { company_token: string; [k: string]: unknown };
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/ghost-track1-live-2026-10-12.json"), "utf8")) as {
  rows: LiveRow[];
  sets_2026_10_11: { lap_pending_pace: string[] };
};
const live = (tok: string): LiveRow => {
  const r = FIXTURE.rows.find((x) => x.company_token === tok);
  if (!r) throw new Error(`no recorded row for ${tok}`);
  return r;
};

/** A board read in full, dated, watched 40 days, titles at one site each: every figure may print. */
const READABLE: HiringRecordRow = {
  observability_bucket: "full_read", watched_from: "2026-08-01", tracking_days: 40, sufficient: true, dated_coverage: 0.8,
  median_days_to_fill: null, median_censored: true, sufficient_30: true, insufficient_reason_30: null,
  filled_roles_90d: 60, relisted_roles_90d: 9, multi_site_title_share: 0.05,
  fill_rate_14: 0.3, fill_rate_14_lo: 0.25, fill_rate_14_hi: 0.35, still_open_14: 0.62, still_open_30_lo: 0.58,
};

describe("the whitelist: only a board read to its end, with a watch floor, prints a pace", () => {
  for (const bucket of ["lap_pending", "unprovable", "unobserved", null, undefined, "weird"]) {
    it(`${String(bucket)}: no 14-day share, no median, no 30-day share, and the reason names the read`, () => {
      const g = hiringRecordGate({ ...READABLE, observability_bucket: bucket });
      expect(g.share14).toEqual({ ok: false, reason: "unproven read" });
      expect(g.median).toEqual({ ok: false, reason: "unproven read" });
      expect(g.share30).toEqual({ ok: false, reason: "unproven read" });
      expect(g.neverHalf.ok).toBe(false);
      expect(g.paceCopy).toBe("unprovenRead");
      expect(g.ceiling14).toBeNull();
    });
  }

  it("a board read in full but with no watch floor is not proven either", () => {
    expect(hiringRecordGate({ ...READABLE, watched_from: null }).share14).toEqual({ ok: false, reason: "unproven read" });
    expect(hiringRecordGate({ ...READABLE, watched_from: "" }).share14).toEqual({ ok: false, reason: "unproven read" });
    const { watched_from: _w, ...noColumn } = READABLE;
    expect(hiringRecordGate(noColumn).share14, "an absent column is a refusal").toEqual({ ok: false, reason: "unproven read" });
  });

  it("lap_proven keeps its own reason", () => {
    const g = hiringRecordGate({ ...READABLE, observability_bucket: "lap_proven", watched_from: null });
    expect(g.share14).toEqual({ ok: false, reason: "lap" });
    expect(g.paceCopy).toBe("lap");
  });

  it("positive control: the readable board prints every figure", () => {
    const g = hiringRecordGate(READABLE);
    expect(g.share14.ok && g.median.ok && g.share30.ok && g.counts90.ok && g.neverHalf.ok).toBe(true);
    expect(g.ceilingBasis).toBe("fills");
    expect(g.ceiling14).toBe(0.3);
  });

  it("the recorded lap_pending replies (2026-10-12) passed the old gate and refuse now", () => {
    const pending = FIXTURE.rows.filter((r) => r.observability_bucket === "lap_pending"
      && canStateFillRate({ sufficient: r.sufficient, dated_coverage: Number(r.dated_coverage) }, Number(r.tracking_days)));
    expect(pending.length, "the live sample no longer carries the defect").toBeGreaterThanOrEqual(5);
    for (const r of pending) {
      const g = hiringRecordGate(r);
      expect(g.share14, r.company_token).toEqual({ ok: false, reason: "unproven read" });
      expect(g.median.ok, r.company_token).toBe(false);
    }
    // The Oracle tenants the spec names by token are among them.
    for (const tok of ["egud~us2~CX_1", "ejwl~us2~CX", "eluq~us2~CX_1", "hcbt~em2~CX_1001"]) {
      expect(FIXTURE.sets_2026_10_11.lap_pending_pace).toContain(tok);
      expect(hiringRecordGate(live(tok)).share14.reason).toBe("unproven read");
    }
  });
});

describe("the ninety-day counts", () => {
  it("every lap-read board refuses with the reason section 91 reads, at any depth (GD5)", () => {
    for (const bucket of ["lap_proven", "lap_pending", "unprovable"]) {
      for (const d of [21, 28, 90]) {
        const g = hiringRecordGate({ ...READABLE, observability_bucket: bucket, tracking_days: d, filled_roles_90d: 40, relisted_roles_90d: 12 });
        expect(g.counts90, `${bucket} ${d}`).toEqual({ ok: false, reason: "relist detection unproven" });
        expect(g.countsCopy).toBe("relistLap");
      }
    }
  });

  it("the zero-relist control still comes first, with its own sentence", () => {
    const g = hiringRecordGate({ ...READABLE, observability_bucket: "lap_proven", filled_roles_90d: 1293, relisted_roles_90d: 0 });
    expect(g.counts90).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(g.countsCopy).toBe("relist");
  });

  it("an unobserved or unknown bucket is an unproven read; an absent multi-site column is our deploy", () => {
    expect(hiringRecordGate({ ...READABLE, observability_bucket: "unobserved" }).counts90).toEqual({ ok: false, reason: "unproven read" });
    expect(hiringRecordGate({ ...READABLE, observability_bucket: null }).countsCopy).toBe("unprovenReadCounts");
    const { multi_site_title_share: _m, ...older } = READABLE;
    const g = hiringRecordGate(older);
    expect(g.counts90).toEqual({ ok: false, reason: "unread" });
    expect(g.countsCopy).toBe("unread");
  });

  it("Centria-shaped (one title at many sites, 2,967 back against 43 down): the re-post test reads other sites", () => {
    const centria = { ...READABLE, multi_site_title_share: 0.97, filled_roles_90d: 43, relisted_roles_90d: 2967, still_open_14: 0.55, fill_rate_14: 0.0068, fill_rate_14_lo: 0.0069, fill_rate_14_hi: 0.0072 };
    expect(relistTestUnreliable(centria)).toBe(true);
    const g = hiringRecordGate({ ...centria, fill_rate_14_lo: 0.005 });
    expect(g.counts90).toEqual({ ok: false, reason: "relist test reads other sites" });
    expect(g.countsCopy).toBe("otherSites");
    // A fill filed as a re-post is no longer under the fill share: the ceiling is every takedown.
    expect(g.ceilingBasis).toBe("every takedown");
    expect(g.ceiling14).toBeCloseTo(0.45, 10);
  });

  it("Affirm-shaped (titles at several sites, but one role back against 22 down): the test is trusted", () => {
    const affirm = { ...READABLE, multi_site_title_share: 0.53, filled_roles_90d: 22, relisted_roles_90d: 1 };
    expect(relistTestUnreliable(affirm)).toBe(false);
    expect(hiringRecordGate(affirm).counts90.ok).toBe(true);
  });

  it("the edges of the rule: share 0.20 and max(10, a quarter of those down)", () => {
    const at = (share: number, filled: number, relisted: number) => relistTestUnreliable({ ...READABLE, multi_site_title_share: share, filled_roles_90d: filled, relisted_roles_90d: relisted });
    expect(at(0.19, 10, 500)).toBe(false);
    expect(at(0.2, 10, 10)).toBe(true);
    expect(at(0.2, 10, 9)).toBe(false);
    expect(at(0.2, 100, 24)).toBe(false);
    expect(at(0.2, 100, 25)).toBe(true);
    expect(at(Number.NaN, 100, 25)).toBeNull();
  });
});

describe("never half is read from every takedown", () => {
  it("Databricks (recorded 2026-10-12): a censored fill median beside S(30) under one half prints no bound", () => {
    const db = live("databricks");
    expect(db.median_censored).toBe(true);
    expect(Number(db.still_open_30)).toBeLessThan(0.5);
    const g = hiringRecordGate({ ...db, multi_site_title_share: 0.15 });
    expect(g.neverHalf.ok).toBe(false);
  });

  it("the bound needs the thirty-day share stated, its lower bound above one half, and a censored median", () => {
    expect(hiringRecordGate(READABLE).neverHalf.ok).toBe(true);
    expect(hiringRecordGate({ ...READABLE, still_open_30_lo: 0.5 }).neverHalf.ok).toBe(false);
    expect(hiringRecordGate({ ...READABLE, sufficient_30: false, insufficient_reason_30: "width" }).neverHalf.ok).toBe(false);
    expect(hiringRecordGate({ ...READABLE, median_censored: false, median_days_to_fill: 20 }).neverHalf.ok).toBe(false);
    const { still_open_30_lo: _s, ...older } = READABLE;
    expect(hiringRecordGate(older).neverHalf).toEqual({ ok: false, reason: "unread" });
  });
});

describe("a share outside its own interval is not printed", () => {
  it("NorthwesternMedicine-shaped (0.3148 against [0.3156, 0.3308]) refuses with 'interval'", () => {
    const g = hiringRecordGate({ ...READABLE, fill_rate_14: 0.3148, fill_rate_14_lo: 0.3156, fill_rate_14_hi: 0.3308 });
    expect(g.share14).toEqual({ ok: false, reason: "interval" });
    expect(g.paceCopy).toBe("interval");
  });
  it("rounding slack: a share on its bound prints", () => {
    expect(hiringRecordGate({ ...READABLE, fill_rate_14: 0.25, fill_rate_14_lo: 0.25, fill_rate_14_hi: 0.35 }).share14.ok).toBe(true);
  });
});

describe("the sentences", () => {
  it("every new refusal says it is not a fact about the employer, and none uses the banned words", () => {
    for (const k of ["unprovenRead", "unprovenReadCounts", "relistLap", "otherSites", "interval", "unread"] as const) {
      expect(HIRING_RECORD_GATE_COPY[k]).toMatch(/not a fact about the employer/);
      expect(HIRING_RECORD_GATE_COPY[k]).not.toMatch(/ghost|fake|filled|not really hiring/i);
    }
  });
});
