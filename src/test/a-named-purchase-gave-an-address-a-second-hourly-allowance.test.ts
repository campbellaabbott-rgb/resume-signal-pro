/**
 * A NAMED PURCHASE GAVE AN ADDRESS A SECOND HOURLY ALLOWANCE.
 *
 * The S8-065 fix counted an address that named a purchase in a bucket of its
 * own, `${fn}:purchase`, as large as the purchase's day, and never in the
 * plain 20-an-hour bucket. Once the purchase's 30 a day were spent, the gate
 * fell through to the ceiling ("never refused for it"), so one address could
 * alternate plain and purchase requests for 20 + 30 calls every hour, all
 * day, and the comment said the opposite.
 *
 * Run against the shipped modelSpendGate with a limiter that counts like the
 * database: each bucket up to its cap, the hourly ones emptied at the hour.
 */
import { describe, expect, it } from "vitest";
import { modelSpendGate } from "../../supabase/functions/_shared/model-spend-gate";

const SESSION = "cs_live_coach_paid";
const LIMITS = { perAddress: 20, globalPerHour: 200, perSessionPerDay: 30 };

function limiter() {
  const buckets = new Map<string, { n: number; window: number }>();
  const db = {
    rpc: async (_name: string, a: Record<string, unknown>) => {
      const key = `${a.p_function}|${a.p_ip}`;
      const b = buckets.get(key) ?? { n: 0, window: Number(a.p_window_minutes) };
      b.n++;
      buckets.set(key, b);
      return { data: b.n <= Number(a.p_max_requests), error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { session_id: SESSION, product_type: "interview_coach" }, error: null }) }) }) }),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "no" } }) },
  };
  const nextHour = () => { for (const [k, b] of buckets) if (b.window <= 60) buckets.delete(k); };
  return { db, nextHour };
}

const call = async (db: unknown, withSession: boolean) => {
  const req = new Request("https://x.test/fn", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.50" } });
  const refused = await modelSpendGate(db as never, req, "generate-interview-coach", LIMITS, {}, withSession ? { session: SESSION, products: ["interview_coach"] } : {});
  return refused === null;
};

describe("an address that names a purchase", () => {
  it("gets its hour plus the purchase's day once, not a second hourly allowance every hour", async () => {
    const { db, nextHour } = limiter();
    let allowed = 0;
    for (let i = 0; i < 25; i++) if (await call(db, false)) allowed++;
    for (let i = 0; i < 40; i++) if (await call(db, true)) allowed++;
    expect(allowed).toBe(20 + 30);

    nextHour();
    let second = 0;
    for (let i = 0; i < 25; i++) if (await call(db, false)) second++;
    for (let i = 0; i < 40; i++) if (await call(db, true)) second++;
    expect(second).toBe(20);
  });

  it("a paying buyer past the address's hour goes on while the purchase's day lasts", async () => {
    const { db } = limiter();
    const results: boolean[] = [];
    for (let i = 0; i < 31; i++) results.push(await call(db, true));
    expect(results.slice(0, 30).every(Boolean)).toBe(true);
    expect(results[30]).toBe(false);
  });
});
