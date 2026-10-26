/**
 * THE PRICING PAGE'S STRUCTURED DATA. An offer is published only while it can
 * be bought (spec section 6): the free plan always; the Full Analysis only
 * while G1 and G2 are open; Pro only while G1 and G2b are open. The preview's
 * forced-open state publishes no paid offer, because nothing is on sale.
 * Prices are the plan-facts mirrors, never typed here.
 *
 * Each price is stated in US dollars, the currency both list prices are set
 * in. Pro is billed in them; the Full Analysis is charged at about that value
 * in the currency of the device's time zone when the scanner page's hook
 * recognizes the zone and create-checkout prices its currency, else in US
 * dollars, so its offer carries the page's own English sentence saying so
 * (owner decision 2026-10-25). The bake's "/" reuses these offers.
 */
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "./plan-facts";
import type { SaleGates } from "./sale-gates";
import en from "@/i18n/shards/pricing/en.json";

const SITE = "https://resumebooster.work";

export function pricingJsonLd(gates: SaleGates): Record<string, unknown> {
  const offers: Array<Record<string, unknown>> = [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", url: `${SITE}/pricing#free` },
  ];
  if (!gates.previewOpen && gates.fullAnalysis.onSale) {
    offers.push({
      "@type": "Offer",
      name: "Full Analysis",
      price: String(FULL_ANALYSIS_PRICE_USD),
      priceCurrency: "USD",
      description: en.pricingPlans.fa.currency,
      url: `${SITE}/pricing#full-analysis`,
    });
  }
  if (!gates.previewOpen && gates.pro.onSale) {
    offers.push({
      "@type": "Offer",
      name: "Pro",
      price: String(PRO_PRICE_USD),
      priceCurrency: "USD",
      url: `${SITE}/pricing#pro`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: String(PRO_PRICE_USD),
        priceCurrency: "USD",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      },
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Resume Booster",
    url: SITE,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers,
  };
}
