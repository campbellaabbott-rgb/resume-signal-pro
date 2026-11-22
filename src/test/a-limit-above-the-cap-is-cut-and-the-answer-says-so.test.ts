// @vitest-environment node
/**
 * A KEYLESS SEARCH THAT ASKED FOR 50 ROWS IS TOLD IT GOT A PAGE OF 10 AND HOW
 * TO GET THE NEXT ONE (lane fix/1121-connector-errors, item 4).
 *
 * Live 2026-11-21: limit 50 with no key answered 9 rows and said nothing,
 * which reads as the board running out. No cap changes here: the answer
 * says the cap it met.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CLAUDE_ADDR = "160.79.105.10";
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `greenhouse:acme:${i}`, source: "greenhouse", title: `Nurse ${i}` }));

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = (b) => new Response(JSON.stringify({ jobs: rows(Number(b.limit ?? 20)), total: 500, hasMore: true, nextOffset: Number(b.limit ?? 20) }), { status: 200 });
}, 120_000);

const call = async (args: Record<string, unknown>, o: { address?: string; key?: boolean } = {}) => {
  const r = await m.rpc("tools/call", { name: "search_jobs", arguments: args }, {
    ...(o.address ? { "x-forwarded-for": o.address } : {}),
    ...(o.key ? { authorization: "Bearer rb_live_harness_key" } : {}),
  });
  const res = r.result as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: res.isError === true, body: JSON.parse(res.content[0].text) as Record<string, unknown> };
};

describe("a limit above the cap is cut, and the answer says so", () => {
  it("keyless limit 50: the board is asked for 10, and the answer names the page it got and nextOffset", async () => {
    const r = await call({ query: "nurse", limit: 50 });
    expect(m.boardCalls[0].limit).toBe(10);
    expect(r.body).toMatchObject({ limitAsked: 50, limitApplied: 10 });
    expect(String(r.body.limitNote)).toMatch(/^A search with no key returns 10 rows a page; ask for the next page with offset = nextOffset\./);
    expect(String(r.body.limitNote)).toMatch(/60 a page with a free key from https:\/\/resumebooster\.work\/data-api/);
  });
  it("a caller on Claude's servers is told the page, and nothing about a key its host has no field for", async () => {
    const r = await call({ query: "nurse", limit: 50 }, { address: CLAUDE_ADDR });
    expect(r.body.limitApplied).toBe(10);
    expect(String(r.body.limitNote)).not.toMatch(/free key|data-api|x-api-key|Authorization/);
  });
  it("keyed limit 500 is cut to 60, and said", async () => {
    m.answers.api_key_check = { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null };
    const r = await call({ query: "nurse", limit: 500 }, { key: true });
    expect(r.body).toMatchObject({ limitAsked: 500, limitApplied: 60 });
    expect(String(r.body.limitNote)).toMatch(/at most 60 rows; ask for the next with offset = nextOffset/);
  });
  it.each(["lots", 0])("limit %j is the default page, with the note", async (limit) => {
    const r = await call({ query: "nurse", limit });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ limitAsked: limit, limitApplied: 10 });
  });
  it.each([null, "", 10, 5])("limit %j adds no field", async (limit) => {
    const r = await call({ query: "nurse", limit });
    expect(r.isError).toBe(false);
    for (const k of ["limitAsked", "limitApplied", "limitNote"]) expect(r.body).not.toHaveProperty(k);
  });
});

describe("/v1 says the cap it met on every list route", () => {
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

  it("/v1/companies?limit=500 answers page.maxLimit 100 and disclosures.limitCapped", async () => {
    const r = await callApi(handler, "/v1/companies?limit=500");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect((r.body.page as { maxLimit: number }).maxLimit).toBe(100);
    expect((r.body.disclosures as { limitCapped: unknown }).limitCapped).toEqual({ requested: 500, applied: 100, reason: "max_limit" });
  });
  it("/v1/changes?limit=500 says the same", async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(since)}&limit=500`);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect((r.body.page as { maxLimit: number }).maxLimit).toBe(100);
    expect((r.body.disclosures as { limitCapped: { requested: number } }).limitCapped.requested).toBe(500);
  });
  it("engine=ranked limit=500 says the same, and the board is asked for 100", async () => {
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=nurse&limit=500");
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect((r.body.page as { maxLimit: number }).maxLimit).toBe(100);
    expect((r.body.disclosures as { limitCapped: unknown }).limitCapped).toEqual({ requested: 500, applied: 100, reason: "max_limit" });
    expect((fetched.find((f) => f.url.endsWith("/functions/v1/job-board"))?.body as { limit: number }).limit).toBe(100);
  });
  it("the default engine says max_limit too; a limit within the cap adds nothing", async () => {
    const r = await callApi(handler, "/v1/jobs?q=nurse&limit=500");
    expect((r.body.disclosures as { limitCapped: unknown }).limitCapped).toEqual({ requested: 500, applied: 100, reason: "max_limit" });
    const ok = await callApi(handler, "/v1/companies?limit=50");
    expect(ok.body).not.toHaveProperty("disclosures");
  });
});
