// @vitest-environment node
/**
 * A CONFIRMED FREE KEY SCORES FIT TWENTY-FIVE TIMES A DAY (owner decision
 * 2026-10-11, MCP economics decision 2), and every paid-tier refusal on /v1
 * names the planned Builder API card.
 *
 * Before: POST /v1/fit answered 402 upgrade_required to every free key, for a
 * dictionary scorer the website gives away at 60 an hour; the ranked engine's
 * 402 pointed at a page with nothing to buy; and /v1/fit/ was metered apart
 * from /v1/fit, so a trailing slash would have been a second allowance.
 *
 * Run three ways: the rule by value (fit-allowance.ts, endpoint.ts), the SQL
 * reader in a real Postgres (pglite) against the tables the key door writes,
 * and the shipped handler with only its network faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootMailDoorDb, rows } from "./helpers/mail-door-db";
import { splitStatements } from "./helpers/function-acl";
import { FIT_FREE_DAILY, FIT_PAID_DAILY, fitGate, fitStandingFrom } from "../../supabase/functions/public-api/fit-allowance";
import { APPLICATION_ENDPOINT, applicationIdSegment, meteredEndpoint } from "../../supabase/functions/public-api/endpoint";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const migration = (prefix: string) => read(`supabase/migrations/${readdirSync(MIG_DIR).find((f) => f.startsWith(prefix))!}`);
const FIT_MIGRATION = migration("20261011110000_");

// ── the rule, by value ──────────────────────────────────────────────────────

describe("the fit gate, by value", () => {
  const free = (used: number, extra: Partial<{ confirmed: boolean; proven: boolean; userId: string | null }> = {}) =>
    ({ userId: null, confirmed: true, proven: false, used, ...extra });

  it("a confirmed free key scores up to the allowance, the call being judged included", () => {
    expect(FIT_FREE_DAILY).toBe(25);
    expect(fitGate({ paid: false, plan: false, standing: free(1) })).toEqual({ open: true, basis: "free", limit: 25, used: 1, left: 24 });
    expect(fitGate({ paid: false, plan: false, standing: free(25) })).toMatchObject({ open: true, left: 0 });
    expect(fitGate({ paid: false, plan: false, standing: free(26) })).toMatchObject({ open: false, reason: "spent", used: 26 });
  });

  it("a proven account counts as confirmed; neither is refused as unconfirmed, and so is a key with no row", () => {
    expect(fitGate({ paid: false, plan: false, standing: free(3, { confirmed: false, proven: true, userId: "u" }) })).toMatchObject({ open: true, basis: "free" });
    expect(fitGate({ paid: false, plan: false, standing: free(0, { confirmed: false }) })).toMatchObject({ open: false, reason: "unconfirmed" });
    expect(fitGate({ paid: false, plan: false, standing: null })).toMatchObject({ open: false, reason: "unconfirmed" });
  });

  it("a read that failed is unknown, never open; paid and plan open whatever the count", () => {
    expect(fitGate({ paid: false, plan: false, standing: undefined })).toMatchObject({ open: false, reason: "unknown" });
    expect(fitGate({ paid: true, plan: false, standing: undefined })).toMatchObject({ open: true, basis: "paid" });
    expect(fitGate({ paid: false, plan: true, standing: free(400) })).toMatchObject({ open: true, basis: "plan" });
  });

  it("parses the reader's row, and tells no row from a failed read", () => {
    expect(fitStandingFrom([{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 4 }], false))
      .toEqual({ userId: null, confirmed: true, proven: false, used: 4 });
    expect(fitStandingFrom([], false)).toBeNull();
    expect(fitStandingFrom(null, true)).toBeUndefined();
  });
});

describe("one metered name per route", () => {
  it("the application route is its own endpoint and names its posting", () => {
    expect(meteredEndpoint("/v1/jobs/greenhouse:acme:123/application")).toBe(APPLICATION_ENDPOINT);
    expect(meteredEndpoint("/v1/jobs/greenhouse:acme:123/application/")).toBe(APPLICATION_ENDPOINT);
    expect(applicationIdSegment("/v1/jobs/greenhouse%3Aacme%3A123/application")).toBe("greenhouse%3Aacme%3A123");
    expect(meteredEndpoint("/v1/jobs/greenhouse:acme:123")).toBe("/v1/jobs/{id}");
    expect(applicationIdSegment("/v1/jobs/greenhouse:acme:123")).toBeNull();
    expect(applicationIdSegment("/v1/jobs//application")).toBeNull();
  });

  it("/v1/fit/ is /v1/fit, so a trailing slash is not a second allowance", () => {
    expect(meteredEndpoint("/v1/fit/")).toBe("/v1/fit");
    expect(meteredEndpoint("/v1/fit")).toBe("/v1/fit");
    expect(meteredEndpoint("/v1/stats")).toBe("/v1/stats");
  });

  it("the paid ceiling the API states is the one job-fit enforces per key", () => {
    const scorer = read("supabase/functions/job-fit/index.ts");
    expect(/const FIT_KEY_MAX = (\d+);/.exec(scorer)?.[1]).toBe(String(FIT_PAID_DAILY));
    expect(FIT_PAID_DAILY).toBe(1000);
  });

  it("the free key's issued limits the index reports are the ones api_key_issue mints", () => {
    const mint = migration("20261004100000_");
    const api = read("supabase/functions/public-api/index.ts");
    const issued = /const FREE_KEY_ISSUED = \{ perDay: (\d+), perMinute: (\d+) \} as const;/.exec(api);
    expect(issued?.[1]).toBe(/c_quota integer := (\d+);/.exec(mint)?.[1]);
    expect(issued?.[2]).toBe(/c_rate integer := (\d+);/.exec(mint)?.[1]);
  });

  it("the key door states the same fit allowance it mints", () => {
    const door = read("supabase/functions/api-key-request/index.ts");
    expect(/const FREE_KEY_FIT_PER_DAY = (\d+);/.exec(door)?.[1]).toBe(String(FIT_FREE_DAILY));
    expect(door).toMatch(/limits: \{ perMinute: d\.ik_rate, perDay: d\.ik_quota, fitPerDay: FREE_KEY_FIT_PER_DAY \}/);
  });
});

// ── the SQL reader, in a real Postgres ──────────────────────────────────────

const PROVEN_FILE = migration("20261005130000_");
const PROVEN_SQL = splitStatements(PROVEN_FILE)
  .filter((s) => /^\s*(CREATE TABLE IF NOT EXISTS public\.mailbox_proof_settings|INSERT INTO public\.mailbox_proof_settings|CREATE OR REPLACE FUNCTION public\.account_mailbox_proven)/.test(s))
  .map((s) => `${s.trim()};`)
  .join("\n");

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function bootFitDb(): Promise<PGlite> {
  const db = await bootMailDoorDb();
  OPEN.push(db);
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE auth.identities (user_id uuid, provider text, identity_data jsonb);
    CREATE TABLE IF NOT EXISTS public.api_usage (
      key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL,
      endpoint text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day, endpoint));
  `);
  expect(PROVEN_SQL).toMatch(/account_mailbox_proven/);
  await db.exec(PROVEN_SQL);
  await db.exec(FIT_MIGRATION);
  return db;
}

type Standing = { fa_user_id: string | null; fa_confirmed: boolean; fa_proven: boolean; fa_used: number };
const standingOf = (db: PGlite, key: string, endpoint = "/v1/fit") =>
  rows<Standing>(db, "SELECT * FROM public.api_key_fit_allowance($1::uuid, $2)", [key, endpoint]);
const h = (c: string) => c.repeat(64).slice(0, 64);

describe("api_key_fit_allowance, applied to the tables the key door writes", () => {
  let db: PGlite;
  beforeAll(async () => { db = await bootFitDb(); }, 120_000);
  beforeEach(async () => { await db.exec("BEGIN"); });
  afterEach(async () => { await db.exec("ROLLBACK"); });

  const mint = async (email: string, token: string, keyHash: string): Promise<string> => {
    await rows(db, "SELECT * FROM public.api_key_request_open($1, 'app', $2, 'net-a')", [email, token]);
    const [r] = await rows<{ ik_issued: boolean }>(db, "SELECT * FROM public.api_key_issue($1, $2, 'rb_live_' || left($2, 8), 'net-b')", [token, keyHash]);
    expect(r.ik_issued).toBe(true);
    const [k] = await rows<{ id: string }>(db, "SELECT id FROM public.api_keys WHERE key_hash = $1", [keyHash]);
    return k.id;
  };

  it("a key minted through the confirmed link is confirmed, account-less, and counts only today's fit calls", async () => {
    const key = await mint("dev@example.org", h("a"), h("b"));
    expect(await standingOf(db, key)).toEqual([{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 0 }]);
    await db.query(`INSERT INTO public.api_usage (key_id, day, endpoint, calls) VALUES
      ($1, (now() AT TIME ZONE 'utc')::date, '/v1/fit', 7),
      ($1, (now() AT TIME ZONE 'utc')::date, '/v1/jobs', 90),
      ($1, (now() AT TIME ZONE 'utc')::date - 1, '/v1/fit', 25),
      ($1, (now() AT TIME ZONE 'utc')::date, '/mcp/fit_resume', 3)`, [key]);
    expect((await standingOf(db, key))[0].fa_used).toBe(7);
    expect((await standingOf(db, key, "/mcp/fit_resume"))[0].fa_used, "each door reads its own row").toBe(3);
  });

  it("a key nobody confirmed is not confirmed; a revoked or unknown key, or another endpoint, has no row", async () => {
    await db.query("INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier) VALUES ($1, 'rb_live_x', 'k', 'x@example.org', 'free')", [h("c")]);
    const [hand] = await rows<{ id: string }>(db, "SELECT id FROM public.api_keys WHERE key_hash = $1", [h("c")]);
    expect((await standingOf(db, hand.id))[0]).toMatchObject({ fa_confirmed: false, fa_proven: false });
    expect(await standingOf(db, hand.id, "/v1/jobs")).toEqual([]);
    await db.query("UPDATE public.api_keys SET revoked_at = now() WHERE id = $1", [hand.id]);
    expect(await standingOf(db, hand.id)).toEqual([]);
    expect(await standingOf(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("an account-bound key is proven only when its account proved the mailbox (a provider-verified address)", async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    await db.query("INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, 'pat@example.org', now())", [uid]);
    await db.query("INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id) VALUES ($1, 'rb_live_y', 'agent', 'pat@example.org', 'free', $2)", [h("d"), uid]);
    const [bound] = await rows<{ id: string }>(db, "SELECT id FROM public.api_keys WHERE key_hash = $1", [h("d")]);
    expect((await standingOf(db, bound.id))[0], "an auto-confirmed password account proves nothing").toMatchObject({ fa_user_id: uid, fa_proven: false });
    await db.query(`INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ($1, 'google', '{"email":"pat@example.org","email_verified":"true"}')`, [uid]);
    expect((await standingOf(db, bound.id))[0]).toMatchObject({ fa_user_id: uid, fa_proven: true, fa_confirmed: false });
  });

  it("no client role may call it; service_role may", async () => {
    const [r] = await rows<{ anon: boolean; authed: boolean; service: boolean }>(db, `SELECT
      has_function_privilege('anon', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS authed,
      has_function_privilege('service_role', 'public.api_key_fit_allowance(uuid, text)', 'EXECUTE') AS service`);
    expect(r).toEqual({ anon: false, authed: false, service: true });
  });

  it("re-running the migration changes nothing and its self-check still passes", async () => {
    await db.exec(FIT_MIGRATION);
    const key = await mint("again@example.org", h("e"), h("f"));
    expect((await standingOf(db, key))[0].fa_confirmed).toBe(true);
  });
});

// ── the shipped handler ─────────────────────────────────────────────────────

type Decision = { key_tier: string };
let handler: EdgeHandler;
let decision: Decision;
let standing: { data: unknown; error: { message: string } | null };
let proRows: unknown[];
let rpcs: Array<{ name: string; args: Record<string, unknown> }>;
let fetched: string[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async (url: string) => {
    fetched.push(String(url));
    if (String(url).endsWith("/functions/v1/job-board")) {
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse", applyUrl: "https://x" }] }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/job-fit")) {
      return new Response(JSON.stringify({ fits: { "greenhouse:acme:1": 71 }, matched: { "greenhouse:acme:1": ["triage"] }, missing: {} }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__fitDb; }",
  });
}, 120_000);

beforeEach(() => {
  decision = { key_tier: "free" };
  standing = { data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 1 }], error: null };
  proRows = [];
  rpcs = [];
  fetched = [];
  const empty = { data: [], error: null, count: 0 };
  const chain: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(empty).then(ok);
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
      return () => chain;
    },
  });
  (globalThis as Record<string, unknown>).__fitDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const r = Promise.resolve(
        name === "api_key_check"
          ? { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: decision.key_tier, rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null }
          : name === "api_key_fit_allowance" ? standing
          : name === "pro_entitlement_rows" ? { data: proRows, error: null }
          : { data: null, error: null },
      );
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: () => chain,
  };
});

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: "Bearer rb_live_harness_key_0123456789", "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  }));
  return { status: res.status, headers: res.headers, body: await res.json() as Record<string, unknown> };
};
const RESUME = "Registered nurse with eight years of triage, emergency department care, patient education and charting experience. ".repeat(2);
const fit = (path = "/v1/fit") => call(path, { method: "POST", body: { resumeText: RESUME, q: "nurse" } });
const scored = () => fetched.some((u) => u.endsWith("/functions/v1/job-fit"));
const errorOf = (b: Record<string, unknown>) => b.error as { code: string; message: string };

describe("POST /v1/fit, as shipped", () => {
  it("scores a confirmed free key and says what is left of its allowance", async () => {
    const { status, body } = await fit();
    expect(status).toBe(200);
    expect(scored()).toBe(true);
    expect((body.data as Array<{ fit: number }>)[0].fit).toBe(71);
    expect(body.allowance).toEqual({ basis: "free", dailyLimit: 25, usedToday: 1, leftToday: 24 });
    expect(rpcs.find((r) => r.name === "api_key_fit_allowance")?.args).toEqual({ p_key_id: "key-1", p_endpoint: "/v1/fit" });
  });

  it("the twenty-sixth call is a 402 naming the Builder card, with a Retry-After to midnight, and scores nothing", async () => {
    standing = { data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 26 }], error: null };
    const { status, headers, body } = await fit();
    expect(status).toBe(402);
    expect(errorOf(body).code).toBe("fit_allowance_used");
    expect(errorOf(body).message).toContain("https://resumebooster.work/data-api#builder");
    expect(Number(headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(headers.get("retry-after"))).toBeLessThanOrEqual(86_400);
    expect(fetched, "neither the board nor the scorer is asked").toEqual([]);
  });

  it("the twenty-fifth call still scores", async () => {
    standing = { data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 25 }], error: null };
    const { status, body } = await fit();
    expect(status).toBe(200);
    expect(body.allowance).toMatchObject({ leftToday: 0 });
  });

  it("a key nobody confirmed is told where a confirmed one comes from, and scores nothing", async () => {
    standing = { data: [{ fa_user_id: null, fa_confirmed: false, fa_proven: false, fa_used: 1 }], error: null };
    const { status, body } = await fit();
    expect(status).toBe(403);
    expect(errorOf(body).code).toBe("confirmed_key_required");
    expect(errorOf(body).message).toContain("https://resumebooster.work/data-api");
    expect(scored()).toBe(false);
    standing = { data: [], error: null };
    expect((await fit()).status, "no standing row is no confirmation").toBe(403);
  });

  it("a proven account scores on the free allowance", async () => {
    standing = { data: [{ fa_user_id: "11111111-1111-4111-8111-111111111111", fa_confirmed: false, fa_proven: true, fa_used: 2 }], error: null };
    expect((await fit()).status).toBe(200);
  });

  it("an account holding Pro or the Agent plan scores past the free count", async () => {
    standing = { data: [{ fa_user_id: "11111111-1111-4111-8111-111111111111", fa_confirmed: false, fa_proven: false, fa_used: 400 }], error: null };
    proRows = [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 864e5).toISOString(), bound: true }];
    const { status, body } = await fit();
    expect(status).toBe(200);
    expect(body.allowance).toMatchObject({ basis: "plan", dailyLimit: FIT_PAID_DAILY });
    expect(rpcs.find((r) => r.name === "pro_entitlement_rows")?.args).toEqual({ p_user_id: "11111111-1111-4111-8111-111111111111" });
  });

  it("a paid key scores without the free reader being asked", async () => {
    decision = { key_tier: "pro" };
    const { status, body } = await fit();
    expect(status).toBe(200);
    expect(body.allowance).toMatchObject({ basis: "paid", dailyLimit: FIT_PAID_DAILY });
    expect(rpcs.some((r) => r.name === "api_key_fit_allowance")).toBe(false);
  });

  it("a reader that fails is a 503, never a free score", async () => {
    standing = { data: null, error: { message: "boom" } };
    const { status, body } = await fit();
    expect(status).toBe(503);
    expect(errorOf(body).code).toBe("fit_allowance_unavailable");
    expect(scored()).toBe(false);
  });

  it("/v1/fit/ is metered as /v1/fit", async () => {
    await fit("/v1/fit/");
    expect(rpcs.find((r) => r.name === "api_key_check")?.args).toMatchObject({ p_endpoint: "/v1/fit" });
  });

  it("/v1/usage reports what is left of the fit allowance", async () => {
    standing = { data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 5 }], error: null };
    const { status, body } = await call("/v1/usage");
    expect(status).toBe(200);
    expect(body.fit).toEqual({ basis: "free", dailyLimit: 25, usedToday: 5, leftToday: 20 });
  });
});

describe("a paid-tier refusal names the Builder card", () => {
  it("engine=ranked on a free key", async () => {
    const { status, body } = await call("/v1/jobs?engine=ranked&q=nurse");
    expect(status).toBe(402);
    expect(errorOf(body).code).toBe("upgrade_required");
    expect(errorOf(body).message).toContain("https://resumebooster.work/data-api#builder");
  });

  it("a closure walk older than a free key reaches", async () => {
    const since = new Date(Date.now() - 40 * 864e5).toISOString();
    const { status, body } = await call(`/v1/changes?since=${encodeURIComponent(since)}`);
    expect(status).toBe(400);
    expect(errorOf(body).message).toContain("https://resumebooster.work/data-api#builder");
  });
});

describe("the /v1 index describes what the routes do", () => {
  it("lists the application route, states the fit allowance and the free tier, and points at the Builder card", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/public-api/v1"));
    const body = await res.json() as { endpoints: string[]; modes: Record<string, string>; tiers: { free: Record<string, unknown>; builder: Record<string, unknown> } };
    expect(res.headers.get("access-control-allow-methods"), "a browser may POST to /v1/fit").toMatch(/\bPOST\b/);
    expect(body.endpoints).toContain("/v1/jobs/{id}/application");
    expect(body.endpoints).toContain("POST /v1/fit");
    expect(body.modes.fit).toContain(`${FIT_FREE_DAILY} scored calls a UTC day`);
    expect(body.modes.fit).toContain(`up to ${FIT_PAID_DAILY} a day`);
    expect(body.modes.fit).toContain("https://resumebooster.work/data-api#builder");
    expect(body.modes.fit).not.toMatch(/\(paid\)/);
    expect(JSON.stringify(body), "a retired product is never named on /v1").not.toMatch(/\bAgent (?:Pass|plan)\b/);
    expect(body.tiers.free).toMatchObject({ fitPerDay: FIT_FREE_DAILY, closureHistoryDays: 3, rankedEngine: false, issuedWith: { perDay: 1000, perMinute: 60 } });
    expect(body.tiers.builder).toMatchObject({ status: "planned", url: "https://resumebooster.work/data-api#builder",
      proposed: { perDay: 5000, perMinute: 120, fitPerDay: FIT_PAID_DAILY, closureHistoryDays: 180, rankedEngine: true } });
  });
});
