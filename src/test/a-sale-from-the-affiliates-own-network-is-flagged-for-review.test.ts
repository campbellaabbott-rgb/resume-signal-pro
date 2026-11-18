// @vitest-environment node
/**
 * A SALE FROM THE AFFILIATE'S OWN NETWORK IS FLAGGED FOR REVIEW (RC-S13-063).
 *
 * WHAT WAS WRONG. The self-referral rule compares mailboxes only. An
 * affiliate who buys with their own code under a second address, from the
 * same connection they sign in from, reads as a stranger and earns. Nothing
 * recorded where an affiliate signs in, nothing recorded where a checkout came
 * from, and every account could earn before proving it owns its address.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's):
 *   - register and login note the network (a keyed hash of the /24 or /48,
 *     never the address) the affiliate signs in from;
 *   - affiliate_network_key, the one service-role helper the checkout side
 *     calls, gives a checkout from 203.0.113.9 the same key as a sign-in from
 *     203.0.113.7, and a different one to 198.51.100.4;
 *   - an earning conversion records review_flags: 'affiliate-network' when the
 *     checkout came from a network the affiliate signed in from in the thirty
 *     days before, 'unproven-affiliate' while the address is unproven, and the
 *     second flag lifts when the address is proven;
 *   - a flagged conversion never reaches a payout: not in the dashboard's
 *     pending balance and not in a payout request, even once approved.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
let aff = "";
let token = "";
beforeAll(async () => {
  db = await bootAffiliateDb({ round: true });
  await fromAddress(db, "203.0.113.200");
  await q(db, "SELECT public.register_affiliate('partner@example.com', 'correct horse 1')");
  await fromAddress(db, "203.0.113.7");
  token = String((await one<{ j: { session_token: string } }>(db, "SELECT public.login_affiliate('partner@example.com', 'correct horse 1') AS j")).j.session_token);
  aff = (await one<{ id: string }>(db, "SELECT id FROM public.affiliates WHERE email = 'partner@example.com'")).id;
  await q(db, "UPDATE public.affiliates SET referral_code = 'netref' WHERE id = $1", [aff]);
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const key = async (ip: string) => (await one<{ k: string | null }>(db, "SELECT public.affiliate_network_key($1) AS k", [ip])).k;

const sale = async (session: string, buyerIp: string | null, buyer = "someone@example.org") => {
  await q(db, `INSERT INTO public.checkout_buyers (stripe_session_id, checkout_function, product_type, network_key)
               VALUES ($1, 'create-subscription-checkout', 'pro_subscription', CASE WHEN $2::text IS NULL THEN NULL ELSE public.affiliate_network_key($2::text) END)`, [session, buyerIp]);
  await q(db, "INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status) VALUES ($1, 'pro_subscription', $2, 'delivered')", [session, buyer]);
  await q(db, "SELECT public.record_affiliate_conversion('netref', $1, 4500, 'Pro', 1000)", [session]);
  return (await one<{ id: string; commission_amount: number; review_flags: string[] }>(db,
    "SELECT id, commission_amount, review_flags FROM public.affiliate_conversions WHERE stripe_session_id = $1", [session]));
};

describe("the network key", () => {
  it("is shared within a /24 and a /48, differs across them, and names no address", async () => {
    expect(await key("203.0.113.9")).toBe(await key("203.0.113.7"));
    expect(await key("198.51.100.4")).not.toBe(await key("203.0.113.7"));
    expect(await key("::ffff:203.0.113.50")).toBe(await key("203.0.113.7"));
    expect(await key("2001:db8:1:2::1")).toBe(await key("2001:db8:1:ff::9"));
    expect(await key("2001:db8:2::1")).not.toBe(await key("2001:db8:1::1"));
    const k = String(await key("203.0.113.7"));
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("203.0.113");
  });

  it("a sign-in noted the affiliate's network, and only its key", async () => {
    const rows = await q<{ network_key: string }>(db, "SELECT network_key FROM public.affiliate_sign_in_networks WHERE affiliate_id = $1", [aff]);
    expect(rows.map((r) => r.network_key)).toContain(await key("203.0.113.7"));
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
  });
});

describe("an earning conversion carries its review flags", () => {
  it("a checkout from the affiliate's own network is flagged; one from elsewhere is not", async () => {
    const mine = await sale("cs_test_same_net", "203.0.113.9");
    expect(mine.commission_amount).toBe(1000);
    expect(mine.review_flags).toContain("affiliate-network");
    const theirs = await sale("cs_test_other_net", "198.51.100.4", "other@example.org");
    expect(theirs.review_flags).not.toContain("affiliate-network");
  });

  it("an affiliate with an unproven address has every earning conversion flagged until it is proven", async () => {
    const before = await sale("cs_test_unproven", "198.51.100.5", "third@example.org");
    expect(before.review_flags).toContain("unproven-affiliate");
    await q(db, "UPDATE public.affiliates SET email_confirmed_at = now() WHERE id = $1", [aff]);
    const [{ review_flags }] = await q<{ review_flags: string[] }>(db, "SELECT review_flags FROM public.affiliate_conversions WHERE id = $1", [before.id]);
    expect(review_flags).not.toContain("unproven-affiliate");
    const after = await sale("cs_test_proven", "198.51.100.6", "fourth@example.org");
    expect(after.review_flags).toEqual([]);
  });

  it("a conversion that earns nothing carries no flag", async () => {
    const zero = await sale("cs_test_self", "203.0.113.9", "partner+x@example.com");
    expect(zero.commission_amount).toBe(0);
    expect(zero.review_flags).toEqual([]);
  });
});

describe("a flagged conversion never reaches a payout", () => {
  it("approved and flagged: outside the pending balance and refused in a payout request", async () => {
    await q(db, "UPDATE public.affiliate_conversions SET status = 'approved' WHERE affiliate_id = $1 AND commission_amount > 0", [aff]);
    const d = (await one<{ j: { stats: { pending_payout: number } } }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j;
    const clean = await q<{ id: string; commission_amount: number }>(db,
      "SELECT id, commission_amount FROM public.affiliate_conversions WHERE affiliate_id = $1 AND status = 'approved' AND review_flags = '{}'", [aff]);
    expect(d.stats.pending_payout).toBe(clean.reduce((t, c) => t + c.commission_amount, 0));
    const flagged = await q<{ id: string; commission_amount: number }>(db,
      "SELECT id, commission_amount FROM public.affiliate_conversions WHERE affiliate_id = $1 AND status = 'approved' AND review_flags <> '{}'", [aff]);
    expect(flagged.length).toBeGreaterThan(0);
    await expect(q(db, "INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, $2, $3)",
      [aff, flagged[0].commission_amount, [flagged[0].id]])).rejects.toThrow(/review/);
  });
});

describe("the helpers are closed", () => {
  it("the network key, the sign-in networks and the flags are not the client roles'", async () => {
    const [acl] = await q<Record<string, boolean>>(db, `SELECT
      has_function_privilege('anon', 'public.affiliate_network_key(text)', 'EXECUTE') AS anon_key,
      has_function_privilege('authenticated', 'public.affiliate_network_key(text)', 'EXECUTE') AS auth_key,
      has_function_privilege('service_role', 'public.affiliate_network_key(text)', 'EXECUTE') AS svc_key,
      has_table_privilege('anon', 'public.affiliate_sign_in_networks', 'SELECT') AS anon_nets,
      has_table_privilege('authenticated', 'public.affiliate_sign_in_networks', 'SELECT') AS auth_nets`);
    expect(acl).toEqual({ anon_key: false, auth_key: false, svc_key: true, anon_nets: false, auth_nets: false });
  });
});
