// @vitest-environment node
/**
 * THE SMALLER PAYMENT DEFECTS OF THE 2026-10-04 SWEEP STAY FIXED.
 *
 * Each case runs a shipped handler with only its network faked
 * (helpers/edge-harness), except the two mirror checks, which compare a
 * frontend constant with the Deno constant that charges.
 *
 *   reconcile-stripe   answered any POST with up to twenty Stripe list calls
 *                      (completeness review): now the cron key, the service
 *                      role or the owner's key, or a 401 before any call.
 *   L6-11              1 and 2 scan credits ($0.20 / $0.40) are under Stripe's
 *                      $0.50 minimum: refused with a clear 400, never a 500.
 *   L6-16              a paid analysis whose stored copy failed was redeemed
 *                      anyway, so every later ask answered 409.
 *   L6-17              create-checkout keyed idempotency on the address and a
 *                      5-second bucket: a second buyer behind the same NAT, or
 *                      a double-click, collided with the first.
 *   L5-16              parse-resume-structured retried a 429 on every model,
 *                      six calls, then answered a non-retryable 500.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { OWING_SUBSCRIPTION_STATUSES as DENO_OWING } from "../../supabase/functions/_shared/subscription-standing";
import { OWING_SUBSCRIPTION_STATUSES as WEB_OWING } from "@/config/subscription-status";
import { MAX_SCAN_CREDITS, MIN_SCAN_CREDITS } from "@/config/scan-credits";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const ADMIN = "admin-key-harness-0123456789";
const VAULT_KEY = "k".repeat(64);
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: "anon_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  ADMIN_API_KEY: ADMIN,
  LOVABLE_API_KEY: "lovable_harness",
};

let stripeCalls: Array<{ op: string; args: unknown[] }>;
let db: FakeDb;
let rpcCalls: string[];

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const log = (op, args) => globalThis.__smallStripe.push({ op, args });
    this.checkout = { sessions: {
      list: async (...a) => { log("sessions.list", a); return { data: [], has_more: false }; },
      create: async (...a) => { log("sessions.create", a); return { id: "cs_test_small", url: "https://checkout.stripe.com/c/cs_test_small", amount_total: 60, currency: "usd", mode: "payment" }; },
    } };
    this.customers = { list: async (...a) => { log("customers.list", a); return { data: [], has_more: false }; } };
    this.promotionCodes = { list: async (...a) => { log("promotionCodes.list", a); return { data: [] }; } };
  }
}`;

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__smallClient;",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
  "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__smallClient;",
};

const handlers: Record<string, EdgeHandler> = {};
let aiStatuses: number[];
let aiCalls: Array<{ model: string }>;

// ONE client object for the file: create-checkout builds its client at module
// load (a warm singleton, as in production), so the object it holds must be
// the one every test reaches; it delegates to the current test's database.
const client = {
  from: (t: string) => {
    const q = db.from(t) as unknown as Record<string, unknown>;
    q.upsert = () => Promise.resolve({ data: null, error: null });
    return q;
  },
  rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__smallClient = client;
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => undefined); } };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("ai.gateway.lovable.dev")) {
      aiCalls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ error: "busy" }), { status: aiStatuses.shift() ?? 429 });
    }
    return new Response("{}", { status: 200 });
  };
  for (const fn of ["reconcile-stripe", "create-scan-pack-checkout", "create-checkout", "parse-resume-structured"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
}, 120_000);

beforeEach(() => {
  stripeCalls = [];
  rpcCalls = [];
  aiStatuses = [];
  aiCalls = [];
  db = new FakeDb();
  db.rpcs.reconcile_cron_key_matches = (a) => { rpcCalls.push("reconcile_cron_key_matches"); return { data: a.p_key === VAULT_KEY, error: null }; };
  db.rpcs.check_rate_limit = () => { rpcCalls.push("check_rate_limit"); return { data: true, error: null }; };
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  const g = globalThis as Record<string, unknown>;
  g.__smallStripe = stripeCalls;
});

const call = (fn: string, body: unknown, headers: Record<string, string> = {}) =>
  handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.40", ...headers },
    body: JSON.stringify(body),
  }));

describe("reconcile-stripe answers its cron, our servers and the owner, and nobody else", () => {
  it("a stranger's POST is a 401 that touches neither Stripe nor the database", async () => {
    const res = await call("reconcile-stripe", { lookbackHours: 336 }, { authorization: "Bearer anon_harness" });
    expect(res.status).toBe(401);
    expect(stripeCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("a key too short to be the vault's is refused before the database is asked", async () => {
    expect((await call("reconcile-stripe", {}, { "x-reconcile-cron": "short" })).status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it("a long wrong key costs exactly one key check and no Stripe call", async () => {
    expect((await call("reconcile-stripe", {}, { "x-reconcile-cron": "w".repeat(64) })).status).toBe(401);
    expect(rpcCalls).toEqual(["reconcile_cron_key_matches"]);
    expect(stripeCalls).toEqual([]);
  });

  it("the vault's key, the service role and the owner's key each run the sweep, with the lookback bounded", async () => {
    for (const headers of [{ "x-reconcile-cron": VAULT_KEY }, { authorization: `Bearer ${SERVICE}` }, { "x-admin-key": ADMIN }]) {
      stripeCalls.length = 0;
      const res = await call("reconcile-stripe", { lookbackHours: 100000 }, headers);
      expect(res.status, JSON.stringify(headers)).toBe(200);
      const body = await res.json();
      expect(body.lookbackHours).toBe(24 * 14);
      expect(stripeCalls.map((c) => c.op)).toEqual(["sessions.list"]);
    }
  });

  it("answers its build on the preflight", async () => {
    const res = await handlers["reconcile-stripe"](new Request("https://harness.supabase.co/functions/v1/reconcile-stripe", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^reconcile-stripe\.2026-10-05\.\d+$/);
  });
});

describe("the smallest credit pack is one Stripe will charge (L6-11)", () => {
  it("two credits are a clear 400 naming the minimum, with no Stripe call", async () => {
    const res = await call("create-scan-pack-checkout", { email: "b@example.com", creditAmount: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).minCredits).toBe(3);
    expect(stripeCalls.filter((c) => c.op === "sessions.create")).toEqual([]);
  });

  it("three credits go to Stripe as a 60-cent session", async () => {
    const res = await call("create-scan-pack-checkout", { email: "b@example.com", creditAmount: 3 });
    expect(res.status).toBe(200);
    const params = stripeCalls.find((c) => c.op === "sessions.create")?.args[0] as { line_items: Array<{ quantity: number; price_data: { unit_amount: number } }> };
    expect(params.line_items[0].quantity * params.line_items[0].price_data.unit_amount).toBeGreaterThanOrEqual(50);
  });

  it("the pickers' bounds are the checkout's", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/create-scan-pack-checkout/index.ts"), "utf8");
    expect(Number(/export const MIN_CREDITS = (\d+);/.exec(src)?.[1])).toBe(MIN_SCAN_CREDITS);
    expect(Number(/export const MAX_CREDITS = (\d+);/.exec(src)?.[1])).toBe(MAX_SCAN_CREDITS);
    expect(MIN_SCAN_CREDITS * 20, "the smallest pack must clear Stripe's 50-cent minimum").toBeGreaterThanOrEqual(50);
  });
});

describe("a plan that owes money is never sold twice: the card and the checkout agree on what 'owes' means", () => {
  it("the frontend list is the Deno list", () => {
    expect([...WEB_OWING].sort()).toEqual([...DENO_OWING].sort());
  });
});

describe("create-checkout's idempotency key belongs to one request (L6-17)", () => {
  it("two requests from one address in the same five seconds send different keys", async () => {
    await call("create-checkout", { currency: "usd" });
    await call("create-checkout", { currency: "usd" });
    const keys = stripeCalls.filter((c) => c.op === "sessions.create").map((c) => (c.args[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.join(" "), "the key must not carry the caller's address").not.toMatch(/198\.51\.100\.40/);
  });

  it("sends a backed-out buyer to a page that knows what they were buying (L3-15)", async () => {
    await call("create-checkout", { currency: "usd" });
    const params = stripeCalls.find((c) => c.op === "sessions.create")?.args[0] as { cancel_url: string };
    expect(params.cancel_url).toMatch(/\/payment-failed\?product=fullAnalysis$/);
  });
});

describe("parse-resume-structured on a busy gateway (L5-16)", () => {
  it("tries each model once and answers a retryable 429, not six calls and a 500", async () => {
    aiStatuses = [429, 429, 429, 429, 429, 429];
    const res = await call("parse-resume-structured", { resumeText: RESUME }, { authorization: `Bearer ${SERVICE}` });
    expect(res.status).toBe(429);
    expect((await res.json()).retryable).toBe(true);
    expect(aiCalls.map((c) => c.model)).toEqual(["openai/gpt-5", "google/gemini-2.5-pro", "openai/gpt-5-mini"]);
  });

  it("answers a 402 at once: credits are account-wide, no other model will succeed", async () => {
    aiStatuses = [402];
    const res = await call("parse-resume-structured", { resumeText: RESUME }, { authorization: `Bearer ${SERVICE}` });
    expect(res.status).toBe(402);
    expect(aiCalls).toHaveLength(1);
  });
});

describe("a paid analysis whose stored copy failed is not redeemed (L6-16)", () => {
  let h: Harness;
  beforeAll(async () => { h = await analyzeResumeHarness(); }, 60_000);
  beforeEach(() => { h.reset(); });

  it("answers 503 and redeems nothing, so the retry delivers", async () => {
    const id = "cs_live_store_flake";
    h.sessions.set(id, fullAnalysisSession(id));
    h.db.faults.push({ table: "resume_analyses", op: "insert", error: { message: "fake: disk full" } });
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status).toBe(503);
    expect(h.db.rows("purchased_content"), "the session was redeemed with nothing behind it").toHaveLength(0);
    const retry = await h.call({ resumeText: RESUME, sessionId: id });
    expect(retry.status, JSON.stringify(retry.json).slice(0, 160)).toBe(200);
    expect(typeof retry.json.shareId).toBe("string");
  });
});
