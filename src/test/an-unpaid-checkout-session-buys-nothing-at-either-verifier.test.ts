// @vitest-environment node
/**
 * AN UNPAID CHECKOUT SESSION BUYS NOTHING AT EITHER VERIFIER (S11-051).
 *
 * verify-product-purchase and verify-scan-pack-purchase take a cs_ id from
 * the browser, ask Stripe for it, and deliver: claim the session, run the
 * generator, add credits, send the mail. Their only payment check is
 * checkoutSessionSettled. Every test sent a paid session or a $0 comp, so
 * replacing that check with `if (false)` (mutations M23, M42) left the suite
 * green while it would hand out every product free.
 *
 * Both shipped handlers run here with Stripe answering unsettled sessions: an
 * open unpaid $5 session, an open unpaid $0 one, a subscription's $0 trial,
 * and 'no_payment_required' with money still owed. Each is a 400 "Payment
 * not completed", with no claim, no credits, no generator call and no mail.
 * The positive control, the same session paid, passes the gate.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

type Session = Record<string, unknown>;
let session: Session = {};
let db: FakeDb;
let outbound: string[] = [];
let rpcCalls: string[] = [];
const g = globalThis as Record<string, unknown>;

const STRIPE = `export default class Stripe { constructor() {
  this.checkout = { sessions: { retrieve: async (id) => ({ id, ...globalThis.__unpaidSession }), listLineItems: async () => ({ data: [] }) } };
  this.customers = { retrieve: async () => ({ id: "cus_1", email: "buyer@example.com" }), list: async () => ({ data: [] }) };
  this.subscriptions = { list: async () => ({ data: [] }) };
  this.charges = { list: async () => ({ data: [] }) };
} }`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__unpaidDb;",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => { globalThis.__unpaidOut.push('resend'); return { data: { id: 'm' }, error: null }; } }; } }",
};

let product: EdgeHandler;
let scanPack: EdgeHandler;

beforeAll(async () => {
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc",
    SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_x", LOVABLE_API_KEY: "lov",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (u: string) => { (g.__unpaidOut as string[]).push(String(u)); return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }); };
  product = await loadEdgeHandler("verify-product-purchase", STUBS);
  scanPack = await loadEdgeHandler("verify-scan-pack-purchase", STUBS);
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  rpcCalls = [];
  const rpc = db.rpc.bind(db);
  db.rpc = ((name: string, args?: Record<string, unknown>) => { rpcCalls.push(name); return rpc(name, args); }) as typeof db.rpc;
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.add_scan_credits = () => ({ data: true, error: null });
  db.rpcs.get_temp_resume = () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "" }], error: null });
  outbound = [];
  g.__unpaidOut = outbound;
  g.__unpaidDb = db;
});

const base = (product_type: string): Session => ({
  object: "checkout.session", mode: "payment", currency: "usd", customer: null,
  customer_details: { email: "buyer@example.com" }, customer_email: "buyer@example.com",
  metadata: { product_type, product_name: "Thing", customer_email: "buyer@example.com", session_id: "sess_r1", credits: "3" },
  line_items: { data: [{ quantity: 3 }] },
});
const UNSETTLED: Array<[string, Session]> = [
  ["an open, unpaid $5 session", { payment_status: "unpaid", status: "open", amount_total: 500 }],
  ["an open, unpaid $0 session", { payment_status: "unpaid", status: "open", amount_total: 0 }],
  ["a subscription's $0 trial", { payment_status: "no_payment_required", status: "complete", amount_total: 0, mode: "subscription" }],
  ["no_payment_required with money still owed", { payment_status: "no_payment_required", status: "complete", amount_total: 500 }],
];
const call = async (h: EdgeHandler, fn: string) => {
  const res = await h(new Request(`https://h.supabase.co/functions/v1/${fn}`, {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.7" },
    body: JSON.stringify({ sessionId: "cs_test_unpaid_abcdefghijk" }),
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
};
const nothingDelivered = () => {
  expect(db.rows("used_stripe_sessions"), "the session was claimed").toEqual([]);
  expect(db.writes.filter((w) => w.table !== "rate_limits"), "something was written").toEqual([]);
  expect(rpcCalls.filter((n) => n !== "check_rate_limit"), "a delivery rpc ran").toEqual([]);
  expect(outbound.filter((u) => /generate-|send-|resend|api\.resend\.com/.test(u)), "a generator or a mail was called").toEqual([]);
};

describe("verify-product-purchase refuses an unsettled session", () => {
  for (const [what, s] of UNSETTLED) {
    it(`${what}: 400 Payment not completed, nothing claimed, generated or mailed`, async () => {
      g.__unpaidSession = { ...base("cover_letter"), ...s };
      const r = await call(product, "verify-product-purchase");
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("Payment not completed");
      nothingDelivered();
    });
  }
  it("positive control: the same session paid gets past the payment check", async () => {
    g.__unpaidSession = { ...base("cover_letter"), payment_status: "paid", status: "complete", amount_total: 500 };
    const r = await call(product, "verify-product-purchase");
    expect(r.json.error).not.toBe("Payment not completed");
  });
});

describe("verify-scan-pack-purchase refuses an unsettled session", () => {
  for (const [what, s] of UNSETTLED) {
    it(`${what}: 400 Payment not completed, no credits, no claim`, async () => {
      g.__unpaidSession = { ...base("scan_pack"), ...s };
      const r = await call(scanPack, "verify-scan-pack-purchase");
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("Payment not completed");
      expect(r.json.verified).toBe(false);
      nothingDelivered();
    });
  }
  it("positive control: the same session paid adds its credits", async () => {
    g.__unpaidSession = { ...base("scan_pack"), payment_status: "paid", status: "complete", amount_total: 60 };
    const r = await call(scanPack, "verify-scan-pack-purchase");
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.creditsAdded).toBe(3);
  });
});
