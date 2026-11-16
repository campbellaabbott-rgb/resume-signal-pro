-- SUB-HOURLY CRON REVIEW MARKER: not required. Every job this file schedules
-- runs once a day (reviewed 2026-11-16 in the bug round A integration).
--
-- A RUN-OUT PASS CLOSES, AND GIVES BACK WHAT IT NEVER SENT (S14X-083, M-S14-051).
--
-- WHAT WAS WRONG. agent_pass_settle (20261008132000) gives back a pass's
-- never-sent applications only once the pass is closed, and every closer is
-- lazy: agent-pass-status, create-pass-checkout and api_key_check on an /mcp/
-- call (20261103110000) close a run-out pass only when its own buyer arrives.
-- The pass and the one tool it paid for are retired, so a past buyer has no
-- reason to arrive, and a pass whose clock or shelf ran out stayed open and
-- unsettled for good. And agent_pass_packet_gives_back counts a 'ready'
-- packet only when it was never released or has used its three attempts: a
-- released packet under three attempts is "left to finish", by the sender
-- that is switched off, so it was never sent and never given back.
--
-- WHAT THIS CHANGES.
--   1. Once, now, while the agent sender is switched off: a released, unsent
--      'ready' packet that no worker holds, on a pass whose clock or shelf has
--      run out (or that is already closed), goes 'stale'. A stale packet is
--      one the refund trigger gives back at once, and one
--      agent_pass_packet_gives_back counts; a packet already given back is
--      not touched, so nothing is given back twice.
--   2. Then the run-out passes are closed, the way every lazy closer closes
--      them: closed_at = now(), 'shelf_expired' when the clock never started,
--      'session_ended' when it did. The existing agent_pass_settle_on_close_trg
--      settles each one.
--   3. A daily job, 'agent-pass-close', closes the same way every pass that
--      runs out from now on, so a pass no longer waits for its buyer to come
--      back before it settles. It closes and nothing else: a packet a pass
--      that runs out later still has in flight is left to finish, as the pass
--      page promises.
--
-- "Run out" is the lazy closers' own test, coalesce(expires_at,
-- shelf_expires_at) <= now(): the clock once it has started, the shelf until
-- then. A started pass whose shelf passes while its six hours are still
-- running is not closed.
--
-- Safe to re-run: the one-shot finds nothing the second time, and the job is
-- scheduled only when it is absent (and given its command back if it drifted).
-- Self-verifying: where pg_cron is installed the job must exist, be active and
-- set its own statement_timeout in its command; no run-out pass may be left
-- open, and no closed pass unsettled.

SET LOCAL statement_timeout = '2min';

-- 1. The released packets the sender will never send.
UPDATE public.agent_submissions s
   SET status = 'stale'
 WHERE s.status = 'ready'
   AND s.pass_id IS NOT NULL
   AND s.pass_refunded_at IS NULL
   AND s.submitted_at IS NULL
   AND s.released_at IS NOT NULL
   AND s.attempts < 3
   AND (s.claimed_at IS NULL OR s.claimed_at <= now() - interval '10 minutes')
   AND EXISTS (
     SELECT 1 FROM public.agent_passes ap
      WHERE ap.id = s.pass_id
        AND (ap.closed_at IS NOT NULL OR coalesce(ap.expires_at, ap.shelf_expires_at) <= now())
   );

-- 2. The run-out passes, closed (the settle trigger gives back the rest).
UPDATE public.agent_passes ap
   SET closed_at = now(),
       close_reason = CASE WHEN ap.activated_at IS NULL THEN 'shelf_expired' ELSE 'session_ended' END
 WHERE ap.closed_at IS NULL
   AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();

-- 3. The daily closer.
DO $$
DECLARE
  v_cmd constant text := 'SET statement_timeout = ''2min''; '
    || 'UPDATE public.agent_passes ap SET closed_at = now(), '
    || 'close_reason = CASE WHEN ap.activated_at IS NULL THEN ''shelf_expired'' ELSE ''session_ended'' END '
    || 'WHERE ap.closed_at IS NULL AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();';
  v_id  bigint;
  v_old text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; schedule agent-pass-close by hand: %', v_cmd;
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_old FROM cron.job j WHERE j.jobname = 'agent-pass-close';
  IF v_id IS NULL THEN
    PERFORM cron.schedule('agent-pass-close', '41 3 * * *', v_cmd);
  ELSIF v_old IS DISTINCT FROM v_cmd THEN
    PERFORM cron.alter_job(v_id, command => v_cmd, active => true);
  END IF;
END $$;

-- Self-verifying.
DO $verify$
DECLARE
  v_active boolean;
  v_cmd    text;
  v_open   bigint;
  v_unsettled bigint;
BEGIN
  SELECT count(*) INTO v_open
    FROM public.agent_passes ap
   WHERE ap.closed_at IS NULL AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now() - interval '1 minute';
  IF v_open > 0 THEN
    RAISE EXCEPTION 'self-check: % run-out pass(es) are still open', v_open;
  END IF;
  SELECT count(*) INTO v_unsettled
    FROM public.agent_passes ap
   WHERE ap.closed_at IS NOT NULL AND ap.settled_at IS NULL;
  IF v_unsettled > 0 THEN
    RAISE EXCEPTION 'self-check: % closed pass(es) were left unsettled', v_unsettled;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'self-verify 20261112152000: run-out passes closed and settled; pg_cron absent, so no daily closer was checked';
    RETURN;
  END IF;
  SELECT j.active, j.command INTO v_active, v_cmd FROM cron.job j WHERE j.jobname = 'agent-pass-close';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'self-check: the agent-pass-close job does not exist';
  END IF;
  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'self-check: the agent-pass-close job is not active';
  END IF;
  IF v_cmd !~* '^[[:space:]]*SET[[:space:]]+statement_timeout[[:space:]]*=' THEN
    RAISE EXCEPTION 'self-check: the agent-pass-close job sets no statement_timeout in its command: %', v_cmd;
  END IF;
  IF v_cmd !~* 'update[[:space:]]+public\.agent_passes' OR v_cmd !~* 'closed_at[[:space:]]+is[[:space:]]+null' THEN
    RAISE EXCEPTION 'self-check: the agent-pass-close job does not close open passes: %', v_cmd;
  END IF;
  RAISE NOTICE 'self-verify 20261112152000: run-out passes closed and settled, and agent-pass-close closes them daily';
END
$verify$;
