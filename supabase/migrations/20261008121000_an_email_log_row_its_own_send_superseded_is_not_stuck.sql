-- AN EMAIL LOG ROW ITS OWN SEND SUPERSEDED IS NOT STUCK, AND A THROTTLE CAN
-- BE WRITTEN DOWN (wave 2 email-ops, register L10-07 and L10-16).
--
-- L10-07. auth-email-hook writes {message_id, status:'pending'} before it
-- enqueues; process-email-queue writes a SEPARATE {message_id, status:'sent'}
-- row when the send succeeds; nothing ever updates the pending row. The
-- delivery reader counted every non-terminal row older than two hours as
-- stuck, at any age, so one delivered magic link from 2026-07-03 (pending at
-- 04:01:04.306, sent at 04:01:06.110) read as "a customer email stuck for 34
-- days" in every window, and scan-heartbeat's delivery reason has said
-- 'stalled' permanently. A real stuck send could not be told apart from it.
-- Now a row is stuck only while no LATER row exists for the same message_id:
-- the latest word on a message decides. The standing-condition rule of
-- 20260807050000 is kept: stuck still has no time window.
--
-- L10-16. process-email-queue logs a provider 429 as status 'rate_limited',
-- which the status CHECK refused; the insert's error was never read, so
-- throttling left no trace while the cooldown was written. The CHECK now
-- accepts it. It is NOT terminal: a throttled message is retried, and a
-- rate_limited row nothing followed for two hours is a message that stopped.
--
-- Same signature, same return shape, counts only; service role only.
-- Safe to re-run.

DO $$
BEGIN
  ALTER TABLE public.email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_status_check
    CHECK (status IN ('pending', 'sent', 'suppressed', 'failed', 'bounced', 'complained', 'dlq', 'rate_limited'));
END $$;

CREATE OR REPLACE FUNCTION public.email_delivery_health(p_hours integer DEFAULT 24)
RETURNS TABLE(
  status text,
  n bigint,
  stuck bigint,
  last_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH w AS (
    SELECT s.status,
           s.created_at,
           -- A later row for the same message is the message's newer state:
           -- the pending row its own send followed is history, not a stall.
           EXISTS (
             SELECT 1 FROM public.email_send_log t
              WHERE s.message_id IS NOT NULL
                AND t.message_id = s.message_id
                AND t.created_at > s.created_at
           ) AS superseded
      FROM public.email_send_log s
     WHERE s.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
        -- Admit currently-stuck rows regardless of age, or the GROUP BY drops
        -- the status entirely and the count has nowhere to live.
        OR (s.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
            AND s.created_at < now() - interval '2 hours')
  )
  SELECT w.status,
         count(*) FILTER (
           WHERE w.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         )::bigint AS n,
         -- No window. Still stuck is still reportable, at any age.
         count(*) FILTER (
           WHERE w.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
             AND w.created_at < now() - interval '2 hours'
             AND NOT w.superseded
         )::bigint AS stuck,
         max(w.created_at) FILTER (
           WHERE w.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))
         ) AS last_at
    FROM w
   GROUP BY w.status
  HAVING count(*) FILTER (WHERE w.created_at >= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 24), 1))) > 0
      OR count(*) FILTER (WHERE w.status NOT IN ('sent', 'failed', 'bounced', 'complained', 'suppressed', 'dlq')
                            AND w.created_at < now() - interval '2 hours' AND NOT w.superseded) > 0
   ORDER BY count(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.email_delivery_health(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_delivery_health(integer) TO service_role;

COMMENT ON FUNCTION public.email_delivery_health(integer) IS
  'Email sends by status: n counts events inside the window, stuck counts the '
  'standing non-terminal condition at ANY age, judged by the LATEST row for a '
  'message (a pending row its own send followed is not stuck). Counts only.';

DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.email_send_log'::regclass AND c.conname = 'email_send_log_status_check'
       AND pg_get_constraintdef(c.oid) LIKE '%rate_limited%'
  ) THEN
    RAISE EXCEPTION 'self-check: email_send_log_status_check does not accept rate_limited';
  END IF;
  SELECT pg_get_functiondef('public.email_delivery_health(integer)'::regprocedure) INTO v_def;
  IF position('superseded' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-check: email_delivery_health still counts a superseded row as stuck';
  END IF;
  IF has_function_privilege('anon', 'public.email_delivery_health(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.email_delivery_health(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can run email_delivery_health';
  END IF;
END $$;
