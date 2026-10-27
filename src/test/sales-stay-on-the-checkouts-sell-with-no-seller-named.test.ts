// @vitest-environment node
/**
 * SALES STAY ON (owner, 2026-10-27: "there is no sales pause ... no one told
 * you to do that"). This overrides the 2026-10-17 design decisions D3 and D4.
 *
 * Wave 4 answered every purchase with 409 while the seller's legal name and
 * postal address were empty, which is how they ship. Nobody asked for that.
 * With the identity exactly as it ships (empty, never invented), each product
 * main sells reaches Stripe as it does on main:
 *   - the $5 Full Analysis (create-checkout), signed out and signed in;
 *   - Pro (create-subscription-checkout), signed in with its renewal box;
 *   - create-product-checkout sells nothing wave 4 kept (every row is cut or
 *     retired by the owner), so a cut product is its 410 and an id it does
 *     not sell is main's 400, never a 409;
 *   - create-checkout's public GET carries no closed shop.
 * Each handler is the shipped one with only its network faked.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { SELLER_IDENTITY } from "../../supabase/functions/_shared/seller-identity";
import { SELLER as PAGE_SELLER } from "@/config/seller";
import { codeOf } from "./helpers/strip-comments";

const PLAIN = { id: "00000000-0000-4000-8000-00000000f702", email: "plain@example.com" };
const MEMBER = { id: "00000000-0000-4000-8000-00000000f701", email: "member@example.com" };
const soon = () => new Date(Date.now() + 20 * 86_400_000).toISOString();
const FNS = ["create-checkout", "create-subscription-checkout", "create-product-checkout"];
const ROOT = resolve(__dirname, "../..");

let shipped: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  shipped = await loadCheckouts(FNS);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-plain": PLAIN, "jwt-member": MEMBER });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id ? [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }] : [],
    error: null,
  });
});

const analysis = (bearer?: string) =>
  post(shipped["create-checkout"], "create-checkout", { currency: "usd", tempSessionId: "00000000-0000-4000-8000-0000000000ab" }, { bearer });
const subscribe = () =>
  post(shipped["create-subscription-checkout"], "create-subscription-checkout", { language: "en", autoRenewConsent: true }, { bearer: "jwt-plain" });

const expectSold = async (res: Response, what: string) => {
  const body = await res.json();
  expect(res.status, `${what}: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
  expect(body.error, what).toBeUndefined();
  expect(String(body.url ?? ""), what).toMatch(/^https:\/\/checkout\.stripe\.com\//);
};

describe("the premise: the seller's identity ships empty, and nothing is invented", () => {
  it("both halves of the server's copy are empty, and the page's copy equals it", () => {
    expect(SELLER_IDENTITY).toEqual({ legalName: "", postalAddress: "" });
    expect({ ...PAGE_SELLER }).toEqual({ ...SELLER_IDENTITY });
  });
});

describe("with no seller named, every product main sells is sold", () => {
  it("the $5 Full Analysis opens a Stripe session, signed out and signed in", async () => {
    await expectSold(await analysis(), "signed out");
    await expectSold(await analysis("jwt-plain"), "signed in");
    expect(world.stripe.created).toHaveLength(2);
  });

  it("Pro opens a Stripe session for a signed-in buyer who ticked the renewal box", async () => {
    await expectSold(await subscribe(), "Pro");
    expect(world.stripe.created).toHaveLength(1);
    expect(world.stripe.created[0].mode).toBe("subscription");
  });

  it("create-product-checkout: a cut product is its 410, an id it does not sell is main's 400, and neither is a 409", async () => {
    const cut = await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost" });
    expect(cut.status).toBe(410);
    const unknown = await post(shipped["create-product-checkout"], "create-product-checkout", { productId: "fullAnalysis" });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("Invalid product selected");
  });

  it("a Pro member's included Full Analysis is minted, not sold, as before", async () => {
    const res = await analysis("jwt-member");
    expect((await res.json()).proIncluded).toBe(true);
    expect(world.db.rows("pro_grants")).toHaveLength(1);
    expect(world.stripe.created).toEqual([]);
  });

  it("create-checkout's public GET reports no closed shop", async () => {
    const res = await shipped["create-checkout"](new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "GET" }));
    const body = await res.json();
    expect(body.purchasesOpen).not.toBe(false);
  });
});

describe("no checkout consults the seller before it sells", () => {
  it("the three checkouts' code names no seller gate", () => {
    for (const fn of FNS) {
      const src = codeOf(readFileSync(resolve(ROOT, `supabase/functions/${fn}/index.ts`), "utf8"));
      expect(src, fn).not.toMatch(/seller-gate|sellerGate|seller_identity_missing|purchasesOpen/);
    }
  });
});
