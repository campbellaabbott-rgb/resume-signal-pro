// @vitest-environment node
/**
 * A PLAN READ THAT STARTED BEFORE A NEWER WRITE LOSES TO IT (S14X-080), AND
 * EVERY REFRESH CARRIES THE CANCEL FLAG WITH THE ROW (S14X-211).
 *
 * checkProByEmail (_shared/pro.ts) asked Stripe, then upserted what it read.
 * A member's /account load that read "active" just before the webhook wrote
 * "canceled" overwrote the newer row with the older snapshot, and the cache
 * said Pro until the next refresh. It now notes when its read began, updates
 * only a row older than that, and inserts only where no row exists (a 23505
 * means a newer write got there first).
 *
 * The same write never carried cancel_at_period_end, so a plan cancelled in
 * Stripe's emailed portal left an UNBOUND row (one check-subscription's
 * per-account refresh never reaches) saying "Renews" while the webhook's
 * refresh -- which is this function -- ran. The flag is now its own write
 * after the row lands, as writeCustomerPlan does, so a database without the
 * column still takes the status.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/edge-harness";
import { loadSharedModule } from "./helpers/shared-module";

type ProStatus = { active: boolean; status: string; stripeCustomerId: string | null };
type ProModule = { checkProByEmail: (stripe: unknown, db: unknown, email: string, opts?: Record<string, unknown>) => Promise<ProStatus> };

const EMAIL = "member@example.com";
const DAY = 86_400_000;
const periodEnd = Math.floor((Date.now() + 9 * DAY) / 1000);
const STUBS = { "https://esm.sh/stripe@18.5.0": "export default class Stripe {}" };
const ROOT = resolve(__dirname, "../..");

let pro: ProModule;
beforeAll(async () => { pro = await loadSharedModule<ProModule>("pro.ts", STUBS); }, 120_000);

/** A Stripe that lists one customer for the address with these subscriptions; `during` runs while the subscriptions are being read. */
function stripeWith(subs: Record<string, unknown>[], during?: () => void) {
  return {
    customers: { list: async () => ({ data: [{ id: "cus_m" }], has_more: false }) },
    subscriptions: { list: async () => { during?.(); return { data: subs, has_more: false }; } },
  };
}
const live = (extra: Record<string, unknown> = {}) => ({ id: "sub_m", status: "active", current_period_end: periodEnd, items: { data: [] }, ...extra });

describe("a newer row wins (S14X-080)", () => {
  it("a row the webhook set to canceled after the read began keeps canceled when the stale active snapshot is written", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    db.rows("pro_subscribers").push({ email: EMAIL, stripe_customer_id: "cus_m", status: "active", updated_at: new Date(Date.now() - DAY).toISOString() });
    const webhookWrites = () => Object.assign(db.rows("pro_subscribers")[0], { status: "canceled", current_period_end: null, updated_at: new Date(Date.now() + 60_000).toISOString() });
    const answer = await pro.checkProByEmail(stripeWith([live()], webhookWrites), db, EMAIL);
    expect(answer.active).toBe(true);
    expect(db.rows("pro_subscribers")).toHaveLength(1);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "canceled", current_period_end: null });
  });

  it("a row older than the read is updated, and no second row is inserted", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    db.rows("pro_subscribers").push({ email: EMAIL, stripe_customer_id: null, status: "inactive", updated_at: new Date(Date.now() - DAY).toISOString() });
    await pro.checkProByEmail(stripeWith([live()]), db, EMAIL);
    expect(db.rows("pro_subscribers")).toHaveLength(1);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "active", stripe_customer_id: "cus_m", current_period_end: new Date(periodEnd * 1000).toISOString() });
    expect(db.writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it("an address with no row gets one", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    await pro.checkProByEmail(stripeWith([live()]), db, EMAIL);
    expect(db.rows("pro_subscribers")).toHaveLength(1);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ email: EMAIL, status: "active", stripe_customer_id: "cus_m" });
  });
});

describe("the cancel flag rides with the row (S14X-211)", () => {
  it("a plan set to cancel in the portal sets an unbound row's flag", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    db.rows("pro_subscribers").push({ email: EMAIL, stripe_customer_id: "cus_m", status: "active", cancel_at_period_end: false, updated_at: new Date(Date.now() - DAY).toISOString() });
    await pro.checkProByEmail(stripeWith([live({ cancel_at_period_end: true })]), db, EMAIL);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(db.rows("pro_subscribers")[0].user_id).toBeUndefined();
  });

  it("a plan resumed in the portal clears it, and a lapsed plan never keeps it", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    db.rows("pro_subscribers").push({ email: EMAIL, stripe_customer_id: "cus_m", status: "active", cancel_at_period_end: true, updated_at: new Date(Date.now() - DAY).toISOString() });
    await pro.checkProByEmail(stripeWith([live({ cancel_at_period_end: false })]), db, EMAIL);
    expect(db.rows("pro_subscribers")[0].cancel_at_period_end).toBe(false);
    db.rows("pro_subscribers")[0].cancel_at_period_end = true;
    db.rows("pro_subscribers")[0].updated_at = new Date(Date.now() - DAY).toISOString();
    await pro.checkProByEmail(stripeWith([live({ status: "past_due", cancel_at_period_end: true })]), db, EMAIL);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "past_due", cancel_at_period_end: false });
  });

  it("a row a newer write kept is not given this read's flag", async () => {
    const db = new FakeDb({ pro_subscribers: ["email"] });
    db.rows("pro_subscribers").push({ email: EMAIL, stripe_customer_id: "cus_m", status: "active", cancel_at_period_end: false, updated_at: new Date(Date.now() + 60_000).toISOString() });
    await pro.checkProByEmail(stripeWith([live({ cancel_at_period_end: true })]), db, EMAIL);
    expect(db.rows("pro_subscribers")[0].cancel_at_period_end).toBe(false);
  });

  it("the webhook's subscription refresh is this function, and the cached answer reads the flag", () => {
    const webhook = readFileSync(resolve(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");
    expect(webhook).toMatch(/await checkProByEmail\(stripe, supabase, email\)/);
    const check = readFileSync(resolve(ROOT, "supabase/functions/check-subscription/index.ts"), "utf8");
    expect(check).toMatch(/cancelAtPeriodEnd: live && row\.cancel_at_period_end === true/);
  });
});
