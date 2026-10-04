-- EVERY CRON JOB GETS THE TIME ITS FUNCTION ASKS FOR.
--
-- 20261003220000 found that a function's SET statement_timeout never governs
-- a pg_cron run: the timer is armed when the top-level statement starts and
-- the setting has no assign hook, so every scheduled run is bounded by the
-- job owner's session (two minutes, measured at 120.03s twice). It moved the
-- limit into the command for the two field-curve jobs, and the 22:27Z run on
-- 2026-10-03 wrote the curve for the first time. Fifteen more jobs in this
-- lane call a function whose header asks for more than two minutes; each is
-- held to two by the same mechanism. This file does for every one of them what
-- that file did for two.
--
-- WHICH JOBS, DECIDED FROM THE LIVE CATALOGUE, NOT A LIST IN THIS FILE. The
-- live database carries jobs and function bodies the migration lane does not
-- (project_schema_drift), so the set is computed at apply time. A job is
-- rewritten when ALL of these hold:
--   - its command is exactly one call, `SELECT [public.]fn(args);`, and does
--     not already begin with SET (20261003220000's two do, and are left);
--   - fn exists in public and EVERY overload of it carries a statement_timeout
--     header, all the same value (a disagreement means the call's overload
--     cannot be told from here, so the job is left and named);
--   - that value is LONGER than two minutes. Only ever widening: a header at
--     or under 120s would, once it governed, cut short a run that today has the
--     full two minutes, so those jobs are left exactly as they are.
-- Jobs calling edge functions (net.http_post returns at once), plain SQL
-- retention commands and multi-statement commands are not touched.
--
-- HOW. cron.alter_job with the command only (production has it: 20260817222227
-- used it), so each job keeps its id, schedule, database, owner and ACTIVE
-- flag -- a job someone switched off stays off. The new command is the old one,
-- byte for byte, behind `SET statement_timeout = '<the header>'; `. A job this
-- role may not alter is named in a NOTICE and left; the self-verify below then
-- refuses the file, because a fix that silently skipped a job is the failure
-- shape this lane keeps finding.
--
-- WHAT CHANGES IN PRODUCTION. Nothing for a job that already finishes inside
-- two minutes, except headroom. A job that has been cancelled at two minutes
-- will now run as long as its own header says, which is the budget its author
-- wrote; some of these run every 2-15 minutes, and pg_cron does not start a
-- second copy of a job while one is running. Whether any were being cancelled
-- is what the reader below reports.
--
-- THE READER. cron.job_run_details is service-role only, so nobody outside the
-- owner's dashboard could see a job being cancelled -- which is how the field
-- curve stayed dark for a week. public.get_cron_health(p_hours) returns, per
-- job: its name, schedule, active flag, the timeout its command sets (or null),
-- and over the window the runs, failures, statement-timeout cancels, the last
-- start, status and duration, and the longest duration. Never the command text
-- and never an error message: aggregates of the jobs this public repository
-- already names. Readable with the publishable key.

DO $$
DECLARE
  r record;
  v_fn text;
  v_overloads integer;
  v_vals text[];
  v_val text;
  v_iv interval;
  v_with integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- no cron command to give its function''s header';
    RETURN;
  END IF;
  IF to_regprocedure('cron.alter_job(bigint, text, text, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'cron.alter_job is missing: this pg_cron cannot change a command in place, and unscheduling would lose each job''s active flag and owner';
  END IF;

  FOR r IN SELECT j.jobid, j.jobname, j.command FROM cron.job j ORDER BY j.jobid LOOP
    CONTINUE WHEN r.command ~* '^\s*set\s';
    v_fn := lower(substring(r.command FROM '(?i)^\s*select\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^;]*\)\s*;?\s*$'));
    CONTINUE WHEN v_fn IS NULL;

    SELECT count(*)::integer INTO v_overloads
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = v_fn;
    SELECT array_agg(DISTINCT split_part(c.setting, '=', 2)), count(*)::integer
      INTO v_vals, v_with
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     CROSS JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
     WHERE ns.nspname = 'public' AND p.proname = v_fn AND c.setting LIKE 'statement_timeout=%';
    IF v_overloads = 0 OR v_vals IS NULL OR v_with <> v_overloads THEN
      CONTINUE;
    END IF;
    IF cardinality(v_vals) <> 1 THEN
      RAISE NOTICE 'cron job % (%): the overloads of % carry different statement_timeout headers %; left as it is', r.jobid, r.jobname, v_fn, v_vals;
      CONTINUE;
    END IF;
    v_val := btrim(v_vals[1]);
    BEGIN
      v_iv := CASE WHEN v_val ~ '^\d+$' THEN (v_val || ' milliseconds')::interval ELSE v_val::interval END;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'cron job % (%): header % of % does not read as a duration; left as it is', r.jobid, r.jobname, v_val, v_fn;
      CONTINUE;
    END;
    CONTINUE WHEN v_iv <= interval '120 seconds';

    BEGIN
      PERFORM cron.alter_job(r.jobid, command => format('SET statement_timeout = %L; %s', v_val, btrim(r.command, E' \t\r\n')));
      RAISE NOTICE 'cron job % (%): now runs % under its function''s own %', r.jobid, r.jobname, v_fn, v_val;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'cron job % (%): could not be altered by this role (%); the self-verify will name it', r.jobid, r.jobname, SQLERRM;
    END;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_cron_health(p_hours integer DEFAULT 24)
RETURNS TABLE (
  ch_jobname text,
  ch_schedule text,
  ch_active boolean,
  ch_timeout text,
  ch_runs bigint,
  ch_failed bigint,
  ch_timeouts bigint,
  ch_last_start timestamptz,
  ch_last_status text,
  ch_last_seconds numeric,
  ch_max_seconds numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hours integer := least(greatest(coalesce(p_hours, 24), 1), 168);
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('cron.job_run_details') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT j.jobname::text,
         j.schedule::text,
         j.active,
         substring(j.command FROM '(?i)^\s*set\s+statement_timeout\s*=\s*''([^'']+)''')::text,
         count(d.runid)::bigint,
         (count(d.runid) FILTER (WHERE d.status = 'failed'))::bigint,
         (count(d.runid) FILTER (WHERE d.return_message ILIKE '%statement timeout%'))::bigint,
         max(d.start_time),
         ((array_agg(d.status ORDER BY d.start_time DESC) FILTER (WHERE d.runid IS NOT NULL))[1])::text,
         round(extract(epoch FROM ((array_agg(d.end_time - d.start_time ORDER BY d.start_time DESC) FILTER (WHERE d.runid IS NOT NULL))[1]))::numeric, 1),
         round(max(extract(epoch FROM (d.end_time - d.start_time)))::numeric, 1)
    FROM cron.job j
    LEFT JOIN cron.job_run_details d
      ON d.jobid = j.jobid AND d.start_time > now() - make_interval(hours => v_hours)
   GROUP BY j.jobid, j.jobname, j.schedule, j.active, j.command
   ORDER BY j.jobname;
END;
$$;

COMMENT ON FUNCTION public.get_cron_health(integer) IS
  'Per pg_cron job over the last p_hours (1-168, default 24): name, schedule, active, the statement_timeout its command sets (null = none, so the job owner''s session limit governs), runs, failures, statement-timeout cancels, last start, last status, last and longest duration in seconds. Never the command text or an error message. Readable with the publishable key (20261004010000).';

REVOKE ALL ON FUNCTION public.get_cron_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_health(integer) TO anon, authenticated, service_role;

-- Self-verifying. Every job the rule selects now carries its function's own
-- header, in exactly the form this file writes; no job the rule leaves alone
-- was touched; the reader exists, is a definer, and anon can call it. A copy
-- the staged runner edited, or a job this role could not alter, must not be
-- able to report success.
DO $$
DECLARE
  r record;
  v_fn text;
  v_overloads integer;
  v_with integer;
  v_vals text[];
  v_val text;
  v_iv interval;
  v_missing text[] := '{}';
  v_reader oid := to_regprocedure('public.get_cron_health(integer)')::oid;
BEGIN
  IF v_reader IS NULL OR NOT has_function_privilege('anon', v_reader, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_cron_health is missing or not executable by anon';
  END IF;
  IF NOT coalesce((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_reader), false) THEN
    RAISE EXCEPTION 'get_cron_health is not SECURITY DEFINER, so anon would read nothing of cron';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  FOR r IN SELECT j.jobid, j.jobname, j.command FROM cron.job j ORDER BY j.jobid LOOP
    -- The command as it was before this file: strip a SET this file wrote.
    v_fn := lower(substring(
      regexp_replace(r.command, '^SET statement_timeout = ''[^'']+''; ', '')
      FROM '(?i)^\s*select\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^;]*\)\s*;?\s*$'));
    CONTINUE WHEN v_fn IS NULL;
    CONTINUE WHEN r.command ~* '^\s*set\s' AND r.command !~ '^SET statement_timeout = ''[^'']+''; ';
    SELECT count(*)::integer INTO v_overloads
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = v_fn;
    SELECT array_agg(DISTINCT split_part(c.setting, '=', 2)), count(*)::integer INTO v_vals, v_with
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     CROSS JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
     WHERE ns.nspname = 'public' AND p.proname = v_fn AND c.setting LIKE 'statement_timeout=%';
    CONTINUE WHEN v_overloads = 0 OR v_vals IS NULL OR v_with <> v_overloads OR cardinality(v_vals) <> 1;
    v_val := btrim(v_vals[1]);
    BEGIN
      v_iv := CASE WHEN v_val ~ '^\d+$' THEN (v_val || ' milliseconds')::interval ELSE v_val::interval END;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF v_iv > interval '120 seconds' THEN
      IF r.command !~ ('^SET statement_timeout = ' || quote_literal(v_val) || '; ') THEN
        v_missing := v_missing || format('%s (%s, header %s)', r.jobname, v_fn, v_val);
      END IF;
    ELSIF r.command ~ '^SET statement_timeout = ''[^'']+''; ' AND r.jobname NOT IN ('refresh-stats-cache', 'refresh-explore-cache') THEN
      RAISE EXCEPTION 'cron job % (header % of %, not over two minutes) was given a SET it should not have: %', r.jobname, v_val, v_fn, r.command;
    END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'cron jobs still bounded by the session, not their function''s header: %', array_to_string(v_missing, '; ');
  END IF;
END $$;