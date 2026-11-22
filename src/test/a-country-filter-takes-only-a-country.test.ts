// @vitest-environment node
/**
 * A COUNTRY FILTER TAKES ONLY A COUNTRY (NB-27).
 *
 * /v1/jobs checked country codes for shape alone, so country=EU (a union,
 * not a country), ZZ or any other two letters bound a filter no posting can
 * match and answered an empty 200: a statement that a market has no jobs, in
 * answer to a code that names no market. The board validates against ISO
 * 3166-1 alpha-2 (job-board/filters.ts ISO_ALPHA2); /v1 now checks the same
 * list, held equal to the board's by this test, and refuses the rest by name.
 *
 * Since lane fix/1121-connector-errors (item 3) the list is the code set of
 * country-names.ts, one table the connector and /v1 each carry a byte-identical
 * copy of, and /v1 reads a country name (Ireland) as its code. public-api's own
 * V1_COUNTRY_CODES is gone: one list fewer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ISO_ALPHA2 } from "../../supabase/functions/job-board/filters";
import { COUNTRY_CODES as MCP_CODES } from "../../supabase/functions/agent-mcp/country-names";
import { COUNTRY_CODES as API_CODES } from "../../supabase/functions/public-api/country-names";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const API = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

describe("the /v1 country list is the board's", () => {
  it("holds exactly the codes job-board validates against, in both copies of the table", () => {
    for (const codes of [MCP_CODES, API_CODES]) {
      expect(new Set(codes)).toEqual(new Set(ISO_ALPHA2));
      expect(codes).toHaveLength(ISO_ALPHA2.size);
    }
  });
  it("public-api keeps no list of its own beside the table", () => {
    expect(API).not.toMatch(/V1_COUNTRY_CODES/);
    expect(API).toMatch(/from "\.\/country-names\.ts"/);
  });
});

let handler: EdgeHandler;
let db: RecordingDb;
beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);
beforeEach(() => {
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  useDb(db);
});

describe("GET /v1/jobs?country=, as shipped", () => {
  it("refuses a two-letter code that names no country, by name", async () => {
    for (const c of ["EU", "ZZ"]) {
      const r = await callApi(handler, `/v1/jobs?country=US,${c}`);
      expect(r.status, c).toBe(400);
      const e = r.body.error as { code: string; message: string };
      expect(e.code).toBe("invalid_value");
      expect(e.message).toContain(`"${c}"`);
      expect(e.message).not.toContain('"US"');
    }
  });

  it("still takes a real code, Kosovo, and the UK spelling", async () => {
    for (const c of ["GB", "XK", "UK", "us"]) expect((await callApi(handler, `/v1/jobs?country=${c}`)).status, c).toBe(200);
  });

  it("reads a country name as its code, binds that code and says so", async () => {
    const r = await callApi(handler, "/v1/jobs?country=Ireland");
    expect(r.status).toBe(200);
    const bound = db.queriesOf("job_board_postings").flat().filter(([, args]) => (args as unknown[])[0] === "country").map(([, args]) => (args as unknown[])[1]);
    expect(bound.length).toBeGreaterThan(0);
    expect(JSON.stringify(bound)).toContain('"IE"');
    expect(JSON.stringify(bound)).not.toMatch(/Ireland/);
    expect((r.body.disclosures as Record<string, unknown>).countryRead).toEqual({ read: { Ireland: "IE" } });
  });
});
