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

describe("ATS Defense's bullets in nine locales", () => {
  it("English is the configured list, word for word", () => {
    expect(bundle("en").productFeatures.atsDefense).toEqual([...ATS]);
  });

  it.each(LOCALES)("%s carries every bullet, and the reader sees them", async (l) => {
    const want = bundle(l).productFeatures.atsDefense as string[];
    expect(want).toHaveLength(ATS.length);
    i18n.addResourceBundle(l, "translation", bundle(l), true, true);
    await i18n.changeLanguage(l);
    expect(productFeatures(i18n.t, "atsDefense", ATS)).toEqual(want);
    // The roles bullet names its limit in every language.
    expect(want[3]).toMatch(/3/);
    if (!l.startsWith("en")) expect(want[3]).not.toBe(ATS[3]);
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
    for (const f of ["pages/Pricing.tsx", "components/ProductPreview.tsx", "pages/ProductSuccess.tsx", "components/TieredPricingSection.tsx", "components/AddOnsShowcase.tsx", "components/ProductSelectionModal.tsx"]) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/productFeatures\(t, /);
      expect(src, f).not.toMatch(/product\.features\.(map|slice)\(/);
    }
  });
});
