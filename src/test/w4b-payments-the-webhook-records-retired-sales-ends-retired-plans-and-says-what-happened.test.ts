// @vitest-environment node
/**
 * THE WEBHOOK, AFTER WAVE 4 RETIRED THE AGENT PRODUCTS (S12-169, S12-079),
 * AND THE MONEY EVENTS IT DID NOT HEAR (S12-100, S12-104, CP-027, CP-029,
 * CP-033).
 *
 * Each case runs the shipped stripe-webhook handler, with the retirement
 * switches as they ship (off), Stripe, the database and Resend faked:
 *
 *   S12-169  a checkout opened before the switch and paid after it was
 *            granted (a pass), seeded (the plan) or generated and marked
 *            delivered (the Apply Assistant). Now: recorded undeliverable,
 *            nothing granted or generated, the owner told once.
 *   S12-079  a $99 Agent trial sold before the switch converted after it,
 *            and its reminder told the subscriber the charge was coming.
 *            Now: the plan is set to end at its period end, the subscriber
 *            is told it ends without a charge, the owner is told once.
 *   S12-100  a customer the owner deleted in Stripe kept its cached plans
 *            (the refresh returned early on the deleted customer).
 *   S12-104  the Freelance Boost purchase link was mailed fire-and-forget on
 *            a row no sweep schedules: a refused send left no way back.
 *   CP-027   owner alerts went from Resend's test sender and a refusal
 *            (answered as {error}) was never read.
 *   CP-029   a delayed payment (async_payment_succeeded) was never claimed
 *            or mailed; a failed one told nobody.
 *   CP-033   the owner's test-mode rehearsal had no way in.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { STRIPE_WEBHOOKS_REAL_SHAPE, signStripePayload } from "./helpers/stripe-signature";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const LIVE_SECRET = "whsec_live_harness";
const TEST_SECRET = "whsec_test_harness";
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: LIVE_SECRET,
  STRIPE_SECRET_KEY: "sk_live_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness",
  RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com",
};

type Sub = Record<string, any>;
const world = {
  subs: {} as Record<string, Sub>,
  customers: {} as Record<string, { id: string; email?: string; deleted?: boolean }>,
  updates: [] as Array<{ id: string; params: Record<string, unknown>; key: string }>,
  keysUsed: [] as string[],
};

const STRIPE_STUB = `
export default class Stripe {
  constructor(key) {
    const w = () => globalThis.__w4bWorld;
    w().keysUsed.push(key);
    this.webhooks = ${STRIPE_WEBHOOKS_REAL_SHAPE};
    this.subscriptions = {
      retrieve: async (id) => { const s = w().subs[id]; if (!s) throw new Error("No such subscription"); return JSON.parse(JSON.stringify(s)); },
      update: async (id, params) => { w().updates.push({ id, params, key }); Object.assign(w().subs[id], params); return w().subs[id]; },
      list: async ({ customer }) => ({ data: Object.values(w().subs).filter((s) => s.customer === customer), has_more: false }),
      cancel: async (id) => w().subs[id],
    };
    this.customers = {
      retrieve: async (id) => w().customers[id] ?? { id, deleted: true },
      list: async ({ email }) => ({ data: Object.values(w().customers).filter((c) => c.email === email), has_more: false }),
    };
    this.invoices = { createPreview: async () => ({ amount_due: 0 }) };
    this.checkout = { sessions: { list: async () => ({ data: [] }) } };
  }
}`;

/** The owner alerts the Resend SDK was handed, and whether each sender refuses. */
const alerts: Array<{ from: string; subject: string; html: string }> = [];
const refusing = new Set<string>();
const RESEND_SDK_STUB = `export class Resend { constructor() { this.emails = { send: async (m) => {
  globalThis.__w4bAlerts.push(m);
  if (globalThis.__w4bRefusing.has(m.from)) return { data: null, error: { message: "domain not verified" } };
  return { data: { id: "re_x" }, error: null };
} }; } }`;

/** Mail that went out over Resend's REST API (sendMail: the buyer's notice). */
const restMails: Array<Record<string, any>> = [];
let restStatus = 200;
/** Calls to our own functions. */
const calls: Array<{ fn: string; body: any }> = [];
let productMailStatus = 200;
const pending: Promise<unknown>[] = [];

let webhook: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__w4bWorld = world;
  g.__w4bAlerts = alerts;
  g.__w4bRefusing = refusing;
  g.__w4bClient = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url === "https://api.resend.com/emails") {
      restMails.push({ ...body, idempotencyKey: (init?.headers as Record<string, string>)?.["Idempotency-Key"] });
      return new Response(JSON.stringify(restStatus === 200 ? { id: `re_${restMails.length}` } : { message: "provider down" }), { status: restStatus });
    }
    const m = /\/functions\/v1\/([a-z-]+)/.exec(url);
    if (m) {
      calls.push({ fn: m[1], body });
      if (m[1] === "send-product-email") return new Response("{}", { status: productMailStatus });
      return new Response(JSON.stringify({ success: true, data: { made: m[1] } }), { status: 200 });
    }
    throw new Error(`unexpected network call: ${url}`);
  };
  webhook = await loadEdgeHandler("stripe-webhook", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__w4bClient; export class SupabaseClient {}",
    "https://esm.sh/resend@2.0.0": RESEND_SDK_STUB,
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rpcs = {
    log_webhook_event: () => ({ data: null, error: null }),
    mail_door_take: (a) => {
      const rows = db.rows("mail_door_counts");
      const hit = rows.find((r) => r.door === a.p_door && r.bucket === a.p_bucket);
      if (hit) { hit.hits = Number(hit.hits) + 1; return { data: Number(hit.hits) <= Number(a.p_max), error: null }; }
      rows.push({ door: a.p_door, bucket: a.p_bucket, hits: 1 });
      return { data: true, error: null };
    },
    update_delivery_retry: (a) => {
      const row = db.rows("product_deliveries").find((r) => r.id === a.p_id);
      if (row) Object.assign(row, { status: a.p_status, last_retry_error: a.p_error, next_retry_at: "soon", retry_count: Number(row.retry_count ?? 0) + 1 });
      return { data: true, error: null };
    },
    agent_pass_grant: () => ({ data: [{ granted_ok: true, grant_reason: "granted", granted_pass_id: "pass-1" }], error: null }),
    agent_prepare_now: () => ({ data: true, error: null }),
    save_purchased_content: () => ({ data: "pc", error: null }),
    get_temp_resume: () => ({ data: [{ resume_text: "R".repeat(300), job_description_text: null }], error: null }),
  };
  world.subs = {};
  world.customers = { cus_1: { id: "cus_1", email: "subscriber@example.com" } };
  world.updates = [];
  world.keysUsed = [];
  alerts.length = 0;
  refusing.clear();
  restMails.length = 0;
  restStatus = 200;
  calls.length = 0;
  productMailStatus = 200;
  delete env.STRIPE_TEST_WEBHOOK_SECRET;
  delete env.STRIPE_TEST_SECRET_KEY;
});

async function settle() {
  while (pending.length) await pending.shift();
}

async function deliver(type: string, object: Record<string, unknown>, opts: { secret?: string; livemode?: boolean } = {}) {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, livemode: opts.livemode ?? true, data: { object } });
  const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signStripePayload(body, opts.secret ?? LIVE_SECRET) },
    body,
  }));
  await settle();
  return { status: res.status, json: await res.json().catch(() => null) };
}

const paidSession = (id: string, metadata: Record<string, string>, over: Record<string, unknown> = {}) => ({
  id, mode: "payment", payment_status: "paid", status: "complete", amount_total: 700, currency: "usd",
  customer_email: null, customer_details: { email: "buyer@example.com" }, metadata, ...over,
});
const rowOf = (id: string) => db.rows("product_deliveries").find((r) => r.stripe_session_id === id);
const agentSub = (id: string, extra: Partial<Sub> = {}): Sub => ({
  id, customer: "cus_1", status: "trialing", trial_end: Math.floor(Date.now() / 1000) + 3 * 86400,
  cancel_at_period_end: false, cancel_at: null, metadata: {},
  items: { data: [{ price: { unit_amount: 9900, currency: "usd", recurring: { interval: "month" } } }] },
  ...extra,
});
const proSub = (id: string, extra: Partial<Sub> = {}): Sub => ({ ...agentSub(id, extra), items: { data: [{ price: { unit_amount: 4500, currency: "usd", recurring: { interval: "month" } } }] }, ...extra });

describe("a retired product paid after its switch is recorded, never delivered (S12-169)", () => {
  it("an Apply Assistant: nothing generated or mailed, the row says why, the owner hears once", async () => {
    const id = "cs_live_aa_after_switch";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: "11111111-2222-4333-8444-555555555555" });
    const event = paidSession(id, { product_type: "apply_assistant", product_name: "Apply Assistant" });
    expect((await deliver("checkout.session.completed", event)).status).toBe(200);
    expect(calls.filter((c) => c.fn.startsWith("generate-")), "a retired product was generated").toEqual([]);
    expect(calls.filter((c) => c.fn === "send-product-email"), "a buyer was mailed a product that was never made").toEqual([]);
    const row = rowOf(id);
    expect(row?.status).toBe("generation_failed");
    expect(row?.max_retries, "the sweep would retry it").toBe(0);
    expect(String(row?.generation_error)).toMatch(/^undeliverable_retired: the Apply Assistant is no longer sold/);
    expect(alerts.filter((a) => /retired product/i.test(a.subject))).toHaveLength(1);
    expect(alerts[0].from, "the owner alert left from Resend's test sender").toContain("alerts@resumebooster.work");
    expect(alerts[0].html).toContain("generate-apply-package");
    expect(alerts[0].html).not.toMatch(/refund it/i);
    await deliver("checkout.session.completed", event);
    expect(alerts.filter((a) => /retired product/i.test(a.subject)), "a redelivered event alerted twice").toHaveLength(1);
  });

  it("an Agent Pass: no pass is granted", async () => {
    const id = "cs_live_pass_after_switch";
    const grants: unknown[] = [];
    db.rpcs.agent_pass_grant = (a) => { grants.push(a); return { data: [{ granted_ok: true }], error: null }; };
    await deliver("checkout.session.completed", paidSession(id, { product_type: "agent_pass", user_id: "00000000-0000-4000-8000-000000000001" }, { amount_total: 2900, client_reference_id: "00000000-0000-4000-8000-000000000001" }));
    expect(grants, "a pass was granted for a retired product").toEqual([]);
    expect(String(rowOf(id)?.generation_error)).toMatch(/^undeliverable_retired: the Agent Pass is no longer sold/);
  });

  it("a sale the success page claimed first is still told to the owner, once", async () => {
    const id = "cs_live_aa_page_first";
    db.rows("used_stripe_sessions").push({ session_id: id, product_type: "apply_assistant" });
    await deliver("checkout.session.completed", paidSession(id, { product_type: "apply_assistant" }));
    expect(alerts.filter((a) => /retired product/i.test(a.subject))).toHaveLength(1);
  });

  it("an owner alert both senders refuse gives its door back, so the next delivery sends it (CP-027)", async () => {
    const id = "cs_live_aa_alert_refused";
    refusing.add("Resume Booster Alerts <alerts@resumebooster.work>");
    refusing.add("Resume Booster Alerts <onboarding@resend.dev>");
    const event = paidSession(id, { product_type: "apply_assistant" });
    await deliver("checkout.session.completed", event);
    expect(alerts.map((a) => a.from), "the onboarding sender was not tried after our own was refused").toEqual([
      "Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>",
    ]);
    expect(db.rows("mail_door_counts").filter((r) => r.door === "owner-alert:retired-sale"), "a refused alert kept its door").toHaveLength(0);
    refusing.clear();
    alerts.length = 0;
    db.rows("used_stripe_sessions").length = 0;
    db.rows("product_deliveries").length = 0;
    await deliver("checkout.session.completed", event);
    expect(alerts.filter((a) => /retired product/i.test(a.subject))).toHaveLength(1);
  });
});

describe("a retired $99 plan is never renewed for a dead product (S12-079)", () => {
  it("its trial reminder sets the plan to end and says no charge comes, never that one does", async () => {
    world.subs.sub_agent = agentSub("sub_agent");
    expect((await deliver("customer.subscription.trial_will_end", world.subs.sub_agent)).status).toBe(200);
    expect(world.updates).toEqual([{ id: "sub_agent", params: { cancel_at_period_end: true }, key: "sk_live_harness" }]);
    expect(restMails).toHaveLength(1);
    const notice = restMails[0];
    expect(notice.to).toEqual(["subscriber@example.com"]);
    expect(notice.text).toMatch(/will not turn into a paid plan: you will not be charged/);
    expect(notice.text, "the reminder still announced the $99 charge").not.toMatch(/you will be charged \$/);
    expect(notice.idempotencyKey).toBe("agent-retired:sub_agent");
    expect(alerts.filter((a) => /Retired Apply Agent plan/.test(a.subject))).toHaveLength(1);
  });

  it("the update it makes comes back as an event and changes nothing more", async () => {
    world.subs.sub_agent = agentSub("sub_agent", { status: "active" });
    await deliver("customer.subscription.updated", world.subs.sub_agent);
    expect(world.updates).toHaveLength(1);
    await deliver("customer.subscription.updated", { ...world.subs.sub_agent, cancel_at_period_end: true });
    expect(world.updates, "a plan already ending was updated again").toHaveLength(1);
    expect(restMails, "the subscriber was told twice").toHaveLength(1);
  });

  it("a plan checkout completed after the switch is set to end, gets no confirmation, and is never seeded", async () => {
    world.subs.sub_new = agentSub("sub_new");
    const seeded: unknown[] = [];
    db.rpcs.agent_prepare_now = () => { seeded.push(1); return { data: true, error: null }; };
    await deliver("checkout.session.completed", {
      id: "cs_live_plan_after_switch", mode: "subscription", subscription: "sub_new", customer: "cus_1",
      customer_details: { email: "subscriber@example.com" }, payment_status: "no_payment_required", amount_total: 0,
      metadata: { product_type: "apply_agent" },
    });
    expect(world.updates.map((u) => u.id)).toEqual(["sub_new"]);
    expect(restMails.map((m) => m.subject), "a confirmation promised renewals of a retired plan").toEqual(["Your Apply Agent plan ends without a charge"]);
    expect(db.rows("agent_subscribers"), "the retired plan was seeded").toHaveLength(0);
    expect(seeded).toEqual([]);
  });

  it("a renewal charge of a retired plan ends it and tells the owner", async () => {
    world.subs.sub_paid = agentSub("sub_paid", { status: "active" });
    await deliver("invoice.payment_succeeded", {
      id: "in_1", customer: "cus_1", customer_email: "subscriber@example.com", subscription: "sub_paid",
      lines: { data: [{ price: { unit_amount: 9900 } }] },
    });
    expect(world.updates.map((u) => u.id)).toEqual(["sub_paid"]);
    expect(alerts.some((a) => /Retired Apply Agent plan/.test(a.subject))).toBe(true);
  });

  it("a past_due plan is left to the owner: nothing changed, the owner told", async () => {
    world.subs.sub_due = agentSub("sub_due", { status: "past_due" });
    await deliver("customer.subscription.trial_will_end", world.subs.sub_due);
    expect(world.updates).toEqual([]);
    expect(alerts.some((a) => /needs your decision/.test(a.subject))).toBe(true);
  });

  it("a notice Resend refused answers 500 for a redelivery, and the redelivery sends it", async () => {
    world.subs.sub_agent = agentSub("sub_agent");
    restStatus = 500;
    expect((await deliver("customer.subscription.trial_will_end", world.subs.sub_agent)).status).toBe(500);
    restStatus = 200;
    restMails.length = 0;
    expect((await deliver("customer.subscription.trial_will_end", world.subs.sub_agent)).status).toBe(200);
    expect(restMails).toHaveLength(1);
  });

  it("a $45 Pro trial is untouched: no update, its own reminder", async () => {
    world.subs.sub_pro = proSub("sub_pro");
    await deliver("customer.subscription.trial_will_end", world.subs.sub_pro);
    expect(world.updates).toEqual([]);
    expect(restMails.map((m) => m.idempotencyKey)).toEqual(["sub-notice:sub_pro:trial_ending"]);
  });
});

describe("a customer deleted in Stripe ends its cached plans (S12-100)", () => {
  it("both caches lapse by the customer id; other customers and manual grants are untouched", async () => {
    db.rows("pro_subscribers").push(
      { email: "gone@example.com", stripe_customer_id: "cus_gone", status: "active", current_period_end: "2099-01-01T00:00:00Z" },
      { email: "other@example.com", stripe_customer_id: "cus_other", status: "active", current_period_end: "2099-01-01T00:00:00Z" },
      { email: "comp@example.com", stripe_customer_id: null, status: "active", current_period_end: "2099-01-01T00:00:00Z" },
    );
    db.rows("agent_subscribers").push({ email: "gone@example.com", stripe_customer_id: "cus_gone", status: "active", current_period_end: "2099-01-01T00:00:00Z" });
    world.customers.cus_gone = { id: "cus_gone", deleted: true };
    await deliver("customer.subscription.deleted", agentSub("sub_gone", { customer: "cus_gone", status: "canceled" }));
    const pro = (e: string) => db.rows("pro_subscribers").find((r) => r.email === e);
    expect(pro("gone@example.com")).toMatchObject({ status: "canceled", current_period_end: null, stripe_customer_id: "cus_gone" });
    expect(db.rows("agent_subscribers")[0]).toMatchObject({ status: "canceled", current_period_end: null });
    expect(pro("other@example.com")?.status).toBe("active");
    expect(pro("comp@example.com")?.status).toBe("active");
  });

  it("customer.deleted itself lapses them", async () => {
    db.rows("pro_subscribers").push({ email: "gone@example.com", stripe_customer_id: "cus_gone2", status: "active", current_period_end: "2099-01-01T00:00:00Z" });
    await deliver("customer.deleted", { id: "cus_gone2", deleted: true });
    expect(db.rows("pro_subscribers")[0].status).toBe("canceled");
  });
});

describe("the link back to a product made on its own page is recorded (S12-104)", () => {
  it("a refused Freelance Boost mail is recorded as email_failed with its next try, in the buyer's language", async () => {
    const id = "cs_live_freelance_mail_refused";
    productMailStatus = 502;
    await deliver("checkout.session.completed", paidSession(id, { product_type: "freelance_boost", product_name: "Freelance Boost", language: "de" }, { amount_total: 2900 }));
    const mail = calls.find((c) => c.fn === "send-product-email");
    expect(mail?.body).toMatchObject({ productType: "freelance_boost", sessionId: id, language: "de" });
    expect(rowOf(id)).toMatchObject({ status: "email_failed", last_retry_error: "send-product-email answered 502" });
  });

  it("a sent one stamps the row and leaves it waiting for the buyer's own page", async () => {
    const id = "cs_live_freelance_mail_sent";
    await deliver("checkout.session.completed", paidSession(id, { product_type: "freelance_boost" }, { amount_total: 2900 }));
    const row = rowOf(id);
    expect(row?.status).toBe("payment_received");
    expect(row?.next_retry_at).toBe("infinity");
    expect(row?.email_success).toBe(true);
    expect(typeof row?.email_sent_at).toBe("string");
  });
});

describe("a delayed payment is delivered when it lands, and told when it fails (CP-029)", () => {
  it("async_payment_succeeded claims a Full Analysis and mails its link", async () => {
    const id = "cs_live_fa_delayed";
    await deliver("checkout.session.completed", paidSession(id, { product_type: "full_analysis" }, { payment_status: "unpaid", amount_total: 500 }));
    expect(db.rows("used_stripe_sessions"), "an unpaid session was claimed").toHaveLength(0);
    await deliver("checkout.session.async_payment_succeeded", paidSession(id, { product_type: "full_analysis" }, { amount_total: 500 }));
    expect(db.rows("used_stripe_sessions").map((r) => r.session_id)).toEqual([id]);
    expect(calls.filter((c) => c.fn === "send-product-email").map((c) => c.body.productType)).toEqual(["full_analysis"]);
  });

  it("async_payment_failed records the failure and tells the buyer nothing was charged", async () => {
    const id = "cs_live_fa_delayed_failed";
    await deliver("checkout.session.async_payment_failed", paidSession(id, { product_type: "full_analysis", product_name: "Full Resume Analysis", language: "es" }, { payment_status: "unpaid", amount_total: 500 }));
    expect(db.rows("used_stripe_sessions")).toHaveLength(0);
    expect(db.rows("payment_failures")[0]).toMatchObject({ failure_code: "async_payment_failed", customer_email: "buyer@example.com" });
    expect(calls.find((c) => c.fn === "send-product-email")?.body).toMatchObject({ kind: "payment_failed", productType: "full_analysis", language: "es" });
  });
});

describe("the owner's test-mode rehearsal has a way in (CP-033)", () => {
  it("an event signed with the test secret is handled with the test key and its row is tagged", async () => {
    env.STRIPE_TEST_WEBHOOK_SECRET = TEST_SECRET;
    env.STRIPE_TEST_SECRET_KEY = "sk_test_rehearsal";
    const id = "cs_test_rehearsal_fa";
    const r = await deliver("checkout.session.completed", paidSession(id, { product_type: "full_analysis" }, { amount_total: 500, livemode: false }), { secret: TEST_SECRET, livemode: false });
    expect(r.status).toBe(200);
    expect(world.keysUsed).toContain("sk_test_rehearsal");
    expect((rowOf(id)?.metadata as Record<string, unknown>)?.livemode).toBe(false);
  });

  it("a test-secret event that claims to be live is refused", async () => {
    env.STRIPE_TEST_WEBHOOK_SECRET = TEST_SECRET;
    env.STRIPE_TEST_SECRET_KEY = "sk_test_rehearsal";
    const r = await deliver("checkout.session.completed", paidSession("cs_live_forged", { product_type: "full_analysis" }), { secret: TEST_SECRET, livemode: true });
    expect(r.status).toBe(400);
    expect(db.rows("used_stripe_sessions")).toHaveLength(0);
  });

  it("without a test key a test event is acknowledged and nothing is delivered", async () => {
    env.STRIPE_TEST_WEBHOOK_SECRET = TEST_SECRET;
    const r = await deliver("checkout.session.completed", paidSession("cs_test_no_key", { product_type: "full_analysis" }, { livemode: false }), { secret: TEST_SECRET, livemode: false });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ testMode: true, delivered: false });
    expect(db.rows("used_stripe_sessions")).toHaveLength(0);
  });

  it("an event signed with neither secret is refused", async () => {
    env.STRIPE_TEST_WEBHOOK_SECRET = TEST_SECRET;
    const r = await deliver("checkout.session.completed", paidSession("cs_live_unsigned", { product_type: "full_analysis" }), { secret: "whsec_someone_else" });
    expect(r.status).toBe(400);
  });
});
