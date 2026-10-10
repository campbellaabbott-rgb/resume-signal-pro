// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness).
/**
 * A PURCHASE MAIL SAID "READY" BEFORE ANYTHING EXISTED, AND LINKED NOWHERE.
 *
 * WHAT WAS WRONG (sweep 2026-10-08).
 *   S8-009  verify-product-purchase reused the webhook's saved copy only when
 *           the page asked it to generate, which it did for the keyword fix
 *           alone, so the page regenerated every other product from its own
 *           tab's résumé. Claiming a generated product without content it
 *           mailed "Your X is Ready!" and logged email_sent, which closes the
 *           delivery row: if nothing was then made, the sweeper never came.
 *           And while the webhook was still generating, the page's call
 *           generated the same product a second time.
 *   S8-015  The purchase mail's only link was the homepage; the recovery form
 *           asks for "the link or session ID from your confirmation email".
 *   S8-016  A Freelance Boost purchase was mailed nothing.
 *
 * Run against the shipped handlers with only their network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { PRODUCT_ID_BY_TYPE, purchaseLinkFor } from "../../supabase/functions/_shared/purchase-link";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const RESUME_ID = "11111111-2222-4333-8444-555555555555";

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__mailWorld;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.customers = { list: async () => ({ data: [], has_more: false }), retrieve: async (id) => ({ id, email: null }) };
    this.subscriptions = { list: async () => ({ data: [], has_more: false }) };
    this.checkout = { sessions: { retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; } } };
  }
}`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__mailClient; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__sent.push(m); return { data: { id: 'x' }, error: null }; } }; } }",
};
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec", STRIPE_SECRET_KEY: "sk_test", SUPABASE_URL: "https://h.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_x",
};

const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const steps: Array<Record<string, unknown>> = [];
const fetches: Array<{ url: string; body: Record<string, unknown> }> = [];
const sent: Array<Record<string, any>> = [];
const world = { sessions: {} as Record<string, unknown> };
const pending: Promise<unknown>[] = [];
let verify: EdgeHandler;
let mailer: EdgeHandler;
let webhook: EdgeHandler;

const client = {
  from: (t: string) => {
    const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
    q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
    return q;
  },
  rpc: (name: string, args: Record<string, unknown> = {}) => db.rpc(name, args),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__mailClient = client;
  g.__mailWorld = world;
  g.__sent = sent;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("send-product-email")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify({ success: true, data: { summary: "made here" } }), { status: 200 });
  };
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
  mailer = await loadEdgeHandler("send-product-email", STUBS);
  webhook = await loadEdgeHandler("stripe-webhook", STUBS);
}, 120_000);

beforeEach(() => {
  db.tables = {};
  steps.length = 0; fetches.length = 0; sent.length = 0; pending.length = 0;
  world.sessions = {};
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    log_delivery_step: (a) => { steps.push(a); return { data: "pd", error: null }; },
    log_email_send: () => ({ data: null, error: null }),
    log_webhook_event: () => ({ data: null, error: null }),
    get_temp_resume: () => ({ data: [{ resume_text: "B".repeat(400), job_description_text: "Job X posting" }], error: null }),
    save_purchased_content: () => ({ data: "pc", error: null }),
    get_purchased_content_by_session: (a) => ({ data: db.rows("purchased_content").filter((r) => r.stripe_session_id === a.p_session_id), error: null }),
  };
});

const session = (id: string, productType: string, extra: Record<string, unknown> = {}) => ({
  id, payment_status: "paid", mode: "payment", amount_total: 900, customer_details: { email: "buyer@example.com" },
  metadata: { product_type: productType, product_name: "Career Snapshot", session_id: RESUME_ID }, ...extra,
});
const ask = async (sessionId: string, generateContent: boolean) => {
  const res = await verify(new Request("https://h.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.5" },
    body: JSON.stringify({ sessionId, generateContent }),
  }));
  await Promise.all(pending);
  return res.json() as Promise<Record<string, unknown>>;
};
const mails = () => fetches.filter((f) => f.url.includes("send-product-email"));
const generators = () => fetches.filter((f) => /generate-/.test(f.url));

describe("verify-product-purchase (S8-009)", () => {
  it("claiming a generated product with nothing made sends no 'Ready' mail and logs no email_sent", async () => {
    world.sessions.cs_test_first_claim01 = session("cs_test_first_claim01", "career_snapshot");
    const r = await ask("cs_test_first_claim01", false);
    expect(r.verified).toBe(true);
    expect(mails(), "a 'Ready' mail with nothing behind it").toHaveLength(0);
    expect(steps.some((s) => s.p_step === "email_sent")).toBe(false);
  });

  it("answers the webhook's saved copy whatever the page asked, and makes nothing", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_test_saved_copy01", product_type: "career_snapshot" });
    db.rows("purchased_content").push({ stripe_session_id: "cs_test_saved_copy01", generated_content: { summary: "for job X" } });
    world.sessions.cs_test_saved_copy01 = session("cs_test_saved_copy01", "career_snapshot");
    const r = await ask("cs_test_saved_copy01", false);
    expect(r.generatedContent).toEqual({ summary: "for job X" });
    expect(generators()).toHaveLength(0);
  });

  it("while the webhook is still making it, answers inProgress instead of making it twice", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_test_in_flight01", product_type: "career_snapshot" });
    db.rows("product_deliveries").push({ stripe_session_id: "cs_test_in_flight01", status: "generating", content_generation_started_at: new Date().toISOString() });
    world.sessions.cs_test_in_flight01 = session("cs_test_in_flight01", "career_snapshot");
    const r = await ask("cs_test_in_flight01", true);
    expect(r.inProgress).toBe(true);
    expect(generators(), "the product was generated a second time").toHaveLength(0);
  });

  it("the mail it does send carries the purchase's id", async () => {
    world.sessions.cs_test_made_here01 = session("cs_test_made_here01", "career_snapshot");
    await ask("cs_test_made_here01", true);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].body.sessionId).toBe("cs_test_made_here01");
  });
});

describe("the purchase mail reopens the purchase (S8-015)", () => {
  const send = async (body: Record<string, unknown>) => {
    const res = await mailer(new Request("https://h.supabase.co/functions/v1/send-product-email", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify(body),
    }));
    return res.status;
  };

  it("links the success page for this session and product, and prints the id", async () => {
    expect(await send({ email: "buyer@example.com", productType: "career_snapshot", productName: "Career Snapshot", sessionId: "cs_live_abc123XYZ" })).toBe(200);
    const html = String(sent[0].html);
    expect(html).toContain('href="https://resumebooster.work/product-success?session_id=cs_live_abc123XYZ&amp;product=careerSnapshot"');
    expect(html).toContain("cs_live_abc123XYZ</strong>");
  });

  it("a Freelance Boost mail opens the intake page and is not called ready", async () => {
    await send({ email: "buyer@example.com", productType: "freelance_boost", productName: "Freelance Boost", sessionId: "cs_live_free123lance" });
    expect(String(sent[0].html)).toContain('href="https://resumebooster.work/freelance-boost?session_id=cs_live_free123lance"');
    expect(String(sent[0].subject)).not.toMatch(/Ready/);
  });

  it("the link's product ids are the checkout's own catalogue keys", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/create-product-checkout/index.ts"), "utf8");
    const table = [...src.matchAll(/\n  (\w+): \{[\s\S]*?productType: "([a-z_]+)"/g)].map((m) => [m[2], m[1]]);
    expect(table.length).toBeGreaterThanOrEqual(12);
    expect(Object.fromEntries(table)).toEqual(PRODUCT_ID_BY_TYPE);
    expect(purchaseLinkFor("not-a-session", "career_snapshot")).toBeNull();
  });
});

describe("a Freelance Boost purchase is mailed its link at payment (S8-016)", () => {
  it("the webhook sends the intake link with the session", async () => {
    const res = await webhook(new Request("https://h.supabase.co/functions/v1/stripe-webhook", {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=x" },
      body: JSON.stringify({ id: "evt_f", type: "checkout.session.completed", data: { object: {
        id: "cs_test_freelance_paid1", mode: "payment", payment_status: "paid", amount_total: 2900,
        customer_details: { email: "buyer@example.com" }, metadata: { product_type: "freelance_boost", product_name: "Freelance Boost" },
      } } }),
    }));
    expect(res.status).toBe(200);
    await Promise.all(pending);
    expect(mails()).toHaveLength(1);
    expect(mails()[0].body).toMatchObject({ productType: "freelance_boost", sessionId: "cs_test_freelance_paid1" });
  });
});
