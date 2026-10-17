// @vitest-environment node
/**
 * AN ACCOUNT SEES ITS ORDERS ONCE ITS MAILBOX IS PROVEN BY A CODE (S12-002,
 * plan CP-047, CP-022, CP-050).
 *
 * WHAT WAS WRONG. get-account-data listed purchases only for a session that
 * proved its mailbox by a Google sign-in made in that very session. No Google
 * button existed, so every account saw an empty Purchases box, and the page
 * told buyers to use a button that was not there. Rows had no status, amount
 * or link.
 *
 * WHAT HOLDS NOW, against the shipped handler with the database faked:
 *   - R1's proof row (account_mailbox_proofs, written when a fresh emailed code
 *     proved the address) opens the address's orders to a later password
 *     session; without it, a password session sees no order by the address;
 *   - each order says its status (preparing, ready, needs your résumé,
 *     couldn't be made, refunded, included with Pro), amount and session;
 *   - a one-off bound to the account by checkout_buyers shows with no proof,
 *     and a missing checkout_buyers table reads as none, not as an error;
 *   - a connector's token is refused;
 *   - THE GUARD AS A BACKSTOP (plan CP-H): a fresh code sign-in whose guard
 *     call never landed is proven by this read, which records R1's proof row,
 *     clears a password set before it and says so; a password session, or a
 *     code sign-in older than 15 minutes, never runs it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { accountGuardNotices } from "@/lib/account-guard-notice";

const USER_ID = "00000000-0000-4000-8000-0000000a0002";
const EMAIL = "buyer@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (extra: Record<string, unknown> = {}) =>
  `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }], ...extra })}.sig`;
const SESSION = jwt();
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
/** A session whose newest sign-in is an emailed code, `ageS` seconds ago. */
const codeJwt = (ageS: number) => jwt({ amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) - ageS }], session_id: SESSION_ID, email: EMAIL });
const FRESH_CODE = codeJwt(30);
const STALE_CODE = codeJwt(20 * 60);
const EMAIL_IDENTITY = [{ provider: "email", identity_data: { email: EMAIL } }];
const adminCalls: string[] = [];

let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bAcct = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (token: string) => (token === SESSION
        ? { data: { user: { id: USER_ID, email: EMAIL, identities: [] } }, error: null }
        : token === FRESH_CODE || token === STALE_CODE
          ? { data: { user: { id: USER_ID, email: EMAIL, identities: EMAIL_IDENTITY } }, error: null }
          : { data: { user: null }, error: { message: "no" } }),
      admin: {
        signOut: async (_jwt: string, scope?: string) => { adminCalls.push(`signOut:${scope}`); return { error: null }; },
        updateUserById: async () => { adminCalls.push("updateUserById"); return { error: null }; },
      },
    },
  });
  handler = await loadEdgeHandler("get-account-data", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bAcct(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.scan_credit_balance = (a) => ({ data: a.p_email ? 5 : 0, error: null });
  db.rows("product_deliveries").push(
    { stripe_session_id: "cs_ready", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 500, created_at: "2026-10-01T10:00:00Z" },
    { stripe_session_id: "cs_resume", customer_email: EMAIL, product_name: "Cover Letter", product_type: "cover_letter", status: "failed", generation_error: "No résumé linked to this purchase", amount_cents: 400, created_at: "2026-10-02T10:00:00Z" },
    { stripe_session_id: "cs_refund", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "refunded", amount_cents: 500, created_at: "2026-10-03T10:00:00Z" },
    { stripe_session_id: "cs_making", customer_email: EMAIL, product_name: "Full Resume Analysis", product_type: "full_analysis", status: "generating", amount_cents: 500, created_at: "2026-10-04T10:00:00Z" },
    { stripe_session_id: "cs_bound", customer_email: "typed.at.checkout@example.com", product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 500, created_at: "2026-10-05T10:00:00Z" },
  );
});

const ask = async (token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/get-account-data", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, json: await res.json() as Record<string, any>, build: res.headers.get("x-fn-build") };
};

describe("S12-002: a proof recorded once keeps counting", () => {
  it("a password session with no proof sees no order by the address, and says why", async () => {
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.build).toBe("get-account-data.2026-10-14.25");
    expect(r.json.mailboxProven).toBe(false);
    expect(r.json.orders).toEqual([]);
    expect(r.json.credits).toBe(0);
  });

  it("with R1's proof row for the address, the same password session sees the address's orders and pool", async () => {
    db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: EMAIL });
    const r = await ask();
    expect(r.json.mailboxProven).toBe(true);
    expect(r.json.credits).toBe(5);
    const byId = Object.fromEntries((r.json.orders as Array<{ id: string; status: string }>).map((o) => [o.id, o]));
    expect(Object.keys(byId).sort()).toEqual(["cs_making", "cs_ready", "cs_refund", "cs_resume"]);
    expect(byId.cs_ready).toMatchObject({ status: "ready", amountCents: 500, currency: "usd", sessionId: "cs_ready", productType: "full_analysis" });
    expect(byId.cs_resume.status).toBe("needs_resume");
    expect(byId.cs_refund.status).toBe("refunded");
    expect(byId.cs_making.status).toBe("preparing");
  });

  it("a proof for another address does not count", async () => {
    db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: "old.address@example.com" });
    expect((await ask()).json.mailboxProven).toBe(false);
  });
});

describe("orders the account owns by id", () => {
  it("a one-off bound by checkout_buyers shows with no proof; a Pro inclusion shows as included", async () => {
    db.rows("checkout_buyers").push({ stripe_session_id: "cs_bound", user_id: USER_ID });
    db.rows("pro_grants").push({ id: "g1", user_id: USER_ID, product_name: "Full Resume Analysis", product_type: "full_analysis", created_at: "2026-10-06T10:00:00Z", revoked_at: null });
    const r = await ask();
    expect(r.json.mailboxProven).toBe(false);
    const ids = (r.json.orders as Array<{ id: string; status: string }>).map((o) => `${o.id}:${o.status}`);
    expect(ids).toEqual(["grant:g1:included", "cs_bound:ready"]);
  });

  it("a checkout_buyers table that does not exist yet reads as no rows, not as an error", async () => {
    db.faults.push({ table: "checkout_buyers", op: "select", error: { code: "PGRST205", message: "Could not find the table 'public.checkout_buyers' in the schema cache" } });
    const r = await ask();
    expect(r.status).toBe(200);
  });

  it("any other failed read is an error the page can show, never an empty account", async () => {
    db.faults.push({ table: "pro_grants", op: "select", error: { code: "57014", message: "statement timeout" } });
    const r = await ask();
    expect(r.status).toBe(500);
  });
});

describe("plan CP-H: the account guard as a backstop", () => {
  const rotations: string[] = [];
  beforeEach(() => {
    adminCalls.length = 0;
    rotations.length = 0;
    db.rpcs.auth_sign_in_addresses = () => ({ data: [EMAIL], error: null });
    db.rpcs.auth_changed_since = () => ({ data: false, error: null });
    db.rpcs.auth_user_has_password = () => ({ data: false, error: null });
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      rotations.push(`${init?.method ?? "GET"} ${u}`);
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a fresh code sign-in with no proof is proven here: the proof row is written and the address's orders show", async () => {
    const r = await ask(FRESH_CODE);
    expect(r.status).toBe(200);
    expect(r.json.mailboxProven).toBe(true);
    expect(r.json.passwordCleared).toBeUndefined();
    expect(db.rows("account_mailbox_proofs")).toEqual([expect.objectContaining({ user_id: USER_ID, email: EMAIL, method: "otp", password_cleared: false })]);
    expect((r.json.orders as Array<{ id: string }>).map((o) => o.id)).toContain("cs_ready");
    expect(rotations).toEqual([]);
  });

  it("a password set before the proof is cleared as the session, other sessions end, and the answer says so", async () => {
    db.rpcs.auth_user_has_password = () => ({ data: true, error: null });
    const r = await ask(FRESH_CODE);
    expect(r.json.mailboxProven).toBe(true);
    expect(r.json.passwordCleared).toBe(true);
    expect(r.json.signedOut).toBeUndefined();
    expect(rotations).toEqual(["PUT https://harness.supabase.co/auth/v1/user"]);
    expect(adminCalls).toEqual(["signOut:others"]);
    expect(db.rows("account_password_clears")).toEqual([expect.objectContaining({ session_id: SESSION_ID, user_id: USER_ID })]);
  });

  it("a code sign-in older than 15 minutes, or a password session, never runs the guard", async () => {
    let asked = 0;
    db.rpcs.auth_sign_in_addresses = () => { asked += 1; return { data: [EMAIL], error: null }; };
    expect((await ask(STALE_CODE)).json.mailboxProven).toBe(false);
    expect((await ask(SESSION)).json.mailboxProven).toBe(false);
    expect(asked).toBe(0);
    expect(db.rows("account_mailbox_proofs")).toEqual([]);
  });

  it("a guard that cannot read the auth log leaves the address unproven and the read still answers", async () => {
    db.rpcs.auth_sign_in_addresses = () => ({ data: null, error: { code: "57014", message: "statement timeout" } });
    const r = await ask(FRESH_CODE);
    expect(r.status).toBe(200);
    expect(r.json.mailboxProven).toBe(false);
    expect(r.json.orders).toEqual([]);
  });
});

describe("plan CP-H: the account page says what the backstop did, as the sign-in says it", () => {
  const t = (_k: string, d: string) => d;
  it("a cleared password is said once; nothing is said for an ordinary read", () => {
    expect(accountGuardNotices({ passwordCleared: true }, FRESH_CODE, t)).toEqual([
      { title: "Your old password was cleared", description: expect.stringMatching(/before you proved you own it/) },
    ]);
    expect(accountGuardNotices({ mailboxProven: true } as never, FRESH_CODE, t)).toEqual([]);
    expect(accountGuardNotices(null, FRESH_CODE, t)).toEqual([]);
  });

  it("never after a reset (which sets a new password anyway), and every ended session says sign in again", () => {
    const reset = jwt({ amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) }] });
    expect(accountGuardNotices({ passwordCleared: true }, reset, t)).toEqual([]);
    expect(accountGuardNotices({ passwordCleared: true, signedOut: true }, reset, t)).toEqual([
      { title: "Every session of this account was ended. Please sign in again." },
    ]);
  });
});

describe("CP-J", () => {
  it("a connector's token is refused", async () => {
    const r = await ask(jwt({ client_id: "mcp" }));
    expect(r.status).toBe(401);
    expect(r.json.reason).toBe("connector_token");
  });
});
