-- THE PERK SWEEP IS KICKED ONLY WHEN THERE IS WORK.
--
-- Cost audit 2026-11-08, "Perk sweep", second half. employer-perks-sweep
-- (20261012111000) POSTs {"action":"sweep"} to employer-profiles every
-- minute. Once the day's boards are swept the function wakes, takes its lease,
-- reads its config, asks the take for postings, gets none, writes a run row
-- and stops -- 1,000 to 1,440 idle edge invocations a day.
--
-- The job's command already ends in a WHERE that decides whether the POST is
-- sent at all (the key-header row must exist). This file adds one condition in
-- front of that existing one:
--   ... ) WHERE public.employer_perk_sweep_due() AND EXISTS ( ...
-- so the minute's kick is sent only when employer_perk_sweep_due()
-- (20261109160000) says a board is pending at the extractor version, the daily
-- requeue is due, or no sweep has run for an hour. Everything else in the
-- command -- its opening SET statement_timeout, the URL, the headers, the
-- body, pg_net's timeout -- is kept exactly as the job holds it: the new
-- command is the old one with that predicate inserted, built from the
-- scheduler's own row, so this file restates nothing the job carries. The
-- schedule stays '* * * * *'.
--
-- ORDER: after 20261109160000 (the gate function must exist first; a missing
-- function would make every minute's run raise, and then the sweep would
-- never be sent).
--
-- Guarded: a database without pg_cron, or without the job, is told so and left
-- alone; a job already gated is left alone. If the command does not have the
-- WHERE this file inserts into, it RAISES rather than guess. Self-verifying.

DO $$
DECLARE
  v_id  bigint;
  v_cmd text;
  v_new text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; employer-perks-sweep is not gated';
    RETURN;
  END IF;
  IF to_regprocedure('public.employer_perk_sweep_due()') IS NULL THEN
    RAISE EXCEPTION 'employer_perk_sweep_due() does not exist; apply 20261109160000 first';
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'employer-perks-sweep';
  IF v_id IS NULL THEN
    RAISE NOTICE 'employer-perks-sweep is not scheduled here; nothing to gate';
    RETURN;
  END IF;
  IF position('public.employer_perk_sweep_due()' IN v_cmd) > 0 THEN
    RAISE NOTICE 'employer-perks-sweep is already gated';
    RETURN;
  END IF;
  v_new := regexp_replace(v_cmd, '\)\s*WHERE\s+EXISTS\s*\(', ') WHERE public.employer_perk_sweep_due() AND EXISTS (');
  IF v_new = v_cmd THEN
    RAISE EXCEPTION 'employer-perks-sweep has no ") WHERE EXISTS (" to gate; its command was changed since 20261012111000';
  END IF;
  PERFORM cron.alter_job(job_id := v_id, command := v_new);
END $$;

DO $verify$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.schedule, j.command, j.active INTO r FROM cron.job j WHERE j.jobname = 'employer-perks-sweep';
  IF r.command IS NULL THEN
    RETURN;
  END IF;
  IF position('public.employer_perk_sweep_due() AND EXISTS (' IN r.command) = 0 THEN
    RAISE EXCEPTION 'employer-perks-sweep is not gated on employer_perk_sweep_due()';
  END IF;
  IF (length(r.command) - length(replace(r.command, 'public.employer_perk_sweep_due()', ''))) / length('public.employer_perk_sweep_due()') <> 1 THEN
    RAISE EXCEPTION 'employer-perks-sweep names its gate more than once';
  END IF;
  IF position('SET statement_timeout = ''15s'';' IN r.command) <> 1 THEN
    RAISE EXCEPTION 'employer-perks-sweep no longer opens with its own statement_timeout';
  END IF;
  IF position('x-employer-profiles-cron' IN r.command) = 0 OR position('"action":"sweep"' IN r.command) = 0 THEN
    RAISE EXCEPTION 'employer-perks-sweep lost its key header or its sweep action';
  END IF;
  IF r.schedule <> '* * * * *' OR NOT r.active THEN
    RAISE EXCEPTION 'employer-perks-sweep is no longer active every minute (%, %)', r.schedule, r.active;
  END IF;
END
$verify$;
