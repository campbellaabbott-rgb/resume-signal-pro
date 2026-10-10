/**
 * WHO IS SELLING (commercial-readiness plan 2026-10-08, item 10; owner
 * decision 2026-10-08).
 *
 * No legal name or postal address appeared on the site, the Terms, the
 * Privacy policy or marketing mail. California wants the seller's name and a
 * street address before payment (B&P 17538(d)), US anti-spam law an address
 * in every marketing mail (15 U.S.C. 7704(a)(5)), and EU privacy law the
 * controller named. The seller's legal name and address are NOT known yet, so
 * both stay EMPTY and nothing renders until the owner fills them in here AND
 * in supabase/functions/_shared/seller.ts (a test holds the two equal). Never
 * put an invented identity here.
 *
 * Once set, they show in the footer, on /terms and /privacy, beside every buy
 * and sign-up button (PurchaseTerms) and in the footer of the marketing mails
 * (the saved-search digest, the market pulse, the fix-plan drip).
 */
export const SELLER = {
  /** The legal name: a person's for a sole proprietor, or the company's. */
  legalName: "",
  /** One line: street (or a registered private mailbox), city, region, postcode, country. */
  postalAddress: "",
} as const;

export type SellerIdentity = { legalName: string; postalAddress: string };

/** The identity to show, or null while either half is unset. */
export function sellerIdentity(s: SellerIdentity = SELLER): SellerIdentity | null {
  const legalName = s.legalName.trim();
  const postalAddress = s.postalAddress.trim();
  return legalName && postalAddress ? { legalName, postalAddress } : null;
}
