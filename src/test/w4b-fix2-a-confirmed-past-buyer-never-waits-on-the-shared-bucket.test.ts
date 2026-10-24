// @vitest-environment node
/**
 * A CONFIRMED PAST BUYER NEVER WAITS ON THE SHARED BUCKET (wave 4 round 2
 * recheck; generate-career-path 2026-10-11.31, migration 20261011213000).
 *
 * WHAT WAS WRONG. The round 1 fix (21dc2c66) counted a per-address bucket (10
 * an hour) and a function-wide one (200 an hour) before asking Stripe about a
 * past Career Path buyer whose 30-day claim row is gone. Well-formed made-up
 * ids from about 20 addresses an hour fill the function-wide bucket, and then
 * every genuine buyer between day 30 and day 90 got 402 for the rest of the
 * hour, though their page regenerates for 90 days.
 *
 * WHAT HOLDS NOW (the shipped handler, Stripe and the database faked):
 *   - Stripe's yes is remembered in career_path_past_buyers until the
 *     buyer's 90 days end;
 *   - with the function-wide bucket full, that buyer still reaches the model,
 *     and Stripe is not asked again;
 *   - a remembered buyer refunded or disputed since is refused, and so is a
 *     remembered row whose 90 days have ended;
 *   - control: a stranger's made-up id is still refused while the bucket is full.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__cpDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const STRIPE = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => { globalThis.__cpStripeReads.push(id); const paid = globalThis.__cpPaid.has(id); return { id, created: Math.floor(Date.now() / 1000) - 40 * 86400, payment_status: paid ? 'paid' : 'unpaid', status: paid ? 'complete' : 'open', mode: 'payment', metadata: paid ? { product_type: 'career_path_simulator' } : {} }; } } }; } }";

let handler: EdgeHandler;
let db: FakeDb;
let stripeReads: string[];
let paid: Set<string>;
let buckets: Map<string, number>;
let globalFull = false;

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
  paid = new Set();
  buckets = new Map();
  globalFull = false;
  const g = globalThis as Record<string, unknown>;
  g.__cpDb = db;
  g.__cpStripeReads = stripeReads;
  g.__cpPaid = paid;
  db.rpcs.check_rate_limit = (a) => {
    if (a.p_function === "generate-career-path:stripe" && a.p_ip === "all" && globalFull) return { data: false, error: null };
    const k = `${a.p_function}|${a.p_ip}`;
    const n = (buckets.get(k) ?? 0) + 1;
    buckets.set(k, n);
    return { data: n <= Number(a.p_max_requests), error: null };
  };
  // The model answers, so a request that passes the gates finishes.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ paths: [], actionPlan90Days: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } })));
});

const call = async (sessionId: string, ip: string) => (await handler(new Request("https://harness.supabase.co/functions/v1/generate-career-path", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer anon", "cf-connecting-ip": ip },
  body: JSON.stringify({ resumeText: "Product manager with seven years in fintech. ".repeat(4), isPremium: true, sessionId }),
}))).status;

const BUYER = "cs_live_GenuinePastCareerPathBuyer0001";

describe("a genuine past buyer is remembered once and never counted again", () => {
  it("Stripe's yes is written with the end of the buyer's 90 days", async () => {
    paid.add(BUYER);
    expect(await call(BUYER, "198.51.100.40")).toBe(200);
    const row = db.rows("career_path_past_buyers").find((r) => r.stripe_session_id === BUYER);
    expect(row, JSON.stringify(db.rows("career_path_past_buyers"))).toBeTruthy();
    const days = (Date.parse(String(row!.regenerate_until)) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(49);
    expect(days).toBeLessThan(51);
  });

  it("with the function-wide bucket full, the remembered buyer still reaches the model and Stripe is not asked", async () => {
    paid.add(BUYER);
    expect(await call(BUYER, "198.51.100.41")).toBe(200);
    const reads = stripeReads.length;
    globalFull = true;
    expect(await call(BUYER, "198.51.100.42")).toBe(200);
    expect(stripeReads.length).toBe(reads);
  });

  it("control: a stranger's made-up id is refused while the bucket is full", async () => {
    globalFull = true;
    expect(await call("cs_live_MadeUpByAStrangerXXXXXXXXXX01", "198.51.100.43")).toBe(402);
  });

  it("a remembered buyer refunded or disputed since, or past their 90 days, is refused", async () => {
    db.rows("career_path_past_buyers").push({ stripe_session_id: BUYER, regenerate_until: new Date(Date.now() + 10 * 86400_000).toISOString() });
    db.rows("payment_revocations").push({ stripe_session_id: BUYER, reason: "dispute" });
    globalFull = true;
    expect(await call(BUYER, "198.51.100.44")).toBe(402);
    const ended = "cs_live_EndedPastCareerPathBuyer00001";
    db.rows("career_path_past_buyers").push({ stripe_session_id: ended, regenerate_until: new Date(Date.now() - 86400_000).toISOString() });
    expect(await call(ended, "198.51.100.45")).toBe(402);
  });
});
