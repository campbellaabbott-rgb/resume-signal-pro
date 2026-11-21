// @vitest-environment node
/**
 * A COMMISSION IS APPROVED ONLY AFTER ITS HOLD, WITH NO REFUND OR FLAG
 * (S14X-085, the owner-gated half: the proposed default rule).
 *
 * WHAT WAS WRONG. A referred sale is recorded as a pending conversion and
 * nothing ever approved one, so a payout request (approved conversions only)
 * could never reach the minimum by the program's own steps.
 *
 * WHAT HOLDS NOW (pglite, the affiliate files on main and then this round's,
 * twice, from Supabase's default grants, with a pg_cron stand-in):
 *   - a clean commission 31 days old becomes approved, with approved_at;
 *   - one whose checkout session was refunded or disputed is never approved:
 *     rejected by main's trigger when the revocation comes after it, and
 *     left pending here when the revocation row was there first;
 *   - one held for review, one whose affiliate has not proven the address,
 *     one whose affiliate is paused, and one 29 days old stay pending;
 *   - a hold outside 14..365 days is refused;
 *   - the daily job runs it with its statement_timeout SET in the command;
 *   - anon and authenticated cannot run it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootAffiliateDb, one, q } from "./helpers/affiliate-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let db: PGlite;
let proven = "";
let unproven = "";
let paused = "";

const affiliate = async (email: string, opts: { confirmed: boolean; status?: string }) =>
  (await one<{ id: string }>(db,
    `INSERT INTO public.affiliates (email, password_hash, status, email_confirmed_at)
     VALUES ($1, 'x', $2, CASE WHEN $3 THEN now() ELSE NULL END) RETURNING id`,
    [email, opts.status ?? "active", opts.confirmed])).id;

const sale = async (aff: string, session: string, daysAgo: number, flags: string[] = []) => {
  await q(db,
    `INSERT INTO public.affiliate_conversions (affiliate_id, stripe_session_id, sale_amount, commission_amount, status, review_flags, created_at)
     VALUES ($1, $2, 4500, 1500, 'pending', $3, now() - make_interval(days => $4))`,
    [aff, session, flags, daysAgo]);
};

const statusOf = async (session: string) =>
  one<{ status: string; approved_at: string | null }>(db,
    "SELECT status, approved_at FROM public.affiliate_conversions WHERE stripe_session_id = $1", [session]);

beforeAll(async () => {
  db = await bootAffiliateDb({ round: true, cron: true });
  proven = await affiliate("proven@example.com", { confirmed: true });
  unproven = await affiliate("unproven@example.com", { confirmed: false });
  paused = await affiliate("paused@example.com", { confirmed: true, status: "paused" });
  await sale(proven, "cs_hold_clean", 31);
  await sale(proven, "cs_hold_refunded", 31);
  await q(db, "INSERT INTO public.payment_revocations (payment_intent_id, reason, stripe_session_id) VALUES ('pi_hold_refunded', 'refunded', 'cs_hold_refunded')");
  // A revocation recorded before the conversion row: main's trigger never sees it.
  await q(db, "INSERT INTO public.payment_revocations (payment_intent_id, reason, stripe_session_id) VALUES ('pi_hold_first', 'disputed', 'cs_hold_revoked_first')");
  await sale(proven, "cs_hold_revoked_first", 31);
  await sale(proven, "cs_hold_flagged", 31, ["affiliate-network"]);
  await sale(proven, "cs_hold_young", 29);
  await sale(unproven, "cs_hold_unproven", 31);
  await sale(paused, "cs_hold_paused", 31);
}, 180_000);
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the daily approval", () => {
  it("approves a clean commission held thirty days, and only that one", async () => {
    const [{ n }] = await q<{ n: number }>(db, "SELECT public.affiliate_approve_held_commissions(30) AS n");
    expect(n).toBe(1);
    const clean = await statusOf("cs_hold_clean");
    expect(clean.status).toBe("approved");
    expect(clean.approved_at).not.toBeNull();
  });

  it("never approves a refunded or disputed commission", async () => {
    expect(await statusOf("cs_hold_refunded")).toEqual({ status: "rejected", approved_at: null });
    expect(await statusOf("cs_hold_revoked_first")).toEqual({ status: "pending", approved_at: null });
  });

  it("leaves a flagged, a young, an unproven and a paused affiliate's commission pending", async () => {
    for (const s of ["cs_hold_flagged", "cs_hold_young", "cs_hold_unproven", "cs_hold_paused"]) {
      const r = await statusOf(s);
      expect({ s, status: r.status, approved_at: r.approved_at }).toEqual({ s, status: "pending", approved_at: null });
    }
  });

  it("a second run approves nothing more", async () => {
    const [{ n }] = await q<{ n: number }>(db, "SELECT public.affiliate_approve_held_commissions(30) AS n");
    expect(n).toBe(0);
  });

  it("refuses a hold shorter than fourteen days", async () => {
    await expect(q(db, "SELECT public.affiliate_approve_held_commissions(3)")).rejects.toThrow(/outside 14\.\.365/);
  });

  it("runs daily from pg_cron with its statement_timeout set in the command", async () => {
    const job = await one<{ schedule: string; command: string }>(db,
      "SELECT schedule, command FROM cron.job WHERE jobname = 'affiliate-commission-approval'");
    expect(job.schedule).toBe("47 4 * * *");
    expect(job.command).toMatch(/^SET statement_timeout = '2min'; SELECT public\.affiliate_approve_held_commissions\(30\);$/);
  });

  it("refuses anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      const [{ can }] = await q<{ can: boolean }>(db,
        "SELECT has_function_privilege($1, 'public.affiliate_approve_held_commissions(integer)', 'EXECUTE') AS can", [role]);
      expect({ role, can }).toEqual({ role, can: false });
    }
  });
});
