/**
 * A NAMED SELLER, FOR CHECKOUT TESTS ABOUT SOMETHING ELSE (owner decision
 * 2026-10-17).
 *
 * The checkouts refuse every purchase with 409 seller_identity_missing while
 * _shared/seller-identity.ts is empty, which is how it ships: the owner has
 * not given the seller's legal name and postal address, and one is never
 * invented. A test of what a checkout does once it sells loads the handler
 * with this stub in place of that module, so the gate does not hide what it
 * is testing. The gate itself is proved, as shipped, in
 * src/test/w4b-nothing-is-sold-until-the-seller-is-named.test.ts (the checkouts) and w4b-no-buy-button-until-the-seller-is-named.test.tsx (the pages).
 *
 * These values are a test stand-in only; nothing ships them.
 */
export const TEST_NAMED_SELLER = { legalName: "Example Seller LLC", postalAddress: "1 Example Street, Springfield" } as const;

/** loadEdgeHandler stub entry: spread it into a checkout's stubs. */
export const SELLER_NAMED_STUB: Record<string, string> = {
  "_shared/seller-identity.ts": `export const SELLER_IDENTITY = ${JSON.stringify(TEST_NAMED_SELLER)};`,
};
