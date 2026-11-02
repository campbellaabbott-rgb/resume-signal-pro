// @vitest-environment node
/**
 * CHECK_JOBS_OPEN SAYS THE TEST THE BOARD RAN, NOT THE ONE ITS BUILD EXPECTS.
 *
 * The basis is published to an agent as the meaning of `open`. job-board .100
 * reads detail's row test in `exists` (S13-076): no missing stamp, inside the
 * 30-day fence. An older board asks only whether a row is stored, which reads
 * a dropped or fenced posting open. agent-mcp and job-board deploy separately,
 * so a basis chosen by agent-mcp's own build would overstate the check for as
 * long as the board ran .96. The board now names its test in the answer, and
 * the basis follows that answer (n1464).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("check_jobs_open reads its basis from the board's own answer", () => {
  let handler: EdgeHandler;
  let answer: Record<string, unknown>;
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.fetch = async (url: string) => String(url).endsWith("/functions/v1/job-board")
      ? new Response(JSON.stringify(answer), { status: 200 })
      : new Response("{}", { status: 404 });
    g.__mcpDb = {
      rpc: (name: string) => {
        const data = name === "mcp_anon_check_v2"
          ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
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

  const check = async (ids: string[]) => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_jobs_open", arguments: { ids } } }),
    }));
    return ((await res.json()) as { result: { structuredContent: { basis: string; open: Record<string, boolean> } } }).result.structuredContent;
  };

  it("a board that names the served row test gets the basis that says a dropped or fenced posting reads closed", async () => {
    answer = { open: { "greenhouse:acme:1": true }, rowTest: "served" };
    const sc = await check(["greenhouse:acme:1"]);
    expect(sc.open).toEqual({ "greenhouse:acme:1": true });
    expect(sc.basis).toMatch(/passes the test get_job applies/);
    expect(sc.basis).toMatch(/past the cap reads closed here/);
    expect(sc.basis).not.toMatch(/WEAKER/);
  });

  it("a board that does not (job-board .96) gets the weaker basis: open there can include a posting get_job declines", async () => {
    answer = { open: { "greenhouse:acme:1": true } };
    const sc = await check(["greenhouse:acme:1"]);
    expect(sc.basis, "against .96 the basis claimed a check the board did not make").not.toMatch(/passes the test get_job applies/);
    expect(sc.basis).toMatch(/WEAKER/);
    expect(sc.basis).toMatch(/can still read open here while get_job declines/);
  });

  it("any other value, or none, is the weaker basis", async () => {
    for (const rowTest of ["row", "", 1, true, null]) {
      answer = { open: { "greenhouse:acme:1": false }, rowTest };
      expect((await check(["greenhouse:acme:1"])).basis, String(rowTest)).toMatch(/WEAKER/);
    }
  });
});
