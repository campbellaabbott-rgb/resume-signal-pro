// @vitest-environment node
/**
 * THE FIELD CURVE NAMES THE BOARDS IT ADMITS (S14X-277, C-S14-125).
 *
 * Since 20261012122000 get_category_fill_curve admits a role to the 14-day
 * pool only from a board read in full that has a watch floor, posted after
 * that floor, entering at the later of first sighting and the floor; the
 * day-30 figure has its own board rule. The rows have carried
 * admitted_boards_14 and admitted_boards_30 since then, and /v1/stats served
 * neither, with a basis that described the pool as every role in the field.
 * Each row now says how many boards it pools, and the basis states the rule.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let db: RecordingDb;
let row: Record<string, unknown>;

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  row = {
    category: "nursing", window_days: 90, n_at_risk_14: 300, fills_le_14: 40, fill_rate_14: 0.13,
    fill_rate_14_lo: 0.1, fill_rate_14_hi: 0.16, relist_rate_14: 0.02, still_open_14: 0.8, median_days_to_fill: null,
    median_censored: true, dated_coverage: 0.9, sufficient: true, admitted_boards_14: 3, admitted_boards_30: 1,
  };
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.get_stats_cache = () => ({ data: {
    computed_at: "2026-11-15T03:27:00Z",
    ghost_stats: { closed_90d: 10, computed_at: "2026-11-15T03:05:00Z" },
    fill_curve: { computed_at: "2026-11-15T03:27:00Z", rows: [row] },
    stale_parts: [],
  }, error: null });
  useDb(db);
});

const curve = async () => {
  const r = await callApi(handler, "/v1/stats");
  expect(r.status).toBe(200);
  return ((r.body.data as Record<string, Record<string, unknown>>).lifecycle.fillCurve) as { basis: string; data: Array<Record<string, unknown>> };
};

describe("GET /v1/stats fillCurve, as shipped", () => {
  it("each row says how many boards its 14-day and day-30 figures pool", async () => {
    const c = await curve();
    expect(c.data[0].admittedBoards14).toBe(3);
    expect(c.data[0].admittedBoards30).toBe(1);
  });

  it("a row from before the admission rule states null, not zero", async () => {
    delete row.admitted_boards_14;
    delete row.admitted_boards_30;
    const c = await curve();
    expect(c.data[0].admittedBoards14).toBeNull();
    expect(c.data[0].admittedBoards30).toBeNull();
  });

  it("the basis states the admission rule and keeps the rest of what it said", async () => {
    const { basis } = await curve();
    expect(basis).toMatch(/read in full/);
    expect(basis).toMatch(/watch floor/);
    expect(basis).toMatch(/admittedBoards14/);
    expect(basis).toMatch(/right-censored/);
    expect(basis).toMatch(/Greenwood/);
    expect(basis).toMatch(/FLOORS/);
  });
});
