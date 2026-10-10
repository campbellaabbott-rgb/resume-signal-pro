// @vitest-environment node
/**
 * A BUYER WHO CLOSED THE TAB HAD NO WAY BACK, AND NO ONE READ THEIR REPLY
 * (commercial-readiness 2026-10-08, item 3).
 *
 * WHAT WAS WRONG.
 *   - Every purchase mail's button went to the homepage.
 *   - The Full Resume Analysis and Freelance Boost buyers got no mail at all:
 *     the webhook returned before mailing anything for products made on
 *     their own pages.
 *   - recover-purchase took only a bare session id, asked for "the link from
 *     your confirmation email" that no email carried, and refused the rest.
 *   - No customer mail set a reply address, so "reply to this email" went to
 *     reports@ or notify@ on our sending domains, which nobody reads.
 *
 * WHAT HOLDS NOW, running the shipped handlers with only their network faked:
 * each product's mail opens the page that holds that purchase, with its
 * session, and prints the reference; the webhook mails the Full Analysis and
 * Freelance Boost buyer at payment; recover-purchase finds the purchase from
 * the bare id, the button's link (encoded or not) or the reference line; and
 * the purchase, report, affiliate and queued mails carry the reply address.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const REPLY = "resumeboostersupp@gmail.com";
const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const SESSION = "cs_live_a1B2c3D4e5F6g7H8i9J0purchase";
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness", STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness",
};
const resendStub = (v: string) => `export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__mails.push({ ...m, __v: "${v}" }); return { data: { id: "em" }, error: null }; } }; } }`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.webhooks = { constructEventAsync: async (b) => JSON.parse(b) }; this.customers = { list: async () => ({ data: [] }) }; this.subscriptions = { list: async () => ({ data: [] }) }; } }",
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__client; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": resendStub("2"),
  "https://esm.sh/resend@4.0.0": resendStub("4"),
  "npm:@lovable.dev/email-js": "export async function sendLovableEmail(p) { globalThis.__queued.push(p); return { success: true }; }",
  "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__client;",
};

type Mail = Record<string, unknown> & { to: string[] | string; html: string; subject: string };
const g = globalThis as Record<string, unknown>;
const mails: Mail[] = [];
const queued: Array<Record<string, unknown>> = [];
const fetches: Array<{ url: string; body: Record<string, unknown> | null }> = [];
const pending: Promise<unknown>[] = [];
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const client = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown> = {}) => db.rpc(n, a) };
const handlers: Record<string, EdgeHandler> = {};

beforeAll(async () => {
  g.__mails = mails;
  g.__queued = queued;
  g.__client = client;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    fetches.push({ url, body });
    return new Response("{}", { status: 200 });
  };
  for (const fn of ["send-product-email", "stripe-webhook", "recover-purchase", "process-email-queue", "send-analysis-email", "send-affiliate-commission-email"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
}, 120_000);

beforeEach(() => {
  mails.length = 0; queued.length = 0; fetches.length = 0; pending.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {
    log_email_send: () => ({ data: null, error: null }),
    log_webhook_event: () => ({ data: null, error: null }),
  };
});
const settle = async () => { while (pending.length) await pending.shift(); };
const internal = (fn: string, body: unknown) => handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify(body),
}));
const ctaOf = (html: string) => /<a href="([^"]+)"[^>]*>\s*Open your purchase/.exec(html)?.[1]?.replace(/&amp;/g, "&");

describe("the purchase mail opens what was bought, and a reply reaches a person", () => {
  const cases: Array<[string, string]> = [
    ["cover_letter", `https://resumebooster.work/product-success?session_id=${SESSION}&product=coverLetter`],
    ["apply_assistant", `https://resumebooster.work/product-success?session_id=${SESSION}&product=applyAssistant`],
    ["scan_pack", `https://resumebooster.work/product-success?session_id=${SESSION}&product=scanPack`],
    ["full_analysis", `https://resumebooster.work/success?session_id=${SESSION}`],
    ["freelance_boost", `https://resumebooster.work/freelance-boost?session_id=${SESSION}`],
    ["freelance_transition_pro", `https://resumebooster.work/freelance-boost?session_id=${SESSION}`],
  ];
  for (const [productType, link] of cases) {
    it(`${productType}: the button opens ${new URL(link).pathname} with the session, the reference is printed, replies go to the owner`, async () => {
      const res = await internal("send-product-email", { email: "buyer@example.com", productType, productName: "The Product", sessionId: SESSION });
      expect(res.status).toBe(200);
      expect(mails).toHaveLength(1);
      const m = mails[0];
      expect(ctaOf(m.html), "the button went to the homepage").toBe(link);
      expect(m.html).toContain(SESSION);
      expect(m.reply_to, "a reply went to a sending address nobody reads").toBe(REPLY);
    });
  }

  it("a product made on its own page is not announced as ready", async () => {
    await internal("send-product-email", { email: "buyer@example.com", productType: "full_analysis", productName: "Full Resume Analysis", sessionId: SESSION });
    expect(mails[0].subject).not.toMatch(/is ready/i);
    expect(mails[0].subject).toMatch(/open your purchase/i);
  });
});

describe("the webhook mails a Full Analysis and a Freelance Boost buyer at payment", () => {
  const complete = (productType: string, id: string) => handlers["stripe-webhook"](new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${id}`, type: "checkout.session.completed", data: { object: {
      id, mode: "payment", payment_status: "paid", amount_total: 500, currency: "usd",
      customer_details: { email: "buyer@example.com" }, metadata: { product_type: productType },
    } } }),
  }));

  for (const productType of ["full_analysis", "freelance_boost"]) {
    it(`${productType}: one purchase mail, carrying the session`, async () => {
      const id = `cs_live_${productType.replace(/_/g, "")}0001`;
      expect((await complete(productType, id)).status).toBe(200);
      await settle();
      const calls = fetches.filter((f) => f.url.endsWith("/functions/v1/send-product-email"));
      expect(calls, "the buyer of a product made on its own page got no mail").toHaveLength(1);
      expect(calls[0].body).toMatchObject({ email: "buyer@example.com", productType, sessionId: id });
      expect(String(calls[0].body?.productName ?? "")).not.toBe("");
    });
  }
});

describe("recover-purchase takes what the email contains", () => {
  const ask = async (pasted: unknown) => {
    const looked: unknown[] = [];
    db.rpcs.get_purchased_content_by_session = (a) => { looked.push(a.p_session_id); return { data: [{ id: "p", product_type: "cover_letter", product_name: "Cover Letter", generated_content: { coverLetter: "Dear" }, created_at: "2026-10-09" }], error: null }; };
    const res = await handlers["recover-purchase"](new Request("https://harness.supabase.co/functions/v1/recover-purchase", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: pasted }),
    }));
    return { status: res.status, looked, body: await res.json() };
  };

  it("the bare id, the button's link, the link percent-encoded, and the reference line all find the purchase", async () => {
    for (const pasted of [
      SESSION,
      `https://resumebooster.work/product-success?session_id=${SESSION}&product=coverLetter`,
      `https%3A%2F%2Fresumebooster.work%2Fproduct-success%3Fsession_id%3D${SESSION}%26product%3DcoverLetter`,
      `Keep this email: the button opens your purchase on any device. Order reference (session ID): ${SESSION}`,
    ]) {
      const r = await ask(pasted);
      expect(r.status, `refused: ${pasted.slice(0, 60)}`).toBe(200);
      expect(r.looked).toEqual([SESSION]);
      expect(r.body.found).toBe(true);
    }
  });

  it("text with no purchase reference is refused without a lookup", async () => {
    for (const pasted of ["hello", "", null, "https://resumebooster.work/"]) {
      const r = await ask(pasted);
      expect(r.status).toBe(400);
      expect(r.looked).toEqual([]);
    }
  });
});

describe("the other customer mails carry the reply address", () => {
  it("the Full Analysis report mail", async () => {
    const res = await internal("send-analysis-email", { email: "buyer@example.com", shareId: "a".repeat(24), analysisData: { atsScore: { score: 70 } } });
    expect(res.status).toBe(200);
    expect(mails[0].reply_to).toBe(REPLY);
  });

  it("the affiliate's commission mail (Resend 4 spells it replyTo)", async () => {
    const res = await internal("send-affiliate-commission-email", { affiliateEmail: "aff@example.com", productName: "Cover Letter", saleAmount: 400, commissionAmount: 100, referralCode: "abc" });
    expect(res.status).toBe(200);
    expect(mails[0].__v).toBe("4");
    expect(mails[0].replyTo).toBe(REPLY);
  });

  it("a queued mail (sign-in links and the fix-plan drip)", async () => {
    db.rows("email_send_state").push({ id: 1, retry_after_until: null, batch_size: 10, send_delay_ms: 0, auth_email_ttl_minutes: 15, transactional_email_ttl_minutes: 60 });
    const msgs: Record<string, unknown[]> = {
      auth_emails: [{ msg_id: 1, read_ct: 1, message: { message_id: "m-1", to: "u@example.com", from: "Resume Booster <noreply@notify.resumebooster.work>", subject: "s", html: "h", label: "magiclink", queued_at: new Date().toISOString() } }],
      transactional_emails: [{ msg_id: 2, read_ct: 1, message: { message_id: "m-2", to: "v@example.com", from: "Resume Booster <noreply@notify.resumebooster.work>", subject: "Day 2", html: "h", label: "fix-plan-drip", queued_at: new Date().toISOString() } }],
    };
    db.rpcs.read_email_batch = (a) => ({ data: msgs[String(a.queue_name)] ?? [], error: null });
    db.rpcs.delete_email = () => ({ data: true, error: null });
    db.rpcs.move_to_dlq = () => ({ data: 1, error: null });
    const jwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
    await handlers["process-email-queue"](new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "POST", headers: { authorization: `Bearer ${jwt}` } }));
    expect(queued.map((q) => q.to).sort()).toEqual(["u@example.com", "v@example.com"]);
    for (const q of queued) expect(q.reply_to, `queued ${String(q.label)} has no reply address`).toBe(REPLY);
  });
});
