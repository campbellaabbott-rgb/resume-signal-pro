// @vitest-environment node
/**
 * THE EMPLOYER DIRECTORY IS DATED BY THE PASS THAT COUNTED IT (S14X-274,
 * C-S14-121).
 *
 * /v1/companies dated its per-employer counts with the meta row's
 * updated_at, which the headline recount moves between passes without
 * recounting a single employer, and a pass whose facet query failed carries
 * the previous counts under its own stamp. The directory, and the companies
 * figure on /v1/stats, now carry the counted time (refreshedAt, or the carried
 * counted time on a carry) and say whether the counts were carried.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { carriedCountsAt } from "../../supabase/functions/job-board/facet-carry";
import { countedAt, countsCarried } from "../../supabase/functions/public-api/facet-stamp";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const UPDATED = "2026-11-15T03:45:00.000Z";
const PASS = "2026-11-15T03:13:00.000Z";
const COUNTED = "2026-11-15T01:00:00.000Z";

describe("the public-api stamp is the board's stamp", () => {
  it("answers exactly what job-board's carriedCountsAt answers, on every shape a row takes", () => {
    const table: Array<Record<string, unknown> | null | undefined> = [
      null, undefined, {},
      { refreshedAt: PASS },
      { refreshedAt: PASS, facetsCarried: true, facetsCarriedAt: COUNTED },
      { refreshedAt: PASS, facetsCarried: true },
      { refreshedAt: PASS, facetsCarried: true, facetsCarriedAt: "" },
      { refreshedAt: "", facetsCarried: false, facetsCarriedAt: COUNTED },
      { refreshedAt: 7, facetsCarried: 1, facetsCarriedAt: COUNTED },
    ];
    for (const row of table) expect(countedAt(row), JSON.stringify(row)).toBe(carriedCountsAt(row));
    expect(countsCarried({ facetsCarried: true })).toBe(true);
    expect(countsCarried({ refreshedAt: PASS })).toBe(false);
    expect(countsCarried(null)).toBe(false);
  });
});

let handler: EdgeHandler;
let db: RecordingDb;
let v: Record<string, unknown>;

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  v = {
    refreshedAt: PASS,
    companiesFacet: [{ token: "acme", name: "Acme", count: 9 }, { token: "globex", name: "Globex", count: 3 }],
    companiesOpen: { acme: 7, globex: 2 },
    companiesOpenCount: 2,
    coverage: { open: 9, tracked: 12, openAt: UPDATED },
  };
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
  db.rpcs.get_stats_cache = () => ({ data: null, error: null });
  db.tables.job_board_meta = [{ k: "refresh", v, updated_at: UPDATED }];
  useDb(db);
});

describe("GET /v1/companies and /v1/stats, as shipped", () => {
  it("a fresh pass dates the directory by its own refreshedAt, never by the row's updated_at", async () => {
    const r = await callApi(handler, "/v1/companies");
    expect(r.status).toBe(200);
    expect(r.body.asOf).toBe(PASS);
    expect(r.body.countsCarried).toBe(false);
  });

  it("a carried pass dates the directory by when its counts were counted, and says they were carried", async () => {
    Object.assign(v, { facetsCarried: true, facetsCarriedAt: COUNTED });
    const r = await callApi(handler, "/v1/companies");
    expect(r.body.asOf).toBe(COUNTED);
    expect(r.body.countsCarried).toBe(true);
    expect(String(r.body.basis)).toMatch(/countsCarried/);
  });

  it("/v1/stats dates its companies figure by the same pass and names the field in the basis", async () => {
    Object.assign(v, { facetsCarried: true, facetsCarriedAt: COUNTED });
    const r = await callApi(handler, "/v1/stats");
    expect(r.status).toBe(200);
    const d = r.body.data as Record<string, unknown>;
    expect(d.companies).toBe(2);
    expect(d.companiesAsOf).toBe(COUNTED);
    expect(d.companiesCarried).toBe(true);
    expect(String(d.companiesBasis)).toMatch(/companiesAsOf/);
  });
});
