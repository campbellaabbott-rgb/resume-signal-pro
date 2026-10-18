// @vitest-environment node
/**
 * NOTHING IS SOLD UNTIL THE SELLER IS NAMED (owner decision 2026-10-17;
 * California Business and Professions Code 17538(d)).
 *
 * WHAT WAS WRONG. The seller's legal name and postal address are empty (the
 * owner has not given them, and one is never invented), and the checkouts
 * took money anyway: California wants both shown before anyone pays.
 *
 * WHAT HOLDS NOW, on the shipped handlers with the shipped (empty) identity:
 *   - create-checkout (the $5 Full Analysis), create-subscription-checkout
 *     (Pro) and create-product-checkout answer 409 with
 *     error "seller_identity_missing" and a sentence in the buyer's language,
 *     and Stripe is asked for nothing;
 *   - create-checkout's GET says purchasesOpen false, so the deploy verifier
 *     reads the state without buying;
 *   - a Pro member's included Full Analysis is not a sale and is still minted;
 *   - with a seller named (the test stand-in), the same requests reach Stripe
 *     (the control), and the GET says purchasesOpen true;
 *   - the page's copy of the identity and the server's are equal, and both
 *     ship empty, so the buttons and the checkouts open together.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { SELLER as PAGE_SELLER } from "@/config/seller";
import { SELLER_IDENTITY } from "../../supabase/functions/_shared/seller-identity";
import { purchasesOpen as pageOpen } from "@/lib/purchases-open";
import { purchasesOpen, sellerGate, SELLER_MISSING } from "../../supabase/functions/_shared/seller-gate";
import { TEST_NAMED_SELLER } from "./helpers/w4b-seller-named";

const MEMBER = { id: "00000000-0000-4000-8000-00000000f501", email: "member@example.com" };
const PLAIN = { id: "00000000-0000-4000-8000-00000000f502", email: "plain@example.com" };
const soon = () => new Date(Date.now() + 20 * 86_400_000).toISOString();

let shipped: Record<string, EdgeHandler>;
let named: Record<string, EdgeHandler>;
let world: W4bWorld;

const FNS = ["create-checkout", "create-subscription-checkout", "create-product-checkout"];

beforeAll(async () => {
  installDeno();
  shipped = await loadCheckouts(FNS, { seller: "as-shipped" });
  named = await loadCheckouts(FNS);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-member": MEMBER, "jwt-plain": PLAIN });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id ? [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }] : [],
    error: null,
  });
});

const analysis = (h: Record<string, EdgeHandler>, bearer?: string, body: Record<string, unknown> = {}) =>
  post(h["create-checkout"], "create-checkout", { currency: "usd", tempSessionId: "00000000-0000-4000-8000-0000000000aa", ...body }, { bearer });
const subscribe = (h: Record<string, EdgeHandler>, body: Record<string, unknown> = {}) =>
  post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "en", autoRenewConsent: true, ...body }, { bearer: "jwt-plain" });
const get = (h: Record<string, EdgeHandler>) =>
  h["create-checkout"](new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "GET" }));

const expectClosed = async (res: Response) => {
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body).toMatchObject({ error: SELLER_MISSING, purchasesOpen: false });
  expect(body.message).toMatch(/Purchases open soon/);
  expect(body.message).toMatch(/Nothing was charged/);
  expect(body).not.toHaveProperty("url");
  expect(world.stripe.created, "a purchase reached Stripe with no seller named").toEqual([]);
};

describe("as shipped (no seller named), nothing is sold", () => {
  it("the Full Analysis: 409 seller_identity_missing, signed out or signed in without a plan", async () => {
    await expectClosed(await analysis(shipped));
    await expectClosed(await analysis(shipped, "jwt-plain"));
  });

  it("Pro: 409 before anyone is asked to sign in, and before Stripe is asked whether the address subscribes", async () => {
    await expectClosed(await subscribe(shipped));
    const signedOut = await post(shipped["create-subscription-checkout"], "create-subscription-checkout", { autoRenewConsent: true });
    await expectClosed(signedOut);
    expect(world.stripe.touched).toEqual([]);
  });

  it("the sentence is in the buyer's language", async () => {
    const res = await subscribe(shipped, { language: "fr" });
    const body = await res.json();
    expect(body.language).toBe("fr");
    expect(body.message).toMatch(/Les achats ouvrent bientôt/);
  });

  it("create-product-checkout: a cut product is still its 410 (the cut answers first), and anything else is the 409", async () => {
    const cut = await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost" });
    expect(cut.status).toBe(410);
    await expectClosed(await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "fullAnalysis" }));
  });

  it("a Pro member's included Full Analysis is not a sale: it is still minted", async () => {
    const res = await analysis(shipped, "jwt-member");
    expect((await res.json()).proIncluded).toBe(true);
    expect(world.db.rows("pro_grants")).toHaveLength(1);
    expect(world.stripe.created).toEqual([]);
  });

  it("the public GET says purchasesOpen false", async () => {
    expect(await (await get(shipped)).json()).toMatchObject({ purchasesOpen: false });
  });
});

describe("control: with a seller named, the same requests reach Stripe", () => {
  it("the Full Analysis and Pro each open a session, and the GET says purchasesOpen true", async () => {
    expect((await analysis(named)).status).toBe(200);
    expect((await subscribe(named)).status).toBe(200);
    expect(world.stripe.created).toHaveLength(2);
    expect(await (await get(named)).json()).toMatchObject({ purchasesOpen: true });
  });
});

describe("the rule, and the two copies of the identity", () => {
  it("both halves are needed: a name without an address, or spaces, opens nothing", () => {
    expect(purchasesOpen({ legalName: "", postalAddress: "" })).toBe(false);
    expect(purchasesOpen({ legalName: "Example Seller LLC", postalAddress: " " })).toBe(false);
    expect(purchasesOpen({ legalName: " ", postalAddress: "1 Example Street" })).toBe(false);
    expect(purchasesOpen(TEST_NAMED_SELLER)).toBe(true);
    expect(sellerGate({}, TEST_NAMED_SELLER)).toBeNull();
    expect(pageOpen({ legalName: "", postalAddress: "1 Example Street" })).toBe(false);
    expect(pageOpen(TEST_NAMED_SELLER)).toBe(true);
  });

  it("the page's copy and the server's are equal, and both ship empty (never an invented identity)", () => {
    expect({ ...PAGE_SELLER }).toEqual({ ...SELLER_IDENTITY });
    expect(pageOpen()).toBe(false);
    expect(purchasesOpen()).toBe(false);
  });
});
