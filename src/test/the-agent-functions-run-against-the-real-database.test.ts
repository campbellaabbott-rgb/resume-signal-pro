// @vitest-environment node
/**
 * THE AGENT'S EDGE FUNCTIONS, RUN — AGAINST THE MIGRATIONS THEY SHIP WITH.
 *
 * WHAT WAS WRONG (agents-api review, 2026-10-05). The security claims of this
 * branch — agent-access answers only its caller and asks Stripe only through a
 * meter; the broker cannot loop on one packet; a prepared posting is never
 * refunded; a woken worker is told when to come back — were proved by regexes
 * over the source. None of them was executed, and the one seam the review
 * reproduced (the claim and the broker reading funding by different keys) was
 * invisible to every one of them.
 *
 * WHAT THIS HOLDS. Each function's shipped index.ts is bundled with only its
 * network faked (helpers/edge-harness: the Deno server, Stripe, the client
 * factory), and its client is a PostgREST-shaped wrapper over pglite holding
 * the stand-in tables, the LIVE triggers and this branch's migrations
 * (helpers/agent-db, helpers/pglite-supabase). So a request goes through the
 * real handler into the real SQL, and the assertions read rows and responses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { agentDb } from "./helpers/agent-db";
import { PgSupabase } from "./helpers/pglite-supabase";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
  APPLY_WORKER_SECRET: "worker-secret-harness",
  MAINTENANCE_KEY: "maintenance-harness",
  WORKER_START_URL: "https://wake.test/start",
  WORKER_START_TOKEN: "wake-token",
  WORKER_START_BODY: '{"ref":"main"}',
};

type Sub = { id: string; status: string; metadata?: Record<string, string>; items: { data: Array<{ price: { unit_amount: number }; current_period_end?: number }> } };
interface StripeWorld { customers: Record<string, Array<{ id: string }>>; subs: Record<string, Sub[]>; calls: string[]; created: Array<Record<string, unknown>> }
const agentSub = (status: string, metadata?: Record<string, string>): Sub => ({
  id: `sub_${status}`, status, metadata,
  items: { data: [{ price: { unit_amount: 9900 }, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20 }] },
});

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__stripe;
    this.customers = { list: async ({ email }) => { w().calls.push("customers.list:" + email); return { data: w().customers[email] ?? [], has_more: false }; } };
    this.subscriptions = { list: async ({ customer }) => { w().calls.push("subscriptions.list"); return { data: w().subs[customer] ?? [], has_more: false }; } };
    this.checkout = { sessions: { create: async (p) => { w().calls.push("sessions.create"); w().created.push(p); return { id: "cs_test_new", url: "https://checkout.stripe.com/c/cs_test_new", amount_total: 0, currency: "usd", mode: p.mode, payment_status: "unpaid" }; } } };
  }
}`;
const CLIENT_STUB = "export function createClient(url, key, opts) { return globalThis.__pgClient(key, opts); }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT_STUB,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT_STUB,
};

const W = "77777777-7777-7777-7777-777777777777"; // a subscriber whose plan is bound to her account
const R = "a1a1a1a1-0000-0000-0000-000000000001"; // registered a subscriber's address; proved nothing
const N = "a1a1a1a1-0000-0000-0000-000000000009"; // a new buyer
const K = "a1a1a1a1-0000-0000-0000-00000000000b"; // someone about to buy
const SEED = `
  INSERT INTO auth.users (id, email, created_at) VALUES
    ('${W}', 'wren@example.com', now() - interval '30 days'),
    ('${N}', 'nia@example.com', now() - interval '10 days'),
    ('${K}', 'kit@example.com', now() - interval '5 days');
  INSERT INTO public.agent_subscribers (email, status, current_period_end)
  VALUES ('wren@example.com', 'active', now() + interval '20 days'),
         ('victim@example.com', 'active', now() + interval '20 days');
`;

let db: PGlite;
let client: PgSupabase;
let stripe: StripeWorld;
let wakes: Array<{ url: string; body: string }>;
const handlers: Record<string, EdgeHandler> = {};
const realFetch = globalThis.fetch;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await db.query(sql, params)).rows[0] ?? {}) as T;
const post = (fn: string, body: unknown, headers: Record<string, string> = {}) =>
  handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));

beforeAll(async () => {
  db = await agentDb({ seed: SEED });
  // The registrant arrives AFTER the migration: auto-confirmed at sign-up.
  await db.query(`INSERT INTO auth.users (id, email, created_at, email_confirmed_at) VALUES ($1, 'victim@example.com', now(), now())`, [R]);
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__pgClient = (key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    if (key === env.SUPABASE_ANON_KEY) {
      const bearer = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
      return { auth: { getUser: (jwt?: string) => client.auth.getUser(jwt ?? bearer) } };
    }
    return client;
  };
  for (const fn of ["apply-broker", "agent-access", "create-agent-checkout", "apply-agent"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await db?.close();
});
beforeEach(() => {
  client = new PgSupabase(db);
  client.tokens = { "jwt-wren": { id: W, email: "wren@example.com" }, "jwt-registrant": { id: R, email: "victim@example.com" }, "jwt-nia": { id: N, email: "nia@example.com" }, "jwt-kit": { id: K, email: "kit@example.com" } };
  stripe = { customers: {}, subs: {}, calls: [], created: [] };
  (globalThis as Record<string, unknown>).__stripe = stripe;
  wakes = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    wakes.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
});

// ── apply-broker ─────────────────────────────────────────────────────────────

describe("apply-broker: one packet cannot hold the queue, and a failed read is not an answer", () => {
  const worker = { authorization: `Bearer ${env.APPLY_WORKER_SECRET}` };
  const E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  beforeAll(async () => {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'eve@example.com')`, [E]);
    await db.query(`INSERT INTO agent_mandates (user_id, active, undo_window_seconds, full_name) VALUES ($1, true, 0, 'Eve Ng'), ($2, true, 0, 'Wren Ode')`, [E, W]);
  });
  beforeEach(async () => { await db.query(`DELETE FROM agent_submissions`); });

  it("in the deploy window (the old claim, no funding gate) a handed-back packet steps aside and the next account's is sent", async () => {
    // Production runs the previous claim until 20261005133000 applies; the
    // broker's own gate is then the only one. E is unfunded and older.
    const prev = readFileSync(resolve(__dirname, "../../supabase/migrations/20260804192051_d748ac84-086f-4c04-93db-1bd90737d114.sql"), "utf8");
    const oldClaim = prev.slice(0, prev.indexOf("REVOKE ALL ON FUNCTION public.agent_claim_submission"));
    const current = (await one<{ def: string }>(`SELECT pg_get_functiondef('public.agent_claim_submission(text,integer)'::regprocedure) AS def`)).def;
    await db.exec(oldClaim);
    try {
      const e = await one<{ id: number }>(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:e:1', 'E Co', now() - interval '2 hours') RETURNING id`, [E]);
      const w = await one<{ id: number }>(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:w:1', 'W Co', now() - interval '1 hour') RETURNING id`, [W]);
      const res = await post("apply-broker", { action: "claim", worker_id: "gha-1", version: "t" }, worker);
      expect(res.status).toBe(200);
      const body = await res.json() as { packet: { id: number; user_id: string } | null; answers?: { email: string } };
      expect(body.packet?.id).toBe(w.id);
      expect(body.answers?.email).toBe("wren@example.com");
      const eRow = await one<{ attempts: number; claimed_at: string | null; claimable_at: string | null }>(`SELECT attempts, claimed_at, claimable_at FROM agent_submissions WHERE id = $1`, [e.id]);
      expect(eRow.attempts).toBe(0);
      expect(eRow.claimed_at).toBeNull();
      expect(new Date(String(eRow.claimable_at)).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    } finally {
      await db.exec(current + ";");
    }
  });

  it("with the claim this branch ships, an unfunded account's packet is never handed out at all", async () => {
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:e:2', 'E Co', now() - interval '2 hours')`, [E]);
    const w = await one<{ id: number }>(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:w:2', 'W Co', now() - interval '1 hour') RETURNING id`, [W]);
    const body = await (await post("apply-broker", { action: "claim", worker_id: "gha-1", version: "t" }, worker)).json() as { packet: { id: number } | null };
    expect(body.packet?.id).toBe(w.id);
    expect(client.rpcCalls("agent_unclaim_submission")).toEqual([]);
  });

  it("a failed entitlement read answers 503 and gives the packet back unspent — never a loop", async () => {
    const w = await one<{ id: number }>(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:w:3', 'W Co', now() - interval '1 hour') RETURNING id`, [W]);
    client.rpcFaults.set("agent_subscription_rows", { code: "57014", message: "canceling statement due to statement timeout" });
    const res = await post("apply-broker", { action: "claim", worker_id: "gha-1", version: "t" }, worker);
    expect(res.status).toBe(503);
    expect(client.rpcCalls("agent_claim_submission")).toHaveLength(1);
    const row = await one<{ attempts: number; claimed_at: string | null }>(`SELECT attempts, claimed_at FROM agent_submissions WHERE id = $1`, [w.id]);
    expect(row).toEqual({ attempts: 0, claimed_at: null });
  });

  it("a transient refusal waits 10, then 30 minutes; a send clears the stale reason and reaches the tracker", async () => {
    const w = await one<{ id: number }>(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at) VALUES ($1, 'breezy:w:4', 'W Co', now() - interval '1 hour') RETURNING id`, [W]);
    const claim = async () => (await (await post("apply-broker", { action: "claim", worker_id: "gha-1", version: "t" }, worker)).json() as { packet: { id: number; attempts: number } | null }).packet;
    const release = (patch: Record<string, unknown>) => post("apply-broker", { action: "release", id: w.id, patch }, worker);
    const at = async () => one<{ claimable_at: string; error: string; status: string }>(`SELECT claimable_at, error, status FROM agent_submissions WHERE id = $1`, [w.id]);

    expect((await claim())?.attempts).toBe(1);
    await release({ status: "ready", error: "will retry: driver error: timeout" });
    let row = await at();
    const first = new Date(row.claimable_at).getTime() - Date.now();
    expect(first).toBeGreaterThan(9 * 60_000);
    expect(first).toBeLessThan(11 * 60_000);
    expect(await claim()).toBeNull(); // waiting, not re-claimed twenty seconds later

    await db.query(`UPDATE agent_submissions SET claimable_at = now() - interval '1 second' WHERE id = $1`, [w.id]);
    expect((await claim())?.attempts).toBe(2);
    await release({ status: "ready", error: "will retry: net::ERR_CONNECTION_RESET" });
    row = await at();
    const second = new Date(row.claimable_at).getTime() - Date.now();
    expect(second).toBeGreaterThan(29 * 60_000);

    await db.query(`UPDATE agent_submissions SET claimable_at = now() - interval '1 second' WHERE id = $1`, [w.id]);
    expect((await claim())?.attempts).toBe(3);
    const sent = await release({ status: "submitted", submitted_at: new Date().toISOString(), submitted_via: "worker" });
    expect(await sent.json()).toMatchObject({ ok: true, mirrored: true });
    row = await at();
    expect(row.status).toBe("submitted");
    expect(row.error).toBe("");
  });

  it("an empty claim says when the next cancel window ends, so a started worker waits for it", async () => {
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, released_at, claimable_at) VALUES ($1, 'breezy:w:5', 'W Co', now(), now() + interval '5 minutes')`, [W]);
    const body = await (await post("apply-broker", { action: "claim", worker_id: "gha-1", version: "t" }, worker)).json() as { packet: null; nextClaimableInSeconds?: number };
    expect(body.packet).toBeNull();
    expect(body.nextClaimableInSeconds).toBeGreaterThan(250);
    expect(body.nextClaimableInSeconds).toBeLessThanOrEqual(300);
  });
});

// ── agent-access ─────────────────────────────────────────────────────────────

describe("agent-access answers only its caller, by account, and asks Stripe only through the meter", () => {
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it("signed out: 401, and nothing in the database or at Stripe is touched", async () => {
    const res = await post("agent-access", { email: "wren@example.com" });
    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty("currentPeriodEnd");
    expect(client.calls.filter((c) => c.kind === "rpc" || c.kind === "from")).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  it("an address in the body is ignored: the answer and every read are about the verified caller", async () => {
    const res = await post("agent-access", { email: "victim@example.com" }, bearer("jwt-nia"));
    const body = await res.json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    // Read twice (before and after the Stripe refresh), both times by the caller's id.
    expect(client.rpcCalls("agent_subscription_rows").length).toBeGreaterThan(0);
    for (const args of client.rpcCalls("agent_subscription_rows")) expect(args).toEqual({ p_user_ids: [N] });
    expect(stripe.calls.filter((c) => c.startsWith("customers.list"))).toEqual(["customers.list:nia@example.com"]);
    expect(JSON.stringify(body)).not.toMatch(/cus_|stripeCustomerId/);
  });

  it("a fresh live row bound to the caller is served without Stripe", async () => {
    await db.query(`UPDATE agent_subscribers SET updated_at = now() WHERE email = 'wren@example.com'`);
    const body = await (await post("agent-access", {}, bearer("jwt-wren"))).json() as Record<string, unknown>;
    expect(body).toMatchObject({ active: true, tier: "subscription", status: "active" });
    expect(stripe.calls).toEqual([]);
  });

  it("whoever registered a subscriber's address is told no — and the meter was asked before Stripe was", async () => {
    stripe.customers["victim@example.com"] = [{ id: "cus_victim" }];
    stripe.subs["cus_victim"] = [agentSub("active")];
    const before = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM test_door_hits WHERE door IN ('agent-access', 'agent-access-net')`)).n;
    const body = await (await post("agent-access", {}, bearer("jwt-registrant"))).json() as Record<string, unknown>;
    expect(body.active).toBe(false);
    expect(body.subscriptionUnbound).toBe(true);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM test_door_hits WHERE door IN ('agent-access', 'agent-access-net')`)).n).toBe(before + 2);
    expect(stripe.calls[0]).toBe("customers.list:victim@example.com");
    expect((await one<{ user_id: string | null }>(`SELECT user_id FROM agent_subscribers WHERE email = 'victim@example.com'`)).user_id).toBeNull();
  });

  it("over the meter: no Stripe call at all, and the answer says it is cached", async () => {
    await db.query(`INSERT INTO test_door_limits (door, refuse) VALUES ('agent-access', true) ON CONFLICT (door) DO UPDATE SET refuse = true`);
    try {
      const body = await (await post("agent-access", {}, bearer("jwt-registrant"))).json() as Record<string, unknown>;
      expect(body.cached).toBe(true);
      expect(stripe.calls).toEqual([]);
    } finally {
      await db.query(`UPDATE test_door_limits SET refuse = false WHERE door = 'agent-access'`);
    }
  });

  it("a plan whose Stripe subscription carries the buyer's user id binds to that account on its first read", async () => {
    stripe.customers["nia@example.com"] = [{ id: "cus_nia" }];
    stripe.subs["cus_nia"] = [agentSub("trialing", { user_id: N })];
    const body = await (await post("agent-access", {}, bearer("jwt-nia"))).json() as Record<string, unknown>;
    expect(body).toMatchObject({ active: true, tier: "subscription", status: "trialing" });
    expect((await one<{ user_id: string }>(`SELECT user_id FROM agent_subscribers WHERE email = 'nia@example.com'`)).user_id).toBe(N);
  });
});

// ── create-agent-checkout ────────────────────────────────────────────────────

describe("create-agent-checkout: signed in, about the caller only, and the plan carries its buyer", () => {
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it("signed out: 401, and Stripe is never asked about anyone", async () => {
    const res = await post("create-agent-checkout", { email: "victim@example.com" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ signInRequired: true });
    expect(stripe.calls).toEqual([]);
  });

  it("the publishable key is not a user", async () => {
    const res = await post("create-agent-checkout", { email: "victim@example.com" }, bearer(env.SUPABASE_ANON_KEY));
    expect(res.status).toBe(401);
    expect(stripe.calls).toEqual([]);
  });

  it("a body address is ignored; the session is the caller's and the subscription carries the caller's user id", async () => {
    stripe.customers["victim@example.com"] = [{ id: "cus_victim" }];
    stripe.subs["cus_victim"] = [agentSub("active")];
    const res = await post("create-agent-checkout", { email: "victim@example.com" }, bearer("jwt-registrant"));
    const body = await res.json() as Record<string, unknown>;
    // The registrant's own address holds a plan: that is the only thing it
    // learns (the merged checkout names the plan's tier, as payments' guard does).
    expect(body).toEqual({ alreadySubscribed: true, tier: "agent" });
    stripe.calls = [];
    const res2 = await post("create-agent-checkout", { email: "victim@example.com" }, bearer("jwt-kit"));
    expect(res2.status).toBe(200);
    expect(stripe.calls.filter((c) => c.startsWith("customers.list"))).toEqual(["customers.list:kit@example.com"]);
    const created = stripe.created.at(-1) as Record<string, unknown>;
    expect(created.customer_email).toBe("kit@example.com");
    expect(created.client_reference_id).toBe(K);
    expect((created.subscription_data as { metadata?: Record<string, string> }).metadata).toEqual({ user_id: K });
    expect((created.metadata as Record<string, string>).user_id).toBe(K);
  });

  it("is rate-limited per network before the token is even read", async () => {
    await db.query(`INSERT INTO test_door_limits (door, refuse) VALUES ('create-agent-checkout', true) ON CONFLICT (door) DO UPDATE SET refuse = true`);
    try {
      const res = await post("create-agent-checkout", {}, bearer("jwt-wren"));
      expect(res.status).toBe(429);
      expect(client.calls.some((c) => c.kind === "auth")).toBe(false);
      expect(stripe.calls).toEqual([]);
    } finally {
      await db.query(`UPDATE test_door_limits SET refuse = false WHERE door = 'create-agent-checkout'`);
    }
  });
});

// ── apply-agent ──────────────────────────────────────────────────────────────

describe("apply-agent: a prepared posting is never refunded, and a waiting packet goes with the wake behind it", () => {
  const P = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const maint = { "x-maintenance-key": env.MAINTENANCE_KEY };
  let pass = "";
  beforeAll(async () => {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'pat@example.com')`, [P]);
    await db.query(`UPDATE agent_mandates SET active = false`);
    await db.query(`INSERT INTO agent_mandates (user_id, active, apply_mode, auto_apply_sources, hold_first_n, undo_window_seconds, resume_text, full_name, last_prepare_kick_at)
                    VALUES ($1, true, 'auto', ARRAY['breezy'], 0, 900, repeat('x', 200), 'Pat Doe', now())`, [P]);
    pass = (await one<{ id: string }>(`INSERT INTO agent_passes (user_id, activated_at, expires_at, applications_used) VALUES ($1, now(), now() + interval '6 hours', 1) RETURNING id`, [P])).id;
  });
  beforeEach(async () => {
    await db.query(`DELETE FROM agent_submissions`);
    await db.query(`DELETE FROM agent_queue WHERE user_id = $1`, [P]);
    await db.query(`DELETE FROM agent_worker_heartbeat`);
  });

  it("through the fallback read, a pass row whose posting already has a packet is skipped and NOT refunded (review of L6-07)", async () => {
    await db.query(`INSERT INTO agent_queue (user_id, posting_id, company, status, pass_id) VALUES ($1, 'breezy:pat:1', 'Pat Co', 'approved', $2)`, [P, pass]);
    await db.query(`INSERT INTO agent_submissions (user_id, posting_id, company, status, released_at, pass_id) VALUES ($1, 'breezy:pat:1', 'Pat Co', 'ready', now(), $2)`, [P, pass]);
    client.rpcFaults.set("agent_queue_unprepared", { code: "PGRST202", message: "Could not find the function" });
    const res = await post("apply-agent", { source: "cron" }, maint);
    expect(res.status).toBe(200);
    const summary = await res.json() as Record<string, number>;
    expect(summary.skippedDuplicate).toBe(1);
    expect(summary.passRowsRefunded).toBe(0);
    expect(client.rpcCalls("agent_queue_refuse")).toEqual([]);
    expect((await one<{ applications_used: number }>(`SELECT applications_used FROM agent_passes WHERE id = $1`, [pass])).applications_used).toBe(1);
    expect((await one<{ status: string; pass_refunded_at: string | null }>(`SELECT status, pass_refunded_at FROM agent_queue WHERE posting_id = 'breezy:pat:1'`))).toEqual({ status: "approved", pass_refunded_at: null });
  });

  it("no sender awake, one ran two hours ago: the waiting packet is released, and the wake fires AFTER the run with it counted (review of L9-22)", async () => {
    await db.query(`INSERT INTO agent_worker_heartbeat (worker_id, last_seen) VALUES ('gha-old', now() - interval '2 hours')`);
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, source, status, release_refusal, fit_pct, pass_id)
       VALUES ($1, 'breezy:pat:2', 'Pat Co', 'breezy', 'ready', 'sender-offline', 80, $2) RETURNING id`, [P, pass])).id;
    const res = await post("apply-agent", { source: "cron" }, maint);
    const summary = await res.json() as Record<string, unknown>;
    expect(summary.senderOnline).toBe(false);
    expect(summary.senderReachable).toBe(true);
    expect(summary.released).toBe(1);
    const row = await one<{ released_at: string | null; release_refusal: string; claimable_at: string | null }>(`SELECT released_at, release_refusal, claimable_at FROM agent_submissions WHERE id = $1`, [id]);
    expect(row.released_at).not.toBeNull();
    expect(row.release_refusal).toBe("");
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toEqual({ url: env.WORKER_START_URL, body: env.WORKER_START_BODY });
    expect(summary.wake).toMatchObject({ attempted: true, ok: true });
  });

  it("no sender inside the backstop period either: nothing is released, the packet says why, and the wake still asks for one", async () => {
    const id = (await one<{ id: number }>(
      `INSERT INTO agent_submissions (user_id, posting_id, company, source, status, release_refusal, fit_pct, pass_id)
       VALUES ($1, 'breezy:pat:3', 'Pat Co', 'breezy', 'ready', 'sender-offline', 80, $2) RETURNING id`, [P, pass])).id;
    const summary = await (await post("apply-agent", { source: "cron" }, maint)).json() as Record<string, unknown>;
    expect(summary.senderReachable).toBe(false);
    expect(summary.released).toBe(0);
    expect((await one<{ release_refusal: string; released_at: string | null }>(`SELECT release_refusal, released_at FROM agent_submissions WHERE id = $1`, [id])))
      .toEqual({ release_refusal: "sender-offline", released_at: null });
    expect(wakes).toHaveLength(1);
  });
});
