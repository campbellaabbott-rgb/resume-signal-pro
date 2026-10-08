/**
 * THE TERMS A BUYER OR A NEW ACCOUNT IS SHOWN (commercial-readiness plan
 * 2026-10-08, item 12).
 *
 * The date the Terms page's text last changed. Every buy and sign-up button
 * carries "By continuing you agree to the Terms of Service" and sends this
 * version; the checkouts write it on the Stripe session and the start record
 * (supabase/functions/_shared/checkout-policy.ts holds the same string, and a
 * test holds the two equal), and a password sign-up stores it on the account.
 * The Terms page prints it as its "Last updated" date, so the version a buyer
 * agreed to is the date the page shows. Change it in BOTH places in the same
 * commit as any change to the Terms text.
 */
export const TERMS_VERSION = "2026-07-10";

/** The version as the date the Terms page prints. */
export const TERMS_UPDATED = new Date(`${TERMS_VERSION}T12:00:00Z`);
