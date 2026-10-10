/**
 * WHO IS SELLING, AND WHEN THE LEGAL PAGES LAST CHANGED (commercial-readiness
 * plan 2026-10-08, item 10; owner decision 2026-10-08; register L1-09).
 *
 * No legal name or postal address appeared on the site, the Terms, the
 * Privacy policy or marketing mail. California wants the seller's name and a
 * street address before payment (B&P 17538(d)), US anti-spam law an address
 * in every marketing mail (15 U.S.C. 7704(a)(5)), and EU privacy law the
 * controller named. The seller's legal name and address are NOT known yet, so
 * both stay EMPTY and nothing renders until the owner fills them in here AND
 * in supabase/functions/_shared/seller-identity.ts (a test holds the two
 * equal). Never put an invented identity or a placeholder here.
 *
 * Once set, they show in the footer, on /terms and /privacy, beside every buy
 * and sign-up button (PurchaseTerms), in the bake's crawlable footer and legal
 * pages, and in the footer of the marketing mails (the saved-search digest,
 * the market pulse, the fix-plan drip, the agent digest).
 *
 * (Wave 3: the payments-account and seo-content groups each added this file;
 * the integration keeps one.)
 */
import { TERMS_VERSION } from "./terms";

export const SELLER: { readonly legalName: string; readonly postalAddress: string } = {
  /** The legal name: a person's for a sole proprietor, or the company's. */
  legalName: "",
  /** One line: street (or a registered private mailbox), city, region, postcode, country. */
  postalAddress: "",
};

export type SellerIdentity = { legalName: string; postalAddress: string };

/** The identity to show, or null while either half is unset. */
export function sellerIdentity(s: SellerIdentity = SELLER): SellerIdentity | null {
  const legalName = String(s?.legalName ?? "").trim();
  const postalAddress = String(s?.postalAddress ?? "").trim();
  return legalName && postalAddress ? { legalName, postalAddress } : null;
}

/**
 * The day each legal page's text last changed, as a literal. Both pages
 * printed `new Date()`, so "Last updated" was always today (L1-09). The Terms
 * date IS the Terms version every "By continuing you agree" line records
 * (src/config/terms.ts), so it is read from there, never typed twice. Bump the
 * date in the same commit that changes the page's words.
 */
export const TERMS_LAST_UPDATED: string = TERMS_VERSION;
export const PRIVACY_LAST_UPDATED = "2026-10-04";
