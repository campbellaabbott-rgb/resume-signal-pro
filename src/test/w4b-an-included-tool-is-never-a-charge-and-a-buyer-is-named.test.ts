// @vitest-environment node
/**
 * AN INCLUDED TOOL IS NEVER A CHARGE, A SIGNED-IN BUYER IS NAMED, AND A
 * SIGNED-OUT ONE IS TOLD NOTHING ABOUT AN ADDRESS (critical-path CP-012,
 * CP-022, CP-025; owner decisions D7, D8; S12-067, S12-098).
 *
 * WHAT WAS WRONG, each run here on the shipped handlers:
 *   - create-product-checkout sent a Pro member to a paid Stripe page when
 *     the grant insert failed ("falling back to Stripe") or the Pro check
 *     threw ("best-effort"), and both checkouts read an auth server that
 *     could not answer as "anonymous";
 *   - grants had no count: a loop of presses minted one model run each;
 *   - in the hour between a trial's end and its first charge the cache read
 *     "active", so a converted trial minted grants before paying;
 *   - a signed-out POST naming an address learned whether it held Pro;
 *   - a signed-in purchase named no account, and Stripe was prefilled with
 *     the body's address rather than the verified one.
 *
 * Since 2026-10-17 (owner decision) Freelance Boost and Transition Pro are
 * cut and not part of Pro, so the Full Analysis (create-checkout) is the one
 * tool a member's checkout mints, and these run on it; create-product-checkout
 * sells nothing and mints nothing, member or not.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { planPaid, subscriptionPaid } from "../../supabase/functions/_shared/consumable-paid";
import { checkoutCaller, fairUseAnswer, grantCapOf } from "../../supabase/functions/_shared/checkout-buyer";

const MEMBER = { id: "00000000-0000-4000-8000-00000000d001", email: "member@example.com" };
const PLAIN = { id: "00000000-0000-4000-8000-00000000d002", email: "plain@example.com" };
const soon = () => new Date(Date.now() + 20 * 86_400_000).toISOString();
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-checkout", "create-product-checkout"]);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-member": MEMBER, "jwt-plain": PLAIN });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id ? [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }] : [],
    error: null,
  });
});

const analysis = (bearer?: string, body: Record<string, unknown> = {}) =>
  post(h["create-checkout"], "create-checkout", { currency: "usd", tempSessionId: "00000000-0000-4000-8000-0000000000aa", ...body }, { bearer });
const freelance = (bearer?: string, body: Record<string, unknown> = {}) =>
  post(h["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost", ...body }, { bearer });

describe("a Pro member is never sent to pay for an included tool (CP-025)", () => {
  it("a grant that cannot be minted is a 503 and no Stripe url (it used to fall back to Stripe)", async () => {
    world.db.faults.push({ table: "pro_grants", op: "insert", error: { code: "XX000", message: "boom" } });
    const res = await analysis("jwt-member");
    expect(res.status).toBe(503);
    expect((await res.json()).url).toBeUndefined();
    expect(world.stripe.created).toEqual([]);
  });

  it("an auth server that cannot answer is a 503, not an anonymous sale", async () => {
    world.authDown = true;
    const res = await analysis("jwt-member");
    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
    expect(world.stripe.created).toEqual([]);
  });

  it("a refused token is still an anonymous buyer (control)", async () => {
    const res = await analysis("jwt-forged");
    expect(res.status).toBe(200);
    expect(world.stripe.created).toHaveLength(1);
  });

  it("the paid member gets the grant, named for the account", async () => {
    const res = await analysis("jwt-member");
    expect((await res.json()).proIncluded).toBe(true);
    expect(world.db.rows("pro_grants")).toHaveLength(1);
    expect(world.db.rows("pro_grants")[0]).toMatchObject({ user_id: MEMBER.id, product_id: "fullAnalysis" });
  });

  it("Freelance Boost is not part of Pro and not sold: the member gets the 410, no grant and no Stripe page", async () => {
    const res = await freelance("jwt-member");
    expect(res.status).toBe(410);
    expect(world.db.rows("pro_grants")).toEqual([]);
    expect(world.stripe.created).toEqual([]);
  });
});

describe("a grant over the cap is fair use, never a charge (D7, S12-067)", () => {
  it("the cap's refusal is a 429 that says why, for the day and for the month", async () => {
    world.db.faults.push({ table: "pro_grants", op: "insert", error: { code: "P0001", message: "pro_grant_cap: daily" } });
    const a = await analysis("jwt-member");
    expect(a.status).toBe(429);
    expect(await a.json()).toMatchObject({ fairUse: true, reason: "pro_grant_cap", window: "daily" });
    world.db.faults.push({ table: "pro_grants", op: "insert", error: { code: "P0001", message: "pro_grant_cap: monthly" } });
    const f = await analysis("jwt-member");
    expect(f.status).toBe(429);
    expect((await f.json()).window).toBe("monthly");
    expect(world.stripe.created).toEqual([]);
  });

  it("reads only the cap's own message", () => {
    expect(grantCapOf({ message: "pro_grant_cap: daily" })).toBe("daily");
    expect(grantCapOf({ message: "duplicate key" })).toBeNull();
    expect(fairUseAnswer("daily").body.error).toMatch(/10 of these a day and 60 a month/);
  });
});

describe("a converted trial mints nothing until its first real payment (S12-098)", () => {
  it("a live plan that began with a trial and has paid nothing is refused a grant, with no charge", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", user_id: MEMBER.id, stripe_customer_id: "cus_trial", status: "active" });
    world.stripe.subs.cus_trial = [{ id: "sub_trial", status: "active", trial_end: Math.floor(Date.now() / 1000) - 600 }];
    world.stripe.invoices.sub_trial = [{ status: "paid", amount_paid: 0 }];
    const res = await analysis("jwt-member");
    expect(res.status).toBe(409);
    expect((await res.json()).planUnpaid).toBe(true);
    expect(world.db.rows("pro_grants")).toEqual([]);
    expect(world.stripe.created).toEqual([]);
  });

  it("once an invoice with money in it is paid, the grant is minted", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", user_id: MEMBER.id, stripe_customer_id: "cus_trial", status: "active" });
    world.stripe.subs.cus_trial = [{ id: "sub_trial", status: "active", trial_end: Math.floor(Date.now() / 1000) - 7200 }];
    world.stripe.invoices.sub_trial = [{ status: "paid", amount_paid: 0 }, { status: "paid", amount_paid: 4500 }];
    expect((await (await analysis("jwt-member")).json()).proIncluded).toBe(true);
  });

  it("the rule: no trial needs no invoice; a comped plan with no customer is paid", async () => {
    expect(subscriptionPaid({ id: "s", status: "active", trial_end: null }, [])).toBe(true);
    expect(subscriptionPaid({ id: "s", status: "active", trial_end: 1 }, [{ amount_paid: 0, status: "paid" }])).toBe(false);
    const noRows = { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) };
    const stripe = { subscriptions: { list: async () => ({ data: [] }) }, invoices: { list: async () => ({ data: [] }) } };
    expect(await planPaid(stripe, noRows, MEMBER.id)).toBe("paid");
    const broken = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "x" } }) }) }) };
    expect(await planPaid(stripe, broken, MEMBER.id)).toBe("unknown");
  });
});

describe("a signed-out visitor learns nothing about an address (D8)", () => {
  it("a subscriber's address in a signed-out body gets an ordinary checkout, not 'sign in to use your plan'", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "active", current_period_end: soon() });
    const res = await analysis(undefined, { email: "member@example.com" });
    const body = await res.json();
    expect(body.proRequiresSignIn).toBeUndefined();
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(world.db.rows("pro_grants")).toEqual([]);
  });
});

describe("a signed-in purchase names its account and its verified address (CP-022, CP-012)", () => {
  it("the session carries the account and checkout_buyers records it; the verified address beats the body's", async () => {
    const res = await analysis("jwt-plain", { email: "someone-else@example.com" });
    expect(res.status).toBe(200);
    const s = world.stripe.created[0];
    expect(s.client_reference_id).toBe(PLAIN.id);
    expect((s.metadata as Record<string, string>).user_id).toBe(PLAIN.id);
    expect(s.customer_email).toBe(PLAIN.email);
    expect(world.db.rows("checkout_buyers")).toEqual([
      expect.objectContaining({ user_id: PLAIN.id, checkout_function: "create-checkout", product_type: "full_analysis" }),
    ]);
  });

  it("the Full Analysis does the same for a signed-in buyer without a plan", async () => {
    await analysis("jwt-plain");
    const s = world.stripe.created[0];
    expect(s.client_reference_id).toBe(PLAIN.id);
    expect(s.customer_email).toBe(PLAIN.email);
    expect(world.db.rows("checkout_buyers")[0]).toMatchObject({ user_id: PLAIN.id, checkout_function: "create-checkout", product_type: "full_analysis" });
  });

  it("an anonymous buyer writes no buyer row and carries no account", async () => {
    await analysis();
    expect(world.stripe.created[0].client_reference_id).toBeUndefined();
    expect(world.db.rows("checkout_buyers")).toEqual([]);
  });

  it("the caller has three answers, never two", async () => {
    const auth = (r: unknown) => ({ getUser: async () => r as never });
    const hdr = (t: string) => new Headers({ authorization: `Bearer ${t}` });
    expect(await checkoutCaller(auth({}), hdr("anon"), "anon")).toEqual({ kind: "anonymous" });
    expect((await checkoutCaller(auth({ data: { user: null }, error: { status: 503 } }), hdr("t"), "anon")).kind).toBe("unavailable");
    expect((await checkoutCaller(auth({ data: { user: null }, error: { status: 401 } }), hdr("t"), "anon")).kind).toBe("anonymous");
    expect((await checkoutCaller({ getUser: async () => { throw new Error("network"); } }, hdr("t"), "anon")).kind).toBe("unavailable");
  });
});
