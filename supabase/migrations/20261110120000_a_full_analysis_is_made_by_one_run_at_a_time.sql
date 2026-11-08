-- A FULL ANALYSIS IS MADE BY ONE RUN AT A TIME (hotfix 2026-11-10; S14
-- M-S14-005, C-S14-005).
--
-- THE GAP. analyze-resume redeems a purchase only once the analysis exists,
-- so a failed run never uses it up. Nothing stopped two requests for one
-- purchase (two tabs, a double click, a retry while the first run was still
-- working) from each starting a model run: both were paid for, and only one
-- was delivered.
--
-- THE LEASE. A run now takes a row here, keyed by its session, before the
-- model call, and deletes it when it has delivered or failed. A second request
-- meanwhile finds the row and is answered 409 analysis_in_progress; the page
-- asks again until the first run's analysis is there. A row past expires_at
-- (a run the platform killed) is taken over, so nothing stays locked.
--
-- ORDER. Applied before analyze-resume 2026-11-10.1. Until then nothing reads
-- the table; a function that finds no table runs without a lease, as today.
--
-- SELF-VERIFYING. The DO block refuses the file unless the table exists with
-- its key and its shape checks, row-level security is on, the client roles
-- hold no privilege on it, and service_role can read, write and delete it.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.analysis_run_leases (
  session_id text PRIMARY KEY
    CONSTRAINT analysis_run_leases_is_a_purchase CHECK (
      session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'
      OR session_id ~* '^pro_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  holder uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.analysis_run_leases IS
  'One row per full analysis being made now: analyze-resume takes it before the model call and deletes it when the run delivers or fails; a row past expires_at is taken over. Service role only (20261110120000).';

ALTER TABLE public.analysis_run_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_run_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.analysis_run_leases TO service_role;

DO $$
DECLARE
  v_priv text;
BEGIN
  IF to_regclass('public.analysis_run_leases') IS NULL THEN
    RAISE EXCEPTION 'self-verify 20261110120000: public.analysis_run_leases does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.analysis_run_leases'::regclass AND contype = 'p'
  ) THEN
    RAISE EXCEPTION 'self-verify 20261110120000: analysis_run_leases has no primary key, so two runs could hold one session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.analysis_run_leases'::regclass AND conname = 'analysis_run_leases_is_a_purchase'
  ) THEN
    RAISE EXCEPTION 'self-verify 20261110120000: analysis_run_leases accepts a key that is no purchase';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE oid = 'public.analysis_run_leases'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'self-verify 20261110120000: analysis_run_leases does not have row-level security on';
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.analysis_run_leases', v_priv)
       OR has_table_privilege('authenticated', 'public.analysis_run_leases', v_priv) THEN
      RAISE EXCEPTION 'self-verify 20261110120000: a client role holds % on analysis_run_leases', v_priv;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.analysis_run_leases', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.analysis_run_leases', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.analysis_run_leases', 'DELETE') THEN
    RAISE EXCEPTION 'self-verify 20261110120000: service_role cannot read, take and free a lease, so every run would go without one';
  END IF;
  RAISE NOTICE 'self-verify 20261110120000: analysis_run_leases keyed by purchase, row-level security on, closed to the client roles, open to service_role';
END $$;
