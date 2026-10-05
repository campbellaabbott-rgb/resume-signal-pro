/**
 * THE AGENT'S DATABASE, FOR TESTS: STAND-IN TABLES, THE REAL TRIGGERS, THE
 * REAL MIGRATIONS.
 *
 * The first version of the agents-api pglite test built agent_submissions with
 * no triggers, and so passed a migration that production would have refused:
 * the learned-answer retry set status 'ready' on a row that still carried
 * blockers, and the live agent_submissions_guard raises on exactly that — inside
 * the candidate's own save of their answer (agents-api review, 2026-10-05).
 *
 * So the tables here are stand-ins with the columns the SQL touches, and every
 * TRIGGER and FUNCTION the outcome depends on is the LIVE definition read from
 * the migrations (helpers/live-sql.ts takes the last file that defines each):
 * agent_submissions_guard, the pass refund trigger, the worker heartbeat and
 * sent-today counters. Then the branch's own migrations run, self-checks and
 * all — those DO blocks exercise the real functions with the first account and
 * roll back, so they run here on every test run as well.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveDefinitionOf } from "./live-sql";

const MIG = resolve(__dirname, "../../../supabase/migrations");
export const migration = (file: string): string => readFileSync(resolve(MIG, file), "utf8");

export const M_ENTITLEMENT = "20261005130000_an_entitlement_is_read_by_the_account_and_a_signed_in_key_has_limits.sql";
export const M_GATES = "20261005133000_a_held_packet_can_go_and_the_last_gate_reads_the_stop_button.sql";
export const M_ONE_CLICK = "20261005134500_oracle_leaves_the_one_click_mirror_with_the_list_it_mirrors.sql";

/** The tables the agent's SQL touches, with the columns it reads and writes. */
export const AGENT_STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE auth.identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
    provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}'
  );
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      'service_role') $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

  CREATE TABLE public.agent_mandates (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id),
    email text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT false,
    resume_text text NOT NULL DEFAULT '', full_name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
    linkedin text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', postcode text NOT NULL DEFAULT '',
    resume_file_url text NOT NULL DEFAULT '', work_authorized boolean, requires_sponsorship boolean,
    willing_to_relocate boolean, work_authorized_countries text[] NOT NULL DEFAULT '{}',
    salary_expectation text NOT NULL DEFAULT '', earliest_start text NOT NULL DEFAULT '',
    cover_note text NOT NULL DEFAULT '', tailor_cover_note boolean NOT NULL DEFAULT false,
    share_demographics boolean NOT NULL DEFAULT false, consent_to_processing boolean NOT NULL DEFAULT false,
    apply_mode text NOT NULL DEFAULT 'review',
    auto_apply_daily_cap integer NOT NULL DEFAULT 5 CHECK (auto_apply_daily_cap BETWEEN 1 AND 20),
    auto_apply_sources text[] NOT NULL DEFAULT '{}',
    paused_until timestamptz, blocked_companies text[] NOT NULL DEFAULT '{}',
    employer_cooldown_days integer NOT NULL DEFAULT 14 CHECK (employer_cooldown_days BETWEEN 0 AND 365),
    hold_first_n integer NOT NULL DEFAULT 3, auto_released_count integer NOT NULL DEFAULT 0,
    undo_window_seconds integer NOT NULL DEFAULT 900, last_prepare_kick_at timestamptz
  );
  CREATE TABLE public.agent_subscribers (
    email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
  );
  -- The real table's NOT NULL columns carry defaults here only so a test can
  -- write a pass in one line; the self-checks write every one explicitly.
  CREATE TABLE public.agent_passes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    stripe_session_id text NOT NULL DEFAULT ('cs_test_' || gen_random_uuid()), stripe_payment_intent_id text,
    amount_cents integer NOT NULL DEFAULT 2900, session_hours integer NOT NULL DEFAULT 6,
    applications_total integer NOT NULL DEFAULT 10, applications_used integer NOT NULL DEFAULT 0,
    rate_per_min integer NOT NULL DEFAULT 60, daily_quota integer NOT NULL DEFAULT 5000,
    purchased_at timestamptz NOT NULL DEFAULT now(),
    shelf_expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
    activated_at timestamptz, expires_at timestamptz, closed_at timestamptz, close_reason text,
    CHECK (applications_used >= 0 AND applications_used <= applications_total)
  );
  CREATE UNIQUE INDEX agent_passes_one_open_pass_per_user ON public.agent_passes (user_id) WHERE closed_at IS NULL;
  CREATE TABLE public.agent_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL, posting_id text NOT NULL,
    title text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '', company_token text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '', apply_url text NOT NULL DEFAULT '', salary text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT 'other', posted_at timestamptz, fit_pct integer,
    reasons jsonb NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'ready',
    created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
    search_id bigint, search_label text NOT NULL DEFAULT '', pass_id uuid REFERENCES public.agent_passes(id),
    UNIQUE (user_id, posting_id)
  );
  GRANT SELECT ON public.agent_queue TO authenticated;
  GRANT UPDATE (status, decided_at) ON public.agent_queue TO authenticated;
  CREATE TABLE public.agent_submissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL, posting_id text NOT NULL, title text NOT NULL DEFAULT '',
    company text NOT NULL DEFAULT '', company_token text NOT NULL DEFAULT '', apply_url text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'breezy',
    status text NOT NULL DEFAULT 'ready' CHECK (status IN ('preparing','ready','blocked','submitted','failed','stale')),
    fields jsonb NOT NULL DEFAULT '{}', questions jsonb NOT NULL DEFAULT '[]', answers jsonb NOT NULL DEFAULT '[]',
    fit_pct integer, prepared_at timestamptz DEFAULT now(),
    released_at timestamptz, release_refusal text NOT NULL DEFAULT '', claimable_at timestamptz,
    claimed_at timestamptz, claimed_by text NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0,
    submitted_at timestamptz, submitted_via text, error text NOT NULL DEFAULT '',
    pass_id uuid REFERENCES public.agent_passes(id), pass_refunded_at timestamptz,
    blockers jsonb NOT NULL DEFAULT '[]', sent_answers jsonb, sent_evidence text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, posting_id)
  );
  CREATE TABLE public.agent_learned_answers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL,
    question_key text NOT NULL, question_label text NOT NULL,
    answer_kind text NOT NULL CHECK (answer_kind IN ('fill','choose','check')),
    answer_value text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, question_key)
  );
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text, owner_email text, tier text, user_id uuid, revoked_at timestamptz, notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.agent_worker_heartbeat (
    worker_id text PRIMARY KEY, last_seen timestamptz NOT NULL DEFAULT now(),
    claimed_total integer NOT NULL DEFAULT 0, version text NOT NULL DEFAULT ''
  );
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  CREATE TABLE public.user_applications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, company text, role text,
    status text, job_id text, apply_url text
  );
  -- The two door counters the functions consult, as counters: a test can
  -- watch them being asked and make them say no.
  CREATE TABLE public.test_door_hits (door text, bucket text, at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.test_door_limits (door text PRIMARY KEY, refuse boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.mail_door_take(p_door text, p_bucket text, p_max integer, p_window_minutes integer)
  RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public.test_door_hits (door, bucket) VALUES (p_door, p_bucket);
    RETURN NOT coalesce((SELECT refuse FROM public.test_door_limits WHERE door = p_door), false);
  END $$;
  CREATE FUNCTION public.check_rate_limit(p_function text, p_ip text, p_max_requests integer, p_window_minutes integer)
  RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public.test_door_hits (door, bucket) VALUES (p_function, p_ip);
    RETURN NOT coalesce((SELECT refuse FROM public.test_door_limits WHERE door = p_function), false);
  END $$;
  CREATE FUNCTION public.record_checkout_start(p jsonb DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.agent_maintenance_key_matches(p_key text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`;

/** The live body of a function, as a CREATE statement. */
const live = (fn: string): string => `CREATE OR REPLACE ${liveDefinitionOf(fn).body}\n$$;`;

/** The live triggers and functions the agent's outcomes depend on. */
export function liveAgentSql(): string {
  return [
    live("agent_submissions_guard"),
    `CREATE TRIGGER agent_submissions_guard_trg BEFORE INSERT OR UPDATE ON public.agent_submissions
       FOR EACH ROW EXECUTE FUNCTION public.agent_submissions_guard();`,
    // The pass refund trigger, function and trigger as its last file wrote them.
    migration("20260917170000_a_pass_refund_is_the_pipelines_to_give_never_the_owners_to_take.sql"),
    live("agent_sender_online"),
    live("agent_worker_ping"),
    live("agent_sent_today"),
    live("agent_note_auto_release"),
  ].join("\n");
}

export type AgentDbOptions = {
  /** SQL run after the stand-ins and live functions, before the migrations (accounts the self-checks use). */
  seed?: string;
};

export async function agentDb(opts: AgentDbOptions = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AGENT_STAND_INS);
  await db.exec(liveAgentSql());
  if (opts.seed) await db.exec(opts.seed);
  await db.exec(migration(M_ENTITLEMENT));
  await db.exec(migration(M_GATES));
  return db;
}
