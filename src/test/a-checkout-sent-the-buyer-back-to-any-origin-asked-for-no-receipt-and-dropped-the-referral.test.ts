// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness).
/**
 * A CHECKOUT SENT THE BUYER BACK TO ANY ORIGIN, ASKED STRIPE FOR NO RECEIPT,
 * AND DROPPED THE REFERRAL.
 *
 * WHAT WAS WRONG (wave 3 payments-account; sweep S8-059, S8-060 and the
 * commercial-readiness plan of 2026-10-08, items 1, 11, 12 and 14).
 *   - Every checkout built its success and cancel addresses from the
 *     caller's Origin header, so a forged one turned a real Stripe page into a
 *     redirect, after payment and with the session id, to any host. Three fell
 *     back to lovable.dev.
 *   - None named a receipt address, so no buyer was sent one unless a
 *     dashboard switch nobody had checked was on.
 *   - Five of six dropped the affiliate's code.
 *   - No session recorded which Terms the buyer was shown, and no subscription
 *     said beside Stripe's pay button that it renews until cancelled.
 *   - The scan-credit checkout attached an anonymous payment to whatever
 *     Stripe customer the typed address already had.
 *   - Tax was off by a literal in two checkouts and absent in the rest; the
 *     EU/UK build had nowhere to switch on.
 *
 * WHAT HOLDS NOW, against the six shipped handlers that mint a live Stripe
 * session, with Stripe, the database and the auth server faked: a forged
 * Origin returns the buyer to the site; the referral and the Terms version
 * ride every session (at $0 commission where the affiliate page promises
 * none); a payment with a known address names it for the receipt; each
 * subscription carries its renewal terms, the agent's its trial; tax stays
 * off unless the EU/UK switch is on, and with it on a checkout without the
 * buyer's waiver is refused.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { TERMS_VERSION } from "@/config/terms";
import { TERMS_VERSION as SERVER_TERMS_VERSION } from "../../supabase/functions/_shared/checkout-policy";
import { SUBSCRIPTIONS } from "@/config/products";

const BUYER = { id: "00000000-0000-4000-8000-0000000c0de1", email: "buyer@example.com" };
const env: Record<string, string> = {};
type Created = Record<string, any>;
const state: { created: Created[]; customerLists: string[]; customers: Record<string, Array<{ id: string }>> } = { created: [], customerLists: [], customers: {} };
let db: FakeDb;

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const s = () => globalThis.__polState;
    this.customers = { list: async ({ email }) => { s().customerLists.push(email); return { data: s().customers[email] ?? [], has_more: false }; } };
    this.subscriptions = { list: async () => ({ data: [], has_more: false }) };
    this.promotionCodes = { list: async () => ({ data: [] }) };
    this.checkout = { sessions: {
      create: async (p) => {
        s().created.push(p);
        const li = (p.line_items ?? [])[0] ?? {};
        const amount = (li.price_data?.unit_amount ?? 500) * (li.quantity ?? 1);
        return { id: "cs_test_pol_" + s().created.length, url: "https://checkout.stripe.com/c/pay", amount_total: p.mode === "subscription" ? 0 : amount, currency: "usd", mode: p.mode };
      },
      expire: async () => ({}),
    } };
  }
}`;

function client(_url?: string, _key?: string, opts?: { global?: { headers?: Record<string, string> } }) {
  const headerToken = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
  return {
    from: (t: string) => {
      const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
      q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
      q.lte = (col: string, v: unknown) => { q.preds.push((r) => r[col] != null && String(r[col]) <= String(v)); return q; };
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (jwt?: string) => ((jwt ?? headerToken) === "jwt-buyer"
        ? { data: { user: BUYER }, error: null }
        : { data: { user: null }, error: { message: "no session" } }),
    },
  };
}

const handlers: Record<string, EdgeHandler> = {};
const SERVE = { "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }" };
const CLIENT = "export function createClient(...a) { return globalThis.__polClient(...a); }";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  g.__polState = state;
  g.__polClient = client;
  const stripe = { "https://esm.sh/stripe@18.5.0": STRIPE_STUB };
  handlers["create-checkout"] = await loadEdgeHandler("create-checkout", { ...SERVE, ...stripe, "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__polClient();" });
  handlers["create-product-checkout"] = await loadEdgeHandler("create-product-checkout", { ...SERVE, ...stripe, "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT });
  handlers["create-scan-pack-checkout"] = await loadEdgeHandler("create-scan-pack-checkout", { ...SERVE, ...stripe, "https://esm.sh/@supabase/supabase-js@2": CLIENT });
  handlers["create-subscription-checkout"] = await loadEdgeHandler("create-subscription-checkout", { ...SERVE, ...stripe, "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT });
  handlers["create-agent-checkout"] = await loadEdgeHandler("create-agent-checkout", { ...SERVE, ...stripe, "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT });
  handlers["create-pass-checkout"] = await loadEdgeHandler("create-pass-checkout", { ...stripe, "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT });
}, 240_000);

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
    SUPABASE_ANON_KEY: "anon_harness_key",
    STRIPE_SECRET_KEY: "sk_test_harness",
  });
  state.created.length = 0;
  state.customerLists.length = 0;
  state.customers = {};
  db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
});
afterEach(() => { state.created.length = 0; });

/** What each minter is sent by its page, signed in where it requires it. */
const CASES: Array<{ fn: string; body: Record<string, unknown>; signedIn: boolean; mode: "payment" | "subscription"; commissioned: boolean; receipt: string | null }> = [
  { fn: "create-checkout", body: { currency: "usd" }, signedIn: false, mode: "payment", commissioned: false, receipt: null },
  { fn: "create-product-checkout", body: { email: "Typed@Example.com", productId: "coverLetter" }, signedIn: false, mode: "payment", commissioned: true, receipt: "typed@example.com" },
  { fn: "create-scan-pack-checkout", body: { email: "typed@example.com", creditAmount: 10 }, signedIn: false, mode: "payment", commissioned: false, receipt: "typed@example.com" },
  { fn: "create-subscription-checkout", body: {}, signedIn: true, mode: "subscription", commissioned: false, receipt: null },
  { fn: "create-agent-checkout", body: {}, signedIn: true, mode: "subscription", commissioned: false, receipt: null },
  { fn: "create-pass-checkout", body: {}, signedIn: true, mode: "payment", commissioned: false, receipt: BUYER.email },
];

async function call(c: (typeof CASES)[number], extra: Record<string, unknown> = {}, origin = "https://evil.example") {
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": "198.51.100.40", origin };
  headers.authorization = c.signedIn ? "Bearer jwt-buyer" : "Bearer anon_harness_key";
  const res = await handlers[c.fn](new Request(`https://harness.supabase.co/functions/v1/${c.fn}`, {
    method: "POST", headers, body: JSON.stringify({ ...c.body, ...extra }),
  }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, session: state.created.at(-1) };
}

describe("the policy every checkout applies", () => {
  it("the browser and the server name the same Terms version", () => {
    expect(SERVER_TERMS_VERSION).toBe(TERMS_VERSION);
  });

  for (const c of CASES) {
    describe(c.fn, () => {
      it("a forged Origin gets the buyer sent back to the site, not to the forger's host", async () => {
        const r = await call(c);
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        for (const k of ["success_url", "cancel_url"]) {
          expect(new URL(String(r.session?.[k]).replace("{CHECKOUT_SESSION_ID}", "x")).origin, k).toBe("https://resumebooster.work");
        }
      });

      it("our own host is kept, so the buyer returns where they bought", async () => {
        const r = await call(c, {}, "https://www.resumebooster.work");
        expect(String(r.session?.success_url)).toMatch(/^https:\/\/www\.resumebooster\.work\//);
      });

      it("carries the affiliate's code and the Terms the buyer was shown", async () => {
        const r = await call(c, { referralCode: "ab12cd34", termsVersion: TERMS_VERSION });
        expect(r.session?.metadata?.referral_code).toBe("ab12cd34");
        expect(r.session?.metadata?.terms_version).toBe(TERMS_VERSION);
        expect(r.session?.metadata?.referral_commission, "the affiliate page promises nothing for this checkout").toBe(c.commissioned ? undefined : "none");
      });

      it("a body from a page that showed no Terms line records none", async () => {
        const r = await call(c, { termsVersion: "1999-01-01" });
        expect(r.session?.metadata?.terms_version).toBeUndefined();
      });

      it(c.receipt ? "names the buyer's address for Stripe's receipt" : "names no receipt address it does not know", async () => {
        const r = await call(c);
        expect(r.session?.payment_intent_data?.receipt_email).toBe(c.receipt ?? undefined);
      });

      it("leaves tax off while the EU/UK switch is off", async () => {
        const r = await call(c);
        expect(r.session?.automatic_tax).toEqual({ enabled: false });
        expect(r.session?.consent_collection).toBeUndefined();
      });

      it("with the EU/UK switch on, refuses a checkout without the buyer's consent and taxes one with it", async () => {
        env.EU_UK_SALES = "on";
        const refused = await call(c);
        expect(refused.status).toBe(400);
        expect(refused.json.consentRequired).toBe(c.mode === "payment" ? "withdrawal_waiver_required" : "service_start_consent_required");
        expect(state.created).toHaveLength(0);
        const consent = c.mode === "payment" ? { withdrawalWaiver: true } : { serviceStartConsent: true };
        const ok = await call(c, consent);
        expect(ok.status).toBe(200);
        expect(ok.session?.automatic_tax).toEqual({ enabled: true });
        expect(ok.session?.billing_address_collection).toBe("required");
        expect(ok.session?.metadata?.[c.mode === "payment" ? "withdrawal_waiver" : "service_start_consent"]).toBeTruthy();
      });

      it("asks Stripe for its Terms checkbox only when the owner has switched it on", async () => {
        env.STRIPE_TERMS_CONSENT = "on";
        const r = await call(c);
        expect(r.session?.consent_collection).toEqual({ terms_of_service: "required" });
      });
    });
  }
});

describe("the subscriptions say they renew, beside Stripe's pay button", () => {
  it("Pro renews monthly at its price until cancelled", async () => {
    const r = await call(CASES.find((c) => c.fn === "create-subscription-checkout")!);
    expect(r.session?.custom_text?.submit?.message).toBe(
      `$${SUBSCRIPTIONS.pro.priceUsd.toFixed(2)} every month, renewing automatically until you cancel. Cancel any time from your account (Account, then Manage subscription).`,
    );
  });

  it("a first-time agent subscriber is told the trial, the price after it, and how not to be charged", async () => {
    const r = await call(CASES.find((c) => c.fn === "create-agent-checkout")!);
    const msg = String(r.session?.custom_text?.submit?.message);
    expect(msg).toContain(`Free for ${SUBSCRIPTIONS.agent.trialDays} days, then $${SUBSCRIPTIONS.agent.priceUsd.toFixed(2)} every month until you cancel.`);
    expect(msg).toContain("Cancel before the trial ends and you will not be charged.");
  });

  it("the Pro success address carries the session, so the account page can confirm the plan (S8-055)", async () => {
    const r = await call(CASES.find((c) => c.fn === "create-subscription-checkout")!, {}, "https://resumebooster.work");
    expect(r.session?.success_url).toBe("https://resumebooster.work/account?pro=success&session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("the scan-credit checkout attaches nobody's customer (S8-059)", () => {
  it("an address that already has a Stripe customer is not looked up, and the payment is not attached to it", async () => {
    state.customers["typed@example.com"] = [{ id: "cus_subscriber" }];
    const r = await call(CASES.find((c) => c.fn === "create-scan-pack-checkout")!);
    expect(r.status).toBe(200);
    expect(state.customerLists).toEqual([]);
    expect(r.session?.customer).toBeUndefined();
    expect(r.session?.customer_email).toBe("typed@example.com");
  });
});
