// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE SCAN FALLBACK PUT ANY "LANGUAGE" IN ITS PROMPT, AND CHARGED A SLOT FOR A
 * REPLAY (sweep S8-064; S8-068 and S8-070 kept in step with the primary).
 *
 * free-keyword-scan-stream interpolated the request body's `language` into
 * the system prompt twice when the résumé read as English, at any length:
 * "English. " followed by 200,000 Zs made a 409,518-character prompt. It also
 * counted a day's scan slot before reading its cache, and keyed that cache by
 * the applying-to country only, so the same text from two countries shared
 * the first requester's market sections.
 *
 * Run against the shipped handler, network faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT =
  "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = { "https://esm.sh/@supabase/supabase-js@2": CLIENT };

const RESUME = "Jane Q. Candidate\nEXPERIENCE\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts\n- Built the monthly close model in Excel and SQL\n";

let handler: EdgeHandler;
let db: FakeDb;
let prompts: string[];
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
    SUPABASE_ANON_KEY: "anon_harness",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const body = JSON.parse(init?.body ?? "{}") as { messages?: Array<{ role: string; content: string }> };
      prompts.push(body.messages?.find((m) => m.role === "system")?.content ?? "");
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("free-keyword-scan-stream", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.acquire_scan_slot = () => ({ data: "slot-1", error: null });
  db.rpcs.release_scan_slot = () => ({ data: null, error: null });
  db.rpcs.log_scan_metric = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__streamDb = db;
  prompts = [];
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});

afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

async function scan(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.21", ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  return [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
}

describe("the request's language", () => {
  it("reaches the prompt only as a language name, never as the caller's text", async () => {
    await scan({ resumeText: RESUME, language: "English. " + "Z".repeat(200_000) });
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).not.toContain("ZZZZZZZZ");
      expect(p.length).toBeLessThan(40_000);
    }
  });

  it("a real locale is still named", async () => {
    await scan({ resumeText: RESUME, language: "de" });
    expect(prompts.some((p) => p.includes("Respond in German"))).toBe(true);
  });
});

describe("in step with the primary", () => {
  it("a cache hit spends no day's slot", async () => {
    let slots = 0;
    db.rpcs.check_rate_limit = () => { slots++; return { data: true, error: null }; };
    db.rpcs.get_cached_response = () => ({ data: { industry: "finance", atsScoreEstimate: 70, keywords: [] }, error: null });
    const events = await scan({ resumeText: RESUME });
    expect(events.some((e) => e.event === "complete")).toBe(true);
    expect(slots).toBe(0);
  });

  it("the same text from two countries is two cache entries when the résumé names no place", async () => {
    const keys: string[] = [];
    db.rpcs.get_cached_response = (a) => { keys.push(String(a.p_cache_key)); return { data: null, error: null }; };
    await scan({ resumeText: RESUME }, { "cf-ipcountry": "US" });
    await scan({ resumeText: RESUME }, { "cf-ipcountry": "GB" });
    expect(new Set(keys).size).toBe(2);
  });
});
