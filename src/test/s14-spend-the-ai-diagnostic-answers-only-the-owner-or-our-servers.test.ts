// @vitest-environment node
/**
 * THE AI DIAGNOSTIC ANSWERS ONLY THE OWNER OR OUR OWN SERVERS (S14 hotfix,
 * lane spend, M-S14-056).
 *
 * WHAT WAS WRONG. test-ai-fallback, the /health-check "AI Model Fallback
 * Chain" panel, asks up to four paid models per call on the project's key,
 * and it answered the publishable key: any stranger could spend those calls
 * and use up the three an hour the owner's own check needs, during an
 * outage, when the report matters most.
 *
 * WHAT HOLDS NOW (the shipped handler; the database and the model faked):
 *   - no key, a wrong key, and an empty key are answered 401 before anything
 *     is counted and before any model call;
 *   - the owner's ADMIN_API_KEY, as x-admin-key or as the body's adminKey
 *     (how /health-check sends it), and the service-role key reach the model;
 *   - the preflight allows x-admin-key and says the build that carries this.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const ADMIN_KEY = "owner-admin-key-harness-0123456789";
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, LOVABLE_API_KEY: "lov", ADMIN_API_KEY: ADMIN_KEY };

let handler: EdgeHandler;
let aiCalls: number;
let rateCalls: number;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: "AI fallback test successful" } }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("test-ai-fallback", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__s14DiagDb; }",
  });
}, 180_000);

beforeEach(() => {
  aiCalls = 0;
  rateCalls = 0;
  const db = new FakeDb();
  db.rpcs.check_rate_limit = () => { rateCalls++; return { data: true, error: null }; };
  (globalThis as Record<string, unknown>).__s14DiagDb = db;
});

async function run(headers: Record<string, string>, body: Record<string, unknown> = { mode: "quick" }) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/test-ai-fallback", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: "anon_harness", "cf-connecting-ip": "203.0.113.70", ...headers },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

describe("a stranger spends no model call through the diagnostic", () => {
  for (const [what, headers, body] of [
    ["the publishable key alone", { authorization: "Bearer anon_harness" }, { mode: "quick" }],
    ["the publishable key asking for every model", { authorization: "Bearer anon_harness" }, { mode: "all" }],
    ["a wrong admin key as the header", { authorization: "Bearer anon_harness", "x-admin-key": "guess" }, { mode: "quick" }],
    ["a wrong admin key in the body", { authorization: "Bearer anon_harness" }, { mode: "quick", adminKey: `${ADMIN_KEY}x` }],
    ["an empty admin key", { authorization: "Bearer anon_harness", "x-admin-key": "" }, { mode: "quick", adminKey: "" }],
  ] as const) {
    it(`${what}: 401, nothing counted, no model call`, async () => {
      const r = await run(headers, body);
      expect(r.status).toBe(401);
      expect(r.json.success).toBe(false);
      expect(rateCalls, "a stranger spent one of the owner's three an hour").toBe(0);
      expect(aiCalls, "a stranger reached the model").toBe(0);
    });
  }
});

describe("the owner and our own servers still run it", () => {
  for (const [what, headers, body] of [
    ["the admin key as x-admin-key", { authorization: "Bearer anon_harness", "x-admin-key": ADMIN_KEY }, { mode: "quick" }],
    ["the admin key as the body's adminKey, as /health-check sends it", { authorization: "Bearer anon_harness" }, { mode: "quick", adminKey: ADMIN_KEY }],
    ["the service-role key", { authorization: `Bearer ${SERVICE_KEY}` }, { mode: "quick" }],
  ] as const) {
    it(`${what} reaches the model`, async () => {
      const r = await run(headers, body);
      expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
      expect(r.json.success).toBe(true);
      expect(aiCalls).toBeGreaterThan(0);
    });
  }

  it("the body's mode is still read once the key is checked: all asks each model", async () => {
    const r = await run({ authorization: "Bearer anon_harness" }, { mode: "all", adminKey: ADMIN_KEY });
    expect(r.json.mode).toBe("all");
    expect(aiCalls).toBeGreaterThanOrEqual(3);
  });

  it("the preflight allows x-admin-key and answers the build that carries this", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/test-ai-fallback", { method: "OPTIONS" }));
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").split(",").map((h) => h.trim().toLowerCase());
    expect(allowed).toContain("x-admin-key");
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "test-ai-fallback", "2026-11-10", 1)).toBe(true);
  });
});
