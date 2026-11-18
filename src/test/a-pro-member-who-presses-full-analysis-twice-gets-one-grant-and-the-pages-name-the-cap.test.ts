// @vitest-environment node
/**
 * A PRO MEMBER WHO PRESSES "FULL ANALYSIS" TWICE GETS ONE GRANT, AND THE
 * PAGES NAME THE CAP (S14X-079), AND THE GRANT CARRIES THE MONTH THAT PAID
 * FOR IT (S14X-078).
 *
 * WHAT WAS WRONG. create-checkout minted a new pro_grants row on every
 * press, so a reload or a second tab used one of the day's ten (pro_grants_cap
 * counted every row) and no page said there were ten: Pro's perks and the
 * limits table said "Included" with no number. Now:
 *   - the member's newest unopened, unrevoked Full Analysis grant of the last
 *     day is handed back, carrying the new résumé, instead of a new one;
 *   - a new grant is stamped redeem_until (the paid period's end plus a
 *     week), and a database without the column takes it without;
 *   - 10 and 60 live in one place (_shared/pro-perks.ts PRO_GRANTS_PER_DAY,
 *     PRO_GRANTS_PER_MONTH), and the SQL cap, the fair-use answer, the Pro
 *     perk line in nine languages, Stripe's description and the limits table
 *     are pinned to them here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { fairUseAnswer } from "../../supabase/functions/_shared/checkout-buyer";
import { PRO_GRANTS_PER_DAY, PRO_GRANTS_PER_MONTH, PRO_PERK_ITEMS, proStripeDescription } from "../../supabase/functions/_shared/pro-perks";
import { INCLUDED_FULL_ANALYSIS_KEYS, visibleProPerks } from "@/components/pricing/pro-perks-mirror";
import { proPerksOnSale } from "@/config/pro-perks";
import { limitGroups } from "@/components/pricing/limit-groups";

const MEMBER = { id: "00000000-0000-4000-8000-00000007900a", email: "member@example.com" };
const OTHER = { id: "00000000-0000-4000-8000-00000007900b", email: "other@example.com" };
const DAY = 86_400_000;
const PERIOD_END = new Date(Date.now() + 20 * DAY).toISOString();
const R1 = "00000000-0000-4000-8000-0000000000a1";
const R2 = "00000000-0000-4000-8000-0000000000a2";
const ROOT = resolve(__dirname, "../..");
const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const CAP_KEY = "payments.perks.fullAnalysisCap";
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno();
  h = await loadCheckouts(["create-checkout"]);
}, 240_000);
beforeEach(() => {
  world = freshWorld({ "jwt-member": MEMBER, "jwt-other": OTHER });
  world.db.rpcs.pro_entitlement_rows = (a) => ({
    data: a.p_user_id === MEMBER.id || a.p_user_id === OTHER.id ? [{ tier: "pro", status: "active", current_period_end: PERIOD_END, bound: true }] : [],
    error: null,
  });
});

const press = async (bearer = "jwt-member", tempSessionId = R1) => {
  const res = await post(h["create-checkout"], "create-checkout", { currency: "usd", tempSessionId }, { bearer });
  return { status: res.status, body: await res.json() as { sessionId?: string; proIncluded?: boolean } };
};
const grants = () => world.db.rows("pro_grants");

describe("one open grant a day (S14X-079)", () => {
  it("two presses in a day return the same pro_<id>, the second carrying the new résumé", async () => {
    const a = await press("jwt-member", R1);
    const b = await press("jwt-member", R2);
    expect(a.body.proIncluded).toBe(true);
    expect(b.body.sessionId).toBe(a.body.sessionId);
    expect(grants()).toHaveLength(1);
    expect(grants()[0].resume_session_id).toBe(R2);
    expect(world.stripe.created).toEqual([]);
  });

  it("a redeemed, a revoked or a day-old grant is not handed back: the press mints a new one", async () => {
    for (const spent of [{ consumed_at: new Date().toISOString() }, { revoked_at: new Date().toISOString() }, { created_at: new Date(Date.now() - 2 * DAY).toISOString() }]) {
      world.db.tables.pro_grants = [];
      const a = await press();
      Object.assign(grants()[0], spent);
      const b = await press();
      expect(b.body.sessionId).not.toBe(a.body.sessionId);
      expect(grants()).toHaveLength(2);
    }
  });

  it("another account's open grant is never handed back", async () => {
    const a = await press("jwt-other");
    const b = await press("jwt-member");
    expect(b.body.sessionId).not.toBe(a.body.sessionId);
    expect(grants().map((g) => g.user_id).sort()).toEqual([MEMBER.id, OTHER.id].sort());
  });
});

describe("the grant carries the month that paid for it (S14X-078)", () => {
  it("a new grant is stamped with the paid period's end plus a week", async () => {
    await press();
    expect(grants()[0].redeem_until).toBe(new Date(Date.parse(PERIOD_END) + 7 * DAY).toISOString());
  });

  it("a database without the column (before 20261112110000) takes the grant without it", async () => {
    world.db.faults.push({ table: "pro_grants", op: "insert", error: { code: "PGRST204", message: "Could not find the 'redeem_until' column of 'pro_grants' in the schema cache" } });
    const r = await press();
    expect(r.status).toBe(200);
    expect(r.body.proIncluded).toBe(true);
    expect(grants()).toHaveLength(1);
    expect(grants()[0]).not.toHaveProperty("redeem_until");
  });

  it("any other failed mint is still a retry, never a second insert or a charge", async () => {
    world.db.faults.push({ table: "pro_grants", op: "insert", error: { code: "XX000", message: "boom" } });
    const r = await press();
    expect(r.status).toBe(503);
    expect(grants()).toEqual([]);
    expect(world.stripe.created).toEqual([]);
  });
});

describe("10 and 60 are one fact (S14X-079)", () => {
  it("the latest pro_grants_cap in the migrations refuses at the constants", () => {
    expect([PRO_GRANTS_PER_DAY, PRO_GRANTS_PER_MONTH]).toEqual([10, 60]);
    const dir = resolve(ROOT, "supabase/migrations");
    const latest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /CREATE OR REPLACE FUNCTION public\.pro_grants_cap\(\)/.test(readFileSync(resolve(dir, f), "utf8"))).at(-1)!;
    const sql = readFileSync(resolve(dir, latest), "utf8");
    expect(latest).toMatch(/^20261112111000_/);
    expect(sql).toContain(`IF v_day >= ${PRO_GRANTS_PER_DAY} THEN`);
    expect(sql).toContain(`IF v_month >= ${PRO_GRANTS_PER_MONTH} THEN`);
  });

  it("the fair-use answer says the same numbers, unchanged", () => {
    expect(fairUseAnswer("daily").body.error).toBe(`Pro includes up to ${PRO_GRANTS_PER_DAY} of these a day and ${PRO_GRANTS_PER_MONTH} a month, and you've reached today's ${PRO_GRANTS_PER_DAY}. Nothing was charged; it opens again tomorrow.`);
    expect(fairUseAnswer("monthly").body.error).toBe(`Pro includes up to ${PRO_GRANTS_PER_DAY} of these a day and ${PRO_GRANTS_PER_MONTH} a month, and you've reached the ${PRO_GRANTS_PER_MONTH} for the last 30 days. Nothing was charged.`);
  });

  it("Pro's perks name the cap right after the included Full Analysis, and Stripe's description says it", () => {
    const keys = PRO_PERK_ITEMS.map((p) => p.key);
    expect(keys.indexOf(CAP_KEY)).toBe(keys.indexOf("proPlan.perks.fullAnalysisIncluded") + 1);
    expect(PRO_PERK_ITEMS.find((p) => p.key === CAP_KEY)?.text).toBe(`Up to ${PRO_GRANTS_PER_DAY} Full Analyses a day and ${PRO_GRANTS_PER_MONTH} a month`);
    expect(proStripeDescription()).toContain(`The $5 Full Analysis included. Up to ${PRO_GRANTS_PER_DAY} Full Analyses a day and ${PRO_GRANTS_PER_MONTH} a month.`);
  });

  it("every language's cap line carries both numbers, and the English one is the list's text", () => {
    for (const l of LNGS) {
      const line = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/payments/${l}.json`), "utf8")).payments.perks.fullAnalysisCap as string;
      expect(line, l).toContain(String(PRO_GRANTS_PER_DAY));
      expect(line, l).toContain(String(PRO_GRANTS_PER_MONTH));
      if (l === "en") expect(line).toBe(PRO_PERK_ITEMS.find((p) => p.key === CAP_KEY)?.text);
    }
  });

  it("the cap line hides with the included Full Analysis while it is off sale (gate G2)", () => {
    expect(INCLUDED_FULL_ANALYSIS_KEYS as readonly string[]).toContain(CAP_KEY);
    expect(visibleProPerks({ fullAnalysisOnSale: false }).map((p) => p.key)).not.toContain(CAP_KEY);
    expect(visibleProPerks({ fullAnalysisOnSale: true }).map((p) => p.key)).toContain(CAP_KEY);
    expect(proPerksOnSale(PRO_PERK_ITEMS, false).map((p) => p.key)).not.toContain(CAP_KEY);
    expect(proPerksOnSale(PRO_PERK_ITEMS, true).map((p) => p.key)).toContain(CAP_KEY);
  });

  it("the limits table's Full Analysis row says Pro's ten a day, in every language's pricing shard", () => {
    for (const l of LNGS) {
      const limits = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/pricing/${l}.json`), "utf8")).pricingPlans.limits as Record<string, string>;
      const L = (k: string, v: Record<string, unknown> = {}) => (limits[k] ?? `MISSING ${k}`).replace(/\{\{(\w+)\}\}/g, (_, n) => String(v[n]));
      const table = limitGroups(L, { fullAnalysis: { onSale: true }, alertsStatable: true } as never, { money: (n) => `$${n}`, count: String });
      const fa = table.groups.flatMap((g) => g.rows).find((r) => r.id === "fa")!;
      expect(fa.cells[2].text, l).not.toMatch(/MISSING/);
      expect(fa.cells[2].text, l).toContain(String(PRO_GRANTS_PER_DAY));
      expect(fa.cells[2].text, l).toContain(String(PRO_GRANTS_PER_MONTH));
      if (l === "en") expect(fa.cells[2]).toEqual({ text: "Included: 10 a day, 60 a month", tone: "ok" });
    }
  });
});
