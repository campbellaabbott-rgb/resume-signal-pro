// @vitest-environment node
/**
 * THE KEYLESS PAGE CAP HOLDS WHATEVER CREDENTIAL FAILED (S13-103).
 *
 * A keyless search pages to offset 200: past it, the answer says so by name
 * and nothing is counted. The cap was checked only when the request carried
 * no credential at all. A credential that fails still answers a keyless tool
 * keyless: a junk OAuth bearer ("Authorization: Bearer x", malformed) and a
 * key the check does not recognise (unknown_key) both reached the keyless
 * answer, which never looked at the offset, so search_jobs at offset 9000 was
 * counted and asked of the board. The cap now lives where every keyless
 * answer passes.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("a keyless page past offset 200 is refused by name, however the call arrived", () => {
  let handler: EdgeHandler;
  let boardBodies: Array<Record<string, unknown>>;
  let rpcNames: string[];
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string, init: { body?: string } = {}) => {
      if (String(url).endsWith("/functions/v1/job-board")) {
        boardBodies.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
        return new Response(JSON.stringify({ jobs: [], total: 0, ignoredFilters: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    g.__mcpDb = {
      rpc: (name: string) => {
        rpcNames.push(name);
        const data = name === "mcp_anon_check_v2"
          ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
          : name === "api_key_check"
          ? { is_allowed: false, deny_reason: "unknown_key", rate_limit: 0, rate_used: 0, quota_limit: 0, quota_used: 0 }
          : null;
        const r = Promise.resolve({ data, error: null });
        return Object.assign(r, { maybeSingle: () => r, single: () => r });
      },
      from: () => ({}),
    };
    handler = await loadEdgeHandler("agent-mcp", {
      "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
    });
  }, 120_000);
  beforeEach(() => { boardBodies = []; rpcNames = []; });

  const search = async (offset: number, headers: Record<string, string>) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: { query: "nurse", offset } } }),
    }));
    return ((await res.json()) as { result: { structuredContent?: Record<string, unknown> } }).result.structuredContent ?? {};
  };

  it.each([
    ["no credential", {}],
    ["a junk OAuth bearer", { authorization: "Bearer x" }],
    ["a key the check does not recognise", { "x-api-key": "rb_live_not_a_key_anyone_holds" }],
  ])("%s, offset 9000: not counted, never asked of the board", async (_how, headers) => {
    const sc = await search(9000, headers);
    expect(sc).toMatchObject({ jobs: [], pageLimitReached: true });
    expect(boardBodies.filter((b) => b.action === "list")).toEqual([]);
    expect(rpcNames.filter((n) => n === "mcp_anon_check_v2")).toEqual([]);
  });

  it("the same junk bearer at offset 200 is still answered keyless, and counted", async () => {
    await search(200, { authorization: "Bearer x" });
    expect(boardBodies.find((b) => b.action === "list")).toMatchObject({ offset: 200 });
    expect(rpcNames.filter((n) => n === "mcp_anon_check_v2").length).toBe(1);
  });
});
