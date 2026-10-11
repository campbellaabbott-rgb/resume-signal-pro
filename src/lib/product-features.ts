import type { TFunction } from "i18next";

/**
 * A product's feature bullets in the reader's language.
 *
 * The bullets live in src/config/products.ts in English. A product whose
 * bullets the locale files carry (productFeatures.<productId>, one string per
 * bullet, in the same order) is shown in the reader's language; any other is
 * shown as configured. A locale array of the wrong length is ignored, so a
 * bullet added in products.ts never shows beside a stale translation.
 * ATS Defense is carried since the S11 round changed its roles line
 * ("Targets up to 3 roles you name before checkout"), which /pricing, the
 * preview card and the success page printed in English in every locale.
 */
export function productFeatures(t: TFunction, productId: string, features: readonly string[]): string[] {
  const got: unknown = t(`productFeatures.${productId}`, { returnObjects: true, defaultValue: null });
  return Array.isArray(got) && got.length === features.length && got.every((x) => typeof x === "string" && x.trim() !== "")
    ? (got as string[])
    : [...features];
}
