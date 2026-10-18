// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness).
/**
 * THE RENEWAL TERMS BESIDE STRIPE'S PAY BUTTON WERE ENGLISH FOR EVERY BUYER
 * (wave 3 review of payments-account; commercial-readiness plan item 11).
 *
 * WHAT WAS WRONG. The binding renewal and trial sentence Stripe shows beside
 * its pay button (custom_text.submit, from renewalTerms) was fixed English,
 * and neither subscription checkout read the buyer's language, so a German,
 * Hindi or Tagalog buyer read the terms they agree to in English while
 * Stripe's own page around them was in their language.
 *
 * WHAT HOLDS NOW, against the shipped handlers with Stripe and the database
 * faked (the buttons sending the page's language are mounted in
 * a-buy-button-named-no-terms-no-renewal-and-sent-no-referral.test.tsx): the
 * sentence is in the buyer's language, every figure still from the price and the
 * trial the session carries; Stripe's page is set to match where Stripe has
 * that language (Hindi keeps Stripe's own choice, Tagalog is Stripe's
 * Filipino); a body naming no language we have stays English with no locale.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_NAMED_STUB } from "./helpers/w4b-seller-named";
import { APPLY_AGENT_SWITCH_ON } from "./helpers/apply-agent-switch-on";
import { buildIsAtLeast } from "./helpers/fn-build";
import { CHECKOUT_LANGUAGES, renewalTerms } from "../../supabase/functions/_shared/checkout-policy";
import { SUBSCRIPTIONS } from "@/config/products";

const BUYER = { id: "00000000-0000-4000-8000-0000000c0de9", email: "buyer@example.com" };
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon", STRIPE_SECRET_KEY: "sk_test",
};
const created: Array<Record<string, any>> = [];
let db: FakeDb;

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    this.customers = { list: async () => ({ data: [], has_more: false }) };
    this.subscriptions = { list: async () => ({ data: [], has_more: false }) };
    this.promotionCodes = { list: async () => ({ data: [] }) };
    this.checkout = { sessions: { create: async (p) => { globalThis.__langCreated.push(p); return { id: "cs_test_lang_" + globalThis.__langCreated.length, url: "https://checkout.stripe.com/c/pay", amount_total: 0, currency: "usd", mode: p.mode }; }, expire: async () => ({}) } };
  }
}`;

const handlers: Record<string, EdgeHandler> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  g.__langCreated = created;
  g.__langClient = (_u?: string, _k?: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    const headerToken = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
    return {
      from: (t: string) => {
        const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
        q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
        q.lte = (col: string, v: unknown) => { q.preds.push((r) => r[col] != null && String(r[col]) <= String(v)); return q; };
        return q;
      },
      rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
      auth: { getUser: async (jwt?: string) => ((jwt ?? headerToken) === "jwt-buyer" ? { data: { user: BUYER }, error: null } : { data: { user: null }, error: { message: "no" } }) },
    };
  };
  const stubs = {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient(...a) { return globalThis.__langClient(...a); }",
  };
  // A seller named (owner decision 2026-10-17): the shipped, empty identity
  // answers 409 before the session whose terms this file reads.
  handlers.pro = await loadEdgeHandler("create-subscription-checkout", { ...stubs, ...SELLER_NAMED_STUB });
  // The plan is retired; its dormant purchase code is what this proves.
  handlers.agent = await loadEdgeHandler("create-agent-checkout", { ...stubs, ...APPLY_AGENT_SWITCH_ON });
}, 240_000);

beforeEach(() => {
  created.length = 0;
  db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
});

async function subscribe(which: "pro" | "agent", body: Record<string, unknown>) {
  const fn = which === "pro" ? "create-subscription-checkout" : "create-agent-checkout";
  const res = await handlers[which](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer jwt-buyer", origin: "https://resumebooster.work", "cf-connecting-ip": "198.51.100.41" },
    // Pro's page sends the buyer's tick on its own renewal box (owner decision 2026-10-17).
    body: JSON.stringify(which === "pro" ? { autoRenewConsent: true, ...body } : body),
  }));
  expect(res.status).toBe(200);
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), fn, "2026-10-09", 2), String(res.headers.get("x-fn-build"))).toBe(true);
  return created.at(-1)!;
}

const pro = `$${SUBSCRIPTIONS.pro.priceUsd.toFixed(2)}`;
const agent = `$${SUBSCRIPTIONS.agent.priceUsd.toFixed(2)}`;

describe("the renewal terms Stripe shows beside its pay button", () => {
  it("are German for a buyer on the German site, with Stripe's page in German", async () => {
    const s = await subscribe("pro", { language: "de" });
    expect(s.custom_text.submit.message).toBe(`${pro} pro Monat, verlängert sich automatisch, bis Sie kündigen. Kündigen Sie jederzeit in Ihrem Konto.`);
    expect(s.locale).toBe("de");
  });

  it("name the agent's trial in the buyer's language, from the session's own trial and price", async () => {
    const s = await subscribe("agent", { language: "es" });
    expect(s.custom_text.submit.message).toBe(
      `Gratis durante ${SUBSCRIPTIONS.agent.trialDays} días; después, ${agent} al mes hasta que canceles. Cancela antes de que termine la prueba y no se te cobrará. Cancela cuando quieras desde tu cuenta.`,
    );
    expect(s.locale).toBe("es");
  });

  it("Hindi gets the Hindi sentence and Stripe's own page language; Tagalog gets Stripe's Filipino", async () => {
    const hi = await subscribe("pro", { language: "hi" });
    expect(hi.custom_text.submit.message).toContain("प्रति माह");
    expect(hi).not.toHaveProperty("locale");
    const tl = await subscribe("agent", { language: "tl" });
    expect(tl.custom_text.submit.message).toContain("bawat buwan");
    expect(tl.locale).toBe("fil");
  });

  it("a regional variant reads as its language, and a body naming none stays English with no locale", async () => {
    expect((await subscribe("pro", { language: "fr-CA" })).locale).toBe("fr");
    const old = await subscribe("pro", {});
    expect(old.custom_text.submit.message).toBe(`${pro} every month, renewing automatically until you cancel. Cancel any time from your account (Account, then Manage subscription).`);
    expect(old).not.toHaveProperty("locale");
    expect((await subscribe("pro", { language: "xx-evil" }))).not.toHaveProperty("locale");
  });

  it("every site language has both sentences, each carrying the price and (with a trial) the days", () => {
    const locales = readFileSync(resolve(__dirname, "../i18n/index.ts"), "utf8");
    for (const lang of CHECKOUT_LANGUAGES) {
      expect(locales, `${lang} is not a site language`).toContain(`./locales/${lang}.json`);
      expect(renewalTerms(4500, null, lang)).toContain("$45.00");
      const trial = renewalTerms(9900, 7, lang);
      expect(trial).toContain("$99.00");
      expect(trial).toMatch(/(^|\D)7(\D|$)/);
    }
  });
});
