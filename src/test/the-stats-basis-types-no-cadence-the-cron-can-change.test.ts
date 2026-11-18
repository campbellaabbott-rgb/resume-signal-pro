// @vitest-environment node
/**
 * THE STATS BASIS TYPES NO CADENCE THE CRON CAN CHANGE (NB-32, the public-api
 * half of CW-121000).
 *
 * /v1/stats told a paying caller that feedFreshness and bySource "come from
 * a rollup recomputed every 30 minutes". That sentence was written for
 * 20261109121000, which re-times job-board-stats-rollup from every 15 minutes to every 30, and
 * shipped in the function while the migration stayed unapplied: production
 * ran the rollup every 15 minutes under a basis that said 30. A schedule is
 * moved by a migration and a basis by a function deploy, so the two can be
 * out of step in either direction. The basis now names no cadence for the
 * rollup; each block carries its own asOf, which is true whatever the cron
 * runs on.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.get_stats_cache = () => ({ data: null, error: null });
  db.tables.job_board_stats_rollup = [
    { k: "freshness", v: { boards: 10, p50_min: 30, p95_min: 200, max_min: 900 }, computed_at: "2026-11-15T03:30:00Z" },
  ];
  useDb(db);
}, 120_000);

describe("GET /v1/stats basis, as shipped", () => {
  it("names the rollup and its asOf, and no cadence for it", async () => {
    const r = await callApi(handler, "/v1/stats");
    expect(r.status).toBe(200);
    const basis = String(r.body.basis);
    expect(basis).toMatch(/feedFreshness and bySource come from a rollup/);
    expect(basis).toMatch(/each carries its own asOf/);
    const rollupClause = basis.slice(basis.indexOf("feedFreshness and bySource"));
    expect(rollupClause, "a typed cadence goes false the day a migration re-times the cron").not.toMatch(/every\s+~?\d+\s*minutes|hourly|twice an hour/i);
    expect((r.body.data as Record<string, Record<string, unknown>>).feedFreshness.asOf).toBe("2026-11-15T03:30:00Z");
  });
});
