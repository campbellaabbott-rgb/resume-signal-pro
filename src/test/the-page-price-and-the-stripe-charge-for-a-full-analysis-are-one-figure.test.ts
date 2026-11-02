// @vitest-environment node
/**
 * THE PAGE PRICE AND THE STRIPE CHARGE FOR A FULL ANALYSIS ARE ONE FIGURE
 * (audit 2026-10-31, S13-096).
 *
 * WHAT WAS WRONG (latent). The one one-time product still sold has its price
 * written twice: the pages read src/config/products.ts (fullAnalysis.priceUsd)
 * and Stripe is charged create-checkout's BASE_PRICE_USD. They agree today
 * ($5). Editing either alone would show one price and charge another, and
 * every test stayed green: pricing-truth pins the subscriptions and the pass,
 * and every-price-the-checkout-charges-buys-the-analysis reads the charge but
 * never compares it with the page.
 *
 * WHAT HOLDS NOW. create-checkout's own BASE_PRICE_USD and calculateAmount,
 * lifted out of the shipped file and executed (the file calls serve() and
 * imports from esm.sh, so it cannot be imported), charge exactly the page's
 * figure in US dollars; and a copy with either figure moved fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { codeOf } from "./helpers/strip-comments";
import { PRODUCTS } from "@/config/products";

const CHECKOUT = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/create-checkout/index.ts"), "utf8"));

/** `const NAME ... ;` at bracket depth zero, outside strings. */
function declOf(code: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?const ${name}\\b`).exec(code);
  if (!m) throw new Error(`create-checkout no longer declares ${name}: re-anchor this guard`);
  let depth = 0;
  let quote: string | null = null;
  for (let i = m.index; i < code.length; i++) {
    const ch = code[i];
    if (quote) { if (ch === "\\") { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === ";" && depth === 0) return code.slice(m.index, i + 1).replace(/^export\s+/, "");
  }
  throw new Error(`unterminated ${name}`);
}

/** `function NAME(...): T {...}` to its matching brace (the body opens at the first brace ending a line). */
function functionOf(code: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?function ${name}\\s*\\(`).exec(code);
  if (!m) throw new Error(`create-checkout no longer declares function ${name}: re-anchor this guard`);
  const open = code.indexOf("{\n", code.indexOf(")", m.index));
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(m.index, i + 1).replace(/^export\s+/, "");
  }
  throw new Error(`unterminated function ${name}`);
}

/** The charge create-checkout computes, from a copy of its source. */
function chargeOf(code: string): { base: number; usdCents: number } {
  const ts = [
    declOf(code, "BASE_PRICE_USD"),
    declOf(code, "CURRENCY_RATES"),
    declOf(code, "STRIPE_WHOLE_UNIT_CURRENCIES"),
    functionOf(code, "calculateAmount"),
  ].join("\n");
  const js = transformSync(ts, { loader: "ts" }).code;
  const lifted = new Function(`${js}\nreturn { BASE_PRICE_USD, calculateAmount };`)() as {
    BASE_PRICE_USD: number;
    calculateAmount: (c: string) => { amount: number; currency: string };
  };
  const usd = lifted.calculateAmount("usd");
  expect(usd.currency).toBe("usd");
  return { base: lifted.BASE_PRICE_USD, usdCents: usd.amount };
}

/** Does a copy of the checkout charge what the page shows? */
const agrees = (code: string, pagePriceUsd: number) => {
  const c = chargeOf(code);
  return c.base === pagePriceUsd && c.usdCents === Math.round(pagePriceUsd * 100);
};

describe("a Full Analysis is charged the price its page shows", () => {
  it("create-checkout charges, in US dollars, exactly products.ts's fullAnalysis.priceUsd", () => {
    const page = PRODUCTS.fullAnalysis.priceUsd;
    expect(page).toBeGreaterThan(0);
    const c = chargeOf(CHECKOUT);
    expect(c.base, "the checkout's base price is not the page's").toBe(page);
    expect(c.usdCents, "Stripe is charged a different figure than the page shows").toBe(Math.round(page * 100));
  });

  it("has teeth: a checkout moved alone, or a page moved alone, disagrees", () => {
    const page = PRODUCTS.fullAnalysis.priceUsd;
    expect(agrees(CHECKOUT, page)).toBe(true);
    const moved = CHECKOUT.replace(/const BASE_PRICE_USD = [\d.]+;/, `const BASE_PRICE_USD = ${page + 1};`);
    expect(moved).not.toBe(CHECKOUT);
    expect(agrees(moved, page)).toBe(false);
    expect(agrees(CHECKOUT, page + 1)).toBe(false);
  });
});
