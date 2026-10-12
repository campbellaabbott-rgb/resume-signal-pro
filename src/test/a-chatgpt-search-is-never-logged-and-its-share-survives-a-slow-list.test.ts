// @vitest-environment node
/**
 * A CHATGPT SEARCH IS NEVER LOGGED, AND ITS SHARE SURVIVES A SLOW LIST.
 *
 * Sweep S12-085. agent-mcp kept a search out of the demand log only for a
 * call from OpenAI's published egress, read live from
 * openai.com/chatgpt-connectors.json in 1.5 s. On a cold isolate with a slow
 * fetch the read gave nothing, [] was cached for ten minutes, and in that
 * window every ChatGPT search was logged, while the Privacy page says ChatGPT
 * searches are not kept; the same ChatGPT users were counted as "everyone
 * else", 100 a day per address with one address for all of them.
 *
 * Now a caller that says it is ChatGPT is never logged (fail-closed), and an
 * unreadable list falls back to the copy bundled in chatgpt-egress.ts, so the
 * share still follows OpenAI's address.
 *
 * agent-mcp run as shipped, its network faked with OpenAI's list failing.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { BUNDLED_CHATGPT_EGRESS_AT, BUNDLED_CHATGPT_EGRESS_V4 } from "../../supabase/functions/agent-mcp/chatgpt-egress";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const OPENAI_LIST = "https://openai.com/chatgpt-connectors.json";
/** The first /32 in OpenAI's published list as bundled. */
const OPENAI_ADDR = "100.31.168.162";
const OTHER_ADDR = "203.0.113.7";

let handler: EdgeHandler;
let listReads = 0;
let boardBodies: Array<Record<string, unknown>>;
let meter: Array<Record<string, unknown>>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body?: string } = {}) => {
    if (String(url) === OPENAI_LIST) {
      listReads++;
      return new Response("upstream timeout", { status: 504 });
    }
    if (String(url).endsWith("/functions/v1/job-board")) {
      boardBodies.push(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse" }], total: 1 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "mcp_anon_check_v2") meter.push(args);
      const data = name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: Number(args.p_bucket_cap), share_used: 1, share_cap: Number(args.p_global_cap), overall_used: 1, overall_cap: Number(args.p_overall_cap ?? 0), minute_used: 1, minute_cap: Number(args.p_minute_cap ?? 0) }
        : name === "v1_withheld_company_tokens" ? [] : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: () => ({}),
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => { boardBodies = []; meter = []; });

const search = async (address: string, o: { ua?: string; meta?: Record<string, unknown> } = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": address, ...(o.ua ? { "user-agent": o.ua } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: { query: "nurse" }, ...(o.meta ? { _meta: o.meta } : {}) } }),
  }));
  return ((await res.json()) as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
};

describe("with OpenAI's list unreadable", () => {
  it("a ChatGPT user calling from OpenAI's address is still counted in ChatGPT's share, from the bundled list", async () => {
    const sc = await search(OPENAI_ADDR, { meta: { "openai/subject": "v1/person-a" } });
    expect(listReads).toBeGreaterThan(0);
    expect(sc.unkeyed).toMatchObject({ allowance: "chatgpt-user", partition: "chatgpt" });
    expect(meter[0]).toMatchObject({ p_global_bucket: "global:chatgpt" });
  });

  it("its search is not logged, and neither is one that only says it is ChatGPT", async () => {
    await search(OPENAI_ADDR, { ua: "openai-mcp/1.0 (ChatGPT)" });
    await search(OTHER_ADDR, { ua: "openai-mcp/1.0 (ChatGPT)" });
    await search(OTHER_ADDR, { meta: { "openai/anything": "x" } });
    expect(boardBodies.map((b) => b.noLog)).toEqual([true, true, true]);
  });

  it("the claim alone never picks the share", async () => {
    const sc = await search(OTHER_ADDR, { ua: "openai-mcp/1.0 (ChatGPT)", meta: { "openai/subject": "v1/forged" } });
    expect(sc.unkeyed).toMatchObject({ allowance: "connection", partition: "other" });
  });

  it("everyone else's search is still logged", async () => {
    await search(OTHER_ADDR);
    expect(boardBodies.map((b) => b.noLog)).toEqual([undefined]);
  });
});

describe("the bundled copy", () => {
  it("is OpenAI's list as read, every entry an IPv4 prefix, dated", () => {
    expect(BUNDLED_CHATGPT_EGRESS_V4.length).toBeGreaterThan(200);
    for (const c of BUNDLED_CHATGPT_EGRESS_V4) {
      expect(c, c).toMatch(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/);
      expect(c.split("/")[0].split(".").every((o) => Number(o) <= 255), c).toBe(true);
    }
    expect(new Set(BUNDLED_CHATGPT_EGRESS_V4).size).toBe(BUNDLED_CHATGPT_EGRESS_V4.length);
    expect(BUNDLED_CHATGPT_EGRESS_V4).toContain(`${OPENAI_ADDR}/32`);
    expect(Date.parse(BUNDLED_CHATGPT_EGRESS_AT)).toBeGreaterThan(Date.parse("2026-10-01"));
  });
});
