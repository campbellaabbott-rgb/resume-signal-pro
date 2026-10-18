/**
 * THE ATS DEFENSE ROLES PROMISE IS SHOWN IN THE READER'S LANGUAGE (review of
 * S11-074).
 *
 * The S11 round reworded ATS Defense's roles bullet ("Targets up to 3 roles
 * you name before checkout"), a raw string in PRODUCTS.atsDefense.features.
 * /pricing, the preview card and the success page printed it in English in
 * every locale. The bullets now go through productFeatures(), which reads
 * productFeatures.<productId> from the locale files.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { PRODUCTS } from "@/config/products";
import { productFeatures } from "@/lib/product-features";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const bundle = (l: string) => JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${l}.json`), "utf8"));
const ATS = PRODUCTS.atsDefense.features;

afterAll(async () => { await i18n.changeLanguage("en"); });

// S12-008 (wave 4 round 2): ATS Defense's seventh bullet promised a guarantee
// with no terms and no mechanism, and it is gone from the configured list
// (src/config/products.ts). The locale files still carry seven bullets until
// the translator drops the removed one (an existing locale value is never
// edited by a builder), so every locale's list no longer matches and
// productFeatures shows the configured six: the removed promise is shown in
// no language. ATS Defense itself is no longer sold (2026-10-12); its bullets
// show only to a past buyer.
describe("ATS Defense's bullets in nine locales", () => {
  it("the configured list is the locale's first six bullets, without the removed seventh", () => {
    const en = bundle("en").productFeatures.atsDefense as string[];
    expect(ATS).toHaveLength(6);
    expect(en.slice(0, 6)).toEqual([...ATS]);
  });

  it.each(LOCALES)("%s shows no removed bullet: a list of the wrong length falls back to the configured one", async (l) => {
    const stale = bundle(l).productFeatures.atsDefense as string[];
    i18n.addResourceBundle(l, "translation", bundle(l), true, true);
    await i18n.changeLanguage(l);
    const shown = productFeatures(i18n.t, "atsDefense", ATS);
    expect(shown).toEqual([...ATS]);
    if (stale.length === 7) expect(shown).not.toContain(stale[6]);
    // The roles bullet still names its limit.
    expect(shown[3]).toMatch(/3/);
  });

  it("a product the locale files do not carry keeps its configured bullets", async () => {
    await i18n.changeLanguage("de");
    expect(productFeatures(i18n.t, "premiumPackage", PRODUCTS.premiumPackage.features)).toEqual([...PRODUCTS.premiumPackage.features]);
  });

  it("a locale list whose length no longer matches is ignored, never shown beside a stale bullet", async () => {
    i18n.addResourceBundle("de", "translation", { productFeatures: { careerSnapshot: ["nur eins"] } }, true, true);
    await i18n.changeLanguage("de");
    expect(productFeatures(i18n.t, "careerSnapshot", PRODUCTS.careerSnapshot.features)).toEqual([...PRODUCTS.careerSnapshot.features]);
  });

  it("every surface that lists a product's bullets reads them through productFeatures", () => {
    // /pricing lists no product's bullets since the cut (its catalogue grid is gone).
    expect(readFileSync(resolve(__dirname, "..", "pages/Pricing.tsx"), "utf8")).not.toMatch(/product\.features\.(map|slice)\(/);
    for (const f of ["components/ProductPreview.tsx", "pages/ProductSuccess.tsx", "components/TieredPricingSection.tsx", "components/AddOnsShowcase.tsx", "components/ProductSelectionModal.tsx"]) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/productFeatures\(t, /);
      expect(src, f).not.toMatch(/product\.features\.(map|slice)\(/);
    }
  });
});
