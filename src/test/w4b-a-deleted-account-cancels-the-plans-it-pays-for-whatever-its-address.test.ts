// @vitest-environment node
/**
 * A DELETED ACCOUNT CANCELS THE PLANS IT PAYS FOR, WHATEVER ITS ADDRESS NOW IS
 * (S12-053, S12-097), AND TAKES ITS KEYS AND LISTS WITH IT (S12-153, D9).
 *
 * WHAT WAS WRONG.
 *   S12-053  delete-account found plans as Stripe customers on the account's
 *            CURRENT address. A Pro subscriber who fixed a typo in their email
 *            and then deleted the account got success: true, and $45 kept
 *            leaving their card every month.
 *   S12-097  a legacy plan (no metadata.user_id) that a pro_subscribers row
 *            binds to the account was refused as "not linked", so erasure
 *            waited a month.
 *   S12-153  API and connector keys outlived the account, address included.
 *
 * WHAT HOLDS NOW, against the shipped handler with Stripe, storage and auth
 * faked: plans are found by address, by bound row and by metadata.user_id;
 * a bound legacy plan and a plan naming the account are cancelled at once; an
 * unnamed plan on the address is cancelled only for a proven mailbox (R1's
 * proof row counts), refused otherwise unless it already ends at its period
 * end; the eraser runs before the user goes, with the proof it was given, and
 * its failure stops the delete; a connector token deletes nothing.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const USER_ID = "00000000-0000-4000-8000-0000000d0053";
const NEW_EMAIL = "fixed.typo@example.com";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (extra: Record<string, unknown> = {}) =>
  `${b64({ alg: "none" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }], ...extra })}.sig`;
const SESSION = jwt();

type Sub = { id: string; customer: string; status: string; metadata: Record<string, string>; cancel_at_period_end?: boolean };
const state = {
  customersByEmail: {} as Record<string, string[]>,
  subsByCustomer: {} as Record<string, Sub[]>,
  searchHits: [] as Sub[],
  searchFails: false,
  searchQueries: [] as string[],
  cancelled: [] as string[],
  deleted: [] as string[],
  order: [] as string[],
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const s = () => globalThis.__w4bDel;
    this.customers = { list: async (p) => ({ data: (s().customersByEmail[p.email] ?? []).map((id) => ({ id })), has_more: false }) };
    this.subscriptions = {
      list: async (p) => ({ data: s().subsByCustomer[p.customer] ?? [], has_more: false }),
      search: async (p) => { s().searchQueries.push(p.query); if (s().searchFails) throw new Error("search unavailable"); return { data: s().searchHits, has_more: false }; },
      cancel: async (id) => { s().cancelled.push(id); s().order.push("cancel"); return {}; },
    };
  }
}`;

let handler: EdgeHandler;
let db: FakeDb;
let eraseCalls: Array<Record<string, unknown>>;
let eraseFails: boolean;

beforeAll(async () => {
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__w4bDel = state;
  g.__w4bDelClient = () => ({
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (token: string) => (token === SESSION || token === jwt({ client_id: "mcp" })
        ? { data: { user: { id: USER_ID, email: NEW_EMAIL, identities: [] } }, error: null }
        : { data: { user: null }, error: { message: "no" } }),
      admin: { deleteUser: async (id: string) => { state.deleted.push(id); state.order.push("deleteUser"); return { error: null }; } },
    },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
  });
  handler = await loadEdgeHandler("delete-account", {
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__w4bDelClient(...a); }",
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  eraseCalls = [];
  eraseFails = false;
  db.rpcs.account_erase_personal_data = (a) => {
    eraseCalls.push(a);
    state.order.push("erase");
    return eraseFails ? { data: null, error: { message: "permission denied" } } : { data: { keys_revoked: 2 }, error: null };
  };
  Object.assign(state, { customersByEmail: {}, subsByCustomer: {}, searchHits: [], searchFails: false, searchQueries: [], cancelled: [], deleted: [], order: [] });
});

const del = async (token = SESSION) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, json: await res.json() as Record<string, unknown>, build: res.headers.get("x-fn-build") };
};

describe("S12-053 / S12-097: the plan is found by the account", () => {
  it("after an email change, the legacy plan a bound row names is cancelled, not left charging", async () => {
    // Stripe still holds the old address; the account now carries the fixed one.
    state.customersByEmail["fixed.typp@example.com"] = ["cus_old"];
    state.subsByCustomer.cus_old = [{ id: "sub_legacy", customer: "cus_old", status: "active", metadata: {} }];
    db.rows("pro_subscribers").push({ email: "fixed.typp@example.com", user_id: USER_ID, stripe_customer_id: "cus_old" });
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled, "the plan kept charging a deleted account").toEqual(["sub_legacy"]);
    expect(state.deleted).toEqual([USER_ID]);
    expect(r.json).toMatchObject({ success: true, subscriptionsCancelled: 1, keysRevoked: 2, kept: ["payment_records"] });
    expect(r.build).toBe("delete-account.2026-10-14.25");
  });

  it("a plan that names the account is found by its metadata on a customer under another address", async () => {
    state.searchHits = [{ id: "sub_named", customer: "cus_elsewhere", status: "trialing", metadata: { user_id: USER_ID } }];
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.searchQueries).toEqual([`metadata['user_id']:'${USER_ID}'`]);
    expect(state.cancelled).toEqual(["sub_named"]);
  });

  it("a search Stripe cannot answer changes nothing", async () => {
    state.searchFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("billing_unreadable");
    expect(state.deleted).toEqual([]);
    expect(eraseCalls).toEqual([]);
  });
});

describe("an unnamed plan on the account's address", () => {
  beforeEach(() => {
    state.customersByEmail[NEW_EMAIL] = ["cus_addr"];
  });

  it("an unproven session is refused while it can still charge", async () => {
    state.subsByCustomer.cus_addr = [{ id: "sub_guest", customer: "cus_addr", status: "active", metadata: {} }];
    const r = await del();
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("subscription_unlinked");
    expect(state.cancelled).toEqual([]);
    expect(state.deleted).toEqual([]);
  });

  it("a plan already ending at its period end charges nothing more and does not block the delete", async () => {
    state.subsByCustomer.cus_addr = [{ id: "sub_ending", customer: "cus_addr", status: "active", metadata: {}, cancel_at_period_end: true }];
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual([]);
    expect(state.deleted).toEqual([USER_ID]);
  });

  it("R1's proof row for the address counts as the proven mailbox: the plan is cancelled", async () => {
    state.subsByCustomer.cus_addr = [{ id: "sub_guest", customer: "cus_addr", status: "active", metadata: {} }];
    db.rows("account_mailbox_proofs").push({ id: 1, user_id: USER_ID, email: NEW_EMAIL });
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual(["sub_guest"]);
    expect(eraseCalls).toEqual([{ p_user_id: USER_ID, p_email: NEW_EMAIL, p_email_proven: true }]);
  });

  it("a plan naming another account is never touched", async () => {
    state.subsByCustomer.cus_addr = [{ id: "sub_theirs", customer: "cus_addr", status: "active", metadata: { user_id: "00000000-0000-4000-8000-0000000d0099" } }];
    const r = await del();
    expect(r.status).toBe(200);
    expect(state.cancelled).toEqual([]);
  });
});

describe("S12-153: keys and lists go before the user, with the proof they were given", () => {
  it("the eraser runs after the cancels and before deleteUser, told the address is unproven", async () => {
    state.searchHits = [{ id: "sub_named", customer: "cus_x", status: "active", metadata: { user_id: USER_ID } }];
    await del();
    expect(state.order).toEqual(["cancel", "erase", "deleteUser"]);
    expect(eraseCalls).toEqual([{ p_user_id: USER_ID, p_email: NEW_EMAIL, p_email_proven: false }]);
  });

  it("an eraser that fails stops the delete and says what already happened", async () => {
    eraseFails = true;
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "keys_not_revoked", agentStopped: true, cvRemoved: true });
    expect(state.deleted).toEqual([]);
  });
});

describe("CP-J: a website session only", () => {
  it("a connector's token deletes nothing and reads nothing", async () => {
    const r = await del(jwt({ client_id: "mcp" }));
    expect(r.status).toBe(401);
    expect(r.json.reason).toBe("connector_token");
    expect(state.searchQueries).toEqual([]);
    expect(state.deleted).toEqual([]);
  });
});
