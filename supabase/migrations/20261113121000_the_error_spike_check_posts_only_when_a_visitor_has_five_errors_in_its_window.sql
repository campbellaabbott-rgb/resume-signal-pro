-- lovable-cron-fallback-reviewed: check-error-spikes keeps its existing every-15-minute schedule unchanged; reviewed 2026-11-18 by the project owner; this file only puts the function's own spike condition (a visitor with five errors in 15 minutes) in front of the call, removing up to 96 idle calls a day with no change to alert speed.
-- reviewed: 2026-11-18 by the project owner, who approves this schedule as written.
-- job: check-error-spikes (every 15 minutes since 20261008128000).
-- schedule: '7-59/15 * * * *', UNCHANGED. This file changes only the job's command.
-- why sub-hourly: detect_user_error_spikes reads a 15-minute window, so the
--   job runs once a window and no quarter hour goes unread.
-- load: lower than today. The command now posts only when some visitor has
--   five or more errors in the last 15 minutes, the function's own necessary
--   condition for a spike; a quiet quarter hour evaluates one count over the
--   created_at index and posts nothing. Up to 96 posts a day are skipped, each
--   a key check, a spike scan, a one-hour diagnostics read and a 100-row read.
-- new standing sub-hourly jobs: none.
--
-- THE ERROR SPIKE CHECK POSTS ONLY WHEN A VISITOR HAS FIVE ERRORS IN ITS
-- WINDOW (CW2-HO1, cost wave 2 item HO-1).
--
-- check-error-spikes (20261008128000) posts to its function every 15 minutes.
-- The function mails, and writes its spike_detection row, only when
-- detect_user_error_spikes(5, 15, 24) returns a spike, and that function keeps
-- only visitors with at least p_spike_threshold = 5 rows in the last
-- p_recent_minutes = 15 (HAVING COUNT(*) >= p_spike_threshold,
-- 20251223173908). So a quarter hour in which no visitor has five errors can
-- produce no mail and no row, yet each one still costs an edge call, the key
-- check and three reads.
--
-- The job's command already ends in a WHERE that decides whether the post is
-- sent at all (its key row must exist). This file adds that necessary
-- condition in front of the existing one:
--   ... ) WHERE EXISTS (<a visitor with >= 5 errors in 15 minutes>) AND EXISTS ( ...
-- and opens the command with its own statement_timeout (30 s; the gate is one
-- count over the created_at index). Everything else -- the
-- URL, the headers and the key reference, the body -- is kept exactly as the
-- job holds it: the new command is the old one with those two insertions,
-- built from the scheduler's own row, so this file restates nothing the job
-- carries, and the reader that lists the key names a job's command needs
-- (20261103120000, which mail-watch R10 reads) answers what it answered
-- before. The schedule stays '7-59/15 * * * *'. Alert latency is unchanged:
-- a spike quarter hour posts exactly as it did.
--
-- ORDER: any. The gate reads only public.error_telemetry, whose created_at
-- and visitor_id columns date from 20251221232853; check-error-spikes is not
-- changed.
--
-- Guarded: a database without pg_cron, or without the job, is told so and left
-- alone; a job already gated is left alone. If the command does not hold
-- exactly one ") WHERE EXISTS (" to insert into, it RAISES rather than guess.
-- Self-verifying: the first block raises unless the new command minus the two
-- insertions is the job's old command, character for character; the second
-- raises unless the gate is in the command once, ANDed with the key row's
-- EXISTS, the command opens with its statement_timeout, it still posts to its
-- function with its key header, and the job is active on its old schedule.

DO $$
DECLARE
  v_id    bigint;
  v_cmd   text;
  v_gated text;
  v_new   text;
  v_hits  integer;
  v_pred  constant text := $pred$EXISTS (SELECT 1 FROM public.error_telemetry e WHERE e.created_at > now() - interval '15 minutes' AND e.visitor_id IS NOT NULL GROUP BY e.visitor_id HAVING count(*) >= 5)$pred$;
  v_limit constant text := $lim$SET statement_timeout = '30s'; $lim$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; check-error-spikes is not gated';
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'check-error-spikes';
  IF v_id IS NULL THEN
    RAISE NOTICE 'check-error-spikes is not scheduled here; nothing to gate';
    RETURN;
  END IF;
  IF position(v_pred IN v_cmd) > 0 THEN
    RAISE NOTICE 'check-error-spikes is already gated';
    RETURN;
  END IF;
  SELECT count(*) INTO v_hits FROM regexp_matches(v_cmd, '\)\s*WHERE\s+EXISTS\s*\(', 'g');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'check-error-spikes holds % ") WHERE EXISTS (" where one was expected; its command was changed since 20261008128000', v_hits;
  END IF;
  v_gated := regexp_replace(v_cmd, '(\)\s*WHERE\s+)(EXISTS\s*\()', '\1' || v_pred || ' AND \2');
  IF replace(v_gated, v_pred || ' AND ', '') <> v_cmd OR position(v_pred || ' AND EXISTS' IN v_gated) = 0 THEN
    RAISE EXCEPTION 'check-error-spikes: the gated command is not the old one with the gate inserted';
  END IF;
  v_new := CASE WHEN v_gated ~* '^\s*SET\s+statement_timeout' THEN v_gated ELSE v_limit || v_gated END;
  PERFORM cron.alter_job(job_id := v_id, command := v_new);
END $$;

DO $verify$
DECLARE
  r       record;
  v_pred  constant text := $pred$EXISTS (SELECT 1 FROM public.error_telemetry e WHERE e.created_at > now() - interval '15 minutes' AND e.visitor_id IS NOT NULL GROUP BY e.visitor_id HAVING count(*) >= 5)$pred$;
  v_bare  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.schedule, j.command, j.active INTO r FROM cron.job j WHERE j.jobname = 'check-error-spikes';
  IF r.command IS NULL THEN
    RETURN;
  END IF;
  IF (length(r.command) - length(replace(r.command, v_pred, ''))) / length(v_pred) <> 1
     OR position(v_pred || ' AND EXISTS' IN r.command) = 0 THEN
    RAISE EXCEPTION 'check-error-spikes does not carry its spike gate exactly once, ANDed with its key row';
  END IF;
  IF r.command !~* '^\s*SET\s+statement_timeout' THEN
    RAISE EXCEPTION 'check-error-spikes does not open with its own statement_timeout';
  END IF;
  v_bare := replace(r.command, v_pred || ' AND ', '');
  IF position('x-alerts-cron' IN v_bare) = 0 OR position('alerts_cron_key' IN v_bare) = 0
     OR position('/functions/v1/check-error-spikes''' IN v_bare) = 0 THEN
    RAISE EXCEPTION 'check-error-spikes lost its function, its key header or its key row';
  END IF;
  IF r.schedule <> '7-59/15 * * * *' OR NOT r.active THEN
    RAISE EXCEPTION 'check-error-spikes is no longer active every 15 minutes at :07 (%, %)', r.schedule, r.active;
  END IF;
END
$verify$;
