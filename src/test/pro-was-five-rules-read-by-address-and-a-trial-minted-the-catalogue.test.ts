// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild and the SQL runs in
// pglite.
/**
 * "IS PRO" WAS FIVE RULES, READ BY ADDRESS, AND A TRIAL MINTED THE CATALOGUE.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04: L6-08, L6-29; owner decision
 * 2026-10-04).
 *   - generate-apply-package counted only `active`: every trialing Agent
 *     subscriber, told "every tool is unlocked" by the Account page, got 402
 *     on batch prep.
 *   - The product checkout, the purchase verifier and the scanner each asked
 *     the Pro cache BY ADDRESS. Sign-ups are confirmed automatically, so a
 *     password sign-up as a subscriber's address (one with no account yet)
 *     minted that subscriber's whole catalogue.
 *   - A trialing plan minted free grants for every one-off product and scan
 *     pack; cancel before the first charge and keep them.
 *   - check-subscription called a trialing or address-only plan Pro, so the
 *     page offered tools the gates then refused.
 *
 * WHAT HOLDS NOW, run rather than read: the one rule (_shared/pro-standing.ts),
 * the SQL that feeds it (20261008130000) in pglite, and the shipped handlers.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { agentDb } from "./helpers/agent-db";
import { buildIsAtLeast } from "./helpers/fn-build";
import {
  accountProStanding,
  PRO_GRACE_MS,
  proGrantRefusal,
  proStandingFrom,
} from "../../supabase/functions/_shared/pro-standing";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DAY = 24 * 3600_000;
const soon = () => new Date(Date.now() + 20 * DAY).toISOString();

// ── the rule ────────────────────────────────────────────────────────────────
describe("one rule decides, for every caller", () => {
  it("a trial is Pro for the plan's ongoing features and mints no consumable", () => {
    expect(proStandingFrom([{ tier: "agent", status: "trialing", current_period_end: soon() }]))
      .toMatchObject({ pro: true, trialing: true, consumables: false, known: true });
  });

  it("a paid plan in either cache is Pro and may mint; a paid row outranks a trial", () => {
    expect(proStandingFrom([{ tier: "pro", status: "active", current_period_end: soon() }]))
      .toMatchObject({ pro: true, trialing: false, consumables: true });
    expect(proStandingFrom([{ tier: "agent", status: "active", current_period_end: null }]))
      .toMatchObject({ pro: true, consumables: true });
    expect(proStandingFrom([
      { tier: "agent", status: "trialing", current_period_end: soon() },
      { tier: "pro", status: "active", current_period_end: soon() },
    ])).toMatchObject({ pro: true, trialing: false, consumables: true });
  });

  it("one grace: a day past the period end still counts, a day and a minute does not", () => {
    const now = Date.now();
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(proStandingFrom([{ status: "active", current_period_end: at(PRO_GRACE_MS - 60_000) }], now).pro).toBe(true);
    expect(proStandingFrom([{ status: "active", current_period_end: at(PRO_GRACE_MS + 60_000) }], now).pro).toBe(false);
    expect(proStandingFrom([{ status: "active", current_period_end: "not a date" }], now).pro).toBe(false);
  });

  it("owing, cancelled and unknown statuses are not Pro; no rows is not Pro", () => {
    for (const status of ["past_due", "canceled", "inactive", "comped-ish", ""]) {
      expect(proStandingFrom([{ status, current_period_end: soon() }]).pro, status).toBe(false);
    }
    expect(proStandingFrom(null)).toMatchObject({ pro: false, known: true });
  });

  it("asks by verified account id only, and a failed read is unknown, never Pro", async () => {
    const asked: unknown[] = [];
    const db = { rpc: async (fn: string, args: Record<string, unknown>) => { asked.push([fn, args]); return { data: [{ status: "active" }], error: null }; } };
    expect((await accountProStanding(db, "owner@example.com")).pro).toBe(false);
    expect(asked).toEqual([]);
    const id = "00000000-0000-4000-8000-00000000a001";
    expect((await accountProStanding(db, id)).consumables).toBe(true);
    expect(asked).toEqual([["pro_entitlement_rows", { p_user_id: id }]]);
    const broken = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    expect(await accountProStanding(broken, id)).toMatchObject({ pro: false, consumables: false, known: false });
  });

  it("a grant is redeemable only for the account that minted it, while that account may still mint", async () => {
    const id = "00000000-0000-4000-8000-00000000a002";
    const rows = (status: string) => ({ rpc: async () => ({ data: [{ status, current_period_end: soon() }], error: null }) });
    expect(await proGrantRefusal(rows("active"), { user_id: id })).toBeNull();
    expect(await proGrantRefusal(rows("trialing"), { user_id: id })).toMatchObject({ status: 402 });
    expect(await proGrantRefusal(rows("active"), { user_id: null })).toMatchObject({ status: 402 });
    expect(await proGrantRefusal(rows("active"), { user_id: id, revoked_at: new Date().toISOString() })).toMatchObject({ status: 402 });
    expect(await proGrantRefusal({ rpc: async () => ({ data: null, error: { message: "x" } }) }, { user_id: id })).toMatchObject({ status: 503 });
  });
});

// ── the SQL that feeds it ───────────────────────────────────────────────────
describe("pro_entitlement_rows answers the account, from both caches (20261008130000)", () => {
  const M = "20261008130000_a_plan_is_read_by_the_account_that_bought_it_by_one_rule.sql";
  const OWNER = "00000000-0000-4000-8000-00000000b001";
  const SQUATTER = "00000000-0000-4000-8000-00000000b002";
  const OLD = "00000000-0000-4000-8000-00000000b003";

  it("binds a row whose address had an account, answers bound rows only to their account, and an unbound one only to a proven mailbox", async () => {
    const db = await agentDb({
      seed: `
        CREATE TABLE public.pro_subscribers (
          email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
          current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE public.pro_grants (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
          product_type text, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
        INSERT INTO auth.users (id, email) VALUES ('${OLD}', 'old@example.com'), ('${OWNER}', 'owner@example.com');
        INSERT INTO public.pro_subscribers (email, status, current_period_end)
          VALUES ('old@example.com', 'active', now() + interval '10 days'),
                 ('noaccount@example.com', 'active', now() + interval '10 days');`,
    });
    await db.exec(readFileSync(resolve(__dirname, "../../supabase/migrations", M), "utf8"));
    const rows = async (uid: string) =>
      (await db.query<{ tier: string; status: string; bound: boolean }>(`SELECT tier, status, bound FROM public.pro_entitlement_rows('${uid}')`)).rows;

    // The row that existed with an account is now that account's.
    expect(await rows(OLD)).toEqual([{ tier: "pro", status: "active", bound: true }]);

    // A password sign-up AFTER the migration, as the subscriber's address that had no account: nothing.
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${SQUATTER}', 'noaccount@example.com')`);
    expect(await rows(SQUATTER)).toEqual([]);
    // ...until the switch is on and the mailbox is confirmed after it (account made earlier).
    await db.exec(`UPDATE auth.users SET created_at = now() - interval '2 days', email_confirmed_at = now() WHERE id = '${SQUATTER}';
                   UPDATE public.mailbox_proof_settings SET confirmation_required_since = now() - interval '1 day';`);
    expect(await rows(SQUATTER)).toEqual([{ tier: "pro", status: "active", bound: false }]);

    // The agent tier is read too, bound by account.
    await db.exec(`INSERT INTO public.agent_subscribers (email, status, current_period_end, user_id)
                   VALUES ('anything@example.com', 'trialing', now() + interval '7 days', '${OWNER}')`);
    expect(await rows(OWNER)).toEqual([{ tier: "agent", status: "trialing", bound: true }]);
    expect(proStandingFrom(await rows(OWNER))).toMatchObject({ pro: true, trialing: true, consumables: false });

    // No client role may call it.
    const acl = await db.query<{ anon: boolean; authed: boolean }>(
      `SELECT has_function_privilege('anon', 'public.pro_entitlement_rows(uuid)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.pro_entitlement_rows(uuid)', 'EXECUTE') AS authed`);
    expect(acl.rows[0]).toEqual({ anon: false, authed: false });
    await db.close();
  });
});

// ── the shipped handlers ────────────────────────────────────────────────────
const OWNER = "00000000-0000-4000-8000-00000000c001";
const TRIALIST = "00000000-0000-4000-8000-00000000c002";
const SQUATTER = "00000000-0000-4000-8000-00000000c003";
const COMPED = "00000000-0000-4000-8000-00000000c004";
const USERS: Record<string, { id: string; email: string }> = {
  "jwt-owner": { id: OWNER, email: "owner@example.com" },
  "jwt-trialist": { id: TRIALIST, email: "trialist@example.com" },
  // Signed up by password as a paying subscriber's address; holds no plan.
  "jwt-squatter": { id: SQUATTER, email: "subscriber@example.com" },
  "jwt-comped": { id: COMPED, email: "comped@example.com" },
};
/** What pro_entitlement_rows answers per account. */
const PLANS: Record<string, Array<Record<string, unknown>>> = {
  [OWNER]: [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }],
  [TRIALIST]: [{ tier: "agent", status: "trialing", current_period_end: soon(), bound: true }],
  [COMPED]: [{ tier: "agent", status: "active", current_period_end: null, bound: true }],
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
  LOVABLE_API_KEY: "lovable_harness",
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__proStripe;
    this.customers = { list: async ({ email }) => ({ data: w().customers[email] ?? [], has_more: false }) };
    this.subscriptions = { list: async ({ customer }) => ({ data: w().subs[customer] ?? [], has_more: false }) };
    this.checkout = { sessions: {
      create: async (p) => { w().created.push(p); return { id: "cs_test_new", url: "https://checkout.stripe.com/c/cs_test_new", amount_total: 500, currency: "usd", mode: p.mode }; },
      retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; },
      expire: async () => ({}),
    } };
  }
}`;
const SERVER = "export function serve(h) { globalThis.__edgeHandler = h; }";
// A client made with the caller's Authorization header (generate-apply-package)
// answers getUser() for that header, as supabase-js does.
const CLIENT = `export function createClient(_u, _k, opts) {
  const c = globalThis.__proClient;
  const h = opts?.global?.headers?.Authorization;
  if (!h) return c;
  return { ...c, auth: { getUser: (jwt) => c.auth.getUser(jwt ?? String(h).replace(/^Bearer\\s+/i, "")) } };
}`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": SERVER,
  "https://deno.land/std@0.168.0/http/server.ts": SERVER,
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__proClient;",
  "_shared/ai-fallback.ts":
    "export const chainFrom = (m) => [m]; export const callAIWithModelFallback = async () => { globalThis.__proAiCalls++; return { response: new Response('{}', { status: 500 }), modelUsed: 'fake' }; };",
};

type StripeWorld = { customers: Record<string, Array<{ id: string }>>; subs: Record<string, unknown[]>; sessions: Record<string, unknown>; created: Array<Record<string, unknown>> };
const handlers: Record<string, EdgeHandler> = {};
let db: FakeDb;
let stripe: StripeWorld;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  for (const fn of ["create-product-checkout", "check-subscription", "verify-product-purchase", "generate-apply-package", "create-subscription-checkout"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ pro_subscribers: ["email"], used_stripe_sessions: ["session_id"] });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  db.rpcs.log_delivery_step = () => ({ data: null, error: null });
  db.rpcs.pro_entitlement_rows = (a) => ({ data: PLANS[String(a.p_user_id)] ?? [], error: null });
  // The same world in the address caches, as the old readers saw it: so a
  // reader that still asks by address, or still lets a trial mint, is caught.
  db.rows("pro_subscribers").push({ email: "owner@example.com", status: "active", current_period_end: soon(), updated_at: new Date().toISOString() });
  db.rows("agent_subscribers").push(
    { email: "trialist@example.com", status: "trialing", current_period_end: soon(), stripe_customer_id: "cus_t" },
    { email: "comped@example.com", status: "active", current_period_end: null, stripe_customer_id: null },
  );
  stripe = { customers: {}, subs: {}, sessions: {}, created: [] };
  const g = globalThis as Record<string, unknown>;
  g.__proStripe = stripe;
  g.__proAiCalls = 0;
  g.__proClient = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (jwt?: string) => {
        const u = jwt ? USERS[jwt] : undefined;
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "bad jwt" } };
      },
    },
  };
});

const post = (fn: string, body: Record<string, unknown>, bearer?: string) =>
  handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.8", authorization: `Bearer ${bearer ?? env.SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  }));

describe("create-product-checkout mints a grant only for an account whose plan may mint", () => {
  it("a password sign-up as a subscriber's address is sent to Stripe, whatever the address's cache row says", async () => {
    db.rows("pro_subscribers").push({ email: "subscriber@example.com", status: "active", current_period_end: soon() });
    const body = await (await post("create-product-checkout", { productId: "coverLetter" }, "jwt-squatter")).json();
    expect(body.proIncluded).toBeUndefined();
    expect(db.rows("pro_grants")).toEqual([]);
    expect(stripe.created).toHaveLength(1);
  });

  it("a trialing plan mints no free one-off product and no scan pack", async () => {
    for (const productId of ["coverLetter", "scanPack"]) {
      const body = await (await post("create-product-checkout", { productId }, "jwt-trialist")).json();
      expect(body.proIncluded, productId).toBeUndefined();
    }
    expect(db.rows("pro_grants")).toEqual([]);
    expect(stripe.created).toHaveLength(2);
  });

  it("a paid plan, or a comped agent plan, gets the grant, which names the account", async () => {
    for (const [jwt, uid] of [["jwt-owner", OWNER], ["jwt-comped", COMPED]] as const) {
      const body = await (await post("create-product-checkout", { productId: "coverLetter" }, jwt)).json();
      expect(body.proIncluded, jwt).toBe(true);
      expect(db.rows("pro_grants").at(-1)).toMatchObject({ user_id: uid, product_id: "coverLetter" });
    }
    expect(stripe.created).toEqual([]);
  });

  it("a plan that cannot be read is a 503, never a charge for an included tool", async () => {
    db.rpcs.pro_entitlement_rows = () => ({ data: null, error: { message: "boom" } });
    const res = await post("create-product-checkout", { productId: "coverLetter" }, "jwt-owner");
    expect(res.status).toBe(503);
    expect(stripe.created).toEqual([]);
  });
});

describe("verify-product-purchase redeems a grant for the account that minted it", () => {
  const grant = (over: Record<string, unknown>) => {
    const id = `${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000`;
    db.rows("pro_grants").push({ id, email: "owner@example.com", product_id: "coverLetter", product_type: "cover_letter", product_name: "Cover Letter Generator", consumed_at: null, ...over });
    return `pro_${id}`;
  };

  it("an account that is only trialing now cannot spend a grant, and the grant survives the 402", async () => {
    const sid = grant({ user_id: TRIALIST, email: "trialist@example.com" });
    const res = await post("verify-product-purchase", { sessionId: sid });
    expect(res.status).toBe(402);
    expect(db.rows("pro_grants")[0].consumed_at).toBeNull();
  });

  it("a grant minted before grants named their account is refused, not honoured by its address", async () => {
    const res = await post("verify-product-purchase", { sessionId: grant({ user_id: null }) });
    expect(res.status).toBe(402);
  });

  it("the minting account with a paid plan redeems it once", async () => {
    const sid = grant({ user_id: OWNER });
    const res = await post("verify-product-purchase", { sessionId: sid });
    expect(res.status).toBe(200);
    expect(db.rows("pro_grants")[0].consumed_at).not.toBeNull();
  });
});

describe("generate-apply-package opens batch prep to every live plan, trial included", () => {
  const kit = { resumeText: "Jane Doe. Senior engineer. ".repeat(10), jobPostingText: "We are hiring a senior engineer to build things. ".repeat(3) };

  it("a trialing Agent subscriber reaches the generator instead of a 402", async () => {
    const res = await post("generate-apply-package", kit, "jwt-trialist");
    expect(res.status).not.toBe(402);
    expect((globalThis as Record<string, unknown>).__proAiCalls).toBeGreaterThan(0);
  });

  it("a password sign-up as a subscriber's address is still a 402", async () => {
    db.rows("pro_subscribers").push({ email: "subscriber@example.com", status: "active", current_period_end: soon() });
    const res = await post("generate-apply-package", kit, "jwt-squatter");
    expect(res.status).toBe(402);
  });
});

describe("check-subscription answers what the account's plan unlocks", () => {
  it("a trial reads as live, trialing, and not including the paid tools", async () => {
    stripe.customers["trialist@example.com"] = [{ id: "cus_t" }];
    stripe.subs.cus_t = [{ status: "trialing", items: { data: [{ price: { unit_amount: 9900 }, current_period_end: Math.floor(Date.now() / 1000) + 6 * 86400 }] } }];
    const body = await (await post("check-subscription", {}, "jwt-trialist")).json();
    expect(body).toMatchObject({ active: true, trialing: true, consumablesIncluded: false });
  });

  it("a comped agent account with no Stripe customer reads as Pro", async () => {
    const body = await (await post("check-subscription", {}, "jwt-comped")).json();
    expect(body).toMatchObject({ active: true, consumablesIncluded: true });
  });

  it("an address-only plan the account cannot use reads as not active, and says why", async () => {
    db.rows("pro_subscribers").push({ email: "subscriber@example.com", status: "active", current_period_end: soon(), updated_at: new Date().toISOString() });
    const body = await (await post("check-subscription", {}, "jwt-squatter")).json();
    expect(body).toMatchObject({ active: false, linkPending: true });
  });
});

describe("a Pro plan bought from now on is bound to the account that bought it", () => {
  it("create-subscription-checkout stamps the buyer's user id on the subscription", async () => {
    const body = await (await post("create-subscription-checkout", {}, "jwt-squatter")).json();
    expect(body.url).toBeTruthy();
    expect(stripe.created[0]).toMatchObject({ client_reference_id: SQUATTER, subscription_data: { metadata: { user_id: SQUATTER } } });
  });

  it("every handler here answers a build from this wave or later", async () => {
    for (const fn of Object.keys(handlers)) {
      const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(buildIsAtLeast(res.headers.get("x-fn-build"), fn, "2026-10-08"), `${fn}: ${res.headers.get("x-fn-build")}`).toBe(true);
    }
  });
});
