// @vitest-environment node
/**
 * A CHECKOUT EVENT DELIVERED TWICE IS ONE ROW AND ONE MAIL, AN ABANDON KEEPS
 * NO ADDRESS, A PAID SESSION IS ONE CONVERSION, A REFUNDED FIRST MONTH NAMES
 * ITS CHECKOUT, AND A SECOND LIVE PRO PLAN REACHES THE OWNER (stripe-webhook;
 * S14X-081, S14X-042, S14X-152, S14X-084, S14X-076, S14X-227's hand-off).
 *
 * WHAT WAS WRONG.
 *   S14X-081  checkout.session.async_payment_failed and .expired inserted a
 *             payment_failures row on every delivery, and the failed one
 *             mailed the buyer every time Stripe redelivered it.
 *   S14X-042  an expired (never paid) session's row kept the buyer's address.
 *   S14X-152  product_conversion held only what a Success page reported: a
 *             tab closed early, and every Pro subscription, was a sale with
 *             no conversion.
 *   S14X-084  a refund of a Pro plan's FIRST invoice named no checkout, so
 *             the affiliate's first-month commission was never rejected.
 *   S14X-076  two open Pro pages could sell two plans, and nobody heard.
 *   S14X-227  (hand-off, moved) the conversion's currency is filled by the
 *             affiliate lane's trigger from product_deliveries.metadata, which
 *             this webhook writes before it records the conversion.
 *
 * Run on the shipped webhook with Stripe, the database and mail faked.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

type World = {
  subs: Record<string, Record<string, unknown>>;
  searchHits: Array<Record<string, unknown>>;
  invoices: Record<string, Record<string, unknown>>;
  sessionsBySub: Record<string, Array<{ id: string }>>;
  listed: Array<Record<string, unknown>>;
};
const world: World = { subs: {}, searchHits: [], invoices: {}, sessionsBySub: {}, listed: [] };

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
    const w = () => globalThis.__payWorld;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.checkout = { sessions: {
      retrieve: async (id) => ({ id }),
      list: async (p) => { w().listed.push(p); return { data: p.subscription ? (w().sessionsBySub[p.subscription] ?? []) : [], has_more: false }; },
      listLineItems: async () => ({ data: [] }),
    } };
    this.customers = { retrieve: async (id) => ({ id, email: "buyer@example.com" }), list: async () => ({ data: [], has_more: false }) };
    this.subscriptions = {
      list: async ({ customer }) => ({ data: Object.values(w().subs).filter((s) => s.customer === customer), has_more: false }),
      search: async () => ({ data: w().searchHits, has_more: false }),
      retrieve: async (id) => w().subs[id] ?? { id, status: "canceled", items: { data: [] }, metadata: {} },
      cancel: async (id) => ({ id, status: "canceled" }),
    };
    this.invoices = { retrieve: async (id) => w().invoices[id], createPreview: async () => ({ amount_due: 4500 }) };
    this.invoicePayments = { list: async () => ({ data: [] }) };
    this.charges = { list: async () => ({ data: [] }), retrieve: async () => null };
  } }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__payDb; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": `export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__payMail.push(m); return { data: { id: "re_1" }, error: null }; } }; } }`,
};

let handler: EdgeHandler;
const pending: Promise<unknown>[] = [];
const mail: Array<{ subject: string; html?: string }> = [];
const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let refuseProductMail = false;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const calls: Record<string, Array<Record<string, unknown>>> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_WEBHOOK_SECRET: "whsec_harness", STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness", RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
    LOVABLE_API_KEY: "lov_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__payDb = db;
  g.__payMail = mail;
  g.__payWorld = world;
  g.fetch = async (url: string | URL, init?: RequestInit) => {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { body = {}; }
    posts.push({ url: String(url), body });
    if (String(url).endsWith("/functions/v1/send-product-email") && refuseProductMail) return new Response("{}", { status: 500 });
    if (String(url) === "https://api.resend.com/emails") mail.push(body as { subject: string });
    return new Response(JSON.stringify({ success: true, id: "re_x", data: {} }), { status: 200 });
  };
  handler = await loadEdgeHandler("stripe-webhook", STUBS);
}, 120_000);

const record = (name: string, answer: (a: Record<string, unknown>) => { data: unknown; error: { message: string } | null } = () => ({ data: true, error: null })) => {
  calls[name] = [];
  db.rpcs[name] = (a) => { calls[name].push(a); return answer(a); };
};

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  mail.length = 0;
  posts.length = 0;
  refuseProductMail = false;
  Object.assign(world, { subs: {}, searchHits: [], invoices: {}, sessionsBySub: {}, listed: [] });
  db.rpcs.mail_door_take = (a) => {
    const rows = db.rows("mail_door_counts");
    const row = rows.find((r) => r.door === a.p_door && r.bucket === a.p_bucket);
    if (!row) { rows.push({ door: a.p_door, bucket: a.p_bucket, hits: 1 }); return { data: true, error: null }; }
    if (Number(row.hits) >= Number(a.p_max)) return { data: false, error: null };
    row.hits = Number(row.hits) + 1;
    return { data: true, error: null };
  };
  // track_ab_event_optimized's repeat rule: one conversion per (test, variant, visitor, type) in 90 days.
  record("track_ab_event_optimized", (a) => {
    const rows = db.rows("ab_test_events");
    if (rows.some((r) => r.test_name === a.p_test_name && r.variant === a.p_variant && r.visitor_id === a.p_visitor_id && r.event_type === a.p_event_type)) {
      return { data: { success: true, status: "duplicate" }, error: null };
    }
    rows.push({ test_name: a.p_test_name, variant: a.p_variant, visitor_id: a.p_visitor_id, event_type: a.p_event_type });
    return { data: { success: true, status: "recorded" }, error: null };
  });
  record("record_affiliate_conversion", () => ({ data: false, error: null }));
  record("payment_revoke", () => ({ data: {}, error: null }));
  db.rpcs.log_webhook_event = () => ({ data: null, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
});

async function deliver(type: string, object: Record<string, unknown>, livemode = true) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${type}_${String(object.id)}`, type, livemode, data: { object } }),
  }));
  while (pending.length) await pending.shift();
  return res.status;
}
const productMails = () => posts.filter((p) => p.url.endsWith("/functions/v1/send-product-email"));

describe("one row and one buyer mail per checkout session (S14X-081, S14X-042)", () => {
  const failed = { id: "cs_live_async_failed_1", payment_intent: "pi_async_1", amount_total: 500, currency: "usd", customer_details: { email: "buyer@example.com" }, metadata: { product_type: "full_analysis" } };

  it("the same async_payment_failed delivered twice is one payment_failures row and one buyer mail", async () => {
    expect(await deliver("checkout.session.async_payment_failed", failed)).toBe(200);
    expect(await deliver("checkout.session.async_payment_failed", failed)).toBe(200);
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(productMails()).toHaveLength(1);
    expect(productMails()[0].body).toMatchObject({ kind: "payment_failed", sessionId: failed.id });
  });

  it("a buyer mail send-product-email refused gives its door back: the redelivery mails it, the row stays one", async () => {
    refuseProductMail = true;
    await deliver("checkout.session.async_payment_failed", failed);
    refuseProductMail = false;
    await deliver("checkout.session.async_payment_failed", failed);
    expect(productMails()).toHaveLength(2);
    expect(db.rows("payment_failures")).toHaveLength(1);
  });

  it("a door that cannot be asked still records the row and mails the buyer, as before (no mail pause)", async () => {
    db.rpcs.mail_door_take = () => ({ data: null, error: { message: "down" } });
    await deliver("checkout.session.async_payment_failed", failed);
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(productMails()).toHaveLength(1);
  });

  it("an expired session delivered twice is one row, and the row keeps no address", async () => {
    const expired = { id: "cs_live_expired_1", amount_total: 4500, currency: "usd", customer_email: "buyer@example.com", metadata: { product_type: "pro_subscription" } };
    await deliver("checkout.session.expired", expired);
    await deliver("checkout.session.expired", expired);
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(db.rows("payment_failures")[0]).toMatchObject({ failure_code: "checkout_expired", customer_email: null, metadata: { session_id: expired.id } });
    expect(mail).toEqual([]);
  });
});

describe("a paid session is one product_conversion (S14X-152)", () => {
  const paid = (id: string, extra: Record<string, unknown> = {}) => ({
    id, payment_status: "paid", status: "complete", amount_total: 500, currency: "usd", mode: "payment", customer_email: null,
    customer_details: { email: "buyer@example.com" }, metadata: { product_type: "full_analysis", product_name: "Full Analysis" }, ...extra,
  });

  it("a paid one-off writes one conversion under its checkout's visitor and product, and its redelivery none", async () => {
    db.rows("checkout_starts").push({ stripe_session_id: "cs_live_paid_1", visitor_id: "visitor-0001-abcd", product_type: "full_analysis", product_id: "fullAnalysis" });
    await deliver("checkout.session.completed", paid("cs_live_paid_1"));
    await deliver("checkout.session.completed", paid("cs_live_paid_1"));
    expect(calls.track_ab_event_optimized[0]).toMatchObject({ p_test_name: "product_conversion", p_variant: "fullAnalysis", p_event_type: "conversion", p_visitor_id: "visitor-0001-abcd" });
    expect(db.rows("ab_test_events")).toHaveLength(1);
  });

  it("a session whose start holds no visitor is counted under a stand-in from the session, once", async () => {
    db.rows("checkout_starts").push({ stripe_session_id: "cs_live_paid_2", visitor_id: null, product_type: "full_analysis", product_id: "fullAnalysis" });
    await deliver("checkout.session.completed", paid("cs_live_paid_2"));
    await deliver("checkout.session.completed", paid("cs_live_paid_2"));
    expect(db.rows("ab_test_events")).toEqual([{ test_name: "product_conversion", variant: "fullAnalysis", visitor_id: "session:cs_live_paid_2", event_type: "conversion" }]);
  });

  it("a test-mode session, and one never paid, write none", async () => {
    db.rows("checkout_starts").push({ stripe_session_id: "cs_test_paid_3", visitor_id: "visitor-0003-abcd", product_type: "full_analysis", product_id: "fullAnalysis" });
    await deliver("checkout.session.completed", paid("cs_test_paid_3", { livemode: false }));
    await deliver("checkout.session.completed", paid("cs_live_unpaid_4", { payment_status: "unpaid", amount_total: 500 }));
    expect(calls.track_ab_event_optimized).toEqual([]);
  });

  it("a Pro subscription's first session is the 'pro' conversion", async () => {
    world.subs.sub_one = { id: "sub_one", customer: "cus_1", status: "active", items: { data: [{ price: { unit_amount: 4500 } }] }, metadata: {} };
    db.rows("checkout_starts").push({ stripe_session_id: "cs_live_pro_5", visitor_id: "visitor-0005-abcd", product_type: "pro_subscription", product_id: null });
    await deliver("checkout.session.completed", paid("cs_live_pro_5", { mode: "subscription", amount_total: 4500, subscription: "sub_one", customer: "cus_1", metadata: { product_type: "pro_subscription" } }));
    expect(db.rows("ab_test_events")).toEqual([{ test_name: "product_conversion", variant: "pro", visitor_id: "visitor-0005-abcd", event_type: "conversion" }]);
  });
});

describe("a second live Pro plan reaches the owner, once (S14X-076)", () => {
  const proSession = (id: string) => ({
    id, payment_status: "paid", status: "complete", amount_total: 4500, currency: "usd", mode: "subscription", subscription: "sub_new", customer: "cus_1",
    client_reference_id: "00000000-0000-4000-8000-000000076001", customer_details: { email: "buyer@example.com" }, metadata: { product_type: "pro_subscription" },
  });
  const pro = (id: string, status = "active") => ({ id, customer: "cus_1", status, items: { data: [{ price: { unit_amount: 4500 } }] }, metadata: {} });
  const alerts = () => mail.filter((m) => /Two live Pro plans/.test(m.subject));

  it("a completed Pro session that leaves the customer two live Pro plans mails the owner once per session", async () => {
    world.subs = { sub_old: pro("sub_old"), sub_new: pro("sub_new") };
    await deliver("checkout.session.completed", proSession("cs_live_second_1"));
    await deliver("checkout.session.completed", proSession("cs_live_second_1"));
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].html).toContain("sub_old");
  });

  it("one live plan, or an older one that ended, mails nobody", async () => {
    world.subs = { sub_old: pro("sub_old", "canceled"), sub_new: pro("sub_new") };
    await deliver("checkout.session.completed", proSession("cs_live_second_2"));
    expect(alerts()).toEqual([]);
  });

  it("a plan the account holds on another customer counts too", async () => {
    world.subs = { sub_new: pro("sub_new") };
    world.searchHits = [{ ...pro("sub_elsewhere"), customer: "cus_2" }];
    await deliver("checkout.session.completed", proSession("cs_live_second_3"));
    expect(alerts()).toHaveLength(1);
  });
});

describe("a refunded first month names its checkout (S14X-084)", () => {
  const refund = (invoice: string) => ({ id: `ch_${invoice}`, payment_intent: `pi_${invoice}`, refunded: true, amount: 4500, amount_refunded: 4500, currency: "usd", invoice, created: 1_790_000_000, billing_details: { email: "buyer@example.com" } });

  it("a refund of the plan's first invoice passes the plan's Checkout session to payment_revoke", async () => {
    world.subs.sub_ref = { id: "sub_ref", customer: "cus_1", status: "active", items: { data: [{ price: { unit_amount: 4500 } }] }, metadata: {} };
    world.invoices.in_first = { id: "in_first", billing_reason: "subscription_create", parent: { subscription_details: { subscription: "sub_ref" } }, customer: "cus_1", customer_email: "buyer@example.com" };
    world.sessionsBySub.sub_ref = [{ id: "cs_live_first_month" }];
    await deliver("charge.refunded", refund("in_first"));
    expect(calls.payment_revoke[0]).toMatchObject({ p_stripe_session_id: "cs_live_first_month", p_subscription_id: "sub_ref", p_product_type: "pro_subscription" });
  });

  it("a renewal's refund names none, and Stripe is not asked for a session", async () => {
    world.subs.sub_ref = { id: "sub_ref", customer: "cus_1", status: "active", items: { data: [{ price: { unit_amount: 4500 } }] }, metadata: {} };
    world.invoices.in_renewal = { id: "in_renewal", billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: "sub_ref" } }, customer: "cus_1" };
    world.sessionsBySub.sub_ref = [{ id: "cs_live_first_month" }];
    await deliver("charge.refunded", refund("in_renewal"));
    expect(calls.payment_revoke[0]).toMatchObject({ p_stripe_session_id: null, p_subscription_id: "sub_ref" });
    expect(world.listed.filter((p) => "subscription" in p)).toEqual([]);
  });
});

describe("the conversion's currency rides on the delivery row (S14X-227, moved to the affiliate trigger)", () => {
  it("a referred non-USD sale writes product_deliveries.metadata.currency before record_affiliate_conversion, which keeps its five arguments", async () => {
    let deliveryAtCall: unknown = "not called";
    record("record_affiliate_conversion", () => {
      deliveryAtCall = db.rows("product_deliveries").find((r) => r.stripe_session_id === "cs_live_eur_1")?.metadata;
      return { data: false, error: null };
    });
    await deliver("checkout.session.completed", {
      id: "cs_live_eur_1", payment_status: "paid", status: "complete", amount_total: 500, currency: "EUR", mode: "payment", customer_email: null,
      customer_details: { email: "buyer@example.com" }, metadata: { product_type: "full_analysis", product_name: "Full Analysis", referral_code: "ref-eur" },
    });
    expect(deliveryAtCall).toMatchObject({ currency: "eur" });
    expect(Object.keys(calls.record_affiliate_conversion[0]).sort()).toEqual(["p_commission_override", "p_product_name", "p_referral_code", "p_sale_amount", "p_stripe_session_id"]);
  });
});
