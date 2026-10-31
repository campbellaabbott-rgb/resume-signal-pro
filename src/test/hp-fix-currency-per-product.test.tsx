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
 *     (calculateAmount's fallback). No currency is refused for where the
 *     buyer is: land/all removed wave 4's territory check (owner 2026-10-27,
 *     "keep selling as today").
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
 *
 * THE REVIEW OF 2026-10-25 found two ways "charged in your local currency
 * where we support it" was still false:
 *   - the hook maps a fixed list of time zones. A zone not on the list reads
 *     as the US, so a buyer in Calgary or Brisbane, whose currency
 *     create-checkout supports, is charged US dollars. The sentence now names
 *     the mechanism ("the currency of your device's time zone when we
 *     recognize the zone and support its currency"), the old phrase is gone
 *     in every language, and the hook's own answers for a listed and an
 *     unlisted zone are pinned below;
 *   - with the US-dollar sentence gone, nothing said the printed "$5" was US
 *     dollars, and CAD, AUD, NZD, SGD, HKD and MXN are written with "$" too.
 *     Every Full Analysis currency sentence now says it is priced in US
 *     dollars, the plan strip and the pricing page's buy block say so beside
 *     the price, and so does the structured data.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
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
import { useCurrency } from "@/hooks/use-currency";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ euUkSales: false }), { status: 200 })));
});
afterEach(() => cleanup());

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Tree = Record<string, unknown>;

const HOME_DIR = resolve(__dirname, "../i18n/shards/home");
const PRICING_DIR = resolve(__dirname, "../i18n/shards/pricing");
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
/** "The currency of your device's time zone", in each language: what the hook really reads. */
const LOCAL: Record<Locale, RegExp> = {
  en: /currency of your device's time zone when we recognize the zone and support its currency/,
  "en-GB": /currency of your device's time zone when we recognise the zone and support its currency/,
  de: /Währung der Zeitzone (?:deines|Ihres) Geräts berechnet, wenn wir die Zeitzone kennen und ihre Währung unterstützen/,
  es: /moneda de la zona horaria de tu dispositivo cuando reconocemos esa zona y admitimos su moneda/,
  fr: /devise du fuseau horaire de votre appareil quand nous reconnaissons ce fuseau et prenons en charge sa devise/,
  hi: /डिवाइस के (?:टाइम ज़ोन|समय क्षेत्र) की मुद्रा में लिया जाता है जब हम वह (?:टाइम ज़ोन|समय क्षेत्र) पहचानते हैं और उसकी मुद्रा स्वीकार करते हैं/,
  nl: /valuta van de tijdzone van je apparaat als we die tijdzone herkennen en de valuta ervan ondersteunen/,
  pt: /moeda do fuso horário do seu dispositivo quando reconhecemos esse fuso e aceitamos a moeda dele/,
  tl: /currency ng time zone ng iyong device kung kilala namin ang time zone na iyon at sinusuportahan ang currency nito/,
};
/** "Your local currency", the phrase a buyer in an unlisted zone would be misled by. */
const OLD_LOCAL: Record<Locale, RegExp> = {
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
/** "Priced in US dollars": the printed "$5" is a US-dollar list price, said wherever its charge is. */
const PRICED: Record<Locale, RegExp> = {
  en: /priced in US dollars and charged at about the same value/,
  "en-GB": /priced in US dollars and charged at about the same value/,
  de: /in US-Dollar ausgepreist und wird zum etwa gleichen Wert/,
  es: /precio en dólares estadounidenses,? y se cobra por un valor similar/,
  fr: /tarifée? en dollars américains et débitée? pour une valeur à peu près égale/,
  hi: /कीमत अमेरिकी डॉलर में तय है, और उसका शुल्क लगभग उतने ही मूल्य पर/,
  nl: /geprijsd in Amerikaanse dollars en (?:wordt )?voor ongeveer dezelfde waarde afgerekend/,
  pt: /preço em dólares americanos,? (?:e é )?cobrad[ao] por um valor parecido/,
  tl: /[Nn]aka-presyo (?:ito )?sa US dollars/,
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

    it(`${lng}: no string promises "your local currency", which an unlisted time zone does not get`, () => {
      for (const dir of [HOME_DIR, PRICING_DIR]) {
        const found = stringSentences(dir, lng).filter(([, s]) => OLD_LOCAL[lng].test(s)).map(([k, s]) => `${k}: "${s}"`);
        expect(found).toEqual([]);
      }
    });

    it(`${lng}: every sentence that says how the Full Analysis is charged says it is priced in US dollars`, () => {
      const plans = (readJson(HOME_DIR, lng).home as Record<string, Record<string, string>>).plans;
      const p = readJson(PRICING_DIR, lng).pricingPlans as Record<string, Record<string, string>>;
      for (const [k, v] of [["home.plans.termCurrencyFa", plans.termCurrencyFa], ["pricingPlans.fa.currency", p.fa.currency], ["pricingPlans.before.renewalBody", p.before.renewalBody]] as const) {
        expect(v, `${lng} ${k}`).toMatch(PRICED[lng]);
      }
      for (const dir of [HOME_DIR, PRICING_DIR]) {
        for (const [k, s] of stringSentences(dir, lng)) {
          if (readSentence(lng, s).local) expect(s, `${lng} ${k}`).toMatch(PRICED[lng]);
        }
      }
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
const en = JSON.parse(read("../i18n/shards/pricing/en.json")).pricingPlans as Record<string, Record<string, string>>;
const enHome = (JSON.parse(read("../i18n/shards/home/en.json")).home as Record<string, Record<string, string>>).plans;

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
          // The printed "$5" is said to be US dollars on the strip itself.
          if (homePlanRows(gates).fullAnalysis.state === "onSale") {
            expect(text).toMatch(/\$5/);
            expect(text).toMatch(/Full Analysis is priced in US dollars/);
          }
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
          expect(said).toMatch(/Full Analysis [^.]*priced in US dollars and charged at about the same value in the currency of your device's time zone when we recognize the zone and support its currency, or in US dollars otherwise\./);
          // Beside "Buy the Full Analysis, $5", its block says the price is US dollars and how it is charged.
          const buy = container.querySelector<HTMLElement>("[data-buy-block=full-analysis]");
          expect(!!buy, "the Full Analysis buy block shows exactly while it is on sale").toBe(resolveSaleGates(input).fullAnalysis.onSale);
          if (buy) {
            expect(screenText(buy)).toMatch(/Buy the Full Analysis, \$5/);
            expect(screenText(buy).replace(/\s+/g, " ")).toContain(en.fa.currency);
          }
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
    expect(String(fa.description)).toMatch(PRICED.en);
    expect(String(fa.description)).toMatch(LOCAL.en);
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

describe("the hook the sentences describe: a listed time zone gets its currency, an unlisted one US dollars", () => {
  const zoneIs = (timeZone: string) => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    return vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone };
    });
  };
  for (const [zone, code] of [["America/Toronto", "CAD"], ["Australia/Sydney", "AUD"], ["America/Edmonton", "USD"], ["Australia/Brisbane", "USD"], ["America/Monterrey", "USD"]] as const) {
    it(`${zone}: ${code}`, async () => {
      const spy = zoneIs(zone);
      try {
        const { result } = renderHook(() => useCurrency());
        await waitFor(() => expect(result.current.currency.code).toBe(code));
        if (code === "USD") expect(result.current.countryCode, "an unlisted zone reads as the US").toBe("US");
      } finally {
        spy.mockRestore();
      }
    });
  }
});

// THE FINAL RECHECK OF LAND/ALL (2026-10-31). The switch-over priced Montenegro
// and Kosovo in US dollars (6e4b9105) only to step around wave 4's currency
// refusal; land/all removed that refusal (owner 2026-10-27, "keep selling as
// today"), so a browser in Europe/Podgorica saw $5 and was charged in US
// dollars where main shows and charges about 4.60 euros. Both are priced in
// euros again, as on main, and create-checkout takes a euro body from anywhere.
describe("Montenegro and Kosovo are priced in euros, as on main", () => {
  it("Europe/Podgorica reads as Montenegro and gets the euro", async () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: "Europe/Podgorica" };
    });
    try {
      const { result } = renderHook(() => useCurrency());
      await waitFor(() => expect(result.current.countryCode).toBe("ME"));
      expect(result.current.currency).toEqual({ code: "EUR", symbol: "€", rate: 0.92 });
    } finally {
      spy.mockRestore();
    }
  });

  it("the hook's map prices ME and XK in euros at main's rate, and create-checkout has no currency it refuses", () => {
    const hook = codeOf(read("../hooks/use-currency.ts"));
    for (const cc of ["ME", "XK"]) expect(hook, cc).toMatch(new RegExp(`\\b${cc}: \\{ code: "EUR", symbol: "€", rate: 0\\.92 \\}`));
    const checkout = codeOf(read("../../supabase/functions/create-checkout/index.ts"));
    expect(checkout).toMatch(/\beur: \{ rate: 0\.92/);
    expect(checkout).not.toMatch(/TERRITORY_CURRENCIES|sales-territory/);
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
