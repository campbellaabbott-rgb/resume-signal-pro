// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE SCAN FALLBACK HOLDS THE PRIMARY'S GUARDS, AND LOGS NO RÉSUMÉ.
 *
 * Defect sweep 2.05: free-keyword-scan-stream (the browser's fallback, and
 * callable by anyone directly) had no regional block, no floor on what counts
 * as a résumé and no per-address request budget, so everything the primary
 * refused could be had from it. 2.19: it wrote the first 100 characters of
 * every résumé (name, email, phone) to the function logs before any check.
 * Register L13-65: it asked for correction hints with a parameter the
 * database function no longer has.
 *
 * Run against the shipped handler, network faked, every console line kept.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT =
  "export function createClient() { const db = globalThis.__streamDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = { "https://esm.sh/@supabase/supabase-js@2": CLIENT };

const CONTACT = "Jane Q. Candidate | jane.candidate@example.com | (555) 010-0199 | Austin, TX";
const RESUME = `${CONTACT}\nEXPERIENCE\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts\n`;

let handler: EdgeHandler;
let db: FakeDb;
let aiCalls: number;
let logs: string[];
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
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
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
  aiCalls = 0;
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) {
    spies.push(vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); }));
  }
});

afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

async function scan(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/free-keyword-scan-stream", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.20", ...headers },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  return { res, events, error: events.find((e) => e.event === "error")?.data };
}

describe("the fallback refuses what the primary refuses, before the model", () => {
  it("a blocked region", async () => {
    const r = await scan({ resumeText: RESUME }, { "cf-ipcountry": "RU" });
    expect(r.error?.code).toBe("geo_blocked");
    expect(aiCalls).toBe(0);
  });

  it("a few characters that are not a résumé", async () => {
    const r = await scan({ resumeText: "Jane Doe, analyst, hire me please now" });
    expect(r.error?.code).toBe("too_short");
    expect(aiCalls).toBe(0);
  });

  it("an address past the per-address request budget, and a budget that cannot be read", async () => {
    db.rpcs.check_global_rate_limit = () => ({ data: false, error: null });
    expect((await scan({ resumeText: RESUME })).error?.code).toBe("rate_limited_budget");
    db.rpcs.check_global_rate_limit = () => ({ data: null, error: { message: "boom" } });
    expect((await scan({ resumeText: RESUME })).error?.error).toMatch(/temporarily unavailable/);
    expect(aiCalls).toBe(0);
  });

  it("the daily limit, and a limiter error is not read as a pass", async () => {
    db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    expect((await scan({ resumeText: RESUME })).error?.rateLimited).toBe(true);
    db.rpcs.check_rate_limit = () => ({ data: null, error: { message: "boom" } });
    expect((await scan({ resumeText: RESUME })).error?.rateLimited).toBeUndefined();
    expect(aiCalls).toBe(0);
  });

  it("the concurrency ceiling", async () => {
    db.rpcs.acquire_scan_slot = () => ({ data: null, error: null });
    expect((await scan({ resumeText: RESUME })).error?.code).toBe("busy");
    expect(aiCalls).toBe(0);
  });

  it("a forged first forwarded hop does not buy a fresh daily bucket", async () => {
    const seen: string[] = [];
    db.rpcs.check_rate_limit = (a) => { seen.push(String(a.p_ip)); return { data: false, error: null }; };
    for (const forged of ["6.6.6.6", "7.7.7.7"]) {
      await scan({ resumeText: RESUME }, { "cf-connecting-ip": "", "x-forwarded-for": `${forged}, 203.0.113.30` });
    }
    expect([...new Set(seen)]).toEqual(["203.0.113.30"]);
  });
});

describe("no résumé text reaches the logs", () => {
  it("not on a refusal, and not on a scan that reaches the model", async () => {
    await scan({ resumeText: RESUME }, { "cf-ipcountry": "PK" });
    db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    await scan({ resumeText: RESUME });
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    await scan({ resumeText: RESUME });
    expect(aiCalls).toBeGreaterThan(0);
    const leaked = logs.filter((l) => l.includes("jane.candidate@example.com") || l.includes("Jane Q. Candidate") || l.includes("010-0199"));
    expect(leaked).toEqual([]);
  });
});

describe("correction hints use the function's real signature", () => {
  it("asks with p_days and reads detected / corrected / corrections", async () => {
    const asked: Array<Record<string, unknown>> = [];
    db.rpcs.get_industry_correction_stats = (a) => {
      asked.push(a);
      return { data: [{ detected: "sales", corrected: "marketing", corrections: 4, last_seen: null }], error: null };
    };
    await scan({ resumeText: RESUME });
    expect(asked).toEqual([{ p_days: 30 }]);
  });
});
