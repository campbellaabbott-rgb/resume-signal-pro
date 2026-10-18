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
 */
import { SELLER, sellerIdentity, type SellerIdentity } from "@/config/seller";

/** True once the seller's legal name and postal address are both set. */
export function purchasesOpen(s: SellerIdentity = SELLER): boolean {
  return sellerIdentity(s) !== null;
}
