// @vitest-environment node
/**
 * THE APPLY ASSISTANT IS NO LONGER SOLD.
 *
 * Owner decision 2026-10-11 (the apply pivot): the $7 Apply Assistant is
 * retired with the Agent plan and the Agent Pass. Unlike those two it has no
 * checkout of its own: it is one row of create-product-checkout's shared
 * PRODUCTS table, so wave 4's retire branch could not switch it off without
 * touching a function it did not own, and it still sold after that branch.
 * The integration wires the row to the same refusal: a purchase of
 * `applyAssistant` answers 410 with the retired sentence in the buyer's
 * language, BEFORE the client is built, the rate limiter counts, a Pro grant
 * is issued or Stripe is asked. Every other product still reaches the
 * purchase path (the control), and with the switch stubbed on so does the
 * Apply Assistant (the dormant code).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_NAMED_STUB } from "./helpers/w4b-seller-named";
import { APPLY_AGENT_SWITCH_ON, APPLY_ASSISTANT_SWITCH_ON } from "./helpers/apply-agent-switch-on";
import { APPLY_ASSISTANT_ON_SALE } from "../../supabase/functions/_shared/apply-agent-switch";
import { buildIsAtLeast } from "./helpers/fn-build";
import { retiredSentence } from "../../supabase/functions/_shared/apply-agent-retired";

const FN = "create-product-checkout";
const env: Record<string, string | undefined> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
};
let touched: string[] = [];
const g = globalThis as Record<string, unknown>;

const STRIPE = `export default class Stripe {
  constructor() {
    const t = globalThis.__assistantTouched; t.push("stripe");
    this.checkout = { sessions: { create: async () => { t.push("sessions.create"); return { id: "cs_x", url: "https://checkout.stripe.com/x", amount_total: 700, currency: "usd", mode: "payment" }; } } };
    this.customers = { list: async () => { t.push("customers.list"); return { data: [], has_more: false }; } };
    this.subscriptions = { list: async () => { t.push("subscriptions.list"); return { data: [], has_more: false }; } };
  }
}`;
// Any use is recorded; the refusal must make none.
const CLIENT = `export function createClient() {
  const t = globalThis.__assistantTouched; t.push("createClient");
  const chain = (label) => new Proxy(function () {}, {
    get: (_x, p) => {
      if (p === "then") return (ok) => ok({ data: null, error: null });
      if (typeof p === "symbol") return undefined;
      return () => { t.push(label + "." + String(p)); return chain(label); };
    },
  });
  return {
    from: (table) => { t.push("from:" + table); return chain("from:" + table); },
    rpc: (name) => { t.push("rpc:" + name); return chain("rpc:" + name); },
    auth: { getUser: async () => { t.push("auth.getUser"); return { data: { user: null }, error: { message: "no session" } }; } },
  };
}`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  // A seller named (owner decision 2026-10-17): the shipped, empty identity
  // answers 409 before the purchase path the controls below reach.
  ...SELLER_NAMED_STUB,
};

let shipped: EdgeHandler;
let switchedOn: EdgeHandler;
let agentBackOnSale: EdgeHandler;

beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  shipped = await loadEdgeHandler(FN, STUBS);
  switchedOn = await loadEdgeHandler(FN, { ...STUBS, ...APPLY_ASSISTANT_SWITCH_ON });
  agentBackOnSale = await loadEdgeHandler(FN, { ...STUBS, ...APPLY_AGENT_SWITCH_ON });
}, 240_000);
beforeEach(() => { touched = []; g.__assistantTouched = touched; });

const buy = (h: EdgeHandler, body: unknown, headers: Record<string, string> = {}) =>
  h(new Request(`https://harness.supabase.co/functions/v1/${FN}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));

describe("a purchase of the Apply Assistant is refused before anything is counted, granted or charged", () => {
  it("410, retired, the sentence in English, the free path on our own host, and nothing touched", async () => {
    const res = await buy(shipped, { productId: "applyAssistant", email: "buyer@example.com" });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({ retired: true, reason: "product_retired", product: "apply_assistant", language: "en" });
    expect(body.error).toBe(retiredSentence("apply_assistant", "en"));
    expect(body.error).toMatch(/The Apply Assistant is no longer sold, and nothing was charged\./);
    expect(body.applyYourself).toBe("https://resumebooster.work/agents");
    expect(body).not.toHaveProperty("url");
    expect(touched, "the refusal built a client, counted the caller, granted Pro or asked Stripe").toEqual([]);
  });

  it("the sentence follows the page's language, then the browser's", async () => {
    const de = await (await buy(shipped, { productId: "applyAssistant", language: "de" })).json();
    expect(de.language).toBe("de");
    expect(de.error).toBe(retiredSentence("apply_assistant", "de"));
    const nl = await (await buy(shipped, { productId: "applyAssistant" }, { "accept-language": "nl-NL,nl;q=0.9" })).json();
    expect(nl.language).toBe("nl");
    expect(touched).toEqual([]);
  });

  // Every product this function sold is now cut or retired (Freelance Boost
  // on 2026-10-17), so an id that is neither stands in for one still sold.
  it("control: an id that is neither retired nor cut still reaches the purchase path (the limiter is asked)", async () => {
    const res = await buy(shipped, { productId: "fullAnalysis", email: "buyer@example.com" });
    expect(res.status).not.toBe(410);
    expect(touched).toContain("rpc:check_rate_limit");
  });

  it("control: with the switch on, the Apply Assistant reaches the dormant purchase path", async () => {
    const res = await buy(switchedOn, { productId: "applyAssistant", email: "buyer@example.com" });
    expect(res.status).not.toBe(410);
    expect(touched).toContain("rpc:check_rate_limit");
  });

  // The review of 9fe3bc0d: the row read AGENT_PRODUCTS_ON_SALE, so putting
  // the Pass back on sale after a first proven submission would quietly have
  // reopened the Apply Assistant to any direct POST.
  it("putting the agent and its Pass back on sale does not reopen the Apply Assistant", async () => {
    expect(APPLY_ASSISTANT_ON_SALE).toBe(false);
    const res = await buy(agentBackOnSale, { productId: "applyAssistant", email: "buyer@example.com" });
    expect(res.status).toBe(410);
    expect(touched).toEqual([]);
  });

  it("a body that is not JSON is not mistaken for the Apply Assistant and keeps its old answer", async () => {
    const res = await shipped(new Request(`https://harness.supabase.co/functions/v1/${FN}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    }));
    expect(res.status).toBe(400);
  });

  it("the preflight answers this build, so the deploy is provable", async () => {
    const res = await shipped(new Request(`https://harness.supabase.co/functions/v1/${FN}`, { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), FN, "2026-10-11", 2), String(res.headers.get("x-fn-build"))).toBe(true);
  });
});
