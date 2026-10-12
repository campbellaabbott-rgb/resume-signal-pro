/**
 * A SELLER IDENTITY FOR TESTS ABOUT SOMETHING ELSE (S12-010).
 *
 * Marketing senders (the market pulse batch, the agent digest, the fix-plan
 * sequence) send nothing while _shared/seller-identity.ts is empty, which is
 * how it ships: the owner has not given the seller's legal name and postal
 * address, and one is never invented. A test of what such a mail SAYS, or of
 * how its batch claims and hands back rows, runs the handler with this stub in
 * place of that module, so the pause does not hide what it is testing. The
 * pause itself is proved, as shipped, in
 * w4b-marketing-mail-waits-for-a-seller-with-a-name-and-an-address.test.ts.
 *
 * These values are a test stand-in only; nothing ships them.
 */
export const TEST_SELLER = { legalName: "Example Seller LLC", postalAddress: "1 Example Street, Springfield" } as const;

/** loadEdgeHandler stub entry: spread it into the stubs of a marketing sender. */
export const SELLER_SET_STUB: Record<string, string> = {
  "_shared/seller-identity.ts": `export const SELLER_IDENTITY = ${JSON.stringify(TEST_SELLER)};`,
};
