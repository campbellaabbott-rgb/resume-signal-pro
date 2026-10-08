// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness).
/**
 * EVERY AGENT CHECKOUT HANDED OUT A FRESH TRIAL.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L6-29; owner decision
 * 2026-10-04 "one trial per customer"). create-agent-checkout attached
 * trial_period_days to every session it made. A trial minted the paid
 * catalogue, so the loop was: start the trial, take everything, cancel before
 * day eight, start again -- with the same address, the same account, the same
 * Stripe customer.
 *
 * WHAT HOLDS NOW, against the shipped handler with Stripe, the database and
 * the auth server faked: the trial is offered only when none of the three
 * keys -- the account, its address (every Stripe customer behind it), the
 * Stripe customer the plan would bill -- has ever held an agent-priced or a
 * trialed subscription; a read that fails offers none.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SUBSCRIPTIONS } from "@/config/products";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const USER = { id: "00000000-0000-4000-8000-00000000d001", email: "returning@example.com" };
type Sub = { status: string; trial_start?: number | null; trial_end?: number | null; items: { data: Array<{ price: { unit_amount: number } }> } };
const subOf = (status: string, cents: number, extra: Partial<Sub> = {}): Sub => ({ status, items: { data: [{ price: { unit_amount: cents } }] }, ...extra });

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__trialStripe;
    this.customers = { list: async ({ email }) => ({ data: w().customers[email] ?? [], has_more: false }) };
    this.subscriptions = { list: async ({ customer }) => ({ data: w().subs[customer] ?? [], has_more: false }) };
    this.checkout = { sessions: { create: async (p) => { w().created.push(p); return { id: "cs_test_agent", url: "https://checkout.stripe.com/c/cs_test_agent", amount_total: 0, currency: "usd", mode: p.mode }; } } };
  }
}`;

let handler: EdgeHandler;
let db: FakeDb;
let stripe: { customers: Record<string, Array<{ id: string }>>; subs: Record<string, Sub[]>; created: Array<Record<string, any>> };

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
    SUPABASE_ANON_KEY: "anon_harness_key",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("create-agent-checkout", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient() { return globalThis.__trialClient; }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  stripe = { customers: {}, subs: {}, created: [] };
  const g = globalThis as Record<string, unknown>;
  g.__trialStripe = stripe;
  g.__trialClient = {
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      // .not("stripe_customer_id", "is", null), as supabase-js spells it.
      (q as Record<string, unknown>).not = (col: string, _op: string, _v: unknown) => {
        (q as unknown as { preds: Array<(r: Record<string, unknown>) => boolean> }).preds.push((r) => r[col] != null);
        return q;
      };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (jwt: string) => (jwt === "jwt-returning" ? { data: { user: USER }, error: null } : { data: { user: null }, error: { message: "bad" } }) },
  };
});

const start = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/create-agent-checkout", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer jwt-returning", "cf-connecting-ip": "198.51.100.30" },
    body: "{}",
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, session: stripe.created.at(-1) };
};

describe("the agent trial is offered once per customer", () => {
  it("a first-time customer gets the trial the board's pitch names", async () => {
    const r = await start();
    expect(r.json.url).toBeTruthy();
    expect(r.session?.subscription_data?.trial_period_days).toBe(SUBSCRIPTIONS.agent.trialDays);
    expect(r.json.trial).toBe(true);
  });

  it("an address whose customer once held the agent (now cancelled) starts paying at once", async () => {
    stripe.customers[USER.email] = [{ id: "cus_old" }];
    stripe.subs.cus_old = [subOf("canceled", 9900)];
    const r = await start();
    expect(r.json.url).toBeTruthy();
    expect(r.session?.subscription_data?.trial_period_days).toBeUndefined();
    expect(r.session?.subscription_data?.metadata).toEqual({ user_id: USER.id });
    expect(r.json.trial).toBe(false);
  });

  it("a subscription that ever had a trial, at any price, uses up the trial", async () => {
    stripe.customers[USER.email] = [{ id: "cus_old" }];
    stripe.subs.cus_old = [subOf("canceled", 4500, { trial_start: 1_700_000_000, trial_end: 1_700_600_000 })];
    expect((await start()).session?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("the account that once held an agent plan under another address gets no second trial", async () => {
    db.rows("agent_subscribers").push({ email: "old-address@example.com", user_id: USER.id, stripe_customer_id: "cus_elsewhere", status: "canceled" });
    expect((await start()).session?.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("when the account's record cannot be read, no trial is offered", async () => {
    db.faults.push({ table: "agent_subscribers", op: "select", error: { message: "boom" } }, { table: "agent_subscribers", op: "select", error: { message: "boom" } });
    const r = await start();
    expect(r.json.url).toBeTruthy();
    expect(r.session?.subscription_data?.trial_period_days).toBeUndefined();
  });
});
