// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE PAID TIER NEEDS A PAID SESSION, AND AN UNREADABLE DRAFT IS NO DELIVERY.
 *
 * Defect sweep 1.60 (register L13-41): generate-interview-coach and
 * generate-career-path served their $5 paid tier (model answers, a 90-day
 * plan, bigger budgets) to anyone who sent isPremium:true. Register L5-12:
 * when the model's reply could not be parsed, generate-keyword-fix answered
 * 200 with an empty analysis and an invented "overallScore: 50", which the
 * webhook saved and marked delivered.
 *
 * Run against the shipped handlers with only their network faked:
 *   - isPremium from a browser with no purchase, or with a purchase of
 *     something else (a scan pack), is refused 402 before the model;
 *   - with the right purchase it reaches the model with the paid budget;
 *   - our own servers (the service-role key) still deliver it;
 *   - the free tier (no isPremium) is unchanged;
 *   - an unparseable keyword analysis is a retryable 502, never a 200.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient() { const db = globalThis.__tierDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";

const handlers = new Map<string, EdgeHandler>();
let db: FakeDb;
let aiBodies: Array<Record<string, unknown>>;
let aiReply: () => Response;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return aiReply();
    }
    return new Response("{}", { status: 200 });
  };
  for (const fn of ["generate-interview-coach", "generate-career-path", "generate-keyword-fix"]) {
    handlers.set(fn, await loadEdgeHandler(fn, STUBS));
  }
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rows("used_stripe_sessions").push(
    { session_id: "cs_coach", product_type: "interview_coach" },
    { session_id: "cs_path", product_type: "career_path_simulator" },
    { session_id: "cs_scanpack", product_type: "scan_pack" },
    { session_id: "cs_fix", product_type: "basic_keyword_fix" },
  );
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__tierDb = db;
  aiBodies = [];
  aiReply = () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"questions\":[],\"paths\":[]}" } }] }), { status: 200 });
});

async function call(fn: string, body: Record<string, unknown>, bearer = "anon_harness") {
  const res = await handlers.get(fn)!(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, apikey: bearer, "cf-connecting-ip": "198.51.100.7" },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: parsed };
}

const PAID: Array<{ fn: string; session: string; budget: number }> = [
  { fn: "generate-interview-coach", session: "cs_coach", budget: 9000 },
  { fn: "generate-career-path", session: "cs_path", budget: 5500 },
];
const budgetOf = (b: Record<string, unknown>) => Number(b.max_tokens ?? b.max_completion_tokens);

describe.each(PAID)("$fn: the paid tier", ({ fn, session, budget }) => {
  it("is refused (402) to a browser with no purchase, or the wrong one, before the model", async () => {
    for (const sessionId of [undefined, "cs_never_paid", "cs_scanpack"]) {
      const r = await call(fn, { resumeText: RESUME, isPremium: true, sessionId });
      expect(r.status, String(sessionId)).toBe(402);
    }
    // Any truthy value selects the paid tier, so any truthy value is gated.
    expect((await call(fn, { resumeText: RESUME, isPremium: "yes" })).status).toBe(402);
    expect(aiBodies).toEqual([]);
  });

  it("is served to its own purchase, with the paid budget", async () => {
    await call(fn, { resumeText: RESUME, isPremium: true, sessionId: session });
    expect(aiBodies.length).toBeGreaterThan(0);
    expect(budgetOf(aiBodies[0])).toBe(budget);
  });

  it("is still delivered by our own servers (the service-role key)", async () => {
    await call(fn, { resumeText: RESUME, isPremium: true, sessionId: session }, SERVICE_KEY);
    expect(aiBodies.length).toBeGreaterThan(0);
    expect(budgetOf(aiBodies[0])).toBe(budget);
  });

  it("leaves the free tier alone", async () => {
    await call(fn, { resumeText: RESUME });
    expect(aiBodies.length).toBeGreaterThan(0);
    expect(budgetOf(aiBodies[0])).toBe(4000);
  });
});

describe("generate-keyword-fix: an unreadable analysis is a retryable failure", () => {
  it("answers 502 retryable, never a 200 with an invented score", async () => {
    aiReply = () => new Response(JSON.stringify({ choices: [{ message: { content: "Sorry, here is your analysis: missingKeywords are Python and" } }] }), { status: 200 });
    const r = await call("generate-keyword-fix", { resumeText: RESUME, jobDescription: "We hire engineers to own checkout end to end.", jobTitle: "Engineer", sessionId: "cs_fix" });
    expect(r.status).toBe(502);
    expect(r.body.retryable).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/overallScore/);
  });
});
