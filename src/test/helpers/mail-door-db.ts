/**
 * A pglite database holding what migration 20261004100000 meets in production
 * -- api_keys (with user_id), the original market_pulse_subscribers,
 * suppressed_emails, the two digests' tables, the three client roles, the old
 * address-taking mint, and optionally a stand-in pg_cron (with or without the
 * digest jobs) -- with that migration applied.
 *
 * pglite has no vault and no pg_net, so the vault branches take their "not
 * installed" path and the cron command is stored, never run.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MAIL_DOOR_FILE = "supabase/migrations/20261004100000_a_mail_we_send_needs_a_proof_and_a_key_needs_a_mailbox.sql";
export const MAIL_DOOR_SQL = readFileSync(resolve(__dirname, "../../..", MAIL_DOOR_FILE), "utf8");

/** The file up to its self-verifying block, and that block alone. */
export const [MAIL_DOOR_APPLY, MAIL_DOOR_VERIFY] = (() => {
  const at = MAIL_DOOR_SQL.lastIndexOf("DO $$");
  return [MAIL_DOOR_SQL.slice(0, at), MAIL_DOOR_SQL.slice(at)];
})();

export const CRON_STAND_IN = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL);
  CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
    WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
`;

const BEFORE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL, owner_email text NOT NULL, tier text NOT NULL DEFAULT 'trial',
    rate_per_min integer NOT NULL DEFAULT 60, daily_quota integer NOT NULL DEFAULT 1000,
    created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, notes text, user_id uuid);
  CREATE TABLE public.market_pulse_subscribers (
    email text PRIMARY KEY, industry text NOT NULL DEFAULT 'general', last_score int,
    subscribed_at timestamptz NOT NULL DEFAULT now(), last_sent_at timestamptz, unsubscribed_at timestamptz);
  GRANT ALL ON public.market_pulse_subscribers TO anon, authenticated, service_role;
  CREATE TABLE public.suppressed_emails (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, reason text NOT NULL,
    metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
  -- The mint as 20260826214700 left it: an address in, a key out.
  CREATE FUNCTION public.api_key_issue(p_email text, p_name text, p_key_hash text, p_key_prefix text)
    RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  -- The two digests' tables, with the columns their claims read
  -- (20260711113000, 20260712171728, 20260714180000, 20260726030000;
  -- 20260721290000, 20260724213000).
  CREATE TABLE public.user_job_searches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
    params jsonb NOT NULL DEFAULT '{}'::jsonb, digest_opt_in boolean NOT NULL DEFAULT false,
    digest_last_sent_at timestamptz, fit_threshold integer NOT NULL DEFAULT 0,
    digest_cadence text NOT NULL DEFAULT 'weekly' CHECK (digest_cadence IN ('daily', 'weekly')));
  CREATE TABLE public.agent_mandates (
    user_id uuid PRIMARY KEY, email text NOT NULL DEFAULT '', email_opt_in boolean NOT NULL DEFAULT true,
    email_last_sent_at timestamptz);
`;

/** The two digest jobs as 20260713150000 and 20260725224137 scheduled them: no header. */
export const DIGEST_CRONS_BEFORE = `
  SELECT cron.schedule('send-search-digest', '23 14 * * *', 'SELECT net.http_post(url := ''https://x/functions/v1/send-search-digest'')');
  SELECT cron.schedule('send-agent-digest', '40 6 * * *', 'SELECT net.http_post(url := ''https://x/functions/v1/send-agent-digest'')');
`;

export async function bootMailDoorDb(opts: { cron?: boolean; digestCrons?: boolean; seed?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BEFORE
    + (opts.cron ? CRON_STAND_IN + "SELECT cron.schedule('send-market-pulse', '47 15 * * *', 'SELECT 1');" : "")
    + (opts.cron && opts.digestCrons ? DIGEST_CRONS_BEFORE : "")
    + (opts.seed ?? ""));
  await db.exec(MAIL_DOOR_SQL);
  return db;
}

/** 64 hex characters built from one repeated character: a stand-in sha256. */
export const h64 = (c: string): string => c.repeat(64).slice(0, 64);

export async function rows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
