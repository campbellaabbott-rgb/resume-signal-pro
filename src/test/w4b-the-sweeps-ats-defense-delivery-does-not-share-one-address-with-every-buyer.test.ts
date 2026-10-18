// @vitest-environment node
/**
 * THE SWEEP'S ATS DEFENSE DELIVERY DOES NOT SHARE ONE ADDRESS WITH EVERY BUYER.
 *
 * Critical path CP-030 (2026-10-12). generate-ats-defense counted every call
 * against the caller's address, twenty an hour. Our own servers (the retry
 * sweep, the webhook, the purchase verifier) share one egress address, so
 * every buyer's server-side delivery shared that one bucket, and anyone could
 * spend it by asking warm-up to ping the function: the twenty-first delivery
 * of the hour was refused as if a stranger had sent it. ATS Defense is no
 * longer sold (owner decision 2026-10-12); a buyer who already paid is still
 * delivered for 90 days, by that sweep.
 *
 * Held by RUNNING the shipped handler with Stripe, the database and the model
 * faked, while the address's hour is spent:
 *   - the sweep's call, which carries the service-role key, skips the address
 *     bucket and reaches the model;
 *   - it still pays the purchase's own day (the sess: bucket), the bound that
 *     matters per buyer;
 *   - a browser's call from that address is refused as before.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

type Session = { id: string; payment_status: string; metadata: Record<string, string>; customer_details?: { email: string } };
type RateArgs = { p_function: string; p_ip: string; p_max_requests: number };

const SERVICE_KEY = "service_harness_key_0123456789abcdef";
const ADDRESS = "203.0.113.30";
const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);

const sessions = new Map<string, Session>();
let handler: EdgeHandler;
let db: FakeDb;
let rateCalls: RateArgs[];
let aiRequests: number;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    LOVABLE_API_KEY: "lovable_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__atsStripe = async (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error(`No such checkout.session: '${id}'`);
    return JSON.parse(JSON.stringify(s));
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiRequests++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-ats-defense", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id) => globalThis.__atsStripe(id) } }; } }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__atsDb; }",
  });
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  rateCalls = [];
  aiRequests = 0;
  // The address's hour is SPENT; every other bucket (the purchase's day) passes.
  db.rpcs.check_rate_limit = (a) => {
    const call = { p_function: String(a.p_function), p_ip: String(a.p_ip), p_max_requests: Number(a.p_max_requests) };
    rateCalls.push(call);
    if (call.p_function === "generate-ats-defense" && call.p_ip === ADDRESS) return { data: false, error: null };
    return { data: true, error: null };
  };
  (globalThis as Record<string, unknown>).__atsDb = db;
  sessions.clear();
  sessions.set("cs_live_ats_sweep", { id: "cs_live_ats_sweep", payment_status: "paid", metadata: { product_type: "ats_defense" }, customer_details: { email: "buyer@example.com" } });
});

const ask = (bearer: string | null) => handler(new Request("https://harness.supabase.co/functions/v1/generate-ats-defense", {
  method: "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": ADDRESS, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify({ sessionId: "cs_live_ats_sweep", resumeText: RESUME }),
}));

describe("while the shared address's hour is spent", () => {
  it("the sweep's delivery (service-role key) skips the address bucket, pays the purchase's day, and reaches the model", async () => {
    const res = await ask(SERVICE_KEY);
    expect(res.status, "the sweep's delivery was refused like a stranger's").not.toBe(429);
    expect(aiRequests, "the delivery never reached the model").toBeGreaterThan(0);
    expect(rateCalls.some((c) => c.p_function === "generate-ats-defense" && c.p_ip === ADDRESS), "the service caller was counted by address").toBe(false);
    expect(rateCalls.some((c) => c.p_ip.startsWith("sess:")), "the purchase's own day was not counted").toBe(true);
  });

  it("a browser's call from that address is still refused, before any model call", async () => {
    const res = await ask("anon_harness");
    expect(res.status).toBe(429);
    expect(aiRequests).toBe(0);
    expect(rateCalls.some((c) => c.p_function === "generate-ats-defense" && c.p_ip === ADDRESS)).toBe(true);
  });

  it("a bearer that is not the service-role key (a stranger's guess, or none) is a browser", async () => {
    expect((await ask("service_harness_key_0123456789abcdeg")).status).toBe(429);
    expect((await ask(null)).status).toBe(429);
    expect(aiRequests).toBe(0);
  });
});
