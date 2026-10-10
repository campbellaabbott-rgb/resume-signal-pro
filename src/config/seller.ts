/**
 * WHO IS SELLING, AND WHEN THE LEGAL PAGES LAST CHANGED.
 *
 * No legal name or postal address appeared anywhere on the site, in the Terms,
 * the Privacy policy or the marketing mail (commercial-readiness plan
 * 2026-10-08, item 10). California wants the seller's name and a street
 * address before it takes payment, US anti-spam law an address in every
 * marketing email, and EU privacy law a named controller. The owner has not
 * chosen the selling entity or the address yet, so this is the ONE place they
 * go, and it stays EMPTY: every surface that reads it renders nothing until
 * both fields are set. Never fill it with a placeholder or a guess.
 *
 * TODO(owner): set legalName and postalAddress (a registered private mailbox
 * is fine for the address), then republish.
 */
export const SELLER: { legalName: string; postalAddress: string } = {
  legalName: "",
  postalAddress: "",
};

/** The seller's identity when both parts are set, else null (and the surface renders nothing). */
export function sellerIdentity(s: { legalName: string; postalAddress: string } = SELLER): { legalName: string; postalAddress: string } | null {
  const legalName = String(s?.legalName ?? "").trim();
  const postalAddress = String(s?.postalAddress ?? "").trim();
  return legalName && postalAddress ? { legalName, postalAddress } : null;
}

/**
 * The day each legal page's text last changed, as a literal. Both pages
 * printed `new Date()`, so "Last updated" was always today (L1-09). Bump the
 * date in the same commit that changes the page's words.
 */
export const TERMS_LAST_UPDATED = "2026-07-10";
export const PRIVACY_LAST_UPDATED = "2026-10-04";
