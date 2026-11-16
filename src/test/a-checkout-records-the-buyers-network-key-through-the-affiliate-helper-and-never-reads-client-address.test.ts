// @vitest-environment node
/**
 * A CHECKOUT RECORDS THE BUYER'S NETWORK KEY THROUGH THE AFFILIATE HELPER AND
 * NEVER READS CLIENT-ADDRESS.TS (RC-S13-063, the checkout half; the affiliate
 * lane holds the rest).
 *
 * An affiliate could buy with their own code from their own network and earn
 * the commission, and nothing marked it: affiliates and checkout buyers
 * shared no column. The affiliate lane records each affiliate's sign-in
 * networks as a keyed hash of the /24 or /48 (affiliate_network_key,
 * 20261112120000) and flags a conversion whose checkout_buyers.network_key
 * (20261112122000) matches. This half writes that key: the two checkouts
 * that record a buyer hand recordCheckoutBuyer (_shared/checkout-buyer.ts)
 * the address the platform states, and it asks the helper for the key and
 * writes it with the row. checkout-buyer.ts never imports
 * _shared/client-address.ts (job-board's file). Before either migration the
 * row is written as before; the address itself is never stored.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, type EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { recordCheckoutBuyer, type CheckoutCaller } from "../../supabase/functions/_shared/checkout-buyer";
import { TERMS_VERSION } from "../../supabase/functions/_shared/checkout-policy";
import { codeOf } from "./helpers/strip-comments";

const KEY = "a".repeat(64);
const USER = { id: "00000000-0000-4000-8000-000000063a01", email: "buyer@example.com" };
const SIGNED_IN: CheckoutCaller = { kind: "signed_in", id: USER.id, email: USER.email };
const SESSION = "cs_test_networkkey0001";

describe("recordCheckoutBuyer writes the key the helper answers", () => {
  let db: FakeDb;
  let asked: Array<Record<string, unknown>>;
  beforeEach(() => {
    db = new FakeDb();
    asked = [];
    db.rpcs.affiliate_network_key = (a) => { asked.push(a); return { data: KEY, error: null }; };
  });
  const write = (address?: string | null, caller: CheckoutCaller = SIGNED_IN) =>
    recordCheckoutBuyer(db, { stripeSessionId: SESSION, caller, checkoutFunction: "create-checkout", productType: "full_analysis", address });

  it("the row carries the key for the address the checkout handed in, and never the address", async () => {
    expect(await write("203.0.113.7")).toBe("recorded");
    expect(asked).toEqual([{ p_addr: "203.0.113.7" }]);
    expect(db.rows("checkout_buyers")).toEqual([{ stripe_session_id: SESSION, user_id: USER.id, checkout_function: "create-checkout", product_type: "full_analysis", network_key: KEY }]);
    expect(JSON.stringify(db.rows("checkout_buyers"))).not.toContain("203.0.113.7");
  });

  it("before the affiliate migration (no helper) the row is written as before", async () => {
    delete db.rpcs.affiliate_network_key;
    expect(await write("203.0.113.7")).toBe("recorded");
    expect(db.rows("checkout_buyers")[0]).not.toHaveProperty("network_key");
  });

  it("before the column exists the row is written without it", async () => {
    db.faults.push({ table: "checkout_buyers", op: "upsert", error: { code: "PGRST204", message: "Could not find the 'network_key' column of 'checkout_buyers' in the schema cache" } });
    expect(await write("203.0.113.7")).toBe("recorded");
    expect(db.rows("checkout_buyers")).toHaveLength(1);
    expect(db.rows("checkout_buyers")[0]).not.toHaveProperty("network_key");
  });

  it("an answer that is not a 64-hex key is not written, and no address means no question", async () => {
    db.rpcs.affiliate_network_key = () => ({ data: "203.0.113.0/24", error: null });
    await write("203.0.113.7");
    expect(db.rows("checkout_buyers")[0]).not.toHaveProperty("network_key");
    db.tables = {};
    db.rpcs.affiliate_network_key = (a) => { asked.push(a); return { data: KEY, error: null }; };
    await write(null);
    await write();
    expect(asked).toEqual([]);
    expect(db.rows("checkout_buyers")[0]).not.toHaveProperty("network_key");
  });

  it("an anonymous buyer is skipped and the helper is not asked", async () => {
    expect(await write("203.0.113.7", { kind: "anonymous" })).toBe("skipped");
    expect(asked).toEqual([]);
  });

  it("checkout-buyer.ts never reads client-address.ts, the file job-board owns", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/_shared/checkout-buyer.ts"), "utf8"));
    expect(code).toContain('"affiliate_network_key"');
    expect(code).not.toMatch(/client-address/);
  });
});

describe("the two checkouts that record a buyer", () => {
  let h: Record<string, EdgeHandler>;
  let world: W4bWorld;
  let asked: Array<Record<string, unknown>>;
  beforeAll(async () => {
    installDeno();
    h = await loadCheckouts(["create-checkout", "create-subscription-checkout"]);
  }, 240_000);
  beforeEach(() => {
    world = freshWorld({ "jwt-buyer": USER });
    asked = [];
    world.db.rpcs.affiliate_network_key = (a) => { asked.push(a); return { data: KEY, error: null }; };
  });

  it("a signed-in Full Analysis purchase records the key for the platform's address", async () => {
    const res = await post(h["create-checkout"], "create-checkout", { currency: "usd" }, { bearer: "jwt-buyer" });
    expect(res.status).toBe(200);
    expect(asked).toEqual([{ p_addr: "198.51.100.8" }]);
    expect(world.db.rows("checkout_buyers")[0]).toMatchObject({ user_id: USER.id, checkout_function: "create-checkout", network_key: KEY });
  });

  it("a Pro checkout records it too", async () => {
    const res = await post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "en", termsVersion: TERMS_VERSION, autoRenewConsent: true }, { bearer: "jwt-buyer" });
    expect(res.status).toBe(200);
    expect(asked).toEqual([{ p_addr: "198.51.100.8" }]);
    expect(world.db.rows("checkout_buyers")[0]).toMatchObject({ user_id: USER.id, checkout_function: "create-subscription-checkout", network_key: KEY });
  });

  it("a checkout whose platform states no address records the row without a key", async () => {
    const res = await post(h["create-checkout"], "create-checkout", { currency: "usd" }, { bearer: "jwt-buyer", headers: { "cf-connecting-ip": "" } });
    expect(res.status).toBe(200);
    expect(world.db.rows("checkout_buyers")[0]).toMatchObject({ user_id: USER.id });
  });
});
