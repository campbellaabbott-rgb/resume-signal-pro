// @vitest-environment node
/**
 * A FULL ANALYSIS SESSION CARRIES THE BUYER'S LANGUAGE (S12-114, for the one
 * one-off still sold; payments-delivery's handoff, applied at integration).
 *
 * send-product-email writes the purchase mail in the site's nine languages,
 * reading the language the checkout recorded (metadata.language), and
 * stripe-webhook, verify-product-purchase and the retry sweep pass it on. The
 * Full Analysis session (create-checkout) never recorded it, so every Full
 * Analysis buyer's purchase-link mail fell back to English.
 *
 * Run on the shipped handler with Stripe faked: the language the page sends
 * is on the session's metadata; one the site does not speak (or none) is
 * recorded as English, never passed through to Stripe as typed.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";

let h: Record<string, EdgeHandler>;
let world: W4bWorld;
beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-checkout"]);
}, 240_000);
beforeEach(() => { world = freshWorld(); });

const analysis = (body: Record<string, unknown>) =>
  post(h["create-checkout"], "create-checkout", { currency: "usd", tempSessionId: "00000000-0000-4000-8000-0000000000aa", ...body });
const metadataOf = () => (world.stripe.created[0]?.metadata ?? {}) as Record<string, unknown>;

describe("the Full Analysis session's language", () => {
  it("records the page's language on the session", async () => {
    const res = await analysis({ language: "de" });
    expect(res.status).toBe(200);
    expect(metadataOf().language).toBe("de");
  });

  it("records a regional variant the site speaks as it is", async () => {
    await analysis({ language: "en-GB" });
    expect(metadataOf().language).toBe("en-GB");
  });

  it("records English for a language the site does not speak, or none", async () => {
    await analysis({ language: "<script>" });
    expect(metadataOf().language).toBe("en");
    world = freshWorld();
    await analysis({});
    expect(metadataOf().language).toBe("en");
  });
});
