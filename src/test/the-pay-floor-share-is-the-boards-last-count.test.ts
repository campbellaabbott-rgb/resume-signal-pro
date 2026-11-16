// @vitest-environment node
/**
 * THE PAY-FLOOR SHARE IS THE BOARD'S LAST COUNT (S14X-276, C-S14-124).
 *
 * Every /v1/jobs response under a salary floor stated statedPayShare 0.237,
 * a constant measured once on 2026-09-27 and typed into the source with that
 * date in its basis. The board recounts the same share on every pass
 * (coverage.salaryFloor in the meta row k = 'refresh'), and on 2026-11-15 it
 * read 0.282. The API now reads that count, dates it by the pass that took
 * it, says when the pass had to carry the previous figure, and states null
 * rather than an old number when the row cannot be read.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const AT = "2026-11-15T03:13:48.631Z";
let handler: EdgeHandler;
let db: RecordingDb;
let coverage: Record<string, unknown>;

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  coverage = { open: 600_000, salaryFloor: 0.282, workMode: 0.6, at: AT };
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.tables.job_board_meta = [{ k: "refresh", v: { coverage }, updated_at: "2026-11-15T03:40:00Z" }];
  useDb(db);
});

const cov = async (qs = "?salary_min=50000") => {
  const r = await callApi(handler, `/v1/jobs${qs}`);
  expect(r.status).toBe(200);
  return r.body.coverage as Record<string, unknown>;
};

describe("GET /v1/jobs under a salary floor, as shipped", () => {
  it("states the board's last count of the share, dated by the pass that took it", async () => {
    const c = await cov();
    expect(c.statedPayShare).toBe(0.282);
    expect(c.statedPayShareAt).toBe(AT);
    expect(c.statedPayShareCarried).toBe(false);
    const basis = String(c.statedPayShareBasis);
    expect(basis).toMatch(/salary_rank_usd IS NOT NULL/);
    expect(basis, "the basis types no figure of its own").not.toMatch(/\d\.\d|\d,\d{3}|\d+%/);
  });

  it("says when the pass carried the previous figure forward", async () => {
    coverage.staleParts = ["salaryFloor"];
    expect((await cov()).statedPayShareCarried).toBe(true);
    coverage.staleParts = ["workMode"];
    expect((await cov()).statedPayShareCarried).toBe(false);
  });

  it("states null, never a remembered number, when the count cannot be read", async () => {
    db.faults.job_board_meta = { message: "boom" };
    const c = await cov();
    expect(c.statedPayShare).toBeNull();
    expect(c.statedPayShareAt).toBeNull();
    expect(String(c.statedPayShareBasis)).toMatch(/unavailable/);
    db.faults = {};
    delete coverage.salaryFloor;
    expect((await cov()).statedPayShare).toBeNull();
  });

  it("without a salary floor the block is not read or stated", async () => {
    const c = await cov("");
    expect("statedPayShare" in c).toBe(false);
    expect(db.queriesOf("job_board_meta")).toEqual([]);
  });

  it("the source no longer carries the September constant", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");
    expect(src).not.toMatch(/0\.237/);
    expect(src).not.toMatch(/173,826/);
  });
});
