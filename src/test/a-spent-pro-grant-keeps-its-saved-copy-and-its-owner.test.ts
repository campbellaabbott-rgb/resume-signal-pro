// @vitest-environment node
/**
 * A SPENT PRO GRANT KEEPS ITS SAVED COPY, AND ITS OWNER (S14X-104).
 *
 * The nightly purge deleted every Pro grant 90 days after it was spent, while
 * the copy it made is saved for a year under 'pro_' and the grant id. From
 * day 91 the link in the purchase mail answered 400 "Invalid session" for a
 * copy that still existed, and deleting the account left that copy behind,
 * because the eraser finds a Pro member's copies through the grant.
 *
 * Run, not read:
 *   - pglite from Supabase's default grants, with the purge as the repo's
 *     migrations left it, the cost wave's rewrite (20261109131000), then this
 *     round's file twice: the command keeps a spent grant while a live saved
 *     copy names it, deletes the others, keeps its other deletes and its
 *     timeout, and the eraser then still reaches the kept grant's copy;
 *   - verify-product-purchase with the grant row gone: a claim and a live
 *     saved copy open the copy (no first use, nothing minted); a refunded
 *     order, a missing claim or a missing copy are refused as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => {
  const name = readdirSync(DIR).find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(DIR, name), "utf8");
};
const ERASERS = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql") && /FUNCTION public\.account_erase_personal_data\(/.test(readFileSync(resolve(DIR, n), "utf8")))
  .sort()
  .map((n) => readFileSync(resolve(DIR, n), "utf8"));

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}');
  CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL, owner_email text NOT NULL, tier text NOT NULL DEFAULT 'trial', created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz, user_id uuid);
  CREATE TABLE public.api_key_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);
  CREATE TABLE public.market_pulse_subscribers (email text PRIMARY KEY);
  CREATE TABLE public.free_scan_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);
  CREATE TABLE public.email_unsubscribe_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE);
  CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, reason text NOT NULL, metadata jsonb);
  CREATE TABLE public.mailbox_proof_settings (id boolean PRIMARY KEY DEFAULT true, confirmation_required_since timestamptz);
  CREATE TABLE public.resume_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), share_id text NOT NULL UNIQUE DEFAULT md5(random()::text),
    resume_text text NOT NULL, analysis_result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '90 days');
  CREATE TABLE public.purchased_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, product_name text, generated_content jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT now() + interval '365 days');
  CREATE TABLE public.pro_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, resume_session_id text, job_title text, job_company text, user_id uuid, revoked_at timestamptz,
    consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    checkout_function text NOT NULL, product_type text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, customer_email text, amount_cents int, metadata jsonb);
  CREATE TABLE public.rate_limits (id bigserial PRIMARY KEY, window_start timestamptz NOT NULL);
  CREATE TABLE public.detection_telemetry (id bigserial PRIMARY KEY, created_at timestamptz NOT NULL);
  CREATE TABLE public.scan_report_cache (cache_key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
`;

/** pg_cron's catalogue and the calls these files make, as pg_cron 1.6 shapes them. */
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    database text NOT NULL DEFAULT 'postgres', username text NOT NULL DEFAULT 'postgres',
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE
  );
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
                                 database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE cron.job j SET
      schedule = coalesce(alter_job.schedule, j.schedule),
      command = coalesce(alter_job.command, j.command),
      active = coalesce(alter_job.active, j.active)
     WHERE j.jobid = job_id;
  END $$;
`;

/** The nightly purge in both spellings the repo's migrations wrote. */
const PURGE_UPPER = `
      DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';
      DELETE FROM public.rate_limits WHERE window_start < now() - interval '3 days';
      DELETE FROM public.detection_telemetry WHERE created_at < now() - interval '90 days';
      DELETE FROM public.pro_grants WHERE consumed_at IS NOT NULL AND consumed_at < now() - interval '90 days';
      `;
const PURGE_LOWER = `
  delete from public.scan_report_cache where created_at < now() - interval '7 days';
  delete from public.rate_limits where window_start < now() - interval '3 days';
  delete from public.detection_telemetry where created_at < now() - interval '90 days';
  delete from public.pro_grants where consumed_at is not null and consumed_at < now() - interval '90 days';
  `;

const USER = "00000000-0000-4000-8000-00000000ee11";
const KEPT = "00000000-0000-4000-8000-0000000a0001";
const BARE = "00000000-0000-4000-8000-0000000a0002";
const EXPIRED = "00000000-0000-4000-8000-0000000a0003";
const FRESH = "00000000-0000-4000-8000-0000000a0004";

async function boot(purge: string): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(STAND_INS);
  for (const sql of ERASERS) await pg.exec(sql);
  await pg.exec(CRON);
  await pg.query("INSERT INTO cron.job (jobname, schedule, command) VALUES ('scan-cache-and-telemetry-purge', '10 4 * * *', $1)", [purge]);
  await pg.query("INSERT INTO cron.job (jobname, schedule, command) VALUES ('scan-report-cache-retention', '13 * * * *', $1)",
    ["DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';"]);
  await pg.exec(file("20261109131000_"));
  await pg.exec(file("20261112150000_"));
  await pg.exec(file("20261112150000_"));
  return pg;
}
const command = async (pg: PGlite) =>
  (await pg.query<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'scan-cache-and-telemetry-purge'")).rows[0].command;

describe.each([["upper case", PURGE_UPPER], ["lower case", PURGE_LOWER]])("the nightly purge, written in %s", (_name, purge) => {
  let pg: PGlite;
  beforeAll(async () => { pg = await boot(purge); }, 180_000);
  afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

  beforeEach(async () => {
    await pg.exec(`
      DELETE FROM public.purchased_content; DELETE FROM public.pro_grants; DELETE FROM auth.users;
      DELETE FROM public.rate_limits; DELETE FROM public.detection_telemetry;
      INSERT INTO auth.users (id, email) VALUES ('${USER}', 'pro@example.com');
      INSERT INTO public.pro_grants (id, email, product_id, product_type, user_id, consumed_at) VALUES
        ('${KEPT}', 'pro@example.com', 'careerSnapshot', 'career_snapshot', '${USER}', now() - interval '100 days'),
        ('${BARE}', 'pro@example.com', 'careerSnapshot', 'career_snapshot', '${USER}', now() - interval '100 days'),
        ('${EXPIRED}', 'pro@example.com', 'careerSnapshot', 'career_snapshot', '${USER}', now() - interval '100 days'),
        ('${FRESH}', 'pro@example.com', 'careerSnapshot', 'career_snapshot', '${USER}', now() - interval '10 days');
      INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, generated_content, expires_at) VALUES
        ('pro_${KEPT}', 'other-address@example.com', 'career_snapshot', '{"kept": true}', now() + interval '200 days'),
        ('pro_${EXPIRED}', 'other-address@example.com', 'career_snapshot', '{"kept": false}', now() - interval '1 day');
      INSERT INTO public.rate_limits (window_start) VALUES (now() - interval '5 days'), (now());
      INSERT INTO public.detection_telemetry (created_at) VALUES (now() - interval '100 days'), (now());
    `);
  });

  it("keeps a spent grant while a live saved copy names it, and deletes the bare and the expired one", async () => {
    await pg.exec(await command(pg));
    const left = (await pg.query<{ id: string }>("SELECT id::text FROM public.pro_grants ORDER BY id")).rows.map((r) => r.id);
    expect(left).toEqual([KEPT, FRESH]);
  });

  it("keeps its other deletes, in place, and its timeout", async () => {
    const cmd = await command(pg);
    expect(cmd).toMatch(/^SET statement_timeout = '2min'; /);
    expect(cmd).not.toMatch(/scan_report_cache/i);
    expect(cmd).toMatch(/delete from public\.pro_grants/i);
    await pg.exec(cmd);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.rate_limits")).rows[0].n).toBe(1);
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM public.detection_telemetry")).rows[0].n).toBe(1);
  });

  it("the kept grant still leads the eraser to its copy, for an address that was never proven", async () => {
    await pg.exec(await command(pg));
    await pg.query("SELECT public.account_erase_personal_data($1, 'pro@example.com', false)", [USER]);
    const copies = (await pg.query<{ s: string }>("SELECT stripe_session_id AS s FROM public.purchased_content")).rows;
    expect(copies.map((c) => c.s)).not.toContain(`pro_${KEPT}`);
  });
});

describe("where the job is absent or pg_cron is not installed", () => {
  it("the file applies and changes nothing", async () => {
    const pg = new PGlite();
    await pg.exec(STAND_INS);
    await pg.exec(file("20261112150000_"));
    await pg.exec(CRON);
    await pg.exec(file("20261112150000_"));
    expect((await pg.query("SELECT 1 FROM cron.job")).rows).toEqual([]);
    await pg.close();
  });
});

// ── verify-product-purchase, with the grant row gone ──────────────────────

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const GRANT = "pro_00000000-0000-4000-8000-0000000b0001";
let verify: EdgeHandler;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });

describe("a link whose grant the purge removed", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    // The fake speaks .not("col", "is", null) as "col is set", as supabase-js sends it.
    const from = (t: string) => {
      const q = db.from(t) as unknown as Record<string, unknown> & { preds: Array<(r: Record<string, unknown>) => boolean> };
      q.not = (col: string) => { q.preds.push((r) => r[col] != null); return q; };
      return q;
    };
    g.__purgedClient = { from, rpc: (n: string, a: Record<string, unknown> = {}) => db.rpc(n, a), auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
    g.fetch = async () => new Response("{}", { status: 200 });
    verify = await loadEdgeHandler("verify-product-purchase", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async () => { throw new Error('a grant never reaches Stripe'); } } }; } }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__purgedClient; export class SupabaseClient {}",
      "https://esm.sh/resend@2.0.0": "export class Resend {}",
    });
  }, 180_000);

  beforeEach(() => {
    db.tables = {};
    db.writes = [];
    db.rows("used_stripe_sessions").push({ session_id: GRANT, product_type: "career_snapshot" });
    db.rpcs = {
      check_rate_limit: () => ({ data: true, error: null }),
      get_purchased_content_by_session: (a) => ({
        data: a.p_session_id === GRANT ? [{ product_type: "career_snapshot", product_name: "Career Snapshot", customer_email: "pro@example.com", generated_content: { careerSignalScore: { overall: "Strong" } } }] : [],
        error: null,
      }),
    };
  });

  const ask = async () => {
    const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
      body: JSON.stringify({ sessionId: GRANT, generateContent: true }),
    }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("opens its saved copy, as a revisit, with the address masked", async () => {
    const r = await ask();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ verified: true, isFirstUse: false, productType: "career_snapshot", generatedContent: { careerSignalScore: { overall: "Strong" } } });
    expect(r.body.customerEmail).not.toBe("pro@example.com");
    expect(db.writes.filter((w) => w.op !== "select"), "a revisit wrote something").toEqual([]);
  });

  it("a refunded order opens nothing", async () => {
    db.rows("product_deliveries").push({ stripe_session_id: GRANT, status: "refunded" });
    expect((await ask()).status).toBe(400);
  });

  it("a claim the refund rewrote opens nothing", async () => {
    db.rows("used_stripe_sessions")[0].product_type = "refunded";
    expect((await ask()).status).toBe(400);
  });

  it("no claim, or no saved copy, is refused as before", async () => {
    db.tables.used_stripe_sessions = [];
    expect((await ask()).status).toBe(400);
    db.rows("used_stripe_sessions").push({ session_id: GRANT, product_type: "career_snapshot" });
    db.rpcs.get_purchased_content_by_session = () => ({ data: [], error: null });
    expect((await ask()).status).toBe(400);
  });
});
