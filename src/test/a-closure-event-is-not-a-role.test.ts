// @vitest-environment node
/**
 * A CLOSURE EVENT IS NOT A ROLE (S14X-192, the public-api half).
 *
 * closuresLogged90d counts closure events: a posting that came down, came
 * back and came down again is two. Its basis on /v1/stats opened "Roles an
 * employer took down", which is the count of something else. It now opens
 * with what it counts, in the wording the data pages use, and keeps the rest.
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
  db.rpcs.get_stats_cache = () => ({ data: { computed_at: "2026-11-15T03:27:00Z", ghost_stats: { closed_90d: 1_274_865 }, stale_parts: [] }, error: null });
  useDb(db);
}, 120_000);

describe("GET /v1/stats closuresLogged90dBasis, as shipped", () => {
  it("says it counts closure events, each time a posting came down", async () => {
    const r = await callApi(handler, "/v1/stats");
    expect(r.status).toBe(200);
    const l = (r.body.data as Record<string, Record<string, unknown>>).lifecycle;
    expect(l.closuresLogged90d).toBe(1_274_865);
    const basis = String(l.closuresLogged90dBasis);
    expect(basis).toMatch(/^Closure events over the window \(a posting that came down more than once counts each time\)/);
    expect(basis).not.toMatch(/Roles an employer took down/);
    // The rest of the sentence stands.
    expect(basis).toMatch(/re-listings are excluded/);
    expect(basis).toMatch(/suspect feed/);
    expect(basis).toMatch(/not a time-to-fill/);
  });
});
