// @vitest-environment node
/**
 * REGISTERING A FORMER CUSTOMER'S ADDRESS AND BUYING PRO DOES NOT REUSE THEIR
 * STRIPE CUSTOMER (S12-099), AND PRO'S STRIPE PAGE SAYS WHAT PRO IS.
 *
 * WHAT WAS WRONG. create-subscription-checkout billed a new plan to whatever
 * Stripe customer the address already had. Sign-ups are confirmed
 * automatically, so a stranger who registered a former customer's address
 * and bought Pro had the plan land on THAT customer, whose invoices, card and
 * billing address the portal then showed them. And the Stripe description
 * still sold "premium packages", a cut product.
 *
 * WHAT HOLDS NOW, run on the shipped handler: the address's customer is
 * reused only when this account provably owns it (a cache row bound to the
 * account names it, or the account proved the mailbox); otherwise Stripe
 * makes a new one. The description names no cut product and matches the Pro
 * card's lines.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { reusableCustomer } from "../../supabase/functions/_shared/customer-ownership";

const SQUATTER = { id: "00000000-0000-4000-8000-0000000a9001", email: "former@example.com" };
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-subscription-checkout"]);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-squatter": SQUATTER });
  // The former customer: a Stripe customer on the address, with a plan that ended.
  world.stripe.customers["former@example.com"] = [{ id: "cus_former" }];
  world.stripe.subs.cus_former = [{ id: "sub_old", status: "canceled", items: { data: [{ price: { unit_amount: 4500 } }] } }];
});

// autoRenewConsent: the buyer ticked Pro's own renewal box (owner decision 2026-10-17).
const buy = () => post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "en", autoRenewConsent: true }, { bearer: "jwt-squatter" });

describe("the address's Stripe customer is reused only by the account that owns it", () => {
  it("a sign-up that proved nothing gets a NEW customer (Stripe makes one from the address)", async () => {
    const res = await buy();
    expect(res.status).toBe(200);
    const s = world.stripe.created[0];
    expect(s.customer).toBeUndefined();
    expect(s.customer_email).toBe("former@example.com");
  });

  it("a cache row bound to this account naming that customer reuses it", async () => {
    world.db.rows("pro_subscribers").push({ email: "former@example.com", user_id: SQUATTER.id, stripe_customer_id: "cus_former", status: "canceled" });
    await buy();
    expect(world.stripe.created[0].customer).toBe("cus_former");
    expect(world.stripe.created[0].customer_email).toBeUndefined();
  });

  it("an account that proved the mailbox reuses it", async () => {
    world.db.rows("account_mailbox_proofs").push({ id: 1, user_id: SQUATTER.id, email: "former@example.com" });
    await buy();
    expect(world.stripe.created[0].customer).toBe("cus_former");
  });

  it("a failed read proves nothing and reuses nothing", async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "x" } }), maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) }) };
    expect(await reusableCustomer(failing, SQUATTER, "cus_former")).toBeNull();
  });
});

describe("Pro's Stripe page says what Pro is, and a referral earns the first-month commission", () => {
  it("the description names no cut product and says everything in a free account plus the writing tools", async () => {
    await buy();
    const description = String((world.stripe.created[0].line_items as Array<{ price_data: { product_data: { description: string } } }>)[0].price_data.product_data.description);
    expect(description).toMatch(/^Everything in a free account, plus the writing tools/);
    for (const cut of [/premium package/i, /keyword fix/i, /career simulator/i, /interview coach/i, /every new tool/i, /every resume booster tool/i, /freelance/i, /transition pro/i, /unlimited/i]) {
      expect(description, String(cut)).not.toMatch(cut);
    }
  });

  it("the session is stamped with the Pro first-month commission rule and checkout_buyers names the account", async () => {
    await post(h["create-subscription-checkout"], "create-subscription-checkout", { referralCode: "abc123", autoRenewConsent: true }, { bearer: "jwt-squatter" });
    expect(world.stripe.created[0].metadata).toMatchObject({ referral_code: "abc123", referral_commission: "pro_first_month", referral_commission_cents: "1000" });
    expect(world.db.rows("checkout_buyers")[0]).toMatchObject({ user_id: SQUATTER.id, checkout_function: "create-subscription-checkout" });
  });

  it("the preflight answers the round-2 build", async () => {
    const res = await h["create-subscription-checkout"](new Request("https://harness.supabase.co/functions/v1/create-subscription-checkout", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "create-subscription-checkout", "2026-10-11", 23)).toBe(true);
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/create-subscription-checkout/index.ts"), "utf8");
    expect(src).not.toMatch(/standing\.reuseCustomerId \?/);
  });
});
