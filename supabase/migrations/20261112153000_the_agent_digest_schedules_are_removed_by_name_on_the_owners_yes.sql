-- lovable-cron-fallback-reviewed: no cron; this file unschedules send-agent-digest and send-agent-digest-morning by name and schedules nothing (reviewed 2026-11-18 in the bug round B integration, on the owner's yes of that day).
--
-- THE AGENT DIGEST SCHEDULES ARE REMOVED BY NAME, ON THE OWNER'S YES
-- (bug round A, past buyers, S14X-225; owner-gated because it stops a mail:
-- the owner said yes on 2026-11-18, and it ships in bug round B).
--
-- The apply agent is retired: agent-runner is switched off and unscheduled
-- (20261011130000), so nothing fills the shortlist these jobs mail. They still
-- fire every day into it:
--   send-agent-digest          the job 20261011130000 left alone on purpose;
--   send-agent-digest-morning  a job production holds that no migration wrote.
--
-- REMOVED, by name, each only if it exists. Nothing else is touched: the
-- function stays deployed, and re-arming it is a new migration, never an edit
-- to this one.
--
-- Safe to re-run: where pg_cron is not installed, or neither job exists,
-- there is nothing to remove. The second block refuses to finish while either
-- job is still scheduled.

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no agent digest schedule to remove';
    RETURN;
  END IF;

  FOR r IN
    SELECT j.jobname FROM cron.job j
     WHERE j.jobname IN ('send-agent-digest', 'send-agent-digest-morning')
     ORDER BY j.jobname
  LOOP
    PERFORM cron.unschedule(r.jobname);
    RAISE NOTICE 'unscheduled %', r.jobname;
  END LOOP;
END $$;

DO $$
DECLARE
  v_which text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT string_agg(j.jobname, ', ' ORDER BY j.jobname) INTO v_which
    FROM cron.job j
   WHERE j.jobname IN ('send-agent-digest', 'send-agent-digest-morning');
  IF v_which IS NOT NULL THEN
    RAISE EXCEPTION 'the agent digest is still scheduled after its removal: %', v_which;
  END IF;
END $$;
