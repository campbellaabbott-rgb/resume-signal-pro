// @vitest-environment node
/**
 * THE AFFILIATE DASHBOARD ANSWERS EACH RANGE, WHAT AWAITS APPROVAL, AND EACH
 * PAYOUT REQUEST (S14X-085, S14X-116, S14X-212: the server's half).
 *
 * WHAT WAS WRONG. get_affiliate_dashboard answered all-time totals only, so
 * the page's "Last 7 days" selector changed the click chart and nothing else.
 * It counted only APPROVED commission as pending, and nothing approves one
 * yet, so a fresh $10 sale showed nowhere. And it said nothing of payout
 * requests, so the page drew a made-up "Initial Payout" row and forgot an open
 * request on reload.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's;
 * the same signature, so no client-callable function changes):
 *   - stats_by_range holds the selector's four ranges (7, 30, 90, 365 days):
 *     clicks, conversions, earning conversions, commission and revenue per
 *     currency, each counting only its range;
 *   - awaiting_approval sums commission that is earned but not yet payable
 *     (pending, or approved and still flagged for review);
 *   - payout_requests lists the requests the server holds, newest first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, fromAddress, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Range = { clicks: number; conversions: number; earning_conversions: number; commission: number; revenue_by_currency: Record<string, number> };
type Dash = {
  affiliate: { email_confirmed: boolean };
  stats: { awaiting_approval: number; awaiting_approval_count: number; pending_payout: number };
  stats_by_range: Record<string, Range>;
  payout_requests: Array<{ status: string; amount_cents: number; requested_at: string; resolved_at: string | null }>;
};

let db: PGlite;
let token = "";
let aff = "";
const dash = async () => (await one<{ j: Dash }>(db, "SELECT public.get_affiliate_dashboard($1) AS j", [token])).j;

beforeAll(async () => {
  db = await bootAffiliateDb({ round: true });
  await fromAddress(db, "203.0.113.5");
  await q(db, "SELECT public.register_affiliate('ranges@example.com', 'correct horse 1')");
  token = String((await one<{ j: { session_token: string } }>(db, "SELECT public.login_affiliate('ranges@example.com', 'correct horse 1') AS j")).j.session_token);
  aff = (await one<{ id: string }>(db, "SELECT id FROM public.affiliates WHERE email = 'ranges@example.com'")).id;
  const conv = (s: string, days: number, cents: number, comm: number, status: string, cur: string) => q(db,
    `INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status, currency, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(days => $7))`, [aff, s, cents, comm, status, cur, days]);
  await conv("cs_3d", 3, 4500, 1000, "pending", "usd");
  await conv("cs_20d", 20, 42250, 1000, "pending", "inr");
  await conv("cs_60d", 60, 4500, 0, "pending", "usd");
  await conv("cs_200d", 200, 4500, 1000, "paid", "usd");
  await conv("cs_rejected", 2, 4500, 1000, "rejected", "usd");
  for (const d of [1, 1, 10, 45, 120]) {
    await q(db, "INSERT INTO public.affiliate_clicks (affiliate_id, created_at) VALUES ($1, now() - make_interval(days => $2))", [aff, d]);
  }
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("each of the selector's ranges counts only itself", () => {
  it("7, 30, 90 and 365 days", async () => {
    const r = (await dash()).stats_by_range;
    expect(Object.keys(r).sort()).toEqual(["30", "365", "7", "90"]);
    expect(r["7"]).toEqual({ clicks: 2, conversions: 1, earning_conversions: 1, commission: 1000, revenue_by_currency: { usd: 4500 } });
    expect(r["30"]).toEqual({ clicks: 3, conversions: 2, earning_conversions: 2, commission: 2000, revenue_by_currency: { inr: 42250, usd: 4500 } });
    expect(r["90"]).toMatchObject({ clicks: 4, conversions: 3, earning_conversions: 2, commission: 2000 });
    expect(r["365"]).toMatchObject({ clicks: 5, conversions: 4, earning_conversions: 3, commission: 3000, revenue_by_currency: { inr: 42250, usd: 13500 } });
  });
});

describe("commission awaiting approval is shown, not hidden", () => {
  it("a fresh pending $10 sale is awaiting approval while nothing is payable yet", async () => {
    const d = await dash();
    expect(d.stats.awaiting_approval).toBe(2000);
    expect(d.stats.awaiting_approval_count).toBe(2);
    expect(d.stats.pending_payout).toBe(0);
    expect(d.affiliate.email_confirmed).toBe(false);
  });
});

describe("the payout requests the server holds", () => {
  it("are listed newest first with their status, amount and dates", async () => {
    // A request needs a proven address (20261112122000 refuses it otherwise).
    await q(db, "UPDATE public.affiliates SET email_confirmed_at = now() WHERE id = $1", [aff]);
    const [{ id: c }] = await q<{ id: string }>(db,
      `INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status, currency)
       VALUES ($1, 'cs_approved', 4500, 3000, 'approved', 'usd') RETURNING id`, [aff]);
    await q(db, "INSERT INTO public.affiliate_payout_requests (affiliate_id, amount_cents, conversion_ids) VALUES ($1, 3000, $2)", [aff, [c]]);
    const d = await dash();
    expect(d.payout_requests).toHaveLength(1);
    expect(d.payout_requests[0]).toMatchObject({ status: "requested", amount_cents: 3000, resolved_at: null });
    expect(Date.parse(d.payout_requests[0].requested_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.stringify(d.payout_requests), "a request names its conversions to the owner, not to the page").not.toContain(c);
  });
});
