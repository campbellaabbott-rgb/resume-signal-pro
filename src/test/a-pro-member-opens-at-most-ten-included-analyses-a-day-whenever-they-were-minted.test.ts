// @vitest-environment node
/**
 * A PRO MEMBER OPENS AT MOST TEN INCLUDED ANALYSES A DAY, AND SIXTY IN THIRTY
 * DAYS, WHENEVER THE GRANTS WERE MINTED (S14X-079, the redemption half).
 *
 * WHAT WAS WRONG. pro_grants_cap (20261112111000) counts grants when they are
 * minted, and an unopened grant stops counting after an hour; a grant stays
 * redeemable until its paid period ends plus a week. Nothing counted
 * redemptions. A member who pressed Full Analysis once a day and opened none
 * held thirty unopened grants by day thirty, and could open all of them, plus
 * ten fresh ones, in one day: forty model runs against the stated ten.
 *
 * WHAT HOLDS NOW (the shipped analyze-resume; the model, Stripe and the
 * database faked): before any model run, the account's redemptions are
 * counted by when they happened (consumed_at). Ten in the last 24 hours, or
 * sixty in the last 30 days, answer 429 with code grant_cap; nothing is run,
 * and the grant stays unspent for a later day. Another account's
 * redemptions do not count, nine still open the tenth, and a count that
 * cannot be read lets the analysis through, as before.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeResumeHarness, RESUME, type Harness } from "./helpers/analyze-resume-harness";

const GRANT = "5f0c2a9e-1b7d-4c3e-9a8f-0d1e2f3a4b5c";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let h: Harness;
beforeAll(async () => { h = await analyzeResumeHarness(); }, 60_000);

beforeEach(() => {
  h.reset();
  h.db.rpcs.pro_entitlement_rows = () => ({ data: [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 20 * DAY).toISOString(), bound: true }], error: null });
  // The grant pressed today was minted five days ago and never opened.
  h.db.rows("pro_grants").push({ id: GRANT, email: "member@example.com", user_id: ACCOUNT, product_type: "full_analysis", consumed_at: null, revoked_at: null, created_at: ago(5 * DAY) });
});

/** `n` grants of `account` opened at the given ages, each minted a day before it was opened. */
const opened = (n: number, account: string, age: (i: number) => number) => {
  for (let i = 0; i < n; i++) {
    h.db.rows("pro_grants").push({
      id: `00000000-0000-4000-8000-${String(i).padStart(4, "0")}${account.slice(0, 8)}`, email: "member@example.com", user_id: account,
      product_type: "full_analysis", consumed_at: ago(age(i)), revoked_at: null, created_at: ago(age(i) + DAY),
    });
  }
};
const redeem = () => h.call({ resumeText: RESUME, sessionId: `pro_${GRANT}` });
const grant = () => h.db.rows("pro_grants").find((g) => g.id === GRANT);

describe("the day's ten", () => {
  it("ten opened in the last 24 hours refuse an eleventh minted days ago: 429 grant_cap, no model run, the grant unspent", async () => {
    opened(10, ACCOUNT, (i) => (i + 1) * HOUR);
    const r = await redeem();
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(429);
    expect(r.json).toMatchObject({ code: "grant_cap", window: "daily" });
    expect(String(r.json.error)).toMatch(/10 .* a day and 60 a month/);
    expect(h.aiCalls(), "a model run past the day's ten").toBe(0);
    expect(grant()?.consumed_at ?? null).toBeNull();
  });

  it("nine opened today still open the tenth", async () => {
    opened(9, ACCOUNT, (i) => (i + 1) * HOUR);
    const r = await redeem();
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    expect(h.aiCalls()).toBeGreaterThan(0);
  });

  it("another account's redemptions do not count", async () => {
    opened(10, OTHER, (i) => (i + 1) * HOUR);
    const r = await redeem();
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
  });
});

describe("the month's sixty", () => {
  it("sixty opened in the last 30 days, two a day, refuse the sixty-first", async () => {
    opened(60, ACCOUNT, (i) => DAY + Math.floor(i / 2) * (DAY * 28 / 30) + (i % 2) * HOUR);
    const r = await redeem();
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(429);
    expect(r.json).toMatchObject({ code: "grant_cap", window: "monthly" });
    expect(h.aiCalls()).toBe(0);
  });

  it("redemptions older than 30 days do not count", async () => {
    opened(60, ACCOUNT, (i) => 31 * DAY + i * HOUR);
    const r = await redeem();
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
  });
});

describe("a count that cannot be read", () => {
  it("lets the analysis through, as before the cap was counted here", async () => {
    opened(10, ACCOUNT, (i) => (i + 1) * HOUR);
    // The read that counts redemptions (the one filtered on consumed_at) fails.
    const db = h.db as unknown as { from: (t: string) => Record<string, unknown>; faults: typeof h.db.faults };
    const from = db.from.bind(h.db);
    db.from = (t: string) => {
      const q = from(t) as Record<string, (...a: unknown[]) => unknown>;
      if (t !== "pro_grants") return q;
      const gt = q.gt.bind(q);
      q.gt = (c: unknown, v: unknown) => {
        if (c === "consumed_at") db.faults.push({ table: "pro_grants", op: "select", error: { code: "57014", message: "canceling statement due to statement timeout" } });
        return gt(c, v);
      };
      return q;
    };
    try {
      const r = await redeem();
      expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    } finally {
      db.from = from;
    }
  });
});
