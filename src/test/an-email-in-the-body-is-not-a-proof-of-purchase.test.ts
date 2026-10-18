import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * create-product-checkout MINTS AN ENTITLEMENT, so it must know who is asking.
 *
 * A pro_grant is redeemable for any product in the catalog. The decision to
 * issue one used to be keyed on `normalizedEmail` — a field in an
 * unauthenticated POST body, because this function runs verify_jwt = false.
 * So anyone who knew one active Pro subscriber's email address could mint that
 * subscriber's entire paid catalogue, free, repeatedly.
 *
 * The rule this pins: an email address is a CLAIM; a signed token is PROOF.
 * The grant is keyed on the session, and the body email keeps only its
 * harmless job of prefilling Stripe's customer_email.
 *
 * It also pins the half that protects the CUSTOMER. Gating the grant on the
 * session would otherwise send a signed-out Pro subscriber to Stripe to buy
 * something their subscription already includes — closing a way to take money
 * that should not be taken by opening another one.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/create-product-checkout/index.ts"), "utf8");
const HOOK = readFileSync(resolve(__dirname, "../../src/hooks/use-product-checkout.ts"), "utf8");
const CONFIG = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");

/** Comments stripped: this file explains the bug using the broken shapes. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FN_CODE = code(FN);

describe("an email in the body is not a proof of purchase", () => {
  it("still runs unauthenticated — so the session check is the only thing standing between a stranger and a grant", () => {
    // If this ever flips to verify_jwt = true the platform checks the token for
    // us. It does not today, which is exactly why the check below must exist.
    expect(CONFIG).toMatch(/\[functions\.create-product-checkout\]\s*\n\s*verify_jwt = false/);
  });

  // Wave 4 round 2: the token is read through _shared/checkout-buyer.ts
  // checkoutCaller, which also tells an auth server that could not answer
  // from a refused token (CP-025); its behaviour is run in
  // w4b-an-included-tool-is-never-a-charge-and-a-buyer-is-named.
  it("derives the grant identity from the bearer token, not the request body", () => {
    expect(FN_CODE, "must validate the bearer token with the auth server").toMatch(
      /checkoutCaller\(supabase\.auth, req\.headers, Deno\.env\.get\("SUPABASE_ANON_KEY"\) \?\? ""\)/);
    expect(FN_CODE, "the verified address comes from the caller, never the body").toMatch(
      /const proEmail = caller\.kind === "signed_in" \? caller\.email : null;/);
    expect(FN_CODE, "the grant branch must be gated on the verified email").toMatch(
      /if \(proEmail\) \{/);
  });

  it("never keys the entitlement on the body email", () => {
    // The three places that decide or record WHO the grant belongs to.
    const grantBlock = FN_CODE.slice(FN_CODE.indexOf("if (proEmail) {"), FN_CODE.indexOf("// Create Stripe session"));
    expect(grantBlock.length, "grant block not found — the assertions below would be vacuous").toBeGreaterThan(200);
    // The subscription check is keyed on the verified ACCOUNT (the one rule,
    // both caches, by user id) -- not even on the session's address.
    expect(grantBlock).toMatch(/accountProStanding\(supabase, proUserId\)/);
    expect(grantBlock).toMatch(/\.insert\(\{\s*\n?\s*email: proEmail,/);
    expect(
      /pro_grants[\s\S]{0,400}email: normalizedEmail/.test(grantBlock),
      "the grant row must never carry the body email",
    ).toBe(false);
  });

  it("a bad token is an anonymous request, never a fallback to the body email", () => {
    // The failure mode that would quietly restore the bug: catch the auth error
    // and carry on with whatever the caller typed.
    const authBlock = FN_CODE.slice(FN_CODE.indexOf("const caller = await checkoutCaller"), FN_CODE.indexOf("if (proEmail) {"));
    expect(authBlock.length).toBeGreaterThan(100);
    expect(
      /proEmail = normalizedEmail|proEmail = email|proEmail \?\?= /.test(authBlock),
      "nothing in the token path may assign the body email to proEmail",
    ).toBe(false);
  });

  // Owner decision D8 (2026-10-12): the signed-out branch that told anyone
  // whether a typed address held Pro is gone. The page sends no address for a
  // signed-out buyer (checkoutPrefillEmail), and a subscriber signs in first.
  it("tells a signed-out caller nothing about an address (D8)", () => {
    expect(FN_CODE).not.toMatch(/proRequiresSignIn/);
    expect(FN_CODE).not.toMatch(/addressProStanding/);
    expect(FN_CODE).not.toMatch(/\} else if \(normalizedEmail\) \{/);
    expect(HOOK, "the page sends the signed-in account's address or none").toMatch(/email: await checkoutPrefillEmail\(\)/);
  });
});
