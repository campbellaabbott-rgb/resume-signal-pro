// @vitest-environment node
/**
 * AN ORDER ANSWERS ONLY THE ACCOUNT THAT OWNS IT (plan CP-050; account-order).
 *
 * Account purchase rows had no receipt and no way to get a delivery mail again
 * (S11-096). account-order gives both, run here as shipped with Stripe, the
 * mailer and the database faked:
 *   - an order is this account's when its address is the account's proven
 *     address (R1's proof row counts) or the checkout bound it to the account;
 *     anything else answers 404, the same as no order at all;
 *   - receipt returns Stripe's receipt URL and sends nothing;
 *   - mail_again sends the saved copy to the ORDER's address only, three a day;
 *     an order with no saved copy answers 409;
 *   - a connector's token is refused.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000c0050";
const EMAIL = "owner@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (extra: Record<string, unknown> = {}) =>
  `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }], ...extra })}.sig`;
const SESSION = jwt();
const MINE = "cs_live_a1b2c3d4e5f6g7h8";
const THEIRS = "cs_live_z9y8x7w6v5u4t3s2";

let handler: EdgeHandler;
let db: FakeDb;
let mailed: Array<Record<string, unknown>>;
let doorHits: number;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_live_x" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bOrder = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (token: string) => (token === SESSION ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
  });
  g.fetch = async (u: string, init?: { body?: string; headers?: Record<string, string> }) => {
    if (String(u).endsWith("/functions/v1/send-product-email")) {
      mailed.push({ ...JSON.parse(String(init?.body ?? "{}")), auth: init?.headers?.Authorization });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  handler = await loadEdgeHandler("account-order", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bOrder(...a); }",
    "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_intent: { latest_charge: { receipt_url: "https://pay.stripe.com/receipts/" + id } } }) } }; } }`,
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  mailed = [];
  doorHits = 0;
  db.rpcs.mail_door_take = (a) => { doorHits++; return { data: doorHits <= Number(a.p_max), error: null }; };
  db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL });
  db.rows("product_deliveries").push(
    { stripe_session_id: MINE, customer_email: EMAIL, product_name: "Cover Letter", product_type: "cover_letter", status: "delivered" },
    { stripe_session_id: THEIRS, customer_email: "someone.else@example.com", product_name: "Cover Letter", product_type: "cover_letter", status: "delivered" },
  );
  db.rows("purchased_content").push(
    { stripe_session_id: MINE, customer_email: EMAIL, product_name: "Cover Letter", product_type: "cover_letter", generated_content: { letter: "Dear hiring manager" } },
    { stripe_session_id: THEIRS, customer_email: "someone.else@example.com", product_name: "Cover Letter", product_type: "cover_letter", generated_content: { letter: "x" } },
  );
});

const ask = async (body: Record<string, unknown>, token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/account-order", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, build: res.headers.get("x-fn-build") };
};

describe("ownership", () => {
  it("another address's order answers 404, like no order at all, and nothing is sent", async () => {
    expect((await ask({ action: "receipt", sessionId: THEIRS })).status).toBe(404);
    expect((await ask({ action: "mail_again", sessionId: THEIRS })).status).toBe(404);
    expect((await ask({ action: "receipt", sessionId: "cs_live_doesnotexist0" })).status).toBe(404);
    expect(mailed).toEqual([]);
  });

  it("without the proof row, an order under the address is not this account's", async () => {
    db.tables.account_mailbox_proofs = [];
    expect((await ask({ action: "receipt", sessionId: MINE })).status).toBe(404);
  });

  it("a checkout bound to the account makes the order its own with no proof", async () => {
    db.tables.account_mailbox_proofs = [];
    db.rows("checkout_buyers").push({ stripe_session_id: THEIRS, user_id: USER_ID });
    expect((await ask({ action: "receipt", sessionId: THEIRS })).status).toBe(200);
  });
});

describe("receipt", () => {
  it("answers Stripe's receipt URL and sends nothing", async () => {
    const r = await ask({ action: "receipt", sessionId: MINE });
    expect(r.status).toBe(200);
    expect(r.build).toBe("account-order.2026-10-14.25");
    expect(r.json.url).toBe(`https://pay.stripe.com/receipts/${MINE}`);
    expect(mailed).toEqual([]);
  });
});

describe("mail_again", () => {
  it("sends the saved copy to the order's own address, three times a day and no more", async () => {
    for (let i = 0; i < 3; i++) expect((await ask({ action: "mail_again", sessionId: MINE })).json).toEqual({ sent: true });
    const fourth = await ask({ action: "mail_again", sessionId: MINE });
    expect(fourth.status).toBe(429);
    expect(mailed).toHaveLength(3);
    for (const m of mailed) {
      expect(m).toMatchObject({ email: EMAIL, productType: "cover_letter", sessionId: MINE, generatedContent: { letter: "Dear hiring manager" }, auth: "Bearer service" });
    }
  });

  it("an order with no saved copy answers 409 and takes no daily slot", async () => {
    db.tables.purchased_content = [];
    const r = await ask({ action: "mail_again", sessionId: MINE });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("no_saved_copy");
    expect(doorHits).toBe(0);
  });
});

describe("refusals", () => {
  it("a connector's token is refused", async () => {
    expect((await ask({ action: "receipt", sessionId: MINE }, jwt({ client_id: "mcp" }))).status).toBe(401);
  });
  it("a session id that is not one is a 400", async () => {
    expect((await ask({ action: "receipt", sessionId: "not-a-session" })).status).toBe(400);
  });
});
