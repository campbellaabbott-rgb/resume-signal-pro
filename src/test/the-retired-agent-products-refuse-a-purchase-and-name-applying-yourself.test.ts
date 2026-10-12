// @vitest-environment node
/**
 * THE RETIRED AGENT PRODUCTS REFUSE A PURCHASE, AND NAME APPLYING YOURSELF.
 *
 * Owner decision 2026-10-11 (the apply pivot): the Agent plan and the Agent
 * Pass are no longer sold. Their checkout functions, run here as they ship
 * (the switch module is NOT stubbed), answer every purchase with a 410 that
 * says nothing was charged and names the free path, the person's own AI at
 * resumebooster.work/agents, in the buyer's language. They answer before the
 * token check, the rate limiter or Stripe: no client is built, no auth server
 * or Stripe call is made, so nobody is sent to sign in to be told it is gone
 * and nothing is counted. The preflight still carries the build.
 *
 * The positive control loads the same handlers with the switch stubbed on:
 * the request then reaches the dormant purchase code (the token check). The
 * dormant purchase itself is proved by the suites that use
 * helpers/apply-agent-switch-on.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { APPLY_AGENT_SWITCH_ON } from "./helpers/apply-agent-switch-on";
import { buildIsAtLeast } from "./helpers/fn-build";
import {
  RETIRED_LINES,
  retiredCheckoutAnswer,
  retiredLanguageOf,
  retiredSentence,
} from "../../supabase/functions/_shared/apply-agent-retired";
import { AGENT_PRODUCTS_ON_SALE, APPLY_AGENT_ON } from "../../supabase/functions/_shared/apply-agent-switch";
import { CHECKOUT_LANGUAGES } from "../../supabase/functions/_shared/checkout-policy";

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
    globalThis.__retiredTouched.push("stripe");
    const t = globalThis.__retiredTouched;
    this.checkout = { sessions: { create: async () => { t.push("sessions.create"); return { id: "cs_x", url: "https://checkout.stripe.com/x", amount_total: 0, currency: "usd", mode: "payment" }; } } };
    this.customers = { list: async () => { t.push("customers.list"); return { data: [], has_more: false }; } };
    this.subscriptions = { list: async () => { t.push("subscriptions.list"); return { data: [], has_more: false }; } };
  }
}`;
// Any use is recorded; the switched-off path must make none.
const CLIENT = `export function createClient() {
  const t = globalThis.__retiredTouched; t.push("createClient");
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
};

const shipped: Record<string, EdgeHandler> = {};
const switchedOn: Record<string, EdgeHandler> = {};
const FNS = ["create-agent-checkout", "create-pass-checkout"] as const;
const PRODUCT = { "create-agent-checkout": "agent_plan", "create-pass-checkout": "agent_pass" } as const;

beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  for (const fn of FNS) {
    shipped[fn] = await loadEdgeHandler(fn, STUBS);
    switchedOn[fn] = await loadEdgeHandler(fn, { ...STUBS, ...APPLY_AGENT_SWITCH_ON });
  }
}, 240_000);
beforeEach(() => { touched = []; g.__retiredTouched = touched; });

const buy = (h: EdgeHandler, fn: string, body: unknown, headers: Record<string, string> = {}) =>
  h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));

describe("the switch ships off", () => {
  it("neither the agent nor its products are on", () => {
    expect(APPLY_AGENT_ON).toBe(false);
    expect(AGENT_PRODUCTS_ON_SALE).toBe(false);
  });
});

describe.each(FNS)("%s refuses every purchase with a 410 naming applying yourself", (fn) => {
  it("a signed-out buyer: 410, retired, nothing charged, the free path named, and nothing touched", async () => {
    const res = await buy(shipped[fn], fn, {});
    expect(res.status).toBe(410);
    expect(res.headers.get("x-fn-build")).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ retired: true, reason: "product_retired", product: PRODUCT[fn], language: "en" });
    expect(body.applyYourself).toBe("https://resumebooster.work/agents");
    expect(body.error).toBe(retiredSentence(PRODUCT[fn], "en"));
    expect(body.error).toMatch(/no longer sold, and nothing was charged\./);
    expect(body.error).toMatch(/Applying yourself is free\./);
    expect(body.error).toMatch(/Connect Claude or ChatGPT at resumebooster\.work\/agents\./);
    expect(body).not.toHaveProperty("url");
    expect(touched, "the refusal built a client, asked the auth server or Stripe, or counted the caller").toEqual([]);
  });

  it("a signed-in buyer gets the same refusal: no token is checked to say no", async () => {
    const res = await buy(shipped[fn], fn, { termsVersion: "2026-07-10" }, { authorization: "Bearer jwt-buyer" });
    expect(res.status).toBe(410);
    expect((await res.json()).retired).toBe(true);
    expect(touched).toEqual([]);
  });

  it("the sentence follows the page's language, then the browser's, then English", async () => {
    const de = await (await buy(shipped[fn], fn, { language: "de" })).json();
    expect(de.language).toBe("de");
    expect(de.error).toBe(retiredSentence(PRODUCT[fn], "de"));
    expect(de.error).toMatch(/Selbst bewerben ist kostenlos\./);

    const frCa = await (await buy(shipped[fn], fn, { language: "fr-CA" })).json();
    expect(frCa.language).toBe("fr");

    const nl = await (await buy(shipped[fn], fn, {}, { "accept-language": "nl-NL,nl;q=0.9,en;q=0.8" })).json();
    expect(nl.language).toBe("nl");
    expect(nl.error).toMatch(/Zelf solliciteren is gratis\./);

    const unknown = await (await buy(shipped[fn], fn, { language: "xx" }, { "accept-language": "zz" })).json();
    expect(unknown.language).toBe("en");
    expect(touched).toEqual([]);
  });

  it("the free path links to our own host only, as the checkout's return links do", async () => {
    const own = await (await buy(shipped[fn], fn, {}, { origin: "https://www.resumebooster.work" })).json();
    expect(own.applyYourself).toBe("https://www.resumebooster.work/agents");
    const forged = await (await buy(shipped[fn], fn, {}, { origin: "https://evil.example" })).json();
    expect(forged.applyYourself).toBe("https://resumebooster.work/agents");
  });

  it("a body that is not JSON is still refused cleanly", async () => {
    const res = await shipped[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    }));
    expect(res.status).toBe(410);
    expect((await res.json()).language).toBe("en");
  });

  it("the preflight still answers with this build, so the deploy is provable", async () => {
    const res = await shipped[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), fn, "2026-10-11", 13), String(res.headers.get("x-fn-build"))).toBe(true);
  });

  it("positive control: with the switch on, the same request reaches the dormant purchase code", async () => {
    const res = await buy(switchedOn[fn], fn, {});
    expect(res.status).toBe(401);
    expect(touched.length, "the switched-on handler never reached its purchase code").toBeGreaterThan(0);
  });
});

describe("the refusal's words", () => {
  const products = ["agent_plan", "agent_pass", "apply_assistant"] as const;

  it("every site language has each retired product's sentence, and en-GB is en", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      for (const p of products) {
        const s = retiredSentence(p, lang);
        expect(s.length, `${lang}/${p}`).toBeGreaterThan(80);
        expect(s, `${lang}/${p} names the connect page`).toMatch(/resumebooster\.work\/agents/);
        expect(s, `${lang}/${p} names Claude`).toMatch(/\bClaude\b/);
        expect(s, `${lang}/${p} names ChatGPT`).toMatch(/\bChatGPT\b/);
        for (const vendor of ["Greenhouse", "Ashby", "Recruitee", "Breezy", "Pinpoint"]) {
          expect(s, `${lang}/${p} scopes the form reading to ${vendor}`).toContain(vendor);
        }
      }
    }
    expect(RETIRED_LINES["en-GB"]).toEqual(RETIRED_LINES.en);
  });

  it("the products differ only in their first sentence", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      const l = RETIRED_LINES[lang];
      expect(new Set(products.map((p) => l[p])).size, lang).toBe(products.length);
      for (const p of products) {
        expect(retiredSentence(p, lang), `${lang}/${p}`).toBe(`${l[p]} ${l.free} ${l.connect}`);
      }
    }
  });

  it("the Apply Assistant keeps its English name in every language, as the site's locale files do", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      expect(RETIRED_LINES[lang].apply_assistant, lang).toContain("Apply Assistant");
    }
  });

  it("names only the seekers' hosts, quotes no price, and claims no one sends for the person", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      for (const p of products) {
        const s = retiredSentence(p, lang);
        expect(s, `${lang}/${p}`).not.toMatch(/Cursor|VS ?Code|Cline|Windsurf|Copilot|Gemini/i);
        expect(s, `${lang}/${p}`).not.toMatch(/[$€£]|\d/);
      }
    }
    const en = products.map((p) => retiredSentence(p, "en")).join(" ");
    expect(en).not.toMatch(/on your behalf|for you\b|we (send|submit|apply)|sends? (your )?applications?/i);
    expect(en).toMatch(/you check everything and press submit/);
  });

  it("the language reader: body first, then each Accept-Language tag in order, then English", () => {
    expect(retiredLanguageOf({ language: "pt" }, "de")).toBe("pt");
    expect(retiredLanguageOf({}, "xx-YY, *;q=0.5, tl;q=0.4")).toBe("tl");
    expect(retiredLanguageOf({}, "en-GB")).toBe("en-GB");
    expect(retiredLanguageOf(null, null)).toBe("en");
    expect(retiredLanguageOf("not an object", "")).toBe("en");
  });

  it("the answer: 410, the reason a page keys on, and the connect page on the given origin", () => {
    const a = retiredCheckoutAnswer("agent_pass", { body: { language: "hi" }, origin: "https://resumebooster.work/" });
    expect(a.status).toBe(410);
    expect(a.body).toMatchObject({ retired: true, reason: "product_retired", product: "agent_pass", language: "hi" });
    expect(a.body.applyYourself).toBe("https://resumebooster.work/agents");
    expect(a.body.error).toBe(retiredSentence("agent_pass", "hi"));

    const assistant = retiredCheckoutAnswer("apply_assistant", { body: {}, acceptLanguage: "es-MX", origin: "https://resumebooster.work" });
    expect(assistant.status).toBe(410);
    expect(assistant.body).toMatchObject({ retired: true, reason: "product_retired", product: "apply_assistant", language: "es" });
    expect(assistant.body.error).toMatch(/^El Apply Assistant ya no se vende/);
  });
});
