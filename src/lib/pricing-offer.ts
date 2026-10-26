/**
 * WHAT THE PRICING PAGE TELLS A SEARCH ENGINE IS FOR SALE (recheck 3,
 * 2026-10-26).
 *
 * The page's structured data offered every crawler an AggregateOffer up to
 * Pro's $45, on React's /pricing and in the crawler bake alike, while the
 * checkouts answer 409 seller_identity_missing until src/config/seller.ts
 * names the seller (src/lib/purchases-open.ts). A rich result for a price
 * nobody can pay is the claim this wave removes everywhere else. So the one
 * shape both pages read is built here: while purchases are closed it offers
 * only what is free (the scan and the job board) and says the rest opens
 * soon; once they open, the range of what is sold.
 *
 * Imported with relative paths only, so the bake's esbuild bundle and Vite
 * read the same file.
 */

/** The SoftwareApplication block /pricing carries, React's and the bake's alike. */
export function pricingJsonLd(opts: { open: boolean; offerPrices: readonly number[]; url: string }): Record<string, unknown> {
  const { open, offerPrices, url } = opts;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Resume Booster",
    url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: open
      ? "Free diagnostic resume scan and job board, one paid report and one optional monthly plan."
      : "Free diagnostic resume scan and job board. The paid report and the monthly plan open for purchase soon.",
    offers: open
      ? {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: "0",
          highPrice: String(Math.max(...offerPrices)),
          offerCount: offerPrices.length + 1,
        }
      : { "@type": "Offer", price: "0", priceCurrency: "USD" },
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

/** The tag llms.txt's Pricing line carries while purchases are closed. */
export const LLMS_PRICING_TAG = " (purchases open soon)";
const PRICING_LINE = /^(- \[Pricing\]\([^)]*\): [^\n]*?)(\.?)$/m;
const PRICES_AT = " Current prices are on [/pricing]";

/**
 * llms.txt as the purchase state has it. While closed, the paid line carries
 * checkoutGate.purchasesOpenSoon (passed in, so it is the page's sentence)
 * and the Pricing line its tag; once open, neither. The committed file holds
 * the closed form, and the bake restates it on every build.
 */
export function llmsPurchaseLines(text: string, open: boolean, sentence: string): string {
  let t = text.split(` ${sentence}`).join("");
  t = t.replace(PRICING_LINE, (_m, body: string, dot: string) => `${body.split(LLMS_PRICING_TAG).join("")}${dot}`);
  if (open) return t;
  if (t.includes(PRICES_AT)) t = t.replace(PRICES_AT, ` ${sentence}${PRICES_AT}`);
  t = t.replace(PRICING_LINE, (_m, body: string, dot: string) => `${body}${LLMS_PRICING_TAG}${dot}`);
  return t;
}
