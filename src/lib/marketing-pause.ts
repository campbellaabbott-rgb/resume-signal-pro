/**
 * IS MARKETING MAIL PAUSED? THE PAGE'S COPY OF THE SERVER'S ANSWER (recheck 3
 * of wave 4, 2026-10-26).
 *
 * supabase/functions/_shared/marketing-pause.ts pauses every marketing sender
 * (the market pulse, the fix-plan sequence, the agent digest) while the
 * seller's legal name or postal address is unset (S12-010). The report page
 * still offered the pulse and the fix-plan emails and said a button would
 * arrive, so a seeker was promised mail that could not be sent. The page now
 * reads the same seller (src/config/seller.ts, held equal to the server's
 * copy by a test) and offers neither while paused, as src/lib/purchases-open.ts
 * does for the buy buttons.
 */
import { SELLER, sellerIdentity, type SellerIdentity } from "@/config/seller";

/** True while the seller's legal name or postal address is unset. */
export function marketingMailPaused(s: SellerIdentity = SELLER): boolean {
  return sellerIdentity(s) === null;
}
