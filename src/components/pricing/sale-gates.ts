/**
 * WHEN A BUY BUTTON MAY RENDER (corrected spec 2026-10-17, gates G1, G2, G2b).
 *
 *   G1  the seller's legal name AND postal address are set in
 *       src/config/seller.ts. Until both are, no buy button renders anywhere
 *       on the page, and each paid card says purchases open soon. The values
 *       are never invented: sellerIdentity() answers null while either half
 *       is empty.
 *   G2  the Full Analysis is on sale only after the owner has watched one real
 *       purchase deliver (and the failed-delivery alarm fire on a forced
 *       failure). Pro's "Full Analysis included" line follows it.
 *   G2b Pro is on sale only after one watched subscription: subscribe, one
 *       package, cancel, still on until the period ends.
 *
 * G2 and G2b are owned by hp/honesty as FULL_ANALYSIS_ON_SALE and PRO_ON_SALE
 * in src/config/sales-gate.ts, a file that does not exist on this base. The
 * two stand-ins below are false, the safe value; at switch-over they are
 * replaced by imports of those flags (docs/homepage-pricing/README.md).
 *
 * Each closed gate has its own sentence, so the page never gives the seller's
 * missing address as the reason when the reason is an unwatched delivery.
 */
import { SELLER, sellerIdentity, type SellerIdentity } from "@/config/seller";

/** Stand-in for FULL_ANALYSIS_ON_SALE (src/config/sales-gate.ts, hp/honesty). */
export const FULL_ANALYSIS_DELIVERY_WATCHED = false;
/** Stand-in for PRO_ON_SALE (src/config/sales-gate.ts, hp/honesty). */
export const PRO_SUBSCRIPTION_WATCHED = false;

export type FullAnalysisClosedBy = "seller" | "delivery";
export type ProClosedBy = "seller" | "watched";

export interface SaleGates {
  /** The seller as published, or null while either half is unset. */
  seller: SellerIdentity | null;
  fullAnalysis: { onSale: boolean; closedBy: FullAnalysisClosedBy | null };
  pro: { onSale: boolean; closedBy: ProClosedBy | null };
  /**
   * True only in src/preview: buttons render with no seller set, so the page
   * can be looked at in its open state. Never true on a route.
   */
  previewOpen: boolean;
}

export interface SaleGateInput {
  seller?: SellerIdentity;
  fullAnalysisDelivered?: boolean;
  proWatched?: boolean;
  previewOpen?: boolean;
}

export function resolveSaleGates(input: SaleGateInput = {}): SaleGates {
  const seller = sellerIdentity(input.seller ?? SELLER);
  const delivered = input.fullAnalysisDelivered ?? FULL_ANALYSIS_DELIVERY_WATCHED;
  const watched = input.proWatched ?? PRO_SUBSCRIPTION_WATCHED;
  if (input.previewOpen) {
    return {
      seller,
      fullAnalysis: { onSale: true, closedBy: null },
      pro: { onSale: true, closedBy: null },
      previewOpen: true,
    };
  }
  const faClosed: FullAnalysisClosedBy | null = !seller ? "seller" : !delivered ? "delivery" : null;
  const proClosed: ProClosedBy | null = !seller ? "seller" : !watched ? "watched" : null;
  return {
    seller,
    fullAnalysis: { onSale: faClosed === null, closedBy: faClosed },
    pro: { onSale: proClosed === null, closedBy: proClosed },
    previewOpen: false,
  };
}

/** The sentence a closed card prints, by the gate that closed it. */
export const GATE_TEXT_KEY: Readonly<Record<FullAnalysisClosedBy | ProClosedBy, string>> = {
  seller: "pricingPlans.buy.gateSeller",
  delivery: "pricingPlans.buy.gateFaDelivery",
  watched: "pricingPlans.buy.gateProWatched",
};
