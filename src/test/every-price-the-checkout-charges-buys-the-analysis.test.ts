// @vitest-environment node
/**
 * EVERY PRICE THE CHECKOUT CHARGES BUYS THE ANALYSIS IT CHARGES FOR.
 *
 * WHAT WAS WRONG. create-checkout charges BASE_PRICE_USD = 5, converted into
 * thirty currencies through a hand-kept rate table. analyze-resume, the only
 * thing that delivers what that charge buys, refused any session worth less
 * than a $20 floor (through its OWN, separate table of "conservative minimum"
 * rates) unless a discount was applied. The floor dates from the week the
 * product cost $25; the price moved to $5 and the floor did not. Two tables
 * that had to agree, in two files, with nothing tying them together -- so a
 * full-price buyer was refused in every one of the thirty currencies.
 *
 * THE FIX THIS PINS. The floor is gone, not moved: the session is judged by
 * the product_type create-checkout wrote into it, the way _shared/paid-session
 * judges every other paid product, so there is no second table left to drift.
 * A promotion code lowering the total is a price the shop chose to accept.
 *
 * HOW. The charge is computed by create-checkout's OWN calculateAmount and
 * rate table, lifted out of the shipped file and executed (it cannot be
 * imported: the file calls serve() and imports from esm.sh). Each charge is
 * then presented to analyze-resume's shipped handler as a paid session.
 * Nothing here restates a price or a rate.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { codeOf } from "./helpers/strip-comments";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";

const CHECKOUT = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/create-checkout/index.ts"), "utf8"));
const ANALYZE = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/analyze-resume/index.ts"), "utf8"));

/** `const NAME ... ;` at bracket depth zero, outside strings. */
function declOf(code: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?const ${name}\\b`).exec(code);
  if (!m) throw new Error(`create-checkout no longer declares ${name} -- re-anchor this guard`);
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

/**
 * `function NAME(...): T {...}` to its matching brace. The body opens at the
 * first brace that ends a line: the return type is an object literal type
 * (`{ amount: number; currency: string }`), whose brace does not.
 */
function functionOf(code: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?function ${name}\\s*\\(`).exec(code);
  if (!m) throw new Error(`create-checkout no longer declares function ${name} -- re-anchor this guard`);
  const open = code.indexOf("{\n", code.indexOf(")", m.index));
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(m.index, i + 1).replace(/^export\s+/, "");
  }
  throw new Error(`unterminated function ${name}`);
}

const shipped = (() => {
  const ts = [
    declOf(CHECKOUT, "BASE_PRICE_USD"),
    declOf(CHECKOUT, "CURRENCY_RATES"),
    declOf(CHECKOUT, "STRIPE_WHOLE_UNIT_CURRENCIES"),
    functionOf(CHECKOUT, "calculateAmount"),
  ].join("\n");
  const js = transformSync(ts, { loader: "ts" }).code;
  return new Function(`${js}\nreturn { BASE_PRICE_USD, CURRENCY_RATES, calculateAmount };`)() as {
    BASE_PRICE_USD: number;
    CURRENCY_RATES: Record<string, { rate: number; minUnit: number }>;
    calculateAmount: (c: string) => { amount: number; currency: string };
  };
})();

const CURRENCIES = Object.keys(shipped.CURRENCY_RATES);

let h: Harness;
beforeAll(async () => { h = await analyzeResumeHarness(); }, 60_000);
beforeEach(() => { h.reset(); });

describe("the charge, as create-checkout computes it", () => {
  it("is read from the shipped file, not restated here", () => {
    expect(CURRENCIES.length, "the rate table parsed to nothing -- the guard would pass vacuously").toBeGreaterThanOrEqual(25);
    expect(CURRENCIES).toEqual(expect.arrayContaining(["usd", "eur", "gbp", "jpy", "twd", "inr"]));
    expect(shipped.calculateAmount("usd")).toEqual({ amount: shipped.BASE_PRICE_USD * 100, currency: "usd" });
  });
});

describe("analyze-resume accepts every charge create-checkout makes", () => {
  for (const currency of CURRENCIES) {
    it(`${currency}: a full-price purchase is delivered`, async () => {
      const { amount, currency: billed } = shipped.calculateAmount(currency);
      const id = `cs_live_price_${currency}`;
      h.sessions.set(id, fullAnalysisSession(id, { amount_total: amount, currency: billed, metadata: { product_type: "full_analysis", originalCurrency: billed, baseAmountUSD: String(shipped.BASE_PRICE_USD) } }));
      const r = await h.call({ resumeText: RESUME, sessionId: id });
      expect(r.status, `${amount} ${billed} -- what create-checkout charges -- was answered ${r.status}: ${JSON.stringify(r.json).slice(0, 100)}`).toBe(200);
    });
  }

  it("and a promotion-code total far below list is still the product the session bought", async () => {
    const id = "cs_live_price_promo";
    h.sessions.set(id, fullAnalysisSession(id, { amount_total: 1, total_details: { amount_discount: 499 } }));
    expect((await h.call({ resumeText: RESUME, sessionId: id })).status).toBe(200);
  });
});

describe("no second price table remains to drift", () => {
  it("analyze-resume carries no amount floor and no exchange-rate table of its own", () => {
    // Booleans, not toMatch on the file: a failure should name the defect,
    // not print 1,300 lines of handler.
    expect(/MIN_AMOUNT/.test(ANALYZE), "an amount floor in the fulfilment path is the defect itself").toBe(false);
    expect(/amount_total\s*(?:\|\|\s*0\s*)?\)?\s*[<>]/.test(ANALYZE), "the paid total is compared against a number").toBe(false);
    expect(/(?:usd|eur|gbp):\s*[\d.]+\s*,\s*(?:usd|eur|gbp|cad|inr):/i.test(ANALYZE), "a currency-rate table of its own").toBe(false);
  });

  it("it judges the session through the shared full-analysis predicate", () => {
    expect(/import \{[^}]*\bfullAnalysisRefusal\b[^}]*\} from "\.\.\/_shared\/full-analysis\.ts";/.test(ANALYZE),
      "analyze-resume does not import the shared predicate").toBe(true);
    expect(/fullAnalysisRefusal\(session\)/.test(ANALYZE), "the predicate is imported but never applied to the session").toBe(true);
  });
});
