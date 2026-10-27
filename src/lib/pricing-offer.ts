/**
 * WHAT THE PRICING PAGE TELLS A SEARCH ENGINE IS FOR SALE (recheck 3,
 * 2026-10-26; sales stay on, owner 2026-10-27).
 *
 * React's /pricing and the crawler bake carry the same structured data, built
 * here: the range of what the checkouts sell, from the free scan up to Pro,
 * with one Offer per paid product plus the free one. The checkouts sell the
 * $5 Full Analysis and Pro whether or not the seller's name and address are
 * filled in, so this offers them whatever src/config/seller.ts holds.
 *
 * Imported with relative paths only, so the bake's esbuild bundle and Vite
 * read the same file.
 */

/** The SoftwareApplication block /pricing carries, React's and the bake's alike. */
export function pricingJsonLd(opts: { offerPrices: readonly number[]; url: string }): Record<string, unknown> {
  const { offerPrices, url } = opts;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Resume Booster",
    url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "Free diagnostic resume scan and job board, one paid report and one optional monthly plan.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: String(Math.max(...offerPrices)),
      offerCount: offerPrices.length + 1,
    },
  };
}

/** True when a page's structured data offers anything at a price above zero. */
export function offersAPrice(jsonLd: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown): boolean => {
    if (!v || typeof v !== "object" || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    const o = v as Record<string, unknown>;
    const type = String(o["@type"] ?? "");
    if (/Offer$/.test(type)) {
      const prices = [o.price, o.highPrice, o.lowPrice].map((p) => Number(p)).filter((n) => Number.isFinite(n));
      if (prices.some((n) => n > 0)) return true;
    }
    return Object.values(o).some(walk);
  };
  return walk(jsonLd);
}
