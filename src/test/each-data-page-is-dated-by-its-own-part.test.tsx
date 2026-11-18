/**
 * EACH DATA PAGE IS DATED BY ITS OWN PART, AND SAYS WHEN A PART WAS CARRIED
 * (S14X-160), and the Ghost Job Index's other three sentences say what they
 * count: the closure count is closure events (S14X-192), the freshness sample
 * is job boards holding a live posting, measured at the rollup's own stamp
 * (S14X-194), and a re-check run more than 36 hours old is not called daily
 * (SEO-F07).
 *
 * Live on 2026-11-15 the stats cache row said 03:27 and its ghost_stats part
 * 03:05, and the tiles were dated by the row; a ghost_stats part the cache
 * carried forward was printed as current; /hiring-trends printed no date, and
 * /pay-transparency ignored the parts its refresh named as carried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import GhostJobIndex, { CLOSURE_COUNT_IS, auditAgeHours, ghostStatsStamp } from "../pages/GhostJobIndex";
import HiringTrends, { trendsStamp } from "../pages/HiringTrends";
import PayTransparencyIndex from "../pages/PayTransparencyIndex";

vi.setConfig({ testTimeout: 30_000 });
const ROOT = resolve(__dirname, "../..");
const body = () => document.body.textContent ?? "";
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const stampText = (at: string) => new Date(at).toLocaleString("en-US");

const GHOST = {
  total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000,
  observed_days: 58, median_days_open: 13.8, median_days_to_close: 11, posted_coverage_pct: 99.4,
};
const AUDIT = (at: string) => ({ at, accuracyPct: 96.6, sampled: 120, decided: 117, live: 113, gone: 4, unknown: 3 });

function mountGhost(cache: unknown, extra: Record<string, unknown> = {}) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") return Promise.resolve({ data: cache });
    if (fn in extra) return Promise.resolve({ data: extra[fn] });
    return Promise.resolve({ data: null });
  });
  return render(<HelmetProvider><MemoryRouter><GhostJobIndex /></MemoryRouter></HelmetProvider>);
}

beforeEach(() => { rpc.mockReset(); });
afterEach(() => cleanup());

describe("the Ghost Job Index tiles (S14X-160)", () => {
  it("are dated by ghost_stats' own stamp, not the cache row's", async () => {
    const rowAt = iso(1 * HOUR);
    const partAt = iso(5 * HOUR);
    mountGhost({ computed_at: rowAt, stale_parts: [], ghost_stats: { ...GHOST, computed_at: partAt } });
    await waitFor(() => expect(body()).toContain(`open roles, as of ${stampText(partAt)}`));
    expect(body()).not.toContain(stampText(rowAt));
  });

  it("say the figures were carried when the cache names ghost_stats, even when the part is recent", async () => {
    const partAt = iso(1 * HOUR);
    mountGhost({ computed_at: iso(0), stale_parts: ["ghost_stats"], ghost_stats: { ...GHOST, computed_at: partAt } });
    await waitFor(() => expect(document.querySelector("[data-ghost-stats-carried]")).not.toBeNull());
    expect(body()).toContain(`open roles, as of ${stampText(partAt)}`);
    expect(body()).toMatch(/Carried forward: the latest hourly recomputation could not finish these figures, so they are from an earlier run/);
  });

  it("name the pieces the row's own writer carried", async () => {
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(HOUR), stale_parts: ["closures", "median_days_open"] } });
    await waitFor(() => expect(document.querySelector("[data-ghost-stats-carried]")).not.toBeNull());
    expect(body()).toMatch(/could not finish the closure figures, the median age, so those are from an earlier run/);
  });

  it("print no carried note and 'right now' for a fresh part carried by nobody", async () => {
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(HOUR / 2), stale_parts: [] } });
    await waitFor(() => expect(body()).toContain("open roles right now"));
    expect(document.querySelector("[data-ghost-stats-carried]")).toBeNull();
  });

  it("the stamp reader keeps the part's stamp and both carried signals", () => {
    const at = "2026-11-15T03:05:00Z";
    expect(ghostStatsStamp({ computed_at: "2026-11-15T03:27:00Z", stale_parts: [] }, { ...GHOST, computed_at: at } as never))
      .toEqual({ computedAt: at, carried: false, parts: [] });
    expect(ghostStatsStamp({ stale_parts: ["ghost_stats"] }, { ...GHOST, computed_at: at } as never).carried).toBe(true);
    expect(ghostStatsStamp(null, { ...GHOST, computed_at: at, stale_parts: ["counts"] } as never)).toEqual({ computedAt: at, carried: true, parts: ["counts"] });
    expect(ghostStatsStamp({ stale_parts: ["ghost_stats"] }, null).carried).toBe(false);
  });
});

describe("the Ghost Job Index's sentences say what they count", () => {
  it("the closure count is closure events, in the bake's noun (S14X-192)", async () => {
    expect(CLOSURE_COUNT_IS.startsWith("closure events")).toBe(true);
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toContain("label: `closure events logged in the last 90 days");
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(0) } });
    await waitFor(() => expect(body()).toContain(`That count is ${CLOSURE_COUNT_IS}`));
    expect(body()).not.toMatch(/roles an employer took down|watched [\d,]+ roles/);
    const code = codeOf(readFileSync(resolve(ROOT, "src/pages/GhostJobIndex.tsx"), "utf8"));
    expect(code).not.toContain("roles an employer took down");
  });

  it("the freshness sample is job boards holding a live posting, measured at the rollup's stamp (S14X-194)", async () => {
    const at = iso(20 * 60_000);
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(0) } },
      { get_freshness_stats: [{ boards: 31304, p50_min: 40, p95_min: 300, computed_at: at }] });
    await waitFor(() => expect(body()).toContain("31,304 job boards we read that hold a live posting"));
    expect(body()).toContain(`Measured ${stampText(at)}`);
    expect(body()).not.toMatch(/Measured right now|company feeds/);
  });

  it("a re-check older than 36 hours is not called daily (SEO-F07)", async () => {
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(0) } },
      { get_audit_result: AUDIT(iso(8 * 24 * HOUR)) });
    await waitFor(() => expect(body()).toContain("we sampled"));
    expect(body()).toContain("This audit is scheduled to run every day, but this is the latest run on record, 8 days old.");
    expect(body()).not.toContain("We run this audit every day.");
  });

  it("a re-check from this morning still is (the control)", async () => {
    mountGhost({ computed_at: iso(0), stale_parts: [], ghost_stats: { ...GHOST, computed_at: iso(0) } },
      { get_audit_result: AUDIT(iso(6 * HOUR)) });
    await waitFor(() => expect(body()).toContain("We run this audit every day."));
    expect(auditAgeHours(iso(37 * HOUR))).toBeGreaterThan(36);
    expect(auditAgeHours("not a date")).toBeNull();
  });
});

describe("/hiring-trends (S14X-160)", () => {
  const WEEKS = [
    { week_start: "2026-10-19", new_postings: 100, closed: 10, entry_level: 5, remote: 10, live_new: 90 },
    { week_start: "2026-10-26", new_postings: 120, closed: 12, entry_level: 6, remote: 12, live_new: 110 },
    { week_start: "2026-11-02", new_postings: 130, closed: 13, entry_level: 7, remote: 13, live_new: 120 },
    { week_start: "2026-11-09", new_postings: 40, closed: 4, entry_level: 2, remote: 4, live_new: 38 },
  ];
  const mount = (cache: unknown) => {
    rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === "get_stats_cache" ? cache : null }));
    return render(<HelmetProvider><MemoryRouter><HiringTrends /></MemoryRouter></HelmetProvider>);
  };

  it("prints the cache's stamp, and names the parts it carried", async () => {
    const at = iso(2 * HOUR);
    mount({ computed_at: at, stale_parts: ["hiring_trends", "entry_stats"], hiring_trends: WEEKS, trending_categories: [] });
    await waitFor(() => expect(document.querySelector("[data-trends-as-of]")).not.toBeNull());
    expect(body()).toContain(`Figures as of ${stampText(at)} — carried forward: the latest hourly recomputation could not finish the weekly counts, so those are from an earlier run`);
    expect(body()).not.toContain("entry_stats");
  });

  it("prints the stamp alone when nothing was carried, and nothing for a live read", () => {
    expect(trendsStamp({ computed_at: "2026-11-15T03:27:00Z", stale_parts: [] })).toEqual({ at: "2026-11-15T03:27:00Z", carried: [] });
    expect(trendsStamp({ stale_parts: ["hiring_trends"] })).toBeNull();
    expect(trendsStamp(null)).toBeNull();
  });
});

describe("/pay-transparency (S14X-160)", () => {
  it("says which part its refresh carried", async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve({
      data: fn === "get_transparency_cache"
        ? { computed_at: iso(HOUR), stale_parts: ["pay"], pay: { overall: { total: 1000, with_pay: 400 }, by_category: [], by_source: [], by_company: [] }, coverage: null }
        : null,
    }));
    render(<HelmetProvider><MemoryRouter><PayTransparencyIndex /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(document.querySelector("[data-pay-carried]")).not.toBeNull());
    expect(body()).toMatch(/Carried forward: the latest hourly recomputation could not finish the pay shares, so that part is from an earlier run/);
  });
});

describe("the five data pages format with a stated locale (S14X-255)", () => {
  for (const f of ["GhostJobIndex", "HiringTrends", "PayTransparencyIndex", "ScoreStudy", "DataApi"]) {
    it(`${f} makes no bare toLocale call`, () => {
      const code = codeOf(readFileSync(resolve(ROOT, `src/pages/${f}.tsx`), "utf8"));
      expect(code).not.toMatch(/\.toLocale(?:Date|Time)?String\(\s*\)/);
      expect(code).not.toMatch(/\.toLocale(?:Date|Time)?String\(\s*undefined\b/);
    });
  }
});
