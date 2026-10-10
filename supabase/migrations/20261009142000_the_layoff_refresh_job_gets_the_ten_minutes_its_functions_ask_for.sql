-- THE LAYOFF REFRESH JOB GETS THE TEN MINUTES ITS FUNCTIONS ASK FOR (S8-049).
--
-- layoff-partition-refresh (20260918101000) runs two statements,
-- layoff_matches_rebuild() and refresh_layoff_partition(), whose headers ask
-- for 5 and 10 minutes. A function's SET statement_timeout never extends a
-- pg_cron run (it is armed when the statement starts), so the job ran under
-- the session's 2-minute cap: 20261004010000 gave every single-statement job
-- its time and skipped this two-statement one. Its longest run so far is
-- 102.6 s; one slow layoff day and the partition writer is cancelled.
--
-- The job's command now begins with SET statement_timeout = '10min', which
-- holds for both statements of the run. The schedule is left as it is (only
-- the command changes); a database without the job gets it at 05:10 UTC as
-- 20260918101000 schedules it. The exit rollup's half of S8-049 shipped in
-- 20261008113000 (wave 2).
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  v_id bigint;
  -- The schedule's authority stays 20260918101000 (the mirror is timed
  -- against it); this file schedules only a database that lost the job.
  c_job constant text := 'layoff-partition-refresh';
  c_command constant text := $job$SET statement_timeout = '10min'; SELECT public.layoff_matches_rebuild(); SELECT public.refresh_layoff_partition();$job$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- no layoff refresh job to give its ten minutes';
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = c_job;
  IF v_id IS NULL THEN
    PERFORM cron.schedule(c_job, '10 5 * * *', c_command);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, command := c_command);
  END IF;
END $$;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM cron.job j
        WHERE j.jobname = 'layoff-partition-refresh'
          AND j.command LIKE 'SET statement_timeout = ''10min'';%'
          AND j.command LIKE '%layoff_matches_rebuild()%'
          AND j.command LIKE '%refresh_layoff_partition()%') THEN
    RAISE EXCEPTION 'layoff-partition-refresh does not begin with its ten-minute SET and both statements';
  END IF;
  RAISE NOTICE 'layoff-partition-refresh now runs under a ten-minute statement_timeout';
END
$verify$;
