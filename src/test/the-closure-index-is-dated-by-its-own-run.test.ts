// @vitest-environment node
/**
 * THE CLOSURE INDEX IS DATED BY ITS OWN RUN (S14X-160, the public-api half;
 * C-S14-120).
 *
 * /v1/stats dated lifecycle with the stats cache's root stamp. The ghost
 * index inside it is computed by its own hourly run and copied in by the
 * cache's run 22 minutes later, and when that copy fails the cache keeps the
 * previous index and names it in stale_parts. Measured 2026-11-15: lifecycle
 * said 03:27 for an index computed at 03:05. lifecycle.asOf is now the
 * index's own computed_at, and carriedForward says when it was kept.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = "2026-11-15T03:27:00.000Z";
const OWN = "2026-11-15T03:05:00.000Z";
let handler: EdgeHandler;
let cache: Record<string, unknown>;

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  cache = { computed_at: ROOT, ghost_stats: { closed_90d: 10, computed_at: OWN }, stale_parts: [] };
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.get_stats_cache = () => ({ data: cache, error: null });
  useDb(db);
});

const lifecycle = async () => {
  const r = await callApi(handler, "/v1/stats");
  expect(r.status).toBe(200);
  return (r.body.data as Record<string, Record<string, unknown>>).lifecycle;
};

describe("GET /v1/stats lifecycle, as shipped", () => {
  it("is dated by the index's own run, not by the cache that copied it", async () => {
    const l = await lifecycle();
    expect(l.asOf).toBe(OWN);
    expect(l.carriedForward).toBe(false);
  });

  it("says when the cache kept the previous index", async () => {
    cache.stale_parts = ["ghost_stats"];
    const l = await lifecycle();
    expect(l.asOf).toBe(OWN);
    expect(l.carriedForward).toBe(true);
  });

  it("says so when the index names a part of its own as stale", async () => {
    (cache.ghost_stats as Record<string, unknown>).stale_parts = ["median_days_open"];
    expect((await lifecycle()).carriedForward).toBe(true);
  });

  it("an index with no stamp of its own is dated by the cache only while it is fresh", async () => {
    cache.ghost_stats = { closed_90d: 10 };
    expect((await lifecycle()).asOf).toBe(ROOT);
    cache.stale_parts = ["ghost_stats"];
    const l = await lifecycle();
    expect(l.asOf, "a kept copy is older than the run that kept it").toBeNull();
    expect(l.carriedForward).toBe(true);
  });
});
