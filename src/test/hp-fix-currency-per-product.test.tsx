/**
 * NO CURRENCY SENTENCE ON EITHER PAGE GIVES BOTH PRODUCTS ONE CURRENCY
 * (owner decision 2026-10-25).
 *
 * What checkout does, read from the code:
 *   - Pro is billed in US dollars: create-subscription-checkout's only
 *     price_data names "usd".
 *   - The Full Analysis is charged in the currency the scanner page picks from
 *     the device's time zone (src/hooks/use-currency.ts), sent as `currency`
 *     to create-checkout, which prices it from CURRENCY_RATES when
 *     the table carries that currency and in US dollars when it does not
 *     (calculateAmount's fallback). A currency of the EU, the EEA, the UK or
 *     India is refused by wave 4's territory check, which the region sentence
 *     already says.
 *
 * Both pages used to give one currency to everything they sell. Now, in all
 * nine languages, over every string either page carries, each sentence is
 * read on its own:
 *   - a sentence that names dollars names exactly one product, Pro or the
 *     Full Analysis, so no sentence claims one currency for both;
 *   - a sentence that puts the Full Analysis in dollars also names the local
 *     currency (dollars are its fallback, not its currency);
 *   - a sentence that names the local currency names the Full Analysis and
 *     not Pro;
 *   - each page says both: Pro's dollars and the Full Analysis's local
 *     currency with its fallback.
 * Rendered in English in every sale state, the same holds for the text on
 * screen, the homepage names Pro's currency only while it shows Pro, and the
 * structured data's Full Analysis offer says how it is charged. The facts the
 * sentences rest on are read from the checkout code, so a checkout that moves
 * fails here before the copy goes false.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({
    pro: { active: false, status: null, loading: false, trialing: false, linkPending: false, currentPeriodEnd: null },
    subscribe: vi.fn(async () => true),
    manage: vi.fn(async () => {}),
    actionLoading: false,
    refresh: async () => false,
    knownEmail: "",
    justSubscribed: false,
    notConfirmedYet: false,
  }),
}));

import { HomePlanStrip } from "@/components/home/HomePlanStrip";
import { PricingView } from "@/components/pricing/PricingView";
import { pricingJsonLd } from "@/components/pricing/pricing-jsonld";
import { resolveSaleGates, type SaleGateInput } from "@/components/pricing/sale-gates";
import { homePlanRows, saleGates } from "@/lib/home/sale-gates";
import "@/lib/home/strings";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ euUkSales: false }), { status: 200 })));
});
afterEach(() => cleanup());

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Tree = Record<string, unknown>;

const HOME_DIR = resolve(__dirname, "../lib/home/strings");
const PRICING_DIR = resolve(__dirname, "../components/pricing/strings");
const readJson = (dir: string, lng: Locale) => JSON.parse(readFileSync(join(dir, `${lng}.json`), "utf8")) as Tree;
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

function leaves(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** Sentences end at . ! ? or the danda, before a space or the end. */
const sentencesOf = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Any language's dollar, or the code. */
const DOLLAR = /dollar|dólar|डॉलर|(?<![\p{L}])USD(?![\p{L}])/iu;
const PRO = /(?<![\p{L}])Pro(?![\p{L}])/u;
/** "Your local currency", in each language. */
const LOCAL: Record<Locale, RegExp> = {
  en: /local currency/,
  "en-GB": /local currency/,
  de: /Landeswährung/,
  es: /moneda local/,
  fr: /devise locale/,
  hi: /स्थानीय मुद्रा/,
  nl: /lokale valuta/,
  pt: /moeda local/,
  tl: /lokal(?: mong| na) currency/,
};

/** The Full Analysis's own name in a language, as both pages print it. */
function faNames(lng: Locale): string[] {
  const p = readJson(PRICING_DIR, lng).pricingPlans as Record<string, Record<string, string>>;
  const h = (readJson(HOME_DIR, lng).home as Record<string, Record<string, string>>).plans;
  return [...new Set([p.fa.name, h.faTitle])];
}

interface Reading {
  dollars: boolean;
  pro: boolean;
  fa: boolean;
  local: boolean;
}

function readSentence(lng: Locale, s: string): Reading {
  const names = faNames(lng);
  return { dollars: DOLLAR.test(s), pro: PRO.test(s), fa: names.some((n) => s.includes(n)), local: LOCAL[lng].test(s) };
}

/** Every way a sentence can give the two products one currency, or leave a product's currency unsaid. */
function offences(lng: Locale, where: string, sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    const r = readSentence(lng, s);
    if (r.dollars && r.pro === r.fa) out.push(`${where}: names dollars for ${r.pro ? "both products" : "no product"}: "${s}"`);
    if (r.dollars && r.fa && !r.local) out.push(`${where}: puts the Full Analysis in dollars without its local currency: "${s}"`);
    if (r.local && (!r.fa || r.pro)) out.push(`${where}: names the local currency for ${r.pro ? "Pro" : "no product"}: "${s}"`);
  }
  return out;
}

const stringSentences = (dir: string, lng: Locale) =>
  leaves(readJson(dir, lng), "", []).flatMap(([k, v]) => sentencesOf(v).map((s) => [k, s] as const));

describe("in every language, no string gives both products one currency", () => {
  for (const lng of LOCALES) {
    for (const [page, dir] of [["homepage", HOME_DIR], ["pricing page", PRICING_DIR]] as const) {
      it(`${lng}: the ${page}'s strings`, () => {
        const found = stringSentences(dir, lng).flatMap(([k, s]) => offences(lng, `${lng} ${k}`, [s]));
        expect(found).toEqual([]);
      });
    }

    it(`${lng}: each page says Pro's dollars and the Full Analysis's local currency with its dollar fallback`, () => {
      for (const [page, dir] of [["homepage", HOME_DIR], ["pricing page", PRICING_DIR]] as const) {
        const readings = stringSentences(dir, lng).map(([, s]) => readSentence(lng, s));
        expect(readings.some((r) => r.dollars && r.pro), `${lng} ${page}: Pro in dollars`).toBe(true);
        expect(readings.some((r) => r.dollars && r.fa && r.local), `${lng} ${page}: the Full Analysis in local currency, dollars elsewhere`).toBe(true);
      }
    });

    it(`${lng}: the homepage's Full-Analysis-only line names no Pro, and its two-product line ends with it`, () => {
      const plans = (readJson(HOME_DIR, lng).home as Record<string, Record<string, string>>).plans;
      expect(plans.termCurrencyFa).toBeTruthy();
      expect(plans.termCurrencyFa).not.toMatch(PRO);
      expect(plans.termCurrency.endsWith(plans.termCurrencyFa), `${lng}: termCurrency carries termCurrencyFa`).toBe(true);
      expect(plans).not.toHaveProperty("termUsd");
    });

    it(`${lng}: the Full Analysis's own currency sentence is one product's`, () => {
      const fa = (readJson(PRICING_DIR, lng).pricingPlans as Record<string, Record<string, string>>).fa;
      const r = readSentence(lng, fa.currency);
      expect(r).toEqual({ dollars: true, pro: false, fa: true, local: true });
    });
  }
});

/** Every text node, one space between them, so no sentence runs into the next element's. */
function screenText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest("script, style")) continue;
    parts.push(n.textContent ?? "");
  }
  return parts.join(" ");
}

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const NO_SELLER = { legalName: "", postalAddress: "" };
const POSTINGS = { openTotal: 1040488, asOf: "2026-10-17T22:45:00Z" };
const en = JSON.parse(read("../components/pricing/strings/en.json")).pricingPlans as Record<string, Record<string, string>>;
const enHome = (JSON.parse(read("../lib/home/strings/en.json")).home as Record<string, Record<string, string>>).plans;

describe("rendered in English, in every sale state", () => {
  for (const [sellerName, seller] of [["no seller", NO_SELLER], ["TEST SELLER", TEST_SELLER]] as const) {
    for (const fa of [false, true]) {
      for (const pro of [false, true]) {
        const state = `${sellerName}, Full Analysis ${fa ? "on" : "off"}, Pro ${pro ? "on" : "off"}`;

        it(`${state}: the plan strip's currency line, and no sentence on it gives both products one currency`, () => {
          const gates = saleGates({ seller, fullAnalysisOnSale: fa, proOnSale: pro });
          const showsPro = homePlanRows(gates).pro !== null;
          const { container } = render(
            <MemoryRouter>
              <HomePlanStrip gates={gates} />
            </MemoryRouter>,
          );
          const text = screenText(container).replace(/\s+/g, " ");
          expect(text).toContain(showsPro ? enHome.termCurrency : enHome.termCurrencyFa);
          if (!showsPro) expect(text).not.toMatch(/Pro is billed/);
          expect(offences("en", "homepage", sentencesOf(text))).toEqual([]);
        });

        it(`${state}: the pricing page says both currencies before any click, and no sentence gives both one`, () => {
          const input: SaleGateInput = { seller, fullAnalysisDelivered: fa, proWatched: pro };
          const { container } = render(
            <MemoryRouter>
              <PricingView postings={POSTINGS} gates={resolveSaleGates(input)} />
            </MemoryRouter>,
          );
          const notice = container.querySelector<HTMLElement>("[data-notice=renewal]")!;
          expect(notice).not.toBeNull();
          const said = screenText(notice).replace(/\s+/g, " ");
          expect(said).toContain(en.before.renewalTitle);
          expect(said).toMatch(/Pro is billed in US dollars/);
          expect(said).toMatch(/Full Analysis [^.]*local currency where we support it and in US dollars elsewhere\./);
          expect(offences("en", "pricing page", sentencesOf(screenText(container)))).toEqual([]);
        });
      }
    }
  }
});

describe("the structured data", () => {
  it("the Full Analysis offer says how it is charged; Pro's names only dollars", () => {
    const ld = pricingJsonLd(resolveSaleGates({ seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true }));
    const offers = ld.offers as Array<Record<string, unknown>>;
    const fa = offers.find((o) => o.name === "Full Analysis")!;
    const pro = offers.find((o) => o.name === "Pro")!;
    expect(fa.description).toBe(en.fa.currency);
    expect(offences("en", "structured data", sentencesOf(String(fa.description)))).toEqual([]);
    expect(pro.priceCurrency).toBe("USD");
    expect(JSON.stringify(pro)).not.toMatch(LOCAL.en);
  });
});

const SOURCE_ROOTS = ["../components/home", "../components/pricing", "../pages/home", "../pages/pricing", "../lib/home"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the currency words come only from the strings held above", () => {
  it("no hp source file, comments stripped, types a dollar word or draws the dollar-sign icon", () => {
    const files = SOURCE_ROOTS.flatMap((r) => sourceFiles(resolve(__dirname, r)));
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => /dollar|dólar|डॉलर/i.test(codeOf(readFileSync(f, "utf8"))))).toEqual([]);
  });
});

describe("the checkout code the sentences describe", () => {
  it("Pro is billed only in US dollars", () => {
    const code = codeOf(read("../../supabase/functions/create-subscription-checkout/index.ts"));
    const currencies = [...code.matchAll(/price_data:\s*\{\s*currency:\s*"(\w+)"/g)].map((m) => m[1]);
    expect(currencies.length).toBeGreaterThan(0);
    expect([...new Set(currencies)]).toEqual(["usd"]);
  });

  it("the Full Analysis is priced in more currencies than one, and in US dollars when the table lacks the one asked for", () => {
    const code = codeOf(read("../../supabase/functions/create-checkout/index.ts"));
    const table = code.match(/const CURRENCY_RATES[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(table, "create-checkout's CURRENCY_RATES").not.toBeNull();
    const codes = [...table![1].matchAll(/^\s*([a-z]{3}):/gm)].map((m) => m[1]);
    expect(codes).toContain("usd");
    expect(codes.length).toBeGreaterThan(1);
    expect(code).toMatch(/if \(!currencyData\) \{\s*return \{ amount: BASE_PRICE_USD \* 100, currency: "usd" \};/);
    expect(code).toMatch(/calculateAmount\(requestedCurrency \|\| "usd"\)/);
  });

  it("the page that sells the Full Analysis sends the currency it picked from the device", () => {
    const callers = sourceFiles(resolve(__dirname, "..")).filter((f) => !/[\\/]test[\\/]/.test(f) && /resilientCallers\.createCheckout\(/.test(readFileSync(f, "utf8")));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      const code = codeOf(readFileSync(f, "utf8"));
      expect(code, f).toMatch(/const \{ currency \} = useCurrency\(\)/);
      expect(code, f).toMatch(/createCheckout\(\{[\s\S]{0,400}?currency: currency\.code,/);
    }
  });
});
