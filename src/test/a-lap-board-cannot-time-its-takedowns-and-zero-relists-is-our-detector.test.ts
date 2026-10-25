/**
 * A LAP BOARD CANNOT TIME ITS TAKEDOWNS, AND ZERO RE-LISTINGS IS OUR DETECTOR.
 *
 * THE SHARED HIRING-RECORD GATE (src/lib/hiring-record-gate.ts, byte-identical
 * in supabase/functions/_shared/) is the page's canStateFillRate plus two
 * terms it never had:
 *
 *   - a lap term: on a lap_proven board a takedown is certified one to three
 *     laps late, which the RPC already treats as disqualifying for the
 *     thirty-day share (insufficient_reason_30 = 'lap'). The same lag biases
 *     the fourteen-day share and the median, so both are refused there too;
 *   - a relist positive control: hundreds of roles taken down and not one
 *     back means re-list detection is not working on the board, so the
 *     ninety-day counts are refused ('relist detection unproven').
 *
 * And the ninety-day counts get their own depth floor: 21 days, 28 on a lap
 * board. The fixtures are get_company_fill_curve rows read live with the anon
 * key on 2026-10-11 (UTC), read-only, for the boards the plan names.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  FILL_COVERAGE_MIN as GATE_COVERAGE_MIN,
  FILL_RATE_MIN_TRACKING_DAYS as GATE_MIN_TRACKING,
  HIRING_RECORD_GATE_COPY,
  RELIST_CONTROL_MIN_ROLES,
  ROLE_COUNT_MIN_TRACKING_DAYS,
  ROLE_COUNT_MIN_TRACKING_DAYS_LAP,
  canStateFillRate as gateCanState,
  coverageBand as gateBand,
  fillGateCopy,
  hiringRecordGate,
  type HiringRecordRow,
} from "@/lib/hiring-record-gate";
import {
  FILL_COVERAGE_MIN as PAGE_COVERAGE_MIN,
  FILL_RATE_MIN_TRACKING_DAYS as PAGE_MIN_TRACKING,
  canStateFillRate as pageCanState,
  coverageBand as pageBand,
} from "@/pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Live rows, 2026-10-11 (UTC). Every one of them is lap_proven. */
const LIVE: Record<string, HiringRecordRow & { token: string; fill_rate_14: number }> = {
  dominos: { token: "dominos", observability_bucket: "lap_proven", tracking_days: 10, sufficient: true, fill_rate_14: 0.0053, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 13347, relisted_roles_90d: 0, dated_coverage: 0.9979 },
  oreilly: { token: "oreillyauto~wd1~oreilly", observability_bucket: "lap_proven", tracking_days: 10, sufficient: true, fill_rate_14: 0.0135, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 509, relisted_roles_90d: 2, dated_coverage: 0.87 },
  dollartree: { token: "dollartree~wd5~dollartreeus", observability_bucket: "lap_proven", tracking_days: 8, sufficient: true, fill_rate_14: 0.0347, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 1065, relisted_roles_90d: 19, dated_coverage: 0.9496 },
  eurofins: { token: "Eurofins", observability_bucket: "lap_proven", tracking_days: 87, sufficient: true, fill_rate_14: 0.3047, median_days_to_fill: 25, median_censored: false, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 1293, relisted_roles_90d: 0, dated_coverage: 0.8631 },
  aecom2: { token: "AECOM2", observability_bucket: "lap_proven", tracking_days: 31, sufficient: true, fill_rate_14: 0.2111, median_days_to_fill: null, median_censored: true, sufficient_30: false, insufficient_reason_30: "lap", filled_roles_90d: 1640, relisted_roles_90d: 0, dated_coverage: 0.8771 },
};

/** A board we read in full, watched long enough, with a record that can speak. */
const FULL_READ: HiringRecordRow = {
  observability_bucket: "full_read", watched_from: "2026-08-01", tracking_days: 40, sufficient: true, dated_coverage: 0.8,
  median_days_to_fill: 12, median_censored: false, sufficient_30: true, insufficient_reason_30: null,
  filled_roles_90d: 60, relisted_roles_90d: 9, multi_site_title_share: 0.05,
};

describe("one gate in two runtimes", () => {
  it("the page's copy and the edge functions' copy are the same bytes", () => {
    const page = read("src/lib/hiring-record-gate.ts");
    const edge = read("supabase/functions/_shared/hiring-record-gate.ts");
    expect(page.length, "the page's copy is empty").toBeGreaterThan(1000);
    expect(edge, "the two copies differ: a rule moved in one runtime only").toBe(page);
  });

  it("imports nothing, so it runs unchanged under Vite and under Deno", () => {
    const code = read("src/lib/hiring-record-gate.ts");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(/);
  });
});

describe("canStateFillRate is the page's own, term for term", () => {
  it("the constants the page and the gate read are equal", () => {
    expect(GATE_MIN_TRACKING).toBe(PAGE_MIN_TRACKING);
    expect(GATE_COVERAGE_MIN).toBe(PAGE_COVERAGE_MIN);
  });

  it("parity over a grid of sufficiency, coverage and depth, including the edges and the bad values", () => {
    const sufficients = [true, false, undefined, null];
    const coverages = [undefined, null, NaN, -1, 0, 0.29, 0.3, 0.59, 0.6, 1, 2];
    const depths: unknown[] = [undefined, null, NaN, Infinity, -1, 0, 20, 20.99, 21, 90, "21"];
    let n = 0;
    for (const s of sufficients) for (const c of coverages) for (const d of depths) {
      const row = { sufficient: s, dated_coverage: c } as { sufficient: boolean; dated_coverage: number };
      expect(gateCanState(row, d as number), JSON.stringify({ s, c, d })).toBe(pageCanState(row, d as number));
      n++;
    }
    expect(gateCanState(null, 30)).toBe(pageCanState(null, 30));
    expect(gateCanState(undefined, 30)).toBe(pageCanState(undefined, 30));
    for (const c of coverages) expect(gateBand(c as number)).toBe(pageBand(c as number));
    expect(n).toBe(sufficients.length * coverages.length * depths.length);
  });

  it("the fourteen-day share is canStateFillRate plus the read whitelist (a full read with a watch floor) and nothing else", () => {
    // Track 1, A1: the lap term refused lap_proven alone, so lap_pending,
    // unprovable and an absent bucket printed a share they cannot measure.
    const buckets = ["full_read", "lap_proven", "lap_pending", "unprovable", "unobserved", "weird", null, undefined];
    for (const b of buckets) for (const w of ["2026-08-01", null]) for (const s of [true, false]) for (const c of [0.1, 0.45, 0.9]) for (const d of [5, 20, 21, 60]) {
      const row: HiringRecordRow = { observability_bucket: b, watched_from: w, sufficient: s, dated_coverage: c, tracking_days: d, median_censored: true };
      const want = gateCanState({ sufficient: s, dated_coverage: c }, d) && b === "full_read" && w !== null;
      expect(hiringRecordGate(row).share14.ok, JSON.stringify(row)).toBe(want);
    }
  });
});

describe("the lap term", () => {
  it("Domino's, O'Reilly and Dollar Tree print no fourteen-day share, no median and no thirty-day share", () => {
    for (const key of ["dominos", "oreilly", "dollartree"] as const) {
      const g = hiringRecordGate(LIVE[key]);
      expect(g.share14, `${key} 14-day share`).toEqual({ ok: false, reason: "lap" });
      expect(g.median, `${key} median`).toEqual({ ok: false, reason: "lap" });
      expect(g.share30, `${key} 30-day share`).toEqual({ ok: false, reason: "lap" });
    }
  });

  it("teeth: the lap term is what refuses them, not the depth floor alone", () => {
    // The same rows watched for 30 days pass canStateFillRate, so a gate
    // without the lap term would print the share. AECOM2 already has 31 days.
    for (const key of ["dominos", "oreilly", "dollartree"] as const) {
      const deeper = { ...LIVE[key], tracking_days: 30 };
      expect(gateCanState({ sufficient: true, dated_coverage: Number(deeper.dated_coverage) }, 30), key).toBe(true);
      expect(hiringRecordGate(deeper).share14).toEqual({ ok: false, reason: "lap" });
    }
    expect(gateCanState({ sufficient: true, dated_coverage: 0.8771 }, 31)).toBe(true);
    expect(hiringRecordGate(LIVE.aecom2).share14).toEqual({ ok: false, reason: "lap" });
  });

  it("a board we read in full keeps its share and its median", () => {
    const g = hiringRecordGate(FULL_READ);
    expect(g.share14.ok).toBe(true);
    expect(g.median.ok).toBe(true);
    expect(g.share30.ok).toBe(true);
    expect(g.counts90.ok).toBe(true);
  });

  it("the thirty-day share stays behind sufficient_30, and a lap board is refused even if a row ever says otherwise", () => {
    expect(hiringRecordGate({ ...FULL_READ, sufficient_30: false, insufficient_reason_30: "watch" }).share30).toEqual({ ok: false, reason: "watch" });
    expect(hiringRecordGate({ ...FULL_READ, sufficient_30: false, insufficient_reason_30: "some new word" }).share30).toEqual({ ok: false, reason: "insufficient" });
    const { sufficient_30: _s, ...older } = FULL_READ;
    expect(hiringRecordGate(older).share30, "a row without the column is our deploy gap").toEqual({ ok: false, reason: "unread" });
    expect(hiringRecordGate({ ...LIVE.eurofins, sufficient_30: true }).share30).toEqual({ ok: false, reason: "lap" });
  });

  it("a median the row cannot state is refused as unread, never printed as day zero", () => {
    expect(hiringRecordGate({ ...FULL_READ, median_days_to_fill: null, median_censored: false }).median).toEqual({ ok: false, reason: "unread" });
    expect(hiringRecordGate({ ...FULL_READ, median_days_to_fill: null, median_censored: true }).median.ok).toBe(true);
  });

  it("the share's other refusals keep canStateFillRate's order and name their term", () => {
    expect(hiringRecordGate({ ...FULL_READ, sufficient: false }).share14).toEqual({ ok: false, reason: "insufficient" });
    expect(hiringRecordGate({ ...FULL_READ, dated_coverage: 0.2 }).share14).toEqual({ ok: false, reason: "coverage" });
    expect(hiringRecordGate({ ...FULL_READ, tracking_days: 20 }).share14).toEqual({ ok: false, reason: "tracking" });
    expect(hiringRecordGate({ ...FULL_READ, tracking_days: null }).share14, "an unknown depth is a refusal").toEqual({ ok: false, reason: "tracking" });
    expect(hiringRecordGate(null).share14).toEqual({ ok: false, reason: "no row" });
  });
});

describe("the relist positive control and the depth floor on the ninety-day counts", () => {
  it("Eurofins and Domino's: hundreds taken down and none back is our detector, so no count prints", () => {
    expect(hiringRecordGate(LIVE.eurofins).counts90).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(hiringRecordGate(LIVE.dominos).counts90).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(hiringRecordGate(LIVE.aecom2).counts90).toEqual({ ok: false, reason: "relist detection unproven" });
  });

  it("the control's edges: 199 with none back, 200 with one back, 200 with none back", () => {
    const at = (filled: number, relisted: number) => hiringRecordGate({ ...FULL_READ, filled_roles_90d: filled, relisted_roles_90d: relisted }).counts90;
    expect(RELIST_CONTROL_MIN_ROLES).toBe(200);
    expect(at(199, 0).ok).toBe(true);
    expect(at(200, 1).ok).toBe(true);
    expect(at(200, 0)).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(at(0, 0).ok, "no events is not the control's case; the verdict calls it unknown").toBe(true);
  });

  it("O'Reilly and Dollar Tree: a lap-read board's re-post test sees one visit's window, so no count prints at any depth (GD5)", () => {
    // Owner decision GD5(a), superseding profiles D16(a) for lap boards: the
    // ninety-day counts are refused on every board read in laps until the
    // re-post test is proven there, with the reason section 91 reads.
    const o = hiringRecordGate(LIVE.oreilly);
    expect(o.counts90).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(o.countsCopy).toBe("relistLap");
    expect(o.countsMinTrackingDays).toBe(ROLE_COUNT_MIN_TRACKING_DAYS_LAP);
    expect(hiringRecordGate(LIVE.dollartree).counts90).toEqual({ ok: false, reason: "relist detection unproven" });
    expect(hiringRecordGate({ ...LIVE.oreilly, tracking_days: 90 }).counts90).toEqual({ ok: false, reason: "relist detection unproven" });
  });

  it("the floor is 21 days on a board read in full; a lap-read board refuses before the floor is read", () => {
    expect(ROLE_COUNT_MIN_TRACKING_DAYS).toBe(21);
    expect(ROLE_COUNT_MIN_TRACKING_DAYS_LAP).toBe(28);
    const at = (bucket: string, d: number) => hiringRecordGate({ ...FULL_READ, observability_bucket: bucket, tracking_days: d }).counts90;
    expect(at("full_read", 20).ok).toBe(false);
    expect(at("full_read", 21).ok).toBe(true);
    for (const b of ["lap_proven", "lap_pending", "unprovable"]) {
      expect(at(b, 27), b).toEqual({ ok: false, reason: "relist detection unproven" });
      expect(at(b, 90), b).toEqual({ ok: false, reason: "relist detection unproven" });
    }
    expect(at("unobserved", 90)).toEqual({ ok: false, reason: "unproven read" });
  });

  it("an absent role column is our deploy gap, and a numeric string is a number", () => {
    expect(hiringRecordGate({ ...FULL_READ, filled_roles_90d: null }).counts90).toEqual({ ok: false, reason: "unread" });
    expect(hiringRecordGate({ ...FULL_READ, relisted_roles_90d: undefined }).counts90).toEqual({ ok: false, reason: "unread" });
    expect(hiringRecordGate({ ...FULL_READ, filled_roles_90d: "60", relisted_roles_90d: "9", tracking_days: "40" }).counts90.ok).toBe(true);
  });
});

describe("the refusals in plain words are one set of sentences", () => {
  const LOCALES = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
  const gateOf = (f: string) => (JSON.parse(read(`src/i18n/locales/${f}`)) as { jobsPage: { hhGate?: Record<string, string> } }).jobsPage.hhGate;
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

  it("the English locale says exactly what the module says", () => {
    expect(gateOf("en.json")).toEqual({ ...HIRING_RECORD_GATE_COPY });
  });

  it("every locale carries every sentence with the same placeholders, and none is left in English", () => {
    expect(LOCALES.length).toBe(9);
    for (const f of LOCALES) {
      const g = gateOf(f);
      expect(g, `${f} has no jobsPage.hhGate`).toBeTruthy();
      for (const [k, en] of Object.entries(HIRING_RECORD_GATE_COPY)) {
        expect(typeof g![k], `${f} jobsPage.hhGate.${k}`).toBe("string");
        expect(placeholders(g![k]), `${f} jobsPage.hhGate.${k} placeholders`).toEqual(placeholders(en));
        if (!f.startsWith("en")) expect(g![k], `${f} jobsPage.hhGate.${k} is untranslated`).not.toBe(en);
      }
    }
  });

  it("no refusal reads as a fact about the employer, and the relist sentence names our detector", () => {
    for (const k of ["lap", "relist", "unprovenRead", "unprovenReadCounts", "relistLap", "otherSites", "interval", "unread"] as const) {
      expect(HIRING_RECORD_GATE_COPY[k]).toMatch(/not a fact about the employer/);
    }
    expect(HIRING_RECORD_GATE_COPY.relist).toMatch(/re-list detection is not working here/);
    expect(fillGateCopy(HIRING_RECORD_GATE_COPY.relist, { n: "1,293", d: 87 })).toContain("We logged 1,293 roles taken down on this board over 87 days");
    expect(fillGateCopy("{{a}} {{b}}", { a: 1 }), "an unknown placeholder is left as written").toBe("1 {{b}}");
  });
});
