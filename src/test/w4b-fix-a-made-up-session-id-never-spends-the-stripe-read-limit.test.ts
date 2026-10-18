// @vitest-environment node
/**
 * A MADE-UP SESSION ID NEVER SPENDS THE STRIPE ACCOUNT'S READ LIMIT
 * (wave 4 round 2 review, security lens).
 *
 * WHAT WAS WRONG. generate-career-path's past-buyer path asked Stripe
 * (checkout.sessions.retrieve with the live key) about any string starting
 * "cs_" that an anonymous caller sent with isPremium, before any rate limit.
 * Anyone with the public anon key could flood it and use up the account's
 * shared read limit, which the checkouts, the webhook's reads,
 * check-subscription and delete-account also need.
 *
 * WHAT HOLDS NOW (the shipped handler, Stripe and the database faked):
 *   - an id that is not shaped like a Stripe Checkout session never reaches
 *     Stripe;
 *   - a stream of well-formed unknown ids from one address reaches Stripe at
 *     most PAST_BUYER_STRIPE_LIMITS.perAddress times, and every one is a 402;
 *   - an id Stripe already refused is not asked about again;
 *   - a bucket that cannot be read is a no (Stripe is never asked blind).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__cpDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const STRIPE = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => { globalThis.__cpStripeReads.push(id); return { id, created: Math.floor(Date.now() / 1000), payment_status: 'unpaid', status: 'open', metadata: {} }; } } }; } }";

let handler: EdgeHandler;
let db: FakeDb;
let stripeReads: string[];
let buckets: Map<string, number>;
let bucketsFail = false;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-0123456789",
    STRIPE_SECRET_KEY: "sk_test_harness", LOVABLE_API_KEY: "lovable",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  handler = await loadEdgeHandler("generate-career-path", {
    "https://deno.land/std@0.190.0/http/server.ts": SERVE,
    "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
    "https://esm.sh/stripe@18.5.0": STRIPE,
  });
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  stripeReads = [];
  buckets = new Map();
  bucketsFail = false;
  (globalThis as Record<string, unknown>).__cpDb = db;
  (globalThis as Record<string, unknown>).__cpStripeReads = stripeReads;
  db.rpcs.check_rate_limit = (a) => {
    if (bucketsFail) return { data: null, error: { message: "boom" } };
    const k = `${a.p_function}|${a.p_ip}`;
    const n = (buckets.get(k) ?? 0) + 1;
    buckets.set(k, n);
    return { data: n <= Number(a.p_max_requests), error: null };
  };
});

const call = async (sessionId: string, ip = "198.51.100.20") => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-career-path", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon", "cf-connecting-ip": ip },
    body: JSON.stringify({ resumeText: "x".repeat(80), isPremium: true, sessionId }),
  }));
  return res.status;
};

const rand = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

describe("the past-buyer path counts the caller before Stripe is asked", () => {
  it("an id not shaped like a Checkout session never reaches Stripe", async () => {
    for (const id of ["cs_x", "cs_live_short", `cs_live_${rand(20)}'--`, `cs_${rand(40)}`]) expect(await call(id)).toBe(402);
    expect(stripeReads).toEqual([]);
  });

  it("a stream of unknown well-formed ids from one address reaches Stripe at most the per-address allowance", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push(await call(`cs_live_${rand(40)}`));
    expect(statuses.every((s) => s === 402)).toBe(true);
    expect(stripeReads.length).toBeGreaterThan(0);
    expect(stripeReads.length).toBeLessThanOrEqual(10);
  });

  it("an id Stripe already refused is not asked about again", async () => {
    const id = `cs_live_${rand(40)}`;
    await call(id, "198.51.100.21");
    await call(id, "198.51.100.22");
    await call(id, "198.51.100.23");
    expect(stripeReads.filter((r) => r === id)).toHaveLength(1);
  });

  it("a bucket that cannot be read is a no", async () => {
    bucketsFail = true;
    expect(await call(`cs_live_${rand(40)}`, "198.51.100.24")).toBe(402);
    expect(stripeReads).toEqual([]);
  });
});
