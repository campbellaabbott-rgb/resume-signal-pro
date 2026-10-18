// @vitest-environment node
/**
 * A PLAN CANCELLED IN STRIPE'S PORTAL READS "ENDS", A RETIRED AGENT PLAN IS
 * NAMED AS SUCH, AND THE PORTAL FINDS THE ACCOUNT'S OWN PLAN (S12-076,
 * S12-168, S12-053's portal half).
 *
 * Run on the shipped handlers:
 *   - check-subscription's live read caches cancel_at_period_end and answers
 *     it, read from the same Stripe answer checkProByEmail gets (no second
 *     call; _shared/pro.ts is left as it was, so every other function that
 *     bundles it keeps its build);
 *   - the portal returns to /account?portal=return, and the page's first
 *     check after it (fresh: true) asks Stripe instead of an hour-old row;
 *   - check-subscription says which plan the account's standing rests on
 *     (planTier), so the card can show a retired Agent plan as retired;
 *   - after an address change, the portal finds the plan a cache row bound to
 *     this account names, instead of answering 404 while it keeps charging.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { cancelFlagFrom, recordingSubscriptions, significantSubscription, subscriptionEnds } from "../../supabase/functions/_shared/pro-cancel";

const MEMBER = { id: "00000000-0000-4000-8000-0000000b7001", email: "member@example.com" };
const MOVED = { id: "00000000-0000-4000-8000-0000000b7002", email: "new-address@example.com" };
const DAY = 86_400_000;
const periodEnd = Math.floor((Date.now() + 9 * DAY) / 1000);
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["check-subscription", "create-portal-session"]);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-member": MEMBER, "jwt-moved": MOVED });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id ? [{ tier: "pro", status: "active", current_period_end: new Date(periodEnd * 1000).toISOString(), bound: true }] : [],
    error: null,
  });
});

const check = (body: Record<string, unknown> = {}) => post(h["check-subscription"], "check-subscription", body, { bearer: "jwt-member" });

describe("the cancel flag is cached and answered (S12-076)", () => {
  it("a live read of a subscription set to cancel at period end caches the flag and answers it", async () => {
    world.stripe.customers["member@example.com"] = [{ id: "cus_m" }];
    world.stripe.subs.cus_m = [{ id: "sub_m", status: "active", cancel_at_period_end: true, current_period_end: periodEnd, metadata: { user_id: MEMBER.id }, items: { data: [{ price: { unit_amount: 4500 } }] } }];
    const body = await (await check()).json();
    expect(body).toMatchObject({ active: true, cancelAtPeriodEnd: true });
    expect(world.db.rows("pro_subscribers")[0]).toMatchObject({ email: "member@example.com", cancel_at_period_end: true, stripe_customer_id: "cus_m" });
  });

  it("a cached row that says so is answered from the cache", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "active", current_period_end: new Date(periodEnd * 1000).toISOString(), cancel_at_period_end: true, updated_at: new Date().toISOString() });
    const body = await (await check()).json();
    expect(body).toMatchObject({ cached: true, cancelAtPeriodEnd: true });
    expect(world.stripe.touched).toEqual([]);
  });

  it("back from the portal (fresh), the cache is skipped once and Stripe is asked", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "active", current_period_end: new Date(periodEnd * 1000).toISOString(), cancel_at_period_end: false, updated_at: new Date().toISOString() });
    world.stripe.customers["member@example.com"] = [{ id: "cus_m" }];
    world.stripe.subs.cus_m = [{ id: "sub_m", status: "active", cancel_at_period_end: true, current_period_end: periodEnd, items: { data: [{ price: { unit_amount: 4500 } }] } }];
    const body = await (await check({ fresh: true })).json();
    // One lookup, as before the flag existed: the flag is read from its answer.
    expect(world.stripe.touched).toEqual(["customers.list", "subscriptions.list"]);
    expect(body.cancelAtPeriodEnd).toBe(true);
    expect(world.db.rows("pro_subscribers")[0].cancel_at_period_end).toBe(true);
  });

  it("a plan resumed in the portal reads Renews again, and the row says so", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "active", current_period_end: new Date(periodEnd * 1000).toISOString(), cancel_at_period_end: true, updated_at: new Date().toISOString() });
    world.stripe.customers["member@example.com"] = [{ id: "cus_m" }];
    world.stripe.subs.cus_m = [{ id: "sub_m", status: "active", cancel_at_period_end: false, current_period_end: periodEnd, items: { data: [{ price: { unit_amount: 4500 } }] } }];
    const body = await (await check({ fresh: true })).json();
    expect(body.cancelAtPeriodEnd).toBe(false);
    expect(world.db.rows("pro_subscribers")[0].cancel_at_period_end).toBe(false);
  });

  it("the preflight answers the round-2 build", async () => {
    const res = await h["check-subscription"](new Request("https://harness.supabase.co/functions/v1/check-subscription", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "check-subscription", "2026-10-11", 23)).toBe(true);
  });
});

describe("which plan the standing rests on (S12-168)", () => {
  it("an account whose only live plan is the retired agent plan is told planTier agent", async () => {
    world.db.rpcs.pro_entitlement_rows = () => ({ data: [{ tier: "agent", status: "active", current_period_end: null, bound: true }], error: null });
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "inactive", updated_at: new Date().toISOString() });
    const body = await (await check()).json();
    expect(body).toMatchObject({ active: true, planTier: "agent" });
  });

  it("a Pro row outranks an agent row; a past-due agent plan alone is still 'agent'", async () => {
    world.db.rows("pro_subscribers").push({ email: "member@example.com", status: "inactive", updated_at: new Date().toISOString() });
    expect((await (await check()).json()).planTier).toBe("pro");
    world.db.rpcs.pro_entitlement_rows = () => ({ data: [{ tier: "agent", status: "past_due", current_period_end: null, bound: true }], error: null });
    expect((await (await check()).json()).planTier).toBe("agent");
  });
});

describe("the billing portal (S12-076, S12-053)", () => {
  it("returns to /account?portal=return so the card asks again", async () => {
    world.stripe.customers["member@example.com"] = [{ id: "cus_m" }];
    world.stripe.subs.cus_m = [{ id: "sub_m", status: "active", current_period_end: periodEnd, metadata: { user_id: MEMBER.id }, items: { data: [{ price: { unit_amount: 4500 } }] } }];
    const res = await post(h["create-portal-session"], "create-portal-session", {}, { bearer: "jwt-member" });
    expect((await res.json()).url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(world.stripe.portals[0].return_url).toBe("https://resumebooster.work/account?portal=return");
  });

  it("after an address change the plan bound to this account is found, not a 404", async () => {
    // Stripe has nothing for the new address; the cache row bound to the account names the customer.
    world.db.rows("pro_subscribers").push({ email: "old-address@example.com", user_id: MOVED.id, stripe_customer_id: "cus_old", status: "active", updated_at: new Date().toISOString() });
    const res = await post(h["create-portal-session"], "create-portal-session", {}, { bearer: "jwt-moved" });
    expect(res.status).toBe(200);
    expect(world.stripe.portals[0].customer).toBe("cus_old");
  });

  it("an account with no plan anywhere is still a 404", async () => {
    const res = await post(h["create-portal-session"], "create-portal-session", {}, { bearer: "jwt-moved" });
    expect(res.status).toBe(404);
    expect(world.stripe.portals).toEqual([]);
  });

  it("the preflight answers the round-2 build", async () => {
    const res = await h["create-portal-session"](new Request("https://harness.supabase.co/functions/v1/create-portal-session", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "create-portal-session", "2026-10-14", 23)).toBe(true);
  });
});

describe("the flag is read beside the one rule, not inside it", () => {
  it("the recording client keeps each customer's pages and changes nothing it answers", async () => {
    const calls: unknown[] = [];
    const stripe = {
      customers: { list: async () => ({ data: [{ id: "cus_a" }], has_more: false }) },
      subscriptions: { list: async (p: { customer: string; starting_after?: string }) => { calls.push(p); return p.starting_after ? { data: [{ id: "s2", status: "active", cancel_at: 1 }], has_more: false } : { data: [{ id: "s1", status: "canceled" }], has_more: true }; } },
    };
    const r = recordingSubscriptions(stripe);
    expect(r.stripe.customers).toBe(stripe.customers);
    const first = await r.stripe.subscriptions.list({ customer: "cus_a" });
    await r.stripe.subscriptions.list({ customer: "cus_a", starting_after: "s1" });
    expect(first).toEqual({ data: [{ id: "s1", status: "canceled" }], has_more: true });
    expect(calls).toHaveLength(2);
    expect(r.seen.get("cus_a")?.map((s) => (s as { id?: string }).id)).toEqual(["s1", "s2"]);
    expect(cancelFlagFrom(r.seen, "cus_a")).toBe(true);
    expect(cancelFlagFrom(r.seen, "cus_unlisted")).toBeNull();
  });

  it("the plan's own subscription decides: a live one set to end, never an ended one", () => {
    expect(subscriptionEnds({ cancel_at_period_end: true })).toBe(true);
    expect(subscriptionEnds({ cancel_at: 1_800_000_000 })).toBe(true);
    expect(subscriptionEnds({ cancel_at_period_end: false, cancel_at: null })).toBe(false);
    expect(significantSubscription([{ status: "canceled", cancel_at_period_end: true }, { status: "active" }])?.status).toBe("active");
    expect(cancelFlagFrom(new Map([["cus_x", [{ status: "canceled", cancel_at_period_end: true }]]]), "cus_x")).toBe(false);
  });
});
