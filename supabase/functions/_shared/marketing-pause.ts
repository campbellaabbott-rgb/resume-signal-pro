/**
 * MARKETING MAIL WAITS FOR A SELLER WITH A NAME AND A POSTAL ADDRESS
 * (S12-010; owner decision 2026-10-12, critical-path plan CP-038 and D6).
 *
 * US anti-spam law asks every commercial mail for the sender's valid postal
 * address (15 U.S.C. 7704(a)(5)), and California asks who the seller is. The
 * seller's legal name and address are not known yet: _shared/seller-identity.ts
 * (kept equal to src/config/seller.ts by a test) holds two empty strings, and
 * an identity is never invented. Until both are set, every MARKETING sender
 * (the market pulse batch, the fix-plan sequence, the agent digest) sends
 * nothing and logs the reason below; transactional mail (receipts, deliveries,
 * legal notices, sign-in mail, the report a person asked for, and the
 * saved-search alerts a person set up) is not touched.
 *
 * Every response of a paused sender carries x-marketing-mail, so the deploy
 * verifier can read the state with a preflight and fail while it is paused.
 *
 * Import-light (seller.ts only, which imports only data), so the Node tests
 * import it directly and a test can stand in for the identity module.
 */
import { sellerIdentity, type SellerIdentity, SELLER } from "./seller.ts";

/** The one word every paused marketing sender logs and answers with. */
export const MARKETING_PAUSED = "paused_no_seller_identity";

/** True while the seller's legal name or postal address is unset. */
export function marketingPaused(s: SellerIdentity = SELLER): boolean {
  return sellerIdentity(s) === null;
}

/** The header a marketing sender adds to every response, the preflight included. */
export function marketingMailHeader(s: SellerIdentity = SELLER): Record<string, string> {
  return { "x-marketing-mail": marketingPaused(s) ? MARKETING_PAUSED : "on" };
}

/**
 * One log line per skipped send, in a shape the logs can be searched by:
 * {"marketing":"paused_no_seller_identity","fn":"send-market-pulse","what":"batch"}.
 */
export function logMarketingPaused(fn: string, what: string): void {
  console.log(JSON.stringify({ marketing: MARKETING_PAUSED, fn, what }));
}
