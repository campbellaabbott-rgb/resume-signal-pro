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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
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

describe("/v1 carries the same object", () => {
  let handler: EdgeHandler;
  let fetched: Fetched[];
  let apiGlobals: { Deno: unknown; fetch: unknown };
  let boardAnswer: (body: Record<string, unknown>) => Record<string, unknown> = () => ({ jobs: [], total: 0, hasMore: false });
  let db: RecordingDb;
  beforeAll(async () => {
    ({ handler, fetched } = await loadPublicApi((f) => {
      if (f.url.endsWith("/functions/v1/job-board")) return new Response(JSON.stringify(boardAnswer(f.body as Record<string, unknown>)), { status: 200 });
      if (f.url.endsWith("/functions/v1/job-fit")) return new Response(JSON.stringify({ fits: {}, matched: {}, missing: {} }), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    const g = globalThis as Record<string, unknown>;
    apiGlobals = { Deno: g.Deno, fetch: g.fetch };
  }, 120_000);
  beforeEach(() => {
    // The connector's harness installs its own globals; this block's handler reads the API's.
    Object.assign(globalThis as Record<string, unknown>, apiGlobals);
    fetched.length = 0;
    db = new RecordingDb();
    db.rpcs.api_key_check = () => ({ data: { ...ALLOWED, key_tier: "builder" }, error: null });
    db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
    db.rpcs.api_key_fit_allowance = () => ({ data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 3 }], error: null });
    db.rpcs.api_key_fit_unscored = () => ({ data: true, error: null });
    useDb(db);
  });

  const AT = new Date(Date.now() - 600_000).toISOString();
  const ROW = { k: "freshness", v: { boards: 31193, p50_min: 434.6, p95_min: 717.3, max_min: 2210.5 }, computed_at: AT };
  it("/v1/jobs has coverage.feedFreshness with the rollup's two numbers and its time", async () => {
    db.tables.job_board_stats_rollup = [ROW];
    const r = await callApi(handler, "/v1/jobs?q=nurse");
    expect(r.status).toBe(200);
    expect((r.body.coverage as { feedFreshness?: unknown }).feedFreshness).toEqual({ p50Minutes: 434.6, p95Minutes: 717.3, asOf: AT, basis: feedFreshnessOf(ROW)!.basis });
  });
  it("/v1/stats' feedFreshness deep-equals the object it answered before this lane", async () => {
    db.tables.job_board_stats_rollup = [ROW];
    const r = await callApi(handler, "/v1/stats");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    // Today's object, written out as the shipped block built it.
    expect((r.body.data as { feedFreshness: unknown }).feedFreshness).toEqual({
      boards: 31193, p50Minutes: 434.6, p95Minutes: 717.3, maxMinutes: 2210.5, asOf: AT,
      basis: "minutes since each employer feed behind a live posting was last re-verified against the employer's own system. This measures our re-check cadence, NOT how long ago a role was posted.",
    });
    expect(statsFeedFreshness(ROW)).toEqual((r.body.data as { feedFreshness: unknown }).feedFreshness);
  });
});
