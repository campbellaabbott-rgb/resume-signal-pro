/**
 * WHEN A BUY BUTTON MAY RENDER (corrected spec 2026-10-17, gates G2 and G2b;
 * the owner's rule of 2026-10-27: there is no sales pause).
 *
 *   G2  the owner's switch for the $5 Full Analysis (on, as on main). Pro's
 *       "Full Analysis included" line follows it.
 *   G2b the owner's switch for Pro (on, as on main).
 *
 * No button waits for the seller's legal name and postal address
 * (src/config/seller.ts): the cards sell with the seller unnamed, as main
 * and live do, and print the name and address once the owner gives them.
 * sellerIdentity() still answers null while either half is empty, and the
 * values are never invented.
 *
 * G2 and G2b are the owner's switches FULL_ANALYSIS_ON_SALE and PRO_ON_SALE in
 * src/config/sales-gate.ts, read when the gates are resolved (switch-over
 * step 5), the same switches src/lib/purchases-open.ts gives every other buy
 * control on the site.
 *
 * Each switched-off card has its own sentence, so the page never gives one
 * product's reason for the other.
 */
import { SELLER, sellerIdentity, type SellerIdentity } from "@/config/seller";
import { saleGates as homeSaleGates, SALE_SWITCHES, type DigestMailClass } from "@/lib/home/sale-gates";

/** G2, the owner's switch (src/config/sales-gate.ts FULL_ANALYSIS_ON_SALE), under the name this page's gates use. */
export { FULL_ANALYSIS_ON_SALE as FULL_ANALYSIS_DELIVERY_WATCHED, PRO_ON_SALE as PRO_SUBSCRIPTION_WATCHED } from "@/config/sales-gate";

export type FullAnalysisClosedBy = "delivery";
export type ProClosedBy = "watched";

export interface SaleGates {
  /** The seller as published, or null while either half is unset. */
  seller: SellerIdentity | null;
  fullAnalysis: { onSale: boolean; closedBy: FullAnalysisClosedBy | null };
  pro: { onSale: boolean; closedBy: ProClosedBy | null };
  /**
   * G6: "alerts" may be printed beside saved searches. This is the
   * homepage's own answer (src/lib/home/sale-gates.ts), so the two pages can
   * never disagree: true unless the saved-search digest is ruled marketing
   * mail while the seller is unknown.
   */
  alertsStatable: boolean;
  /**
   * True only in src/preview: buttons render whatever the switches say, so
   * the page can be looked at in its open state, and no markup is written.
   * Never true on a route.
   */
  previewOpen: boolean;
}

export interface SaleGateInput {
  seller?: SellerIdentity;
  fullAnalysisDelivered?: boolean;
  proWatched?: boolean;
  previewOpen?: boolean;
  /** G6, tests only: the route reads the homepage's switch. */
  digestMailClass?: DigestMailClass;
}

export function resolveSaleGates(input: SaleGateInput = {}): SaleGates {
  const seller = sellerIdentity(input.seller ?? SELLER);
  const delivered = input.fullAnalysisDelivered ?? SALE_SWITCHES.fullAnalysisOnSale;
  const watched = input.proWatched ?? SALE_SWITCHES.proOnSale;
  const alertsStatable = homeSaleGates({ seller: input.seller, digestMailClass: input.digestMailClass }).alertsStatable;
  if (input.previewOpen) {
    return {
      seller,
      fullAnalysis: { onSale: true, closedBy: null },
      pro: { onSale: true, closedBy: null },
      alertsStatable,
      previewOpen: true,
    };
  }
  const faClosed: FullAnalysisClosedBy | null = !delivered ? "delivery" : null;
  const proClosed: ProClosedBy | null = !watched ? "watched" : null;
  return {
    seller,
    fullAnalysis: { onSale: faClosed === null, closedBy: faClosed },
    pro: { onSale: proClosed === null, closedBy: proClosed },
    alertsStatable,
    previewOpen: false,
  };
}

/** The sentence a closed card prints, by the gate that closed it. */
export const GATE_TEXT_KEY: Readonly<Record<FullAnalysisClosedBy | ProClosedBy, string>> = {
  delivery: "pricingPlans.buy.gateFaDelivery",
  watched: "pricingPlans.buy.gateProWatched",
};
