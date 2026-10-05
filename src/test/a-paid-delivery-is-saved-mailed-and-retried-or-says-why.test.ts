// @vitest-environment node
/**
 * A PAID DELIVERY IS SAVED, MAILED AND RETRIED -- OR THE RECORD SAYS WHY NOT.
 *
 * The 2026-10-04 platform sweep found the delivery chain losing purchases in
 * ways no guard saw, because the guards read spellings:
 *   L6-02  generate-ats-defense answered {report}; the webhook, the sweeper
 *          and the verify path read `data`, so every $15 report was thrown
 *          away and the sweeper then marked the sale "delivered" anyway.
 *   L6-03  a Pro grant (pro_<id>) was sent to Stripe by generate-ats-defense
 *          and answered 401 after the grant was spent.
 *   L6-10  a 100%-off code completed any product at $0 with
 *          'no_payment_required', and only the pass was ever delivered.
 *   L6-13  the sweeper re-credited a failed scan pack with a hard-coded 10.
 *   L6-14  a failed delivery mail was never recorded, so never retried.
 *   L6-15  refreshing the success page after a Pro grant was spent: 400.
 *   L6-19  a rate-limit counter error told a paying buyer "Too many requests".
 *   L6-25  an anonymous buyer's address (customer_details only) was ignored.
 *   L6-27  subscription and Freelance Boost sales became false failures.
 *   L6-18  refunds and disputes left no trace a person would read.
 *
 * And from the review of those fixes (2026-10-05): when the success page
 * claimed a sale first and its credit grant or generation failed, its
 * confirmation mail closed the row as 'delivered' anyway, so the sweeper
 * never retried it -- and the row it wrote carried no metadata, so a retry
 * would have credited 10 for a 50-credit pack and had no résumé to use.
 *
 * Each is run here against the shipped handler with only its network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const RESUME_ID = "11111111-2222-4333-8444-555555555555";
const SERVICE = "service_harness_key_0123456789abcdef0123456789";

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__stripeWorld;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.customers = {
      list: async ({ email }) => ({ data: w().customers[email] ?? [], has_more: false }),
      retrieve: async (id) => ({ id, email: w().customerEmails[id] ?? null }),
    };
    this.subscriptions = { list: async ({ customer }) => ({ data: w().subs[customer] ?? [], has_more: false }) };
    this.checkout = { sessions: { retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; } } };
  }
}`;

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__deliveryClient; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__alerts.push(m); return { data: { id: 'x' }, error: null }; } }; } }",
};

const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
  RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com",
};

let webhook: EdgeHandler;
let sweeper: EdgeHandler;
let verify: EdgeHandler;
let ats: EdgeHandler;
const pending: Promise<unknown>[] = [];

// ONE database for the whole file: the webhook keeps its client in a
// module-level singleton from the first request, as it does warm in
// production.
const db = new FakeDb({ used_stripe_sessions: ["session_id"], purchased_content: ["stripe_session_id"] });
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const fetches: Array<{ url: string; body: unknown }> = [];
let generatorAnswer: (endpoint: string) => Response;
let mailStatus = 200;
let rateLimit: { data: unknown; error: { message: string } | null } = { data: true, error: null };
const alerts: unknown[] = [];
const world = { customers: {} as Record<string, Array<{ id: string }>>, customerEmails: {} as Record<string, string>, subs: {} as Record<string, unknown[]>, sessions: {} as Record<string, unknown> };

/** A client whose queries also take .not(col, "is", null), which verify-product-purchase uses. */
const client = {
  from: (t: string) => {
    const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
    q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
    q.upsert = (payload: Record<string, unknown>) => {
      db.rows(t).push(payload);
      return Promise.resolve({ data: null, error: null });
    };
    return q;
  },
  rpc: (name: string, args: Record<string, unknown> = {}) => { rpcCalls.push({ name, args }); return db.rpc(name, args); },
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__deliveryClient = client;
  g.__stripeWorld = world;
  g.__alerts = alerts;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    fetches.push({ url, body });
    if (url.includes("/functions/v1/send-product-email")) return new Response("{}", { status: mailStatus });
    if (url.includes("ai.gateway.lovable.dev")) {
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "submit_ats_defense_report", arguments: JSON.stringify({ beforeScore: { overall: 41 } }) } }] } }] }), { status: 200 });
    }
    const m = /\/functions\/v1\/([a-z-]+)/.exec(url);
    return generatorAnswer(m ? m[1] : url);
  };
  webhook = await loadEdgeHandler("stripe-webhook", STUBS);
  sweeper = await loadEdgeHandler("retry-failed-deliveries", STUBS);
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
  ats = await loadEdgeHandler("generate-ats-defense", STUBS);
}, 120_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  db.faults = [];
  rpcCalls.length = 0;
  fetches.length = 0;
  alerts.length = 0;
  mailStatus = 200;
  rateLimit = { data: true, error: null };
  world.customers = {};
  world.customerEmails = {};
  world.subs = {};
  world.sessions = {};
  generatorAnswer = () => new Response(JSON.stringify({ success: true, data: { coverLetter: "Dear team" } }), { status: 200 });
  db.rpcs = {
    log_webhook_event: () => ({ data: null, error: null }),
    get_temp_resume: () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "Senior engineer posting" }], error: null }),
    save_purchased_content: (a) => {
      const rows = db.rows("purchased_content");
      const at = rows.findIndex((r) => r.stripe_session_id === a.p_stripe_session_id);
      const row = { stripe_session_id: a.p_stripe_session_id, customer_email: a.p_customer_email, product_type: a.p_product_type, generated_content: a.p_generated_content };
      if (at >= 0) rows[at] = row; else rows.push(row);
      return { data: "pc-1", error: null };
    },
    update_delivery_retry: (a) => {
      const row = db.rows("product_deliveries").find((r) => r.id === a.p_id);
      if (row) Object.assign(row, { status: a.p_status, last_retry_error: a.p_error });
      return { data: true, error: null };
    },
    add_scan_credits: () => ({ data: true, error: null }),
    get_purchased_content_by_session: (a) => ({ data: db.rows("purchased_content").filter((r) => r.stripe_session_id === a.p_session_id), error: null }),
    check_rate_limit: () => rateLimit,
    log_delivery_step: () => ({ data: "pd-x", error: null }),
    agent_prepare_now: () => ({ data: false, error: null }),
  };
});

async function settle() {
  while (pending.length) await pending.shift();
}

async function event(type: string, object: Record<string, unknown>) {
  const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${String(object.id)}`, type, data: { object } }),
  }));
  await settle();
  return res.status;
}

const paid = (id: string, metadata: Record<string, string>, over: Record<string, unknown> = {}) => ({
  id, mode: "payment", payment_status: "paid", amount_total: 1500, currency: "usd",
  customer_email: null, customer_details: { email: "buyer@example.com" }, metadata, ...over,
});
const rowOf = (id: string) => db.rows("product_deliveries").find((r) => r.stripe_session_id === id);
const savedFor = (id: string) => db.rows("purchased_content").find((r) => r.stripe_session_id === id);

describe("the webhook", () => {
  it("keeps the ATS Defense report it generated, mails it, and closes the row (L6-02)", async () => {
    const id = "cs_live_ats_report";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    generatorAnswer = (ep) => new Response(JSON.stringify({ success: true, data: { beforeScore: { overall: 40 }, from: ep }, report: { beforeScore: { overall: 40 } } }), { status: 200 });
    expect(await event("checkout.session.completed", paid(id, { product_type: "ats_defense", product_name: "ATS Defense Complete" }))).toBe(200);
    expect(savedFor(id)?.generated_content, "the report was thrown away").toMatchObject({ beforeScore: { overall: 40 } });
    expect(fetches.some((f) => f.url.includes("send-product-email")), "no delivery mail was sent").toBe(true);
    expect(rowOf(id)?.status).toBe("delivered");
  });

  it("records a 200 with no content as a failure with its reason, never a silent skip", async () => {
    const id = "cs_live_ats_legacy_shape";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    generatorAnswer = () => new Response(JSON.stringify({ success: true, report: { beforeScore: { overall: 40 } } }), { status: 200 });
    await event("checkout.session.completed", paid(id, { product_type: "ats_defense" }));
    expect(savedFor(id)).toBeUndefined();
    const retry = rpcCalls.find((c) => c.name === "update_delivery_retry");
    expect(retry?.args).toMatchObject({ p_status: "generation_failed" });
    expect(String(retry?.args.p_error)).toMatch(/no content/);
  });

  it("records a failed delivery mail as email_failed, so the sweeper resends it (L6-14)", async () => {
    const id = "cs_live_mail_down";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    mailStatus = 502;
    await event("checkout.session.completed", paid(id, { product_type: "cover_letter" }, { amount_total: 400 }));
    expect(rowOf(id)?.status).toBe("email_failed");
    expect(String(rowOf(id)?.last_retry_error)).toMatch(/502/);
  });

  it("delivers a product a 100%-off code completed at $0 (L6-10)", async () => {
    const id = "cs_live_comp_cover_letter";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    await event("checkout.session.completed", paid(id, { product_type: "cover_letter" }, { payment_status: "no_payment_required", amount_total: 0 }));
    expect(db.rows("used_stripe_sessions").map((c) => c.session_id)).toContain(id);
    expect(savedFor(id), "a comped purchase was not delivered").toBeTruthy();
  });

  it("but never a non-zero session that is not paid", async () => {
    const id = "cs_live_owed";
    await event("checkout.session.completed", paid(id, { product_type: "cover_letter" }, { payment_status: "unpaid", amount_total: 400 }));
    expect(db.rows("used_stripe_sessions")).toHaveLength(0);
  });

  it("uses the address the buyer typed into Checkout when the session carries no other (L6-25)", async () => {
    const id = "cs_live_anonymous_buyer";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    await event("checkout.session.completed", paid(id, { product_type: "cover_letter", customer_email: "" }, { customer_details: { email: "Typed@Example.com" } }));
    expect(rowOf(id)?.customer_email).toBe("typed@example.com");
    expect(savedFor(id)?.customer_email).toBe("typed@example.com");
    const mail = fetches.find((f) => f.url.includes("send-product-email"));
    expect((mail?.body as { email?: string } | null)?.email).toBe("typed@example.com");
  });

  it("writes a subscription sale as delivered, and refreshes the Pro cache (L6-27, L6-28)", async () => {
    const id = "cs_live_pro_plan";
    world.customers["buyer@example.com"] = [{ id: "cus_buyer" }];
    world.subs.cus_buyer = [{ id: "sub_1", status: "active", items: { data: [{ price: { unit_amount: 4500 } }] } }];
    await event("checkout.session.completed", paid(id, { product_type: "pro_subscription" }, { mode: "subscription", amount_total: 4500, customer: "cus_buyer" }));
    expect(rowOf(id)?.status, "a subscription sale was left for the sweeper to call a failure").toBe("delivered");
    expect(rpcCalls.find((c) => c.name === "update_delivery_retry")).toBeUndefined();
    expect(db.rows("pro_subscribers").find((r) => r.email === "buyer@example.com")?.status).toBe("active");
  });

  it("leaves a Freelance Boost sale to its intake page, off the sweeper's schedule (L6-27)", async () => {
    const id = "cs_live_freelance";
    await event("checkout.session.completed", paid(id, { product_type: "freelance_boost" }, { amount_total: 2900 }));
    expect(rowOf(id)?.next_retry_at).toBe("infinity");
    expect(rowOf(id)?.status).toBe("payment_received");
  });

  it("records how many credits a scan pack bought, and closes the row before answering (L6-13)", async () => {
    const id = "cs_live_scan_50";
    await event("checkout.session.completed", paid(id, { product_type: "scan_pack", credits: "50", customer_email: "buyer@example.com" }, { amount_total: 1000 }));
    expect((rowOf(id)?.metadata as { credits?: number })?.credits).toBe(50);
    expect(rpcCalls.find((c) => c.name === "add_scan_credits")?.args.p_credits).toBe(50);
    expect(rowOf(id)?.status).toBe("delivered");
  });

  it("tells the owner about a refund or a dispute and changes no entitlement (L6-18)", async () => {
    expect(await event("charge.refunded", { id: "ch_1", amount: 2900, amount_refunded: 2900, currency: "usd", payment_intent: "pi_1", billing_details: { email: "<b>x</b>@example.com" } })).toBe(200);
    expect(alerts).toHaveLength(1);
    const mail = alerts[0] as { subject: string; html: string };
    expect(mail.subject).toMatch(/Refund issued/);
    expect(mail.html, "a buyer-typed value reached the owner's inbox as markup").not.toMatch(/<b>x<\/b>/);
    expect(db.writes.filter((w) => w.table !== "webhook_events")).toEqual([]);
  });
});

describe("the retry sweeper", () => {
  const sweep = async () => {
    const res = await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }));
    return res.json();
  };
  const due = (row: Record<string, unknown>) => {
    db.rows("product_deliveries").push({ retry_count: 0, max_retries: 3, status: "payment_received", ...row });
    db.rpcs.get_failed_deliveries_for_retry = () => ({ data: db.rows("product_deliveries").filter((r) => ["payment_received", "generation_failed", "email_failed"].includes(String(r.status)) && r.next_retry_at !== "infinity"), error: null });
  };

  it("re-credits what was bought, not a hard-coded ten (L6-13)", async () => {
    due({ id: "pd-scan", stripe_session_id: "cs_live_scan_retry", product_type: "scan_pack", customer_email: "b@example.com", metadata: { credits: 50 } });
    await sweep();
    expect(rpcCalls.find((c) => c.name === "add_scan_credits")?.args.p_credits).toBe(50);
  });

  it("does not pay twice when the credits had already landed", async () => {
    due({ id: "pd-scan2", stripe_session_id: "cs_live_scan_landed", product_type: "scan_pack", customer_email: "b@example.com", metadata: { credits: 20 } });
    db.rows("purchased_content").push({ stripe_session_id: "cs_live_scan_landed", generated_content: { credits: 20 } });
    await sweep();
    expect(rpcCalls.find((c) => c.name === "add_scan_credits")).toBeUndefined();
    expect(db.rows("product_deliveries").find((r) => r.id === "pd-scan2")?.status).toBe("delivered");
  });

  it("takes a subscription row off the schedule with its reason, not a failure (L6-27)", async () => {
    due({ id: "pd-sub", stripe_session_id: "cs_live_sub_old", product_type: "pro_subscription", customer_email: "b@example.com", metadata: {} });
    await sweep();
    const row = db.rows("product_deliveries").find((r) => r.id === "pd-sub");
    expect(row?.next_retry_at).toBe("infinity");
    expect(rpcCalls.find((c) => c.name === "update_delivery_retry")).toBeUndefined();
  });

  it("never marks an ATS Defense row delivered without the report (L6-02)", async () => {
    due({ id: "pd-ats", stripe_session_id: "cs_live_ats_retry", product_type: "ats_defense", customer_email: "b@example.com", metadata: { resume_session_id: RESUME_ID } });
    generatorAnswer = () => new Response(JSON.stringify({ success: true, report: { x: 1 } }), { status: 200 });
    await sweep();
    expect(db.rows("product_deliveries").find((r) => r.id === "pd-ats")?.status).not.toBe("delivered");
    expect(fetches.some((f) => f.url.includes("send-product-email")), "a content-less mail was sent").toBe(false);
  });

  it("moves a row whose content was saved but whose mail failed to email_failed, not back to generation", async () => {
    due({ id: "pd-cl", stripe_session_id: "cs_live_cl_retry", product_type: "cover_letter", customer_email: "b@example.com", metadata: { resume_session_id: RESUME_ID } });
    mailStatus = 500;
    await sweep();
    expect(db.rows("product_deliveries").find((r) => r.id === "pd-cl")?.status).toBe("email_failed");
  });
});

describe("verify-product-purchase", () => {
  const post = async (body: Record<string, unknown>) => {
    const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" }, body: JSON.stringify(body),
    }));
    return { status: res.status, json: await res.json() };
  };

  it("answers a refresh of an already-redeemed Pro grant as verified, not 'Invalid session' (L6-15)", async () => {
    db.rows("pro_grants").push({ id: "grant-1", email: "pro@example.com", product_type: "premium_package", product_name: "Premium", consumed_at: new Date().toISOString(), language: "en" });
    db.rows("used_stripe_sessions").push({ session_id: "pro_grant-1", product_type: "premium_package" });
    const r = await post({ sessionId: "pro_grant-1" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ verified: true, isFirstUse: false });
  });

  it("but a spent grant with no redemption claim is still refused", async () => {
    db.rows("pro_grants").push({ id: "grant-2", email: "pro@example.com", product_type: "premium_package", consumed_at: new Date().toISOString() });
    expect((await post({ sessionId: "pro_grant-2" })).status).toBe(400);
  });

  it("a rate-limit counter that errored is not 'Too many requests' (L6-19)", async () => {
    rateLimit = { data: null, error: { message: "statement timeout" } };
    world.sessions.cs_live_verify_rl = paid("cs_live_verify_rl", { product_type: "career_snapshot" });
    expect((await post({ sessionId: "cs_live_verify_rl" })).status).toBe(200);
    rateLimit = { data: false, error: null };
    expect((await post({ sessionId: "cs_live_verify_rl" })).status).toBe(429);
  });

  it("leaves a receipt for credits it adds, so the sweeper never credits the same purchase twice", async () => {
    world.sessions.cs_live_verify_scan = paid("cs_live_verify_scan", { product_type: "scan_pack", credits: "20", customer_email: "b@example.com" }, { amount_total: 400 });
    expect((await post({ sessionId: "cs_live_verify_scan" })).status).toBe(200);
    expect(rpcCalls.filter((c) => c.name === "add_scan_credits")).toHaveLength(1);
    expect(savedFor("cs_live_verify_scan")?.generated_content).toMatchObject({ credits: 20 });
    expect(rpcCalls.some((c) => c.name === "log_delivery_step" && c.args.p_step === "generation_completed")).toBe(true);
  });

  const steps = () => rpcCalls.filter((c) => c.name === "log_delivery_step").map((c) => c.args);
  const mailed = () => fetches.some((f) => f.url.includes("send-product-email"));

  it("a pack whose credits failed is left failed with what it bought, and not confirmed (review of L6-13 / L6-26)", async () => {
    world.sessions.cs_live_verify_credit_flake = paid("cs_live_verify_credit_flake", { product_type: "scan_pack", credits: "50", customer_email: "b@example.com" }, { amount_total: 1000 });
    db.rpcs.add_scan_credits = () => ({ data: null, error: { message: "fake: deadlock detected" } });
    const r = await post({ sessionId: "cs_live_verify_credit_flake" });
    expect(r.status).toBe(200);
    expect(r.json.emailSent).toBe(false);
    expect(mailed(), "a confirmation went out for credits that never landed").toBe(false);
    const all = steps();
    expect(all.find((a) => a.p_step === "payment_received")?.p_metadata, "the row does not say how many credits were bought").toMatchObject({ credits: 50 });
    expect(all.find((a) => a.p_step === "generation_completed")).toMatchObject({ p_success: false });
    expect(String(all.find((a) => a.p_step === "generation_completed")?.p_error)).toMatch(/deadlock/);
    expect(all.some((a) => a.p_step === "email_sent"), "the mail step would close the row as delivered").toBe(false);
  });

  it("a keyword fix whose generation failed is not confirmed, and its row keeps the résumé to retry from", async () => {
    const id = "cs_live_verify_kwfix_down";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    world.sessions[id] = paid(id, { product_type: "basic_keyword_fix", job_title: "Analyst", language: "de" }, { amount_total: 300 });
    generatorAnswer = () => new Response(JSON.stringify({ error: "model busy" }), { status: 503 });
    const r = await post({ sessionId: id, generateContent: true });
    expect(r.status).toBe(200);
    expect(mailed()).toBe(false);
    const all = steps();
    expect(all.find((a) => a.p_step === "payment_received")?.p_metadata).toMatchObject({ resume_session_id: RESUME_ID, job_title: "Analyst", language: "de" });
    expect(all.filter((a) => a.p_step === "generation_completed").map((a) => a.p_success)).toEqual([false]);
    expect(all.some((a) => a.p_step === "email_sent")).toBe(false);
  });

  it("a delivery that succeeded is still confirmed by mail", async () => {
    world.sessions.cs_live_verify_ok = paid("cs_live_verify_ok", { product_type: "scan_pack", credits: "30", customer_email: "b@example.com" }, { amount_total: 600 });
    const r = await post({ sessionId: "cs_live_verify_ok" });
    expect(r.json.emailSent).toBe(true);
    expect(steps().map((a) => a.p_step)).toEqual(["payment_received", "generation_completed", "email_sent"]);
  });

  it("verifies a $0 comp and names the address the buyer typed into Checkout (L6-10, L6-25)", async () => {
    world.sessions.cs_live_verify_comp = paid("cs_live_verify_comp", { product_type: "career_snapshot", customer_email: "" }, { payment_status: "no_payment_required", amount_total: 0, customer_details: { email: "Comp@Example.com" } });
    const r = await post({ sessionId: "cs_live_verify_comp" });
    expect(r.status).toBe(200);
    expect(r.json.customerEmail).toBe("comp@example.com");
  });
});

describe("generate-ats-defense", () => {
  const post = async (sessionId: string) => {
    const res = await ats(new Request("https://harness.supabase.co/functions/v1/generate-ats-defense", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.30" },
      body: JSON.stringify({ sessionId, resumeText: "B".repeat(300), targetRoles: [] }),
    }));
    return { status: res.status, json: await res.json() };
  };

  it("serves a Pro subscriber's grant by its claim, without asking Stripe, and keeps the report (L6-03)", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "pro_grant-ats", product_type: "ats_defense" });
    db.rows("pro_grants").push({ id: "grant-ats", email: "pro@example.com", product_type: "ats_defense" });
    const r = await post("pro_grant-ats");
    expect(r.status, JSON.stringify(r.json).slice(0, 160)).toBe(200);
    expect(r.json.data, "the payload every server caller reads").toEqual(r.json.report);
    expect(savedFor("pro_grant-ats")?.customer_email).toBe("pro@example.com");
  });

  it("refuses a grant whose claim bought something else", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "pro_grant-other", product_type: "premium_package" });
    expect((await post("pro_grant-other")).status).toBe(402);
  });
});
