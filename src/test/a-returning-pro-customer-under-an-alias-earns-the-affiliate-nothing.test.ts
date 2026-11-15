// @vitest-environment node
/**
 * A RETURNING PRO CUSTOMER UNDER AN ALIAS EARNS THE AFFILIATE NOTHING (S14X-226).
 *
 * WHAT WAS WRONG. An affiliate earns once per customer: on the first paid Pro
 * month. record_affiliate_conversion asked whether the customer had paid for
 * Pro before by comparing lower(btrim(address)), so a customer who bought Pro
 * as jane@gmail.com, cancelled, and came back through a link as
 * j.a.n.e+2@googlemail.com read as new and paid the affiliate again, though
 * Gmail delivers both to one mailbox. The self-referral rule already compared
 * mailboxes (affiliate_address_key, 20261103100000); this one did not.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's):
 *   - the returning-customer test compares affiliate_address_key, in one
 *     service-role helper the verifier can probe;
 *   - the alias records 0; a stranger still records the $10; the account
 *     branch (checkout_buyers.user_id) still holds;
 *   - record_affiliate_conversion is still one overload, and neither function
 *     is callable by a client role.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
beforeAll(async () => {
  db = await bootAffiliateDb({ round: true });
  await q(db, "INSERT INTO public.affiliates (email, password_hash, referral_code, email_confirmed_at) VALUES ('affiliate@example.com', 'x', 'aliasref', now())");
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const paidBefore = async (session: string, email: string, daysAgo: number, user: string | null = null) => {
  if (user) {
    await q(db, "INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING", [user]);
    await q(db, "INSERT INTO public.checkout_buyers (stripe_session_id, user_id, checkout_function, product_type) VALUES ($1, $2, 'create-subscription-checkout', 'pro_subscription')", [session, user]);
  }
  await q(db, "INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at) VALUES ($1, 'pro_subscription', $2, 'delivered', now() - make_interval(days => $3))",
    [session, email, daysAgo]);
};
const sale = async (session: string, email: string, user: string | null = null) => {
  await paidBefore(session, email, 0, user);
  await q(db, "SELECT public.record_affiliate_conversion('aliasref', $1, 4500, 'Pro', 1000)", [session]);
  return (await one<{ c: number }>(db, "SELECT commission_amount AS c FROM public.affiliate_conversions WHERE stripe_session_id = $1", [session])).c;
};

describe("a customer who paid for Pro before earns nothing under any alias of their mailbox", () => {
  it("Pro as jane@gmail.com, then again as j.a.n.e+2@googlemail.com with a code, records 0", async () => {
    await paidBefore("cs_test_jane_first", "jane@gmail.com", 60);
    expect(await sale("cs_test_jane_again", "j.a.n.e+2@googlemail.com"), "a returning customer paid the affiliate twice").toBe(0);
  });

  it("a + tag outside Gmail is the same mailbox too", async () => {
    await paidBefore("cs_test_bob_first", "bob@outlook.com", 40);
    expect(await sale("cs_test_bob_again", "Bob+again@Outlook.com ")).toBe(0);
  });

  it("a stranger still earns the $10", async () => {
    expect(await sale("cs_test_stranger", "new.person@example.org")).toBe(1000);
  });

  it("the same account under a new address is still a returning customer", async () => {
    const user = "00000000-0000-4000-8000-0000000000aa";
    await paidBefore("cs_test_acct_first", "first@example.org", 50, user);
    expect(await sale("cs_test_acct_again", "different@example.org", user)).toBe(0);
  });

  it("the helper says the same, and reads only Pro bought BEFORE this checkout", async () => {
    const ask = async (session: string, email: string, before: string) =>
      (await one<{ r: boolean }>(db, "SELECT public.affiliate_returning_pro_customer($1, $2, NULL, $3::timestamptz) AS r", [session, email, before])).r;
    expect(await ask("cs_x", "JANE+zzz@gmail.com", new Date().toISOString())).toBe(true);
    expect(await ask("cs_x", "jane@gmail.com", new Date(Date.now() - 90 * 864e5).toISOString())).toBe(false);
    expect(await ask("cs_x", "nobody@example.org", new Date().toISOString())).toBe(false);
  });
});

describe("both functions stay closed", () => {
  it("record_affiliate_conversion is one overload; neither it nor the helper is callable by a client role", async () => {
    const rows = await q<{ proname: string; a: boolean; u: boolean; s: boolean }>(db, `SELECT p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
       FROM pg_proc p WHERE p.proname IN ('record_affiliate_conversion', 'affiliate_returning_pro_customer') ORDER BY p.proname`);
    expect(rows.map((r) => r.proname)).toEqual(["affiliate_returning_pro_customer", "record_affiliate_conversion"]);
    for (const r of rows) expect(r).toMatchObject({ a: false, u: false, s: true });
  });
});
