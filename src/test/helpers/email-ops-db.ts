/**
 * A pglite database holding the tables the wave-2 email-ops migrations
 * (20261008120000-20261008129999) meet in production, with a stand-in pg_cron
 * and the three client roles. pglite has no vault and no pg_net, so a cron
 * command is stored and never run, and a vault branch takes its "not
 * installed" path.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CRON_STAND_IN } from "./mail-door-db";

const MIG_DIR = resolve(__dirname, "../../../supabase/migrations");

/** The text of the migration whose file name starts with `stamp`. */
export function migration(stamp: string): string {
  const f = readdirSync(MIG_DIR).find((n) => n.startsWith(`${stamp}_`));
  if (!f) throw new Error(`no migration ${stamp}`);
  return readFileSync(resolve(MIG_DIR, f), "utf8");
}

/** The file up to its LAST self-verifying block, and that block alone. */
export function splitVerify(sql: string): [string, string] {
  const at = sql.lastIndexOf("DO $$");
  return [sql.slice(0, at), sql.slice(at)];
}

export const BEFORE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
  CREATE TABLE public.user_job_searches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
    params jsonb NOT NULL DEFAULT '{}'::jsonb, digest_opt_in boolean NOT NULL DEFAULT false,
    digest_last_sent_at timestamptz, fit_threshold integer NOT NULL DEFAULT 0,
    digest_cadence text NOT NULL DEFAULT 'weekly');
  -- email_send_log as 20260702190811 left it.
  CREATE TABLE public.email_send_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text NOT NULL,
    recipient_email text NOT NULL, status text NOT NULL, error_message text, metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq'));
  CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log(message_id) WHERE status = 'sent';
  GRANT ALL ON public.email_send_log TO service_role;
  -- company_claims as 20260722190000 left it.
  CREATE TABLE public.company_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_token text NOT NULL, company_name text,
    work_email text NOT NULL, contact_name text, website text, note text,
    verify_token uuid NOT NULL DEFAULT gen_random_uuid(), domain_match boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','email_confirmed','verified','rejected')),
    created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, UNIQUE (company_token, work_email));
  ALTER TABLE public.company_claims ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION public.get_company_claim_status(p_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object('verified', false) $$;
  REVOKE ALL ON FUNCTION public.get_company_claim_status(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_company_claim_status(text) TO anon, authenticated;
  -- heartbeat_results as 20260627121655 left it (closed to the client roles).
  CREATE TABLE public.heartbeat_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), function_name text NOT NULL, status text NOT NULL,
    response_time_ms integer, test_passed boolean NOT NULL DEFAULT false, error_message text,
    checks_passed jsonb, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
  -- the affiliate tables as 20251221233709 left them.
  CREATE TABLE public.affiliates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL,
    referral_code text NOT NULL UNIQUE DEFAULT md5(random()::text), commission_amount integer NOT NULL DEFAULT 500,
    status text NOT NULL DEFAULT 'active', total_earnings integer NOT NULL DEFAULT 0,
    pending_payout integer NOT NULL DEFAULT 0, paid_out integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.affiliate_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
    session_token text NOT NULL UNIQUE DEFAULT md5(random()::text), expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    created_at timestamptz NOT NULL DEFAULT now());
`;

export async function bootEmailOpsDb(opts: { cron?: boolean; apply?: string[]; seed?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BEFORE + (opts.cron ? CRON_STAND_IN : "") + (opts.seed ?? ""));
  for (const stamp of opts.apply ?? []) await db.exec(migration(stamp));
  return db;
}

export async function rows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
