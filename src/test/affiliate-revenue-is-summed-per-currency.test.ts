// @vitest-environment node
/**
 * AFFILIATE REVENUE IS SUMMED PER CURRENCY (S14X-227).
 *
 * WHAT WAS WRONG. affiliate_conversions.sale_amount is in the currency the
 * buyer paid in, and nothing recorded which. The dashboard summed every sale
 * as one number and the page printed it as dollars: a ₹422.50 sale and a
 * $45.00 sale showed as "$467.50".
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's):
 *   - a conversion records its currency from the checkout's delivery row
 *     (product_deliveries.metadata.currency, which stripe-webhook writes
 *     before it records the conversion), by trigger, and rows already there
 *     were back-filled;
 *   - the dashboard answers revenue_by_currency, one total per currency, with
 *     a sale whose currency was never recorded under 'unknown', never folded
 *     into dollars.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyRound, bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
let token = "";
const sale = async (session: string, email: string, cents: number, currency: string | null) => {
  await q(db, "INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, metadata) VALUES ($1, 'pro_subscription', $2, 'delivered', $3::jsonb)",
    [session, email, currency === null ? null : JSON.stringify({ currency })]);
  await q(db, "SELECT public.record_affiliate_conversion('curref', $1, $2, 'Pro', 1000)", [session, cents]);
};

beforeAll(async () => {
  db = await bootAffiliateDb();
  await fromAddress(db, "203.0.113.5");
  await q(db, "SELECT public.register_affiliate('money@example.com', 'correct horse 1')");
  await q(db, "UPDATE public.affiliates SET referral_code = 'curref' WHERE email = 'money@example.com'");
  // A sale recorded before this round: back-filled from its delivery row.
  await sale("cs_test_before", "before@example.org", 3900, "eur");
  await applyRound(db);
  await fromAddress(db, "203.0.113.5");
  token = String((await one<{ j: { session_token: string } }>(db, "SELECT public.login_affiliate('money@example.com', 'correct horse 1') AS j")).j.session_token);
  await sale("cs_test_inr", "a@example.org", 42250, "INR");
  await sale("cs_test_usd", "b@example.org", 4500, "usd");
  await sale("cs_test_none", "c@example.org", 2900, null);
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("each conversion knows its currency", () => {
  it("from the delivery row, lower-cased, by trigger; back-filled for rows already there; NULL when none was recorded", async () => {
    const rows = await q<{ s: string; currency: string | null }>(db, "SELECT stripe_session_id AS s, currency FROM public.affiliate_conversions ORDER BY s");
    expect(Object.fromEntries(rows.map((r) => [r.s, r.currency]))).toEqual({
      cs_test_before: "eur", cs_test_inr: "inr", cs_test_none: null, cs_test_usd: "usd",
    });
  });

  it("refuses a currency that is not three letters", async () => {
    const [{ id }] = await q<{ id: string }>(db, "SELECT id FROM public.affiliates WHERE referral_code = 'curref'");
    await expect(q(db, "INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, currency) VALUES ($1, 'cs_bad', 1, 0, 'dollars')", [id])).rejects.toThrow();
  });
});

describe("the dashboard sums each currency apart", () => {
  it("an INR 42250 and a USD 4500 sale give {inr: 42250, usd: 4500}, not 46750", async () => {
    const d = (await one<{ j: { stats: { revenue_by_currency: Record<string, number>; total_revenue: number } } }>(db,
      "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j;
    expect(d.stats.revenue_by_currency).toEqual({ eur: 3900, inr: 42250, usd: 4500, unknown: 2900 });
  });

  it("each recent conversion names its currency", async () => {
    const d = (await one<{ j: { recent_conversions: Array<{ sale_amount: number; currency: string | null }> } }>(db,
      "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j;
    expect(d.recent_conversions.find((c) => c.sale_amount === 42250)?.currency).toBe("inr");
  });
});
