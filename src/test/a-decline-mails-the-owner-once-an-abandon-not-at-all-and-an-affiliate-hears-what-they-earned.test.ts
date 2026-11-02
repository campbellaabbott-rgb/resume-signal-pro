// @vitest-environment node
/**
 * A DECLINE MAILS THE OWNER ONCE, AN ABANDON NOT AT ALL, AND AN AFFILIATE
 * HEARS WHAT THEY EARNED (audit 2026-10-31, S13-059 and S13-060;
 * stripe-webhook and verify-product-purchase 2026-11-03.1).
 *
 * WHAT WAS WRONG.
 *   S13-059  Every abandoned checkout, an anonymous script's included, mailed
 *            the owner "Payment Failed". A card declined in Checkout sent
 *            payment_intent.payment_failed AND charge.failed: two rows, two
 *            mails, with no door and no ceiling.
 *   S13-060  The webhook, which records nearly every affiliate conversion
 *            (every Pro first month among them), mailed the affiliate
 *            nothing, though /affiliates promises a mail per commission; the
 *            success-page verifier mailed "you earned" without reading
 *            whether the conversion was recorded or the affiliate active.
 *
 * WHAT HOLDS NOW (the shipped webhook, Stripe, Resend and the database
 * faked; the mail door counted as mail_door_take counts it):
 *   - an expired checkout is recorded in payment_failures and mails nobody;
 *   - a decline is one row and one mail, and a redelivered decline mails no
 *     more; its two events (payment_intent.payment_failed and charge.failed)
 *     are one row and one mail together, and either alone records and mails
 *     it, so an endpoint subscribed to only one still hears every decline
 *     (the fixer's review); a second card on the same payment is a second
 *     row and no second mail;
 *   - no more than ten failure mails go out an hour; a mail no sender took
 *     gives its door back, so the redelivery mails it;
 *   - the affiliate is mailed by the webhook when its call recorded the
 *     conversion, the row holds a commission above zero and the affiliate is
 *     active, and is mailed the row's commission; otherwise not at all;
 *   - the success-page verifier mails by the same three conditions.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.checkout = { sessions: { retrieve: async (id) => ({ id, ...globalThis.__declineSession }), listLineItems: async () => ({ data: [] }) } };
    this.customers = { retrieve: async () => ({ id: "cus_1", email: "buyer@example.com" }), list: async () => ({ data: [] }) };
    this.subscriptions = { list: async () => ({ data: [] }) };
    this.charges = { list: async () => ({ data: [] }) };
  } }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__declineDb; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": `export class Resend { constructor() { this.emails = { send: async (m) => {
    globalThis.__declineMail.push(m);
    return globalThis.__declineRefuse ? { data: null, error: { message: "refused" } } : { data: { id: "re_1" }, error: null };
  } }; } }`,
};

let handler: EdgeHandler;
let verifier: EdgeHandler;
const pending: Promise<unknown>[] = [];
const mail: Array<{ subject: string }> = [];
const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let recordAnswer: { data: unknown; error: { message: string } | null };

// ONE database object for the whole file: the webhook keeps its client in a
// module-level singleton from its first request, as it does warm.
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_WEBHOOK_SECRET: "whsec_harness", STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness", RESEND_API_KEY: "re_harness", ADMIN_EMAIL: "owner@example.com",
    LOVABLE_API_KEY: "lov_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__declineDb = db;
  g.__declineMail = mail;
  g.fetch = async (url: string | URL, init?: RequestInit) => {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(String(init?.body ?? "{}")); } catch { body = {}; }
    posts.push({ url: String(url), body });
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
  };
  handler = await loadEdgeHandler("stripe-webhook", STUBS);
  verifier = await loadEdgeHandler("verify-product-purchase", STUBS);
}, 120_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  mail.length = 0;
  posts.length = 0;
  (globalThis as Record<string, unknown>).__declineRefuse = false;
  recordAnswer = { data: true, error: null };
  // mail_door_take as 20261004100000 counts it, over the rows a give-back deletes.
  db.rpcs.mail_door_take = (a) => {
    const rows = db.rows("mail_door_counts");
    const row = rows.find((r) => r.door === a.p_door && r.bucket === a.p_bucket);
    if (!row) { rows.push({ door: a.p_door, bucket: a.p_bucket, hits: 1 }); return { data: true, error: null }; }
    if (Number(row.hits) >= Number(a.p_max)) return { data: false, error: null };
    row.hits = Number(row.hits) + 1;
    return { data: true, error: null };
  };
  db.rpcs.record_affiliate_conversion = () => recordAnswer;
  db.rpcs.log_webhook_event = () => ({ data: null, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.add_scan_credits = () => ({ data: true, error: null });
});

async function deliver(type: string, object: Record<string, unknown>) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${type}_${String(object.id)}`, type, data: { object } }),
  }));
  while (pending.length) await pending.shift();
  return res.status;
}

const declined = (pi: string, charge?: string) => ({
  id: pi, amount: 500, currency: "usd", receipt_email: "buyer@example.com",
  ...(charge ? { latest_charge: charge } : {}),
  last_payment_error: { code: "card_declined", message: "Your card was declined.", decline_code: "generic_decline", ...(charge ? { charge } : {}) },
});
const failedCharge = (id: string, pi: string | null) => ({ id, payment_intent: pi, amount: 500, currency: "usd", failure_code: "card_declined", billing_details: { email: "b@example.com" } });
const failureMails = () => mail.filter((m) => /Payment|Failed/i.test(m.subject));

describe("payment failures mail the owner what is money, once (S13-059)", () => {
  it("an expired checkout is recorded and mails nobody", async () => {
    expect(await deliver("checkout.session.expired", { id: "cs_live_abandoned", amount_total: 500, currency: "usd", customer_email: null, metadata: { product_type: "full_analysis" } })).toBe(200);
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(mail).toEqual([]);
  });

  it("a decline is one row and one mail, and its redelivery mails no more", async () => {
    await deliver("payment_intent.payment_failed", declined("pi_declined_1", "ch_declined_1"));
    await deliver("payment_intent.payment_failed", declined("pi_declined_1", "ch_declined_1"));
    expect(failureMails()).toHaveLength(1);
    expect(db.rows("payment_failures")).toHaveLength(1);
  });

  it("a Checkout decline's two events are one row and one mail, in either order", async () => {
    await deliver("charge.failed", failedCharge("ch_1", "pi_declined_2"));
    await deliver("payment_intent.payment_failed", declined("pi_declined_2", "ch_1"));
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(failureMails()).toHaveLength(1);
    await deliver("payment_intent.payment_failed", declined("pi_declined_3", "ch_3"));
    await deliver("charge.failed", failedCharge("ch_3", "pi_declined_3"));
    expect(db.rows("payment_failures")).toHaveLength(2);
    expect(failureMails()).toHaveLength(2);
  });

  it("an endpoint subscribed to charge.failed alone still records and mails a Checkout decline", async () => {
    await deliver("charge.failed", failedCharge("ch_only", "pi_only_charge_event"));
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(db.rows("payment_failures")[0].payment_intent_id).toBe("pi_only_charge_event");
    expect(failureMails()).toHaveLength(1);
  });

  it("a charge with no payment intent behind it is recorded and mailed", async () => {
    await deliver("charge.failed", failedCharge("ch_2", null));
    expect(db.rows("payment_failures")).toHaveLength(1);
    expect(failureMails()).toHaveLength(1);
  });

  it("a second card declined on the same payment is a second row, and no second mail", async () => {
    await deliver("charge.failed", failedCharge("ch_card_a", "pi_two_cards"));
    await deliver("charge.failed", failedCharge("ch_card_b", "pi_two_cards"));
    expect(db.rows("payment_failures")).toHaveLength(2);
    expect(failureMails()).toHaveLength(1);
  });

  it("no more than ten failure mails go out an hour, though every decline is recorded", async () => {
    for (let i = 0; i < 12; i++) await deliver("payment_intent.payment_failed", declined(`pi_testing_run_${i}`));
    expect(db.rows("payment_failures")).toHaveLength(12);
    expect(failureMails()).toHaveLength(10);
  });

  it("a mail no sender took gives its door back, so the redelivery mails it", async () => {
    (globalThis as Record<string, unknown>).__declineRefuse = true;
    await deliver("payment_intent.payment_failed", declined("pi_refused_1"));
    expect(db.rows("mail_door_counts").find((r) => r.door === "owner-alert:payment-failed")).toBeUndefined();
    (globalThis as Record<string, unknown>).__declineRefuse = false;
    mail.length = 0;
    await deliver("payment_intent.payment_failed", declined("pi_refused_1"));
    expect(failureMails()).toHaveLength(1);
  });
});

describe("the affiliate the webhook records is told what they earned (S13-060)", () => {
  const AFF = "11111111-1111-4111-8111-111111111111";
  const sale = (id: string) => ({
    id, payment_status: "paid", amount_total: 4500, currency: "usd", mode: "payment", customer_email: null,
    customer_details: { email: "buyer@example.com" },
    metadata: { product_type: "full_analysis", product_name: "Full Analysis", referral_code: "ref-aff" },
  });
  const commissionMails = () => posts.filter((p) => p.url.endsWith("/functions/v1/send-affiliate-commission-email"));
  const seed = (session: string, commission: number, status = "active") => {
    db.rows("affiliate_conversions").push({ affiliate_id: AFF, stripe_session_id: session, commission_amount: commission });
    db.rows("affiliates").push({ id: AFF, email: "affiliate@example.com", status, referral_code: "ref-aff" });
  };

  it("mails the active affiliate the commission the row holds, when this call recorded it", async () => {
    seed("cs_live_referred_1", 900);
    expect(await deliver("checkout.session.completed", sale("cs_live_referred_1"))).toBe(200);
    expect(commissionMails()).toHaveLength(1);
    expect(commissionMails()[0].body).toMatchObject({ affiliateEmail: "affiliate@example.com", commissionAmount: 900, referralCode: "ref-aff" });
  });

  it("mails nobody when the call recorded nothing, the commission is zero, the affiliate is paused, or the call failed", async () => {
    seed("cs_live_referred_2", 900);
    recordAnswer = { data: false, error: null };
    await deliver("checkout.session.completed", sale("cs_live_referred_2"));
    db.tables = {};
    seed("cs_live_referred_3", 0);
    recordAnswer = { data: true, error: null };
    await deliver("checkout.session.completed", sale("cs_live_referred_3"));
    db.tables = {};
    seed("cs_live_referred_4", 900, "paused");
    await deliver("checkout.session.completed", sale("cs_live_referred_4"));
    db.tables = {};
    seed("cs_live_referred_5", 900);
    recordAnswer = { data: null, error: { message: "duplicate key value violates unique constraint" } };
    await deliver("checkout.session.completed", sale("cs_live_referred_5"));
    expect(commissionMails()).toEqual([]);
  });
});

describe("the success-page verifier mails the affiliate by the same three conditions (S13-060)", () => {
  const AFF = "22222222-2222-4222-8222-222222222222";
  const commissionMails = () => posts.filter((p) => p.url.endsWith("/functions/v1/send-affiliate-commission-email"));
  const verify = async (id: string) => {
    (globalThis as Record<string, unknown>).__declineSession = {
      object: "checkout.session", mode: "payment", currency: "usd", customer: null, payment_status: "paid", status: "complete", amount_total: 2900,
      customer_details: { email: "buyer@example.com" }, customer_email: "buyer@example.com",
      metadata: { product_type: "career_bundle", product_name: "Career Bundle", customer_email: "buyer@example.com", referral_code: "ref-two" },
    };
    const res = await verifier(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" }, body: JSON.stringify({ sessionId: id }),
    }));
    while (pending.length) await pending.shift();
    return res.status;
  };
  const seed = (session: string, commission: number, status = "active") => {
    db.rows("affiliate_conversions").push({ affiliate_id: AFF, stripe_session_id: session, commission_amount: commission });
    db.rows("affiliates").push({ id: AFF, email: "second@example.com", status, referral_code: "ref-two" });
  };

  it("mails the active affiliate the row's commission when the call recorded it", async () => {
    seed("cs_live_bundle_1", 500);
    expect(await verify("cs_live_bundle_1")).toBe(200);
    expect(commissionMails()).toHaveLength(1);
    expect(commissionMails()[0].body).toMatchObject({ affiliateEmail: "second@example.com", commissionAmount: 500, referralCode: "ref-two" });
  });

  it("mails nobody when the call recorded nothing, the commission is zero, or the affiliate is paused", async () => {
    seed("cs_live_bundle_2", 500);
    recordAnswer = { data: false, error: null };
    await verify("cs_live_bundle_2");
    db.tables = {};
    seed("cs_live_bundle_3", 0);
    recordAnswer = { data: true, error: null };
    await verify("cs_live_bundle_3");
    db.tables = {};
    seed("cs_live_bundle_4", 500, "paused");
    await verify("cs_live_bundle_4");
    expect(commissionMails()).toEqual([]);
  });
});
