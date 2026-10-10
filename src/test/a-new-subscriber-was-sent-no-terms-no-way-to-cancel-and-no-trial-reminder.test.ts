// @vitest-environment node
//
// Node, not jsdom: the webhook is bundled with esbuild and the migration runs in pglite.
/**
 * A NEW SUBSCRIBER WAS SENT NO TERMS, NO WAY TO CANCEL, AND NO TRIAL REMINDER.
 *
 * WHAT WAS WRONG (commercial-readiness plan 2026-10-08, item 11; Cal. Bus. &
 * Prof. Code 17602). checkout.session.completed for a $45 Pro or $99 agent
 * plan refreshed the caches and mailed nobody: no terms, no cancellation
 * policy, no way to cancel; a trial subscriber was never told when the first
 * charge falls. customer.subscription.trial_will_end fell into "Unhandled".
 * And a referred Pro sale recorded no conversion, because its session carried
 * no code.
 *
 * WHAT HOLDS NOW, against the shipped webhook with Stripe and the database
 * faked, and the migration in pglite: one confirmation per subscription,
 * one reminder per trial three days out (none for a trial set to cancel),
 * every figure from Stripe's subscription; a queue that refused the mail
 * gives the claim back and answers 500 so Stripe redelivers; a referral on an
 * uncommissioned checkout is recorded at $0.
 *
 * A NOTICE QUOTED THE LIST PRICE TO A BUYER WITH A PROMOTION CODE (wave 3
 * review). The plan checkouts allow promotion codes, but both notices printed
 * price.unit_amount: a 100%-off or first-month code got a legal notice stating
 * a charge the buyer would not pay. They now state the discounted charge
 * Stripe computed, how long it lasts, and the list price after it.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SUBSCRIPTIONS } from "@/config/products";

const ENV: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  SUPABASE_ANON_KEY: "anon_harness",
};
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
type Sub = Record<string, any>;
const world: { subs: Record<string, Sub>; customers: Record<string, { id: string; email: string }>; previews: Record<string, number> } = { subs: {}, customers: {}, previews: {} };

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__noticeWorld;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.subscriptions = {
      retrieve: async (id) => w().subs[id],
      list: async ({ customer }) => ({ data: Object.values(w().subs).filter((s) => s.customer === customer), has_more: false }),
    };
    this.invoices = { createPreview: async ({ subscription }) => ({ amount_due: w().previews[subscription] }) };
    this.customers = {
      retrieve: async (id) => w().customers[id],
      list: async ({ email }) => ({ data: Object.values(w().customers).filter((c) => c.email === email), has_more: false }),
    };
  }
}`;

let handler: EdgeHandler;
let db: FakeDb;
let queued: Array<Record<string, any>>;
let enqueueFails: boolean;
let conversions: Array<Record<string, unknown>>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => ENV[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  g.__noticeWorld = world;
  handler = await loadEdgeHandler("stripe-webhook", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__noticeDb; export class SupabaseClient {}",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
  });
}, 120_000);

beforeEach(() => {
  world.subs = {};
  world.previews = {};
  world.customers = { cus_1: { id: "cus_1", email: "subscriber@example.com" } };
  queued = [];
  conversions = [];
  enqueueFails = false;
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rpcs.enqueue_email_delayed = (a) => {
    if (enqueueFails) return { data: null, error: { message: "queue unavailable" } };
    queued.push(a);
    return { data: queued.length, error: null };
  };
  db.rpcs.record_affiliate_conversion = (a) => { conversions.push(a); return { data: true, error: null }; };
  // The ledger's primary key is (subscription_id, kind): one claim per notice.
  const client = {
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t !== "subscription_notices") return q;
      const insert = q.insert.bind(q);
      q.insert = (row: unknown) => {
        const r = row as { subscription_id: string; kind: string };
        if (db.rows(t).some((x) => x.subscription_id === r.subscription_id && x.kind === r.kind)) {
          return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
        }
        return insert(row);
      };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
  };
  (globalThis as Record<string, unknown>).__noticeDb = client;
});

const sub = (id: string, cents: number, extra: Partial<Sub> = {}): Sub => ({
  id, customer: "cus_1", status: "active", trial_end: null, cancel_at_period_end: false, cancel_at: null, metadata: {},
  items: { data: [{ price: { unit_amount: cents, currency: "usd", recurring: { interval: "month" } } }] },
  ...extra,
});

async function deliver(type: string, object: Record<string, unknown>) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } }),
  }));
  return res.status;
}

const completed = (subId: string, extra: Record<string, unknown> = {}) => ({
  id: `cs_test_${subId}`, mode: "subscription", subscription: subId, customer: "cus_1",
  customer_details: { email: "subscriber@example.com" }, payment_status: "paid", amount_total: 4500,
  metadata: { product_type: "pro_subscription" }, ...extra,
});

const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

describe("the confirmation a new subscriber is owed", () => {
  it("a trial subscriber is told the trial's end, the first charge, the renewal and how to cancel, once", async () => {
    const trialEnd = NOW + SUBSCRIPTIONS.agent.trialDays * DAY;
    world.subs.sub_agent = sub("sub_agent", SUBSCRIPTIONS.agent.priceUsd * 100, { status: "trialing", trial_end: trialEnd });
    const event = completed("sub_agent", { payment_status: "no_payment_required", amount_total: 0, metadata: { product_type: "apply_agent" } });
    expect(await deliver("checkout.session.completed", event)).toBe(200);
    expect(queued).toHaveLength(1);
    const p = queued[0].payload;
    expect(queued[0].queue_name).toBe("transactional_emails");
    expect(p.to).toBe("subscriber@example.com");
    expect(p.text).toContain(`Your free trial ends on ${day(trialEnd)}`);
    expect(p.text).toContain(`you will be charged $${SUBSCRIPTIONS.agent.priceUsd}.00 on ${day(trialEnd)}`);
    expect(p.text).toContain("renewing automatically until you cancel");
    expect(p.text).toContain(`Cancel before ${day(trialEnd)} and you will not be charged.`);
    expect(p.text).toContain("https://resumebooster.work/account");
    expect(p.text).not.toMatch(/refund/i);
    expect(await deliver("checkout.session.completed", event)).toBe(200);
    expect(queued, "a redelivered event mailed again").toHaveLength(1);
  });

  it("a Pro subscriber is told the price and that it renews until cancelled", async () => {
    world.subs.sub_pro = sub("sub_pro", SUBSCRIPTIONS.pro.priceUsd * 100);
    expect(await deliver("checkout.session.completed", completed("sub_pro"))).toBe(200);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.text).toContain(`You are charged $${SUBSCRIPTIONS.pro.priceUsd}.00 every month. The subscription renews automatically until you cancel.`);
  });

  it("a queue that refuses gives the claim back and asks Stripe to redeliver; the redelivery sends it", async () => {
    world.subs.sub_pro = sub("sub_pro", SUBSCRIPTIONS.pro.priceUsd * 100);
    enqueueFails = true;
    expect(await deliver("checkout.session.completed", completed("sub_pro"))).toBe(500);
    expect(db.rows("subscription_notices")).toHaveLength(0);
    enqueueFails = false;
    expect(await deliver("checkout.session.completed", completed("sub_pro"))).toBe(200);
    expect(queued).toHaveLength(1);
  });

  it("a referred Pro sale is recorded at $0, since the affiliate page promises nothing for it", async () => {
    world.subs.sub_pro = sub("sub_pro", SUBSCRIPTIONS.pro.priceUsd * 100);
    await deliver("checkout.session.completed", completed("sub_pro", { metadata: { product_type: "pro_subscription", referral_code: "ab12cd34", referral_commission: "none" } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toMatchObject({ p_referral_code: "ab12cd34", p_commission_override: 0 });
  });
});

describe("a subscriber who used a promotion code", () => {
  const promo = (duration: string, end: number | null) => ({ discounts: [{ id: "di_1", end, source: { type: "coupon", coupon: { id: "co_1", duration } } }] });

  it("is told the discounted charge, until when, and the list price after it", async () => {
    const until = NOW + 90 * DAY;
    world.subs.sub_pro = sub("sub_pro", SUBSCRIPTIONS.pro.priceUsd * 100, { ...promo("repeating", until), latest_invoice: { id: "in_1", amount_paid: 2250 } });
    expect(await deliver("checkout.session.completed", completed("sub_pro", { amount_total: 2250 }))).toBe(200);
    const text = queued[0].payload.text as string;
    expect(text).toContain("Your first charge, with your promotion, is $22.50.");
    expect(text).toContain(`$22.50 every month with your promotion until ${day(until)}, then $${SUBSCRIPTIONS.pro.priceUsd}.00 every month`);
    expect(text, "the notice stated the list price as the charge").not.toContain(`You are charged $${SUBSCRIPTIONS.pro.priceUsd}.00 every month.`);
  });

  it("a code that covers the first charge says it is free, then the list price", async () => {
    world.subs.sub_pro = sub("sub_pro", SUBSCRIPTIONS.pro.priceUsd * 100, { ...promo("once", null), latest_invoice: { id: "in_1", amount_paid: 0 } });
    expect(await deliver("checkout.session.completed", completed("sub_pro", { amount_total: 0 }))).toBe(200);
    expect(queued[0].payload.text).toContain(`Your first charge, with your promotion, is $0.00. After it you are charged $${SUBSCRIPTIONS.pro.priceUsd}.00 every month.`);
  });

  it("a trial's reminder names the discounted first charge Stripe will take", async () => {
    const trialEnd = NOW + 3 * DAY;
    const s = sub("sub_agent", SUBSCRIPTIONS.agent.priceUsd * 100, { status: "trialing", trial_end: trialEnd, ...promo("forever", null) });
    world.subs.sub_agent = s;
    world.previews.sub_agent = SUBSCRIPTIONS.agent.priceUsd * 50;
    expect(await deliver("customer.subscription.trial_will_end", s)).toBe(200);
    const half = (SUBSCRIPTIONS.agent.priceUsd / 2).toFixed(2);
    expect(queued[0].payload.text).toContain(`you will be charged $${half} with your promotion on that day, and then $${half} every month (your promotion) until you cancel`);
  });
});

describe("the reminder three days before a trial ends", () => {
  it("is sent once, with the date and the amount of the first charge", async () => {
    const trialEnd = NOW + 3 * DAY;
    const s = sub("sub_agent", SUBSCRIPTIONS.agent.priceUsd * 100, { status: "trialing", trial_end: trialEnd });
    world.subs.sub_agent = s;
    expect(await deliver("customer.subscription.trial_will_end", s)).toBe(200);
    expect(await deliver("customer.subscription.trial_will_end", s)).toBe(200);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.subject).toContain(day(trialEnd));
    expect(queued[0].payload.text).toContain(`you will be charged $${SUBSCRIPTIONS.agent.priceUsd}.00 on that day`);
    expect(queued[0].payload.text).toContain("cancel before the trial ends");
  });

  it("is not sent for a trial already set to cancel", async () => {
    const s = sub("sub_agent", SUBSCRIPTIONS.agent.priceUsd * 100, { status: "trialing", trial_end: NOW + 3 * DAY, cancel_at_period_end: true });
    expect(await deliver("customer.subscription.trial_will_end", s)).toBe(200);
    expect(queued).toHaveLength(0);
  });
});

describe("the ledger (20261009130000) in a real Postgres", () => {
  it("refuses the client roles, refuses a second claim of one notice, and runs twice", async () => {
    const pg = new PGlite();
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009130000_a_subscription_notice_is_sent_once_per_subscription_and_kind.sql"), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    const { rows } = await pg.query<{ a: boolean; s: boolean }>(
      "SELECT has_table_privilege('anon','public.subscription_notices','SELECT') AS a, has_table_privilege('service_role','public.subscription_notices','INSERT') AS s",
    );
    expect(rows[0]).toEqual({ a: false, s: true });
    await pg.exec("INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_x', 'confirmation', 'a@b.co')");
    await expect(pg.exec("INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_x', 'confirmation', 'a@b.co')")).rejects.toThrow(/duplicate key/);
    await pg.close();
  });
});
