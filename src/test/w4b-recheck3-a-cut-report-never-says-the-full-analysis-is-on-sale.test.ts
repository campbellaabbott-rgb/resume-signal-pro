// @vitest-environment node
/**
 * A CUT REPORT NEVER SAYS THE FULL ANALYSIS IS ON SALE WHILE NOTHING IS
 * (recheck 3 of wave 4, 2026-10-26).
 *
 * ATS Defense, Career Snapshot, Graduate Game Plan and Career Path answer a
 * purchase with a 410 whose last sentence said "The $5 Full Analysis is still
 * on sale, and tailored résumés, cover letters and interview prep come with a
 * free account and with Pro." As shipped no seller is named, so
 * create-checkout refuses every Full Analysis with 409 and
 * create-subscription-checkout refuses Pro: neither is on sale. The sentence
 * reaches a direct POST, a script or an AI caller (the page refuses a hidden
 * id before any request). The shipped handler runs here with the seller as
 * shipped, and again with one named.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshWorld, installDeno, loadCheckouts, post } from "./helpers/w4b-checkout-harness";
import { CUT_LINES, cutSentence } from "../../supabase/functions/_shared/product-cuts";
import { CHECKOUT_LANGUAGES } from "../../supabase/functions/_shared/checkout-policy";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const REPORTS = ["atsDefense", "careerSnapshot", "graduateGamePlan", "careerPathSimulator"] as const;
let shipped: Record<string, EdgeHandler>;
let named: Record<string, EdgeHandler>;
beforeAll(async () => {
  installDeno();
  shipped = await loadCheckouts(["create-product-checkout"], { seller: "as-shipped" });
  named = await loadCheckouts(["create-product-checkout"]);
});
beforeEach(() => { freshWorld(); });

describe("create-product-checkout, with the seller as shipped", () => {
  for (const productId of REPORTS) {
    it(`${productId}: 410, and the sentence says the Full Analysis and Pro open for purchase soon, never that either is on sale`, async () => {
      const res = await post(shipped["create-product-checkout"], "create-product-checkout", { productId });
      expect(res.status).toBe(410);
      const body = await res.json() as { error: string };
      expect(body.error).not.toMatch(/still on sale|on sale/i);
      expect(body.error).toMatch(/The \$5 Full Analysis and Pro open for purchase soon/);
      expect(body.error).toMatch(/nothing was charged/);
    });
  }

  it("in Spanish too", async () => {
    const res = await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "careerSnapshot", language: "es" });
    const body = await res.json() as { error: string; language: string };
    expect(body.language).toBe("es");
    expect(body.error).toBe(cutSentence("careerSnapshot", "es", false));
    expect(body.error).not.toMatch(/sigue a la venta/);
  });
});

describe("positive control: once a seller is named, the report's sentence says the Full Analysis is on sale", () => {
  it("atsDefense", async () => {
    const res = await post(named["create-product-checkout"], "create-product-checkout", { productId: "atsDefense" });
    const body = await res.json() as { error: string };
    expect(body.error).toBe(cutSentence("atsDefense", "en", true));
    expect(body.error).toMatch(/The \$5 Full Analysis is still on sale/);
  });
});

describe("every language has a closed form of the reports line", () => {
  it("nine languages, each closed line differs from its open one and names no sale", () => {
    expect(CHECKOUT_LANGUAGES.length).toBe(9);
    const SALE = { en: /still on sale/, "en-GB": /still on sale/, de: /weiterhin/, es: /sigue a la venta/, fr: /reste en vente/, hi: /अभी भी बिक्री पर/, nl: /nog te koop/, pt: /continua à venda/, tl: /Ibinebenta pa rin/ } as const;
    for (const lang of CHECKOUT_LANGUAGES) {
      const l = CUT_LINES[lang];
      expect(l.reportsClosed, lang).toBeTruthy();
      expect(l.reportsClosed, lang).not.toBe(l.reports);
      expect(l.reports, `${lang}: the open line is the one that names the sale`).toMatch(SALE[lang]);
      expect(l.reportsClosed, lang).not.toMatch(SALE[lang]);
      expect(cutSentence("atsDefense", lang, false)).toContain(l.reportsClosed);
    }
  });

  it("the writing and scans lines name no sale and are the same either way", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      expect(cutSentence("coverLetter", lang, false)).toBe(cutSentence("coverLetter", lang, true));
      expect(cutSentence("scanPack", lang, false)).toBe(cutSentence("scanPack", lang, true));
    }
  });
});
