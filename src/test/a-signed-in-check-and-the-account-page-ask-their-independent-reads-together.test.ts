// @vitest-environment node
/**
 * A SIGNED-IN PLAN CHECK AND THE ACCOUNT PAGE ASK THEIR INDEPENDENT READS
 * TOGETHER (cost audit 2026-11-08, Worth doing: small sequential hops).
 *
 * WHAT WAS WRONG. Two reads that depend only on who is signed in waited for
 * reads they do not depend on, one database round trip each (110-150 ms
 * measured, the audit's correction of its own 150-400 ms):
 *   - check-subscription, on every signed-in /pricing, /account and /jobs
 *     view, read the address's cache row and only then the account's plan
 *     rows (pro_entitlement_rows), although the cached answer writes nothing
 *     in between;
 *   - get-account-data read the account's bound one-offs (checkout_buyers)
 *     only after the mailbox proof and the proof row.
 *
 * WHAT HOLDS NOW, on the shipped handlers with the database held still by the
 * test: each read is asked while the other is still out; the answers are the
 * ones the sequential code gave; a plan check that writes before it answers
 * (a live check) still reads the plan rows again after its writes; a request
 * refused at the door reads nothing.
 *
 * REVIEW 2026-11-15. The early read went out for every signed-in caller and
 * was thrown away on every live check, one more RPC than main made. A caller
 * that asks for the live answer (fresh: true, back from the billing portal)
 * is known to go live before anything is read, so it no longer starts the
 * early read. A caller whose cached row turns out too old cannot be known
 * until the row is read: that check still reads the plan rows twice, the
 * stated trade of one RPC on a live check (at most 30 an hour per address)
 * for one round trip off every cached view.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

/** A promise the test opens. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => { open = r; });
  return { p, open };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

type AnyQuery = Record<string, unknown> & { then: (...a: unknown[]) => unknown; maybeSingle: () => unknown; single: () => unknown };
/** The query, with `asked` called when it is sent, and its answer held until `hold` opens. */
function watched(q: AnyQuery, asked: () => void, hold?: Promise<void>): AnyQuery {
  const then = q.then.bind(q), maybe = q.maybeSingle.bind(q), single = q.single.bind(q);
  const wait = <T,>(f: () => T) => { asked(); return hold ? hold.then(f) : Promise.resolve().then(f); };
  q.then = (ok: unknown, no: unknown) => wait(() => then(ok, no));
  q.maybeSingle = () => wait(() => maybe());
  q.single = () => wait(() => single());
  return q;
}

// ── check-subscription ───────────────────────────────────────────────────────
const USER = { id: "00000000-0000-4000-8000-00000000c501", email: "member@example.com" };
const CS_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_live_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness",
};
const STRIPE = `export default class Stripe {
  constructor() {
    this.customers = { list: async () => ({ data: [], has_more: false }), retrieve: async () => { throw new Error("No such customer"); } };
    this.subscriptions = { list: async () => ({ data: [], has_more: false }) };
    this.checkout = { sessions: { retrieve: async () => { throw new Error("No such checkout.session"); } } };
  }
}`;
let cs: EdgeHandler;
let gad: EdgeHandler;
let db: FakeDb;
let events: string[];
let holdCache: ReturnType<typeof gate> | null;
let holdProof: ReturnType<typeof gate> | null;
/** db.writes.length at each pro_entitlement_rows call. */
let entitlementAt: number[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => CS_ENV[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__hopClient = () => ({
    from: (t: string) => {
      const q = db.from(t) as unknown as AnyQuery;
      if (t === "pro_subscribers") return watched(q, () => events.push("pro_subscribers"), holdCache?.p);
      if (t === "account_mailbox_proofs") return watched(q, () => events.push("account_mailbox_proofs"), holdProof?.p);
      if (t === "checkout_buyers") return watched(q, () => events.push("checkout_buyers"));
      return q;
    },
    rpc: (n: string, a: Record<string, unknown>) => {
      events.push(`rpc:${n}`);
      if (n === "pro_entitlement_rows") entitlementAt.push(db.writes.length);
      return db.rpc(n, a);
    },
    auth: {
      getUser: async (jwt?: string) => (jwt === "jwt-member" || jwt === GAD_SESSION
        ? { data: { user: { ...USER, identities: [] } }, error: null }
        : { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "bad jwt" } }),
    },
  });
  const CLIENT = "export function createClient() { return globalThis.__hopClient(); } export class SupabaseClient {}";
  cs = await loadEdgeHandler("check-subscription", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE,
    "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  });
  gad = await loadEdgeHandler("get-account-data", { "https://esm.sh/@supabase/supabase-js@2": CLIENT });
}, 240_000);

beforeEach(() => {
  db = new FakeDb({ pro_subscribers: ["email"] });
  events = [];
  entitlementAt = [];
  holdCache = null;
  holdProof = null;
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    pro_entitlement_rows: (a) => ({
      data: db.rows("pro_subscribers").filter((r) => r.user_id === a.p_user_id)
        .map((r) => ({ tier: "pro", status: r.status, current_period_end: r.current_period_end, bound: true })),
      error: null,
    }),
    scan_credit_balance: () => ({ data: 0, error: null }),
  };
});

const check = (over: Record<string, string> = {}, body: Record<string, unknown> = {}) =>
  cs(new Request("https://harness.supabase.co/functions/v1/check-subscription", {
    method: "POST", headers: { authorization: "Bearer jwt-member", "content-type": "application/json", ...over }, body: JSON.stringify(body),
  }));
const proRow = (updatedMsAgo: number) => ({
  email: USER.email, user_id: USER.id, stripe_customer_id: "cus_hop1", status: "active",
  current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - updatedMsAgo).toISOString(), cancel_at_period_end: false,
});

describe("check-subscription, signed in", () => {
  it("asks for the account's plan rows while the address's cache row is still out, and answers the cached plan from that one read", async () => {
    db.rows("pro_subscribers").push(proRow(60_000));
    holdCache = gate();
    const pending = check();
    await settle();
    expect(events, "the plan rows waited for the cache row").toContain("rpc:pro_entitlement_rows");
    holdCache.open();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ active: true, cached: true });
    expect(events.filter((e) => e === "rpc:pro_entitlement_rows"), "the cached answer read the plan rows twice").toHaveLength(1);
  });

  it("over the live-check allowance, the stale answer is described from the same one read", async () => {
    db.rows("pro_subscribers").push(proRow(2 * 3600_000));
    db.rpcs.check_rate_limit = () => ({ data: false, error: null });
    const res = await check();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: true, stale: true });
    expect(events.filter((e) => e === "rpc:pro_entitlement_rows")).toHaveLength(1);
  });

  it("a live check that writes before it answers reads the plan rows again after its writes", async () => {
    // No row for the address: the live check finds no plan at Stripe and
    // remembers "inactive" for five minutes before it answers.
    const res = await check();
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(false);
    const inserted = db.writes.filter((w) => w.table === "pro_subscribers").length;
    expect(inserted, "the live check wrote nothing, so this proves nothing").toBeGreaterThan(0);
    expect(entitlementAt.length).toBe(2);
    expect(entitlementAt[1], "the answer used plan rows read before the live check's writes").toBeGreaterThanOrEqual(db.writes.length);
  });

  it("a caller that asks for the live answer (fresh) reads the plan rows once, after the live check's writes (review 2026-11-15)", async () => {
    // A cached row young enough to answer, which fresh skips: the live check runs.
    db.rows("pro_subscribers").push(proRow(60_000));
    const res = await check({}, { fresh: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached, "fresh was answered from the cache row").toBeUndefined();
    expect(entitlementAt, "the early read went out for a check known to go live").toHaveLength(1);
    expect(entitlementAt[0], "the one read came before the live check's writes").toBeGreaterThan(0);
  });

  it("a cached row found too old reads the plan rows twice, the stated trade for the cached views' round trip", async () => {
    db.rows("pro_subscribers").push(proRow(2 * 3600_000));
    const res = await check();
    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBeUndefined();
    expect(entitlementAt).toHaveLength(2);
  });

  it("a plan-rows read that fails still answers with the rows unread, and a signed-out caller reads nothing", async () => {
    db.rows("pro_subscribers").push(proRow(60_000));
    db.rpcs.pro_entitlement_rows = () => ({ data: null, error: { message: "boom" } });
    const res = await check();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active, "an unread account must not be told it has no plan").not.toBe(false);
    events = [];
    const out = await cs(new Request("https://harness.supabase.co/functions/v1/check-subscription", { method: "POST", body: "{}" }));
    expect(await out.json()).toMatchObject({ active: false, status: "sign_in_required" });
    expect(events).toEqual([]);
  });
});

// ── get-account-data ─────────────────────────────────────────────────────────
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const GAD_SESSION = `${b64({ alg: "none" })}.${b64({ sub: USER.id, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const account = (token = GAD_SESSION) =>
  gad(new Request("https://harness.supabase.co/functions/v1/get-account-data", { method: "POST", headers: { authorization: `Bearer ${token}` } }));

describe("get-account-data", () => {
  it("asks for the account's bound one-offs while the mailbox proof is still out, and lists them as before", async () => {
    db.rows("checkout_buyers").push({ stripe_session_id: "cs_bound", user_id: USER.id });
    db.rows("product_deliveries").push({ stripe_session_id: "cs_bound", customer_email: "typed@example.com", product_name: "Full Resume Analysis", product_type: "full_analysis", status: "delivered", amount_cents: 500, created_at: "2026-10-05T10:00:00Z" });
    holdProof = gate();
    const pending = account();
    await settle();
    expect(events, "the mailbox proof was never asked: this test holds nothing").toContain("account_mailbox_proofs");
    expect(events, "the bound one-offs waited for the mailbox proof").toContain("checkout_buyers");
    holdProof.open();
    const res = await pending;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.orders as Array<{ id: string; status: string }>).map((o) => `${o.id}:${o.status}`)).toEqual(["cs_bound:ready"]);
  });

  it("a bound one-off read that fails is still a 500 after the proof, and a refused session reads nothing", async () => {
    db.faults.push({ table: "checkout_buyers", op: "select", error: { code: "XX000", message: "boom" } });
    const res = await account();
    expect(res.status).toBe(500);
    events = [];
    const out = await account("not-a-session");
    expect(out.status).toBe(401);
    expect(events).toEqual([]);
  });
});
