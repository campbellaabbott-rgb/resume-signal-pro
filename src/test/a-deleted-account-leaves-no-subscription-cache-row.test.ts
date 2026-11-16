// @vitest-environment node
/**
 * A DELETED ACCOUNT LEAVES NO SUBSCRIPTION CACHE ROW (S14X-231).
 *
 * check-subscription writes {email, stripe_customer_id NULL, status
 * 'inactive'} into pro_subscribers for every signed-in visitor with no plan,
 * to remember "not subscribed" for five minutes, and nothing removed it:
 * account_erase_personal_data never touched pro_subscribers or
 * agent_subscribers, so a deleted account's address stayed there for good.
 *
 * Run in pglite from Supabase's default grants: every migration that defines
 * the eraser, in order (the newest twice), onto the stand-in schema the other
 * eraser tests use plus the two plan tables.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const ERASERS = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql") && /FUNCTION public\.account_erase_personal_data\(/.test(readFileSync(resolve(DIR, n), "utf8")))
  .sort();

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
    resume_text text NOT NULL, analysis_result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.purchased_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, product_name text, generated_content jsonb);
  CREATE TABLE public.pro_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, user_id uuid, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid, checkout_function text NOT NULL DEFAULT 'x');
  CREATE TABLE public.pro_subscribers (email text PRIMARY KEY, stripe_customer_id text,
    status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','trialing','past_due','canceled','inactive')),
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid, cancel_at_period_end boolean);
  CREATE TABLE public.agent_subscribers (email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid);
`;

const A = "00000000-0000-4000-8000-00000000aa01";
const C = "00000000-0000-4000-8000-00000000cc03";
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  for (const f of ERASERS) await pg.exec(readFileSync(resolve(DIR, f), "utf8"));
  await pg.exec(readFileSync(resolve(DIR, ERASERS[ERASERS.length - 1]), "utf8"));
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.pro_subscribers; DELETE FROM public.agent_subscribers; DELETE FROM public.suppressed_emails;
    INSERT INTO public.pro_subscribers (email, stripe_customer_id, status, user_id) VALUES
      ('leaving@example.com', NULL, 'inactive', NULL),          -- check-subscription's cache row
      ('old-address@example.com', 'cus_paid', 'canceled', '${A}'), -- a plan the account paid for: a payment record
      ('comped@example.com', NULL, 'active', '${A}'),            -- a plan granted to the account by hand
      ('staying@example.com', NULL, 'inactive', NULL),           -- another person's cache row
      ('unproven@example.com', NULL, 'active', NULL);            -- a hand grant on an address nobody has proven
    INSERT INTO public.agent_subscribers (email, stripe_customer_id, status, user_id) VALUES
      ('leaving@example.com', NULL, 'inactive', NULL),
      ('agent-paid@example.com', 'cus_agent', 'active', '${A}');
  `);
});

const erase = async (user: string, email: string, proven: boolean) => (await pg.query<{ r: Record<string, unknown> }>(
  "SELECT public.account_erase_personal_data($1, $2, $3) AS r", [user, email, proven])).rows[0].r;
const pro = async () => (await pg.query<{ email: string }>("SELECT email FROM public.pro_subscribers ORDER BY email")).rows.map((r) => r.email);
const agent = async () => (await pg.query<{ email: string }>("SELECT email FROM public.agent_subscribers ORDER BY email")).rows.map((r) => r.email);

describe("account_erase_personal_data takes the plan rows that are not payment records", () => {
  it("without a proof: the address's 'not subscribed' rows and the account's no-customer rows go; payment records and other people's rows stay", async () => {
    const r = await erase(A, "Leaving@Example.com", false);
    expect(await pro()).toEqual(["old-address@example.com", "staying@example.com", "unproven@example.com"]);
    expect(await agent()).toEqual(["agent-paid@example.com"]);
    expect(r).toMatchObject({ pro_cache_rows_deleted: 3, by_address: false });
  });

  it("a live hand grant on an address goes only with a proven mailbox", async () => {
    expect((await erase(C, "unproven@example.com", false)).pro_cache_rows_deleted).toBe(0);
    expect(await pro()).toContain("unproven@example.com");
    expect((await erase(C, "unproven@example.com", true)).pro_cache_rows_deleted).toBe(1);
    expect(await pro()).not.toContain("unproven@example.com");
  });

  it("a second erase finds nothing more", async () => {
    await erase(A, "leaving@example.com", false);
    expect((await erase(A, "leaving@example.com", false)).pro_cache_rows_deleted).toBe(0);
  });

  it("is still a definer with a fixed search_path, refused to both client roles", async () => {
    const { rows } = await pg.query<{ d: boolean; a: boolean; u: boolean; s: boolean }>(
      `SELECT p.prosecdef AS d, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u, has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
         FROM pg_proc p WHERE p.oid = 'public.account_erase_personal_data(uuid,text,boolean)'::regprocedure`);
    expect(rows[0]).toEqual({ d: true, a: false, u: false, s: true });
  });
});
