// @vitest-environment node
/**
 * A CUT REPORT SAYS THE FULL ANALYSIS IS ON SALE, BECAUSE IT IS (sales stay
 * on, owner 2026-10-27).
 *
 * ATS Defense, Career Snapshot, Graduate Game Plan and Career Path answer a
 * purchase with a 410 whose last sentence points at what is sold instead.
 * Recheck 3 of wave 4 made that sentence say "the $5 Full Analysis and Pro
 * open for purchase soon" while no seller was named, because wave 4's
 * checkouts then refused both. They no longer refuse, so the sentence says
 * the Full Analysis is still on sale, in every language, with the seller as
 * it ships (empty). The shipped handler runs here with only its network
 * faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { freshWorld, installDeno, loadCheckouts, post } from "./helpers/w4b-checkout-harness";
import { CUT_LINES, cutSentence } from "../../supabase/functions/_shared/product-cuts";
import { CHECKOUT_LANGUAGES } from "../../supabase/functions/_shared/checkout-policy";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const REPORTS = ["atsDefense", "careerSnapshot", "graduateGamePlan", "careerPathSimulator"] as const;
let shipped: Record<string, EdgeHandler>;
beforeAll(async () => {
  installDeno();
  shipped = await loadCheckouts(["create-product-checkout"]);
});
beforeEach(() => { freshWorld(); });

describe("create-product-checkout, with the seller as shipped", () => {
  for (const productId of REPORTS) {
    it(`${productId}: 410, and the sentence says the $5 Full Analysis is still on sale, never that it opens soon`, async () => {
      const res = await post(shipped["create-product-checkout"], "create-product-checkout", { productId });
      expect(res.status).toBe(410);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/The \$5 Full Analysis is still on sale/);
      expect(body.error).not.toMatch(/open for purchase soon|open soon/i);
      expect(body.error).toMatch(/nothing was charged/);
      expect(body.error).toBe(cutSentence(productId, "en"));
    });
  }

  it("in Spanish too", async () => {
    const res = await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "careerSnapshot", language: "es" });
    const body = await res.json() as { error: string; language: string };
    expect(body.language).toBe("es");
    expect(body.error).toBe(cutSentence("careerSnapshot", "es"));
    expect(body.error).toMatch(/sigue a la venta/);
  });
});

describe("every language's reports line names the sale", () => {
  it("nine languages, and the line is the one the sentence ends with", () => {
    expect(CHECKOUT_LANGUAGES.length).toBe(9);
    const SALE = { en: /still on sale/, "en-GB": /still on sale/, de: /weiterhin/, es: /sigue a la venta/, fr: /reste en vente/, hi: /अभी भी बिक्री पर/, nl: /nog te koop/, pt: /continua à venda/, tl: /Ibinebenta pa rin/ } as const;
    for (const lang of CHECKOUT_LANGUAGES) {
      const l = CUT_LINES[lang];
      expect(l.reports, lang).toMatch(SALE[lang]);
      expect(Object.keys(l), `${lang} keeps no closed-shop line`).not.toContain("reportsClosed");
      expect(cutSentence("atsDefense", lang).endsWith(l.reports), lang).toBe(true);
    }
  });
});
