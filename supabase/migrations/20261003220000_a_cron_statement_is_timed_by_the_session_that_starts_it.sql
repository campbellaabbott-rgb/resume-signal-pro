-- A CRON STATEMENT IS TIMED BY THE SESSION THAT STARTS IT, NOT BY THE
-- FUNCTION IT CALLS.
--
-- WHAT HAPPENED. 20260928004823 put the field fill curve into
-- refresh_stats_cache under a ten-minute function header, and 20260928011742
-- moved the job to minute 27. Both applied on 2026-10-03 (drizzle 0089/0090,
-- byte-identical). The first run, at 20:27:00.017Z, wrote fill_curve null with
-- fill_curve_error {at 20:29:00.048Z, reason query_canceled, sqlstate 57014,
-- "canceling statement due to statement timeout"}: 120.03 seconds after the
-- statement began. Neither the function's ten minutes nor the curve's own
-- five fired; a two-minute limit did, measured from the top-level statement.
--
-- WHY. statement_timeout is armed once, when a top-level statement starts
-- (postgres.c, start_xact_command -> enable_statement_timeout), and the GUC
-- has no assign hook (guc_tables.c: statement_timeout's check, assign and
-- show hooks are all NULL; transaction_timeout, beside it, has one). So a
-- function's SET statement_timeout changes the setting for the duration of
-- the call and never touches the timer already running: it can neither
-- extend nor shorten the statement it is called from. Over PostgREST the
-- header does govern the RPC: PostgREST applies the called function's
-- statement_timeout setting to the transaction before it calls the function,
-- which is why the RPC timings this repo has recorded agreed with the
-- headers. pg_cron applies nothing: it starts the job's command in a session
-- of the job's owner, postgres, and the cancel at 120.03s says that session
-- carries two minutes (20260812210000 recorded refreshes dying at 120s
-- too). Every scheduled run of every function in this lane has therefore
-- been bounded at two minutes, whatever its header says. 20260812210000's
-- note that "a function-level SET re-arms on entry" is not how the server
-- behaves; whatever produced the 25s kill it observed, it was not a timer
-- re-armed by the callee's header.
--
-- WHY THE EXPLORE COPY SURVIVED. refresh_explore_cache computes the same
-- curve at minute 7 and its 20:07 run wrote field_curves for 18 fields: its
-- whole run fitted inside 120s. The stats run spends ~12s on seven parts
-- before the curve (the leaderboard part stamped 20:27:12.42Z), and the curve
-- alone runs close to two minutes. One fits and one does not -- both live
-- one slow hour from losing the curve.
--
-- THE FIX: the command sets the limit before the statement starts. pg_cron
-- runs the command as one simple-query string; since PostgreSQL 13 each
-- statement in such a string gets its own statement timeout, armed when it
-- starts, so `SET statement_timeout = '10min'; SELECT ...` arms the SELECT at
-- ten minutes. The value is READ FROM THE FUNCTION'S OWN HEADER in the live
-- catalogue at apply time, so the header stays the one statement of intent
-- and this file cannot drift from it; the fallback applies only if a header
-- is missing. The minutes do not move: 27 and 7, so the two scans still
-- cannot overlap (explore ends by :22 at fifteen minutes, stats by :37 at
-- ten).
--
-- WHAT THIS DOES NOT TOUCH. Fifteen other jobs in this lane call a function
-- whose header is longer than 120s (refresh_ghost_stats, refresh_job_board_
-- facets, refresh_closure_population, refresh_explore_role_rows,
-- refresh_job_board_stats, the roll-ups, the snapshots, layoff_matches_
-- rebuild, repair_oracle_subsite_duplicates, refresh_transparency_cache and
-- the one-shot index builders). Each is bounded at two minutes by the same
-- mechanism; whether any of them actually runs past it is in
-- cron.job_run_details, which only the service role can read. Making them run
-- as long as their headers say would change load, so each waits for that
-- evidence rather than riding in on this file.

DO $$
DECLARE
  v_stats text;
  v_explore text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- refresh-stats-cache and refresh-explore-cache keep whatever schedule the host gives them';
    RETURN;
  END IF;

  SELECT split_part(c.setting, '=', 2) INTO v_stats
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   CROSS JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_stats_cache'
     AND c.setting LIKE 'statement_timeout=%';
  SELECT split_part(c.setting, '=', 2) INTO v_explore
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   CROSS JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) c(setting)
   WHERE ns.nspname = 'public' AND p.proname = 'refresh_explore_cache'
     AND c.setting LIKE 'statement_timeout=%';
  v_stats := coalesce(nullif(btrim(v_stats), ''), '10min');
  v_explore := coalesce(nullif(btrim(v_explore), ''), '15min');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.unschedule('refresh-stats-cache');
  END IF;
  PERFORM cron.schedule('refresh-stats-cache', '27 * * * *',
    format('SET statement_timeout = %L; SELECT public.refresh_stats_cache();', v_stats));

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-explore-cache') THEN
    PERFORM cron.unschedule('refresh-explore-cache');
  END IF;
  PERFORM cron.schedule('refresh-explore-cache', '7 * * * *',
    format('SET statement_timeout = %L; SELECT public.refresh_explore_cache();', v_explore));
END $$;

-- Self-verifying: each job exists once, on its minute, and its command sets
-- the function's own header before it calls the function -- a copy the staged
-- runner edited into something else must not be able to report success.
DO $$
DECLARE
  v_job record;
  v_header text;
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  FOR v_job IN
    SELECT * FROM (VALUES
      ('refresh-stats-cache', '27 * * * *', 'refresh_stats_cache', '10min'),
      ('refresh-explore-cache', '7 * * * *', 'refresh_explore_cache', '15min')
    ) t(jobname, sched, fn, fallback)
  LOOP
    SELECT count(*)::integer INTO v_n FROM cron.job j WHERE j.jobname = v_job.jobname;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: want exactly one cron job, found %', v_job.jobname, v_n;
    END IF;
    SELECT coalesce(nullif(btrim(split_part(c.setting, '=', 2)), ''), v_job.fallback) INTO v_header
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      LEFT JOIN LATERAL unnest(coalesce(p.proconfig, '{}'::text[])) c(setting) ON c.setting LIKE 'statement_timeout=%'
     WHERE ns.nspname = 'public' AND p.proname = v_job.fn
     LIMIT 1;
    v_header := coalesce(v_header, v_job.fallback);
    IF NOT EXISTS (
      SELECT 1 FROM cron.job j
       WHERE j.jobname = v_job.jobname
         AND j.schedule = v_job.sched
         AND j.command = format('SET statement_timeout = %L; SELECT public.%I();', v_header, v_job.fn)
    ) THEN
      RAISE EXCEPTION '%: the command does not set the function''s own % before calling it: %',
        v_job.jobname, v_header, (SELECT j.command FROM cron.job j WHERE j.jobname = v_job.jobname);
    END IF;
  END LOOP;
END $$;
