/**
 * ARE PURCHASES OPEN? (owner decision 2026-10-17; California Business and
 * Professions Code 17538(d)).
 *
 * The buy buttons for the $5 Full Analysis and Pro render only while
 * src/config/seller.ts carries the seller's legal name AND postal address.
 * Both are empty until the owner gives them (an identity is never invented),
 * and until then the pages say purchases open soon (PurchasesOpenSoon) and
 * the checkouts refuse with 409 seller_identity_missing
 * (supabase/functions/_shared/seller-gate.ts reads the server's copy, which
 * a test holds equal to this one).
 *
 * WHAT A BUY CONTROL READS: its product's gate, never purchasesOpen() alone
 * (homepage and pricing spec of 2026-10-17, gates G2 and G2b). Beyond the
 * seller's name, the owner opens each product by hand in
 * src/config/sales-gate.ts once its delivery was watched:
 * fullAnalysisOnSale() is G1 and G2, proOnSale() is G1 and G2b. Every Full
 * Analysis control (the uploader, the free report, the sticky bar, the
 * comparison table, the closing call to action, the old pricing page's
 * ladder, Index's checkout handler) and the Pro card read these, and a test
 * fails on any other caller of purchasesOpen(). The checkouts themselves
 * gate on the seller alone.
 */
import { SELLER, sellerIdentity, type SellerIdentity } from "@/config/seller";
import { FULL_ANALYSIS_ON_SALE, PRO_ON_SALE } from "@/config/sales-gate";

/** True once the seller's legal name and postal address are both set (G1). */
export function purchasesOpen(s: SellerIdentity = SELLER): boolean {
  return sellerIdentity(s) !== null;
}

/** G1 and G2: the seller is named and the owner has watched a real purchase deliver its report. */
export function fullAnalysisOnSale(s: SellerIdentity = SELLER): boolean {
  return purchasesOpen(s) && FULL_ANALYSIS_ON_SALE;
}

/** G1 and G2b: the seller is named and the owner has watched a Pro subscription from checkout to cancellation. */
export function proOnSale(s: SellerIdentity = SELLER): boolean {
  return purchasesOpen(s) && PRO_ON_SALE;
}
