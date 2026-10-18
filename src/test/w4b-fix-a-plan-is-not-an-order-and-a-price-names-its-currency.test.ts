// @vitest-environment node
/**
 * A PLAN IS NOT AN ORDER, AND A PRICE NAMES THE CURRENCY IT WAS PAID IN
 * (wave 4 round 2 review, money lens).
 *
 * WHAT WAS WRONG.
 *   - stripe-webhook writes a product_deliveries row for every paid session,
 *     the $45 Pro subscription included ('delivered', 4500), and
 *     create-subscription-checkout binds it to the account in checkout_buyers.
 *     get-account-data listed it as a one-off order labelled with the raw type,
 *     with three controls that could not work: Receipt (a subscription session
 *     has no payment_intent: always 404), Email it again (no saved copy:
 *     always 409) and Open (the one-off success page).
 *   - Every order's currency was "usd", but amount_cents is Stripe's
 *     amount_total in the buyer's own currency: a buyer charged 770 yen saw
 *     "$7.70", one charged 7,100 won saw "$71.00".
 *
 * WHAT HOLDS NOW (the shipped handler, run with the database faked):
 *   - a pro_subscription (or apply_agent) delivery bound through
 *     checkout_buyers is not in orders or purchases; the Full Analysis beside
 *     it is;
 *   - the currency comes from the checkout's own record (checkout_starts),
 *     then the delivery row's metadata; with neither, no price is shown;
 *   - OrdersList formats in the currency's own smallest unit: 770 JPY is
 *     ¥770, 7100 KRW is ₩7,100, 500 USD is $5.00.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { money } from "@/components/account/OrdersList";

const USER_ID = "00000000-0000-4000-8000-0000000a0f01";
const EMAIL = "pro.member@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;

let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bFixOrders = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (token: string) => (token === SESSION
        ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null }
        : { data: { user: null }, error: { message: "no" } }),
      admin: { signOut: async () => ({ error: null }), updateUserById: async () => ({ error: null }) },
    },
  });
  handler = await loadEdgeHandler("get-account-data", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bFixOrders(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.scan_credit_balance = () => ({ data: 0, error: null });
  db.rows("checkout_buyers").push(
    { stripe_session_id: "cs_pro_plan", user_id: USER_ID },
    { stripe_session_id: "cs_agent_plan", user_id: USER_ID },
    { stripe_session_id: "cs_fa_yen", user_id: USER_ID },
    { stripe_session_id: "cs_fa_won", user_id: USER_ID },
    { stripe_session_id: "cs_fa_unknown", user_id: USER_ID },
  );
  db.rows("product_deliveries").push(
    { stripe_session_id: "cs_pro_plan", customer_email: EMAIL, product_name: null, product_type: "pro_subscription", status: "delivered", amount_cents: 4500, created_at: "2026-10-10T10:00:00Z" },
    { stripe_session_id: "cs_agent_plan", customer_email: EMAIL, product_name: null, product_type: "apply_agent", status: "delivered", amount_cents: 2900, created_at: "2026-10-09T10:00:00Z" },
    { stripe_session_id: "cs_fa_yen", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 770, created_at: "2026-10-08T10:00:00Z" },
    { stripe_session_id: "cs_fa_won", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 7100, created_at: "2026-10-07T10:00:00Z", metadata: { currency: "krw" } },
    { stripe_session_id: "cs_fa_unknown", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 500, created_at: "2026-10-06T10:00:00Z" },
  );
  db.rows("purchased_content").push({ stripe_session_id: "cs_pro_plan", customer_email: EMAIL, product_name: null, product_type: "pro_subscription", created_at: "2026-10-10T10:00:00Z" });
  db.rows("checkout_starts").push({ stripe_session_id: "cs_fa_yen", currency: "jpy" }, { stripe_session_id: "cs_pro_plan", currency: "usd" });
});

const ask = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/get-account-data", { method: "POST", headers: { authorization: `Bearer ${SESSION}` } }));
  return await res.json() as { orders: Array<Record<string, unknown>>; purchases: Array<Record<string, unknown>> };
};

describe("a subscription is a plan, not a one-off order", () => {
  it("the Pro and agent plans bound to the account are not listed as orders or purchases", async () => {
    const r = await ask();
    const ids = r.orders.map((o) => o.id);
    expect(ids).not.toContain("cs_pro_plan");
    expect(ids).not.toContain("cs_agent_plan");
    expect(r.orders.some((o) => o.productType === "pro_subscription" || o.product === "pro_subscription")).toBe(false);
    expect(r.purchases.some((p) => p.product === "pro_subscription")).toBe(false);
    expect(ids).toEqual(expect.arrayContaining(["cs_fa_yen", "cs_fa_won", "cs_fa_unknown"]));
  });
});

describe("an order's price is in the currency the buyer paid in", () => {
  it("the checkout's record decides, then the delivery row's, else no price", async () => {
    const byId = Object.fromEntries((await ask()).orders.map((o) => [o.id, o]));
    expect(byId.cs_fa_yen).toMatchObject({ amountCents: 770, currency: "jpy" });
    expect(byId.cs_fa_won).toMatchObject({ amountCents: 7100, currency: "krw" });
    expect(byId.cs_fa_unknown).toMatchObject({ amountCents: null, currency: null });
  });

  it("the list formats each in its own smallest unit", () => {
    expect(money(770, "jpy", "en-US")).toBe("¥770");
    expect(money(7100, "krw", "en-US")).toBe("₩7,100");
    expect(money(500, "usd", "en-US")).toBe("$5.00");
    expect(money(500, null, "en-US")).toBeNull();
  });
});
