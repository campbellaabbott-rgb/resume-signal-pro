// @vitest-environment node
/**
 * A SEARCH ANSWER CARRIES THE MEASURED AGE OF THE LAST RE-CHECK AND THE TIME
 * IT WAS MEASURED (lane fix/1121-connector-errors, item 9).
 *
 * The benchmark of 2026-11-11 printed "the provider's pages don't say" how
 * fresh the data is, while the figure existed only in /v1/stats. Measured
 * 2026-11-21 16:30Z: 31,193 employer feeds behind a live posting, last
 * re-read a median of 434.6 minutes ago, 95% within 717.3.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { feedFreshnessOf, freshnessWithin, statsFeedFreshness } from "../../supabase/functions/agent-mcp/feed-freshness.ts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const AT = "2026-11-21T16:30:00Z";
const ROW = { v: { boards: 31193, p50_min: 434.6, p95_min: 717.3, max_min: 2900 }, computed_at: AT };

let m: KeylessMcp;
let rollupReads: number;
let rollup: () => Promise<{ data: unknown; error: null }>;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, hasMore: false }), { status: 200 });
  rollupReads = 0;
  rollup = async () => ({ data: ROW, error: null });
  const dbo = (globalThis as Record<string, unknown>).__keylessMcpDb as { from: (t: string) => unknown };
  const from = dbo.from;
  dbo.from = (table: string) => {
    if (table !== "job_board_stats_rollup") return from(table);
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = () => { rollupReads++; return rollup(); };
    return q;
  };
}, 120_000);

const search = async () => JSON.parse((await m.call({ query: "nurse" })).text) as Record<string, unknown>;

describe("feedFreshness on every search answer", () => {
  it("carries the two figures and the time they were measured", async () => {
    const r = await search();
    expect(r.feedFreshness).toMatchObject({ p50Minutes: 434.6, p95Minutes: 717.3, asOf: AT });
    expect(String((r.feedFreshness as Record<string, unknown>).basis)).toMatch(/not a posting's age/);
  });
  it("a second search inside five minutes makes no second rollup read", async () => {
    await search();
    await search();
    expect(rollupReads).toBe(1);
  });
  it.each([
    ["boards 0", { v: { boards: 0, p50_min: 1, p95_min: 2 }, computed_at: AT }],
    ["p95 below p50", { v: { boards: 5, p50_min: 10, p95_min: 2 }, computed_at: AT }],
    ["no computed_at", { v: { boards: 5, p50_min: 1, p95_min: 2 } }],
  ])("a row with %s leaves the field out, and the search still answers", async (_w, row) => {
    rollup = async () => ({ data: row, error: null });
    const r = await search();
    expect(r.jobs).toHaveLength(1);
    expect(r).not.toHaveProperty("feedFreshness");
  });
  it("a rollup read that never returns does not hold the answer past its grace", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => {});
      const p = freshnessWithin(never);
      await vi.advanceTimersByTimeAsync(251);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    rollup = () => new Promise(() => {});
    const t0 = Date.now();
    const r = await search();
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r).not.toHaveProperty("feedFreshness");
  });
  it("/v1/stats' object is built by the same module, as it answers today", () => {
    expect(statsFeedFreshness(ROW)).toEqual({
      boards: 31193, p50Minutes: 434.6, p95Minutes: 717.3, maxMinutes: 2900, asOf: AT,
      basis: "minutes since each employer feed behind a live posting was last re-verified against the employer's own system. This measures our re-check cadence, NOT how long ago a role was posted.",
    });
    expect(feedFreshnessOf(null)).toBeNull();
  });
});
