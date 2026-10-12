/**
 * THE TRACK 1 BATTERY (ghost spec, A6): every defect the spec names by board,
 * reproduced on live replies recorded read-only on 2026-10-12, and refused by
 * the rules this round ships.
 *
 * fixtures/ghost-track1-live-2026-10-12.json holds anon get_company_fill_curve
 * replies (PostgREST GET) for the four sets the 2026-10-11 sample of 1,506
 * boards named, and one served-list page per caution board from which the
 * share of postings whose title is live at another location was sampled
 * (multiSiteSamples). Each check states the OLD rule, shows it still fires on
 * the recorded reply (REPRODUCED), and shows the new rule refuses it (FIXED):
 *
 *   1. the 11 lap_pending boards that printed a 14-day share;
 *   2. the 81 boards whose came-back caution passed;
 *   3. the 8 boards that printed "never half" beside a 30-day share under one
 *      half (Databricks 0.45, Canva 0.39);
 *   4. the 7 boards whose 14-day share sat outside its own interval;
 *   5. the Ghost Job Index leaderboard, which ranked on a fill share no gate
 *      read.
 *
 * The replies predate 20261012121000, so they carry no multi_site_title_share:
 * the gate refuses their counts as 'unread' (an absent column is our deploy,
 * never a pass). Check 2 also merges the sampled share in, the input the gate
 * reads once that migration is live, to show which boards keep a caution.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import {
  LAP_BUCKET,
  LAP_MODE_BUCKETS,
  MULTI_SITE_TITLE_SHARE_MIN,
  canStateFillRate,
  hiringRecordGate,
  type HiringRecordRow,
} from "@/lib/hiring-record-gate";
import { relistCaution } from "@/pages/Jobs";
import GhostJobIndex, { leaderFillStatable } from "@/pages/GhostJobIndex";

type LiveRow = HiringRecordRow & { company_token: string; median_censored?: boolean | null; [k: string]: unknown };
interface Fixture {
  recordedAt: string;
  rows: LiveRow[];
  sets_2026_10_11: { lap_pending_pace: string[]; caution_passed: string[]; never_half_contra: string[]; interval_escapes: string[] };
  multiSiteSamples: { boards: Record<string, { status: number; share: number; postings: number }> };
}
const F = JSON.parse(readFileSync(resolve(__dirname, "fixtures/ghost-track1-live-2026-10-12.json"), "utf8")) as Fixture;
const row = (tok: string): LiveRow => {
  const r = F.rows.find((x) => x.company_token === tok);
  if (!r) throw new Error(`no recorded reply for ${tok}`);
  return r;
};
const n = (v: unknown) => Number(v);

// THE OLD RULES, as the page applied them before this round.
/** The 14-day share: canStateFillRate plus the lap term, and nothing else. */
const oldPace = (r: LiveRow) =>
  canStateFillRate({ sufficient: r.sufficient, dated_coverage: n(r.dated_coverage) }, n(r.tracking_days)) && r.observability_bucket !== LAP_BUCKET;
/** The came-back caution: more roles back than down, at least ten, no gate. */
const oldCaution = (r: LiveRow) => n(r.relisted_roles_90d) > n(r.filled_roles_90d) && n(r.relisted_roles_90d) >= 10;
/** "Never half": the pace passes and the fill median is censored. */
const oldNeverHalf = (r: LiveRow) => oldPace(r) && r.median_censored === true;
const outsideOwnInterval = (r: LiveRow) => n(r.fill_rate_14) < n(r.fill_rate_14_lo) || n(r.fill_rate_14) > n(r.fill_rate_14_hi);

describe("the recorded replies are the named boards", () => {
  it("every board of every named set has a recorded reply", () => {
    const sets = F.sets_2026_10_11;
    expect(sets.lap_pending_pace).toHaveLength(11);
    expect(sets.caution_passed).toHaveLength(81);
    expect(sets.never_half_contra).toHaveLength(8);
    expect(sets.interval_escapes).toHaveLength(7);
    for (const tok of [...sets.lap_pending_pace, ...sets.caution_passed, ...sets.never_half_contra, ...sets.interval_escapes]) {
      expect(() => row(tok), tok).not.toThrow();
    }
    expect(Date.parse(F.recordedAt)).toBeGreaterThan(Date.parse("2026-10-12T00:00:00Z"));
  });
});

describe("1. lap_pending boards print no 14-day share", () => {
  it("REPRODUCED on at least nine of the eleven, FIXED on all eleven", () => {
    const set = F.sets_2026_10_11.lap_pending_pace.map(row);
    expect(set.filter(oldPace).length, "the old gate passes the lap_pending replies").toBeGreaterThanOrEqual(9);
    for (const r of set) {
      const g = hiringRecordGate(r);
      expect(g.share14.ok, r.company_token).toBe(false);
      expect(g.median.ok, r.company_token).toBe(false);
      expect(g.share30.ok, r.company_token).toBe(false);
    }
    expect(set.filter((r) => r.observability_bucket === "lap_pending").every((r) => hiringRecordGate(r).share14.reason === "unproven read")).toBe(true);
  });
});

describe("2. the came-back caution", () => {
  const set = F.sets_2026_10_11.caution_passed.map(row);

  it("REPRODUCED: the old rule fires on all 81 recorded replies", () => {
    expect(set.filter(oldCaution)).toHaveLength(81);
  });

  it("FIXED: no caution on any of the 81 replies as recorded (no multi-site column yet)", () => {
    expect(set.filter((r) => relistCaution(r as never)).map((r) => r.company_token)).toEqual([]);
    for (const r of set) expect(hiringRecordGate(r).counts90.ok, r.company_token).toBe(false);
  });

  it("with the sampled share merged in: every lap-read board still refuses, every multi-site board refuses, and single-site boards keep it", () => {
    const merged = set.map((r) => {
      const s = F.multiSiteSamples.boards[r.company_token];
      return { r, share: s && s.status === 200 ? s.share : undefined };
    });
    const lapMode = merged.filter(({ r }) => LAP_MODE_BUCKETS.includes(String(r.observability_bucket)));
    expect(lapMode.length, "the lap-read boards in the set").toBeGreaterThanOrEqual(20);
    for (const { r, share } of lapMode) {
      expect(relistCaution({ ...r, multi_site_title_share: share ?? 0 } as never), r.company_token).toBe(false);
    }
    const full = merged.filter(({ r, share }) => r.observability_bucket === "full_read" && share !== undefined);
    expect(full.length, "every full-read caution board was sampled").toBeGreaterThanOrEqual(50);
    const kept: string[] = [];
    for (const { r, share } of full) {
      const caution = relistCaution({ ...r, multi_site_title_share: share } as never);
      const back = n(r.relisted_roles_90d);
      const unreliable = share! >= MULTI_SITE_TITLE_SHARE_MIN && back >= Math.max(10, 0.25 * n(r.filled_roles_90d));
      if (unreliable) expect(caution, `${r.company_token} (share ${share})`).toBe(false);
      if (caution) kept.push(r.company_token);
    }
    // Centria Autism and Carvana, named by the spec, are multi-site and refuse.
    for (const tok of ["centriaautism", "carvana"]) {
      const s = F.multiSiteSamples.boards[tok];
      if (s) expect(relistCaution({ ...row(tok), multi_site_title_share: s.share } as never), tok).toBe(false);
    }
    // Positive control: the rule does not refuse everything.
    expect(kept.length, "single-site boards whose roles came back keep the caution").toBeGreaterThanOrEqual(5);
    expect(kept).toContain("bjakcareer");
  });
});

describe("3. never half is read from every takedown", () => {
  it("REPRODUCED on all eight, FIXED on all eight (Databricks and Canva among them)", () => {
    const set = F.sets_2026_10_11.never_half_contra.map(row);
    expect(set.filter(oldNeverHalf)).toHaveLength(8);
    for (const r of set) expect(hiringRecordGate(r).neverHalf.ok, r.company_token).toBe(false);
    for (const tok of ["databricks", "Canva"]) {
      const r = row(tok);
      expect(n(r.still_open_30), `${tok}: more than half came down by day 30`).toBeLessThan(0.5);
      expect(hiringRecordGate(r).neverHalf.ok).toBe(false);
    }
  });
});

describe("4. a share outside its own interval", () => {
  it("REPRODUCED: at least five of the seven recorded replies still sit outside their interval", () => {
    const set = F.sets_2026_10_11.interval_escapes.map(row);
    expect(set.filter(outsideOwnInterval).length).toBeGreaterThanOrEqual(5);
  });

  it("FIXED on the page: none prints, and an escape that passes every other term refuses as 'interval'", () => {
    const set = F.sets_2026_10_11.interval_escapes.map(row);
    for (const r of set) expect(hiringRecordGate(r).share14.ok, r.company_token).toBe(false);
    // NorthwesternMedicine was the one sufficient escape; read it as a full-read
    // board with a floor and depth so only its interval is left to refuse it.
    const nm = row("NorthwesternMedicine");
    expect(outsideOwnInterval(nm)).toBe(true);
    const g = hiringRecordGate({ ...nm, observability_bucket: "full_read", watched_from: "2026-08-01", sufficient: true, tracking_days: 60, dated_coverage: 0.9 });
    expect(g.share14).toEqual({ ok: false, reason: "interval" });
  });
});

describe("5. the Ghost Job Index leaderboard ranks only on a share the gate passes", () => {
  const readable = {
    company_token: "acme", fills_90d: 40, tracking_days: 40, fill_rate_14: 0.42, fill_rate_14_lo: 0.36, fill_rate_14_hi: 0.48,
    dated_coverage: 0.9, sufficient: true, observability_bucket: "full_read", watched_from: "2026-08-01",
    multi_site_title_share: 0.05, filled_roles_90d: 30, relisted_roles_90d: 2, still_open_14: 0.5,
  };
  const lapPending = { ...readable, company_token: "globex", observability_bucket: "lap_pending", watched_from: null };
  const multiSite = { ...readable, company_token: "initech", multi_site_title_share: 0.9, filled_roles_90d: 40, relisted_roles_90d: 900 };

  it("the predicate: a readable board passes; lap_pending, multi-site and an absent row do not", () => {
    expect(leaderFillStatable(readable as never)).toBe(true);
    expect(leaderFillStatable(lapPending as never)).toBe(false);
    expect(leaderFillStatable(multiSite as never)).toBe(false);
    expect(leaderFillStatable(undefined)).toBe(false);
    expect(leaderFillStatable({ ...readable, multi_site_title_share: undefined } as never), "no multi-site column: the ceiling is not the fill share").toBe(false);
  });

  const LEADERS = [
    { company: "Acme Corp", company_token: "acme", closed_90d: 30, open_roles: 120, tracking_days: 40, fill_incidence_14d: 0.42, filled_roles_ceiling: 30, dated_share: 0.9 },
    { company: "Globex", company_token: "globex", closed_90d: 20, open_roles: 300, tracking_days: 35, fill_incidence_14d: 0.61, filled_roles_ceiling: 20, dated_share: 0.8 },
    { company: "Initech", company_token: "initech", closed_90d: 20, open_roles: 300, tracking_days: 35, fill_incidence_14d: 0.55, filled_roles_ceiling: 20, dated_share: 0.8 },
  ];
  const body = () => document.body.textContent ?? "";
  beforeEach(() => { rpc.mockReset(); });

  it("rendered: only the readable board keeps its row and its figure once the curve answers", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_stats_cache") return Promise.resolve({ data: { computed_at: new Date().toISOString(), ghost_stats: { total_open: 1000, closed_90d: 200, observed_days: 60 }, stale_parts: [], actively_hiring: { computed_at: new Date().toISOString(), rows: LEADERS } } });
      if (fn === "get_company_fill_curve") return Promise.resolve({ data: [readable, lapPending, multiSite] });
      return Promise.resolve({ data: null });
    });
    render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
    await waitFor(() => expect(body()).toContain("up to 42% came down within 14d"), { timeout: 4000 });
    expect(body(), "a lap_pending board's share is not printed").not.toContain("up to 61%");
    expect(body(), "a multi-site board's share is not printed").not.toContain("up to 55%");
    expect(body()).not.toContain("Globex");
    expect(body()).not.toContain("Initech");
  });
});
