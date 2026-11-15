// @vitest-environment node
/**
 * A PRO GRANT KEEPS THE MONTH THAT PAID FOR IT (S14X-078).
 *
 * A member presses "Full Analysis" in a paid month, the card then declines
 * (past_due) or the plan is cancelled, and the grant they were handed was
 * refused at redemption: the redeemers asked about the plan's standing NOW
 * (pro-standing.ts's consumables rule), not the month that minted it.
 *
 * create-checkout now stamps pro_grants.redeem_until at mint (the minting
 * period's end plus a week, create-checkout/grant-window.ts, kept out of
 * _shared because every _shared byte counts against job-board's upload). _shared/pro.ts's proGrantRefusal, which every
 * Full Analysis redeemer imports, lets an unrevoked grant naming an account
 * through while that window is open, reading redeem_until by the grant's id
 * when the caller's select did not carry it. A revoked grant, a grant naming
 * no account, and a grant with no window keep today's answers, and
 * pro-standing.ts itself is unchanged.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/edge-harness";
import { loadSharedModule } from "./helpers/shared-module";
import { grantRedeemUntil, mintingPeriodEnd, PRO_GRANT_REDEEM_DAYS } from "../../supabase/functions/create-checkout/grant-window";

type Refusal = { status: number; error: string } | null;
type ProModule = {
  proGrantRefusal: (db: unknown, grant: unknown, now?: number) => Promise<Refusal>;
  grantWindowOpen: (g: unknown, now?: number) => boolean;
};

const USER = "00000000-0000-4000-8000-000000078001";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const iso = (t: number) => new Date(t).toISOString();
const STUBS = { "https://esm.sh/stripe@18.5.0": "export default class Stripe {}" };
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

let pro: ProModule;
beforeAll(async () => { pro = await loadSharedModule<ProModule>("pro.ts", STUBS); }, 120_000);

/** A database whose plan rows and grant rows a case chooses. */
function world(planRows: unknown[] | "down", grants: Record<string, unknown>[] = []) {
  const db = new FakeDb({});
  db.tables.pro_grants = grants.map((g) => ({ ...g }));
  db.rpcs.pro_entitlement_rows = () => planRows === "down" ? { data: null, error: { message: "down" } } : { data: planRows, error: null };
  return db;
}

describe("the window itself (create-checkout/grant-window.ts mints it, _shared/pro.ts reads it)", () => {
  it("is the paid period's end plus a week, read from the active rows only", () => {
    expect(PRO_GRANT_REDEEM_DAYS).toBe(7);
    const rows = [
      { status: "trialing", current_period_end: iso(NOW + 40 * DAY) },
      { status: "active", current_period_end: iso(NOW + 9 * DAY) },
      { status: "active", current_period_end: iso(NOW + 12 * DAY) },
      { status: "past_due", current_period_end: iso(NOW + 30 * DAY) },
    ];
    expect(mintingPeriodEnd(rows)).toBe(iso(NOW + 12 * DAY));
    expect(grantRedeemUntil(mintingPeriodEnd(rows))).toBe(iso(NOW + 19 * DAY));
    expect(mintingPeriodEnd([{ status: "active", current_period_end: null }])).toBeNull();
    expect(mintingPeriodEnd("not rows")).toBeNull();
    expect(grantRedeemUntil(null)).toBeNull();
  });

  it("is open only for an unrevoked grant naming an account, before its end", () => {
    const { grantWindowOpen } = pro;
    const g = { user_id: USER, revoked_at: null, redeem_until: iso(NOW + DAY) };
    expect(grantWindowOpen(g, NOW)).toBe(true);
    expect(grantWindowOpen({ ...g, redeem_until: iso(NOW - 1) }, NOW)).toBe(false);
    expect(grantWindowOpen({ ...g, revoked_at: iso(NOW - DAY) }, NOW)).toBe(false);
    expect(grantWindowOpen({ ...g, user_id: null }, NOW)).toBe(false);
    expect(grantWindowOpen({ ...g, redeem_until: null }, NOW)).toBe(false);
    expect(grantWindowOpen(null, NOW)).toBe(false);
  });
});

describe("the redeemers' rule (_shared/pro.ts proGrantRefusal)", () => {
  const open = { user_id: USER, revoked_at: null, redeem_until: iso(NOW + 5 * DAY) };

  it("an unrevoked grant inside its window is redeemable while the plan is past_due", async () => {
    const db = world([{ tier: "pro", status: "past_due", current_period_end: iso(NOW - 2 * DAY), bound: true }]);
    expect(await pro.proGrantRefusal(db, open, NOW)).toBeNull();
  });

  it("and while the plan is cancelled, or cannot be read just now", async () => {
    expect(await pro.proGrantRefusal(world([]), open, NOW)).toBeNull();
    expect(await pro.proGrantRefusal(world("down"), open, NOW)).toBeNull();
  });

  it("a revoked grant is refused inside its window", async () => {
    const r = await pro.proGrantRefusal(world([]), { ...open, revoked_at: iso(NOW - DAY) }, NOW);
    expect(r).toMatchObject({ status: 402 });
    expect(r?.error).toMatch(/refunded/);
  });

  it("a grant naming no account is refused inside its window", async () => {
    expect(await pro.proGrantRefusal(world([]), { ...open, user_id: null }, NOW)).toMatchObject({ status: 402 });
  });

  it("a grant with no window follows today's rule", async () => {
    const lapsed = world([{ tier: "pro", status: "past_due", current_period_end: iso(NOW - 2 * DAY), bound: true }]);
    expect(await pro.proGrantRefusal(lapsed, { user_id: USER, revoked_at: null }, NOW)).toEqual({ status: 402, error: "Subscription is not active" });
    expect(await pro.proGrantRefusal(lapsed, { ...open, redeem_until: iso(NOW - 1) }, NOW)).toEqual({ status: 402, error: "Subscription is not active" });
    const paid = world([{ tier: "pro", status: "active", current_period_end: iso(NOW + 9 * DAY), bound: true }]);
    expect(await pro.proGrantRefusal(paid, { user_id: USER, revoked_at: null }, NOW)).toBeNull();
  });

  it("a caller whose select lacks the column has redeem_until read by the grant's id", async () => {
    const id = "00000000-0000-4000-8000-0000000780aa";
    const db = world([], [{ id, user_id: USER, redeem_until: iso(NOW + DAY) }]);
    expect(await pro.proGrantRefusal(db, { id, user_id: USER, revoked_at: null }, NOW)).toBeNull();
    const before = world([], [{ id, user_id: USER }]);
    expect(await pro.proGrantRefusal(before, { id, user_id: USER, revoked_at: null }, NOW)).toEqual({ status: 402, error: "Subscription is not active" });
  });

  it("a database without the column (before the migration) keeps today's refusal", async () => {
    const id = "00000000-0000-4000-8000-0000000780bb";
    const db = world([], [{ id, user_id: USER }]);
    db.faults.push({ table: "pro_grants", op: "select", error: { code: "42703", message: "column pro_grants.redeem_until does not exist" } });
    expect(await pro.proGrantRefusal(db, { id, user_id: USER, revoked_at: null }, NOW)).toEqual({ status: 402, error: "Subscription is not active" });
  });
});

describe("where it is wired", () => {
  it("the Full Analysis redeemers take the rule from pro.ts and carry the grant's id", () => {
    for (const fn of ["analyze-resume", "verify-product-purchase"]) {
      expect(read(`supabase/functions/${fn}/index.ts`)).toMatch(/import \{[^}]*\bproGrantRefusal\b[^}]*\} from "\.\.\/_shared\/pro\.ts"/);
    }
    expect(read("supabase/functions/analyze-resume/index.ts")).toMatch(/\.from\('pro_grants'\)\s*\.select\('id, /);
    expect(read("supabase/functions/verify-product-purchase/index.ts")).toMatch(/\.from\("pro_grants"\)\s*\.select\("\*"\)/);
  });
});
