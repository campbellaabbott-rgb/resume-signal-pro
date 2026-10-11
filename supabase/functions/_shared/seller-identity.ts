/**
 * WHO IS SELLING: THE ONE PLACE THE SELLER'S LEGAL NAME AND POSTAL ADDRESS
 * LIVE FOR THE MAILERS.
 *
 * US anti-spam law asks for a postal address in every marketing mail, and
 * California and the EU ask who the seller is (commercial-readiness
 * 2026-10-08, item 10). The owner has not chosen the entity or the address
 * yet, so both stay EMPTY and the footer block renders nothing: an identity
 * is never invented. Fill both strings when they are known; every marketing
 * mail footer (the fix-plan drip, the report mail, the market pulse, the
 * saved-search and agent digests) then prints them. The site's footer, Terms
 * and Privacy read the frontend's own copy of these two values; keep them
 * equal.
 *
 * Data only (no imports, no logic): a test replaces this module to fill it.
 */
export const SELLER_IDENTITY: { readonly legalName: string; readonly postalAddress: string } = {
  legalName: "",
  postalAddress: "",
};
