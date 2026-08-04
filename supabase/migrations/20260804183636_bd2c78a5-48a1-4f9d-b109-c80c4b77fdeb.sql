ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS hold_first_n integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_released_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undo_window_seconds integer NOT NULL DEFAULT 900;

DO $$ BEGIN
  ALTER TABLE public.agent_mandates
    ADD CONSTRAINT agent_mandates_onramp_sane
    CHECK (hold_first_n BETWEEN 0 AND 25 AND undo_window_seconds BETWEEN 0 AND 86400);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.agent_mandates.hold_first_n IS
  'Hold this many auto-mode releases for explicit approval before running unattended. An on-ramp, not a cap — they still go out, you just see them first. 0 disables.';
COMMENT ON COLUMN public.agent_mandates.auto_released_count IS
  'Monotonic count of packets released in AUTO mode. Never derived from row counts: deletions and manual submissions would reset an on-ramp that must only move forwards.';
COMMENT ON COLUMN public.agent_mandates.undo_window_seconds IS
  'How long a released packet waits before a worker may claim it. The cancel window. 0 disables and the packet is claimable immediately.';

ALTER TABLE public.agent_submissions
  ADD COLUMN IF NOT EXISTS claimable_at timestamptz;

COMMENT ON COLUMN public.agent_submissions.claimable_at IS
  'Earliest a worker may claim this. Set from the mandate''s undo_window_seconds at release. NULL means immediately claimable — rows written before this column existed must not be frozen by it.';

CREATE OR REPLACE FUNCTION public.agent_note_auto_release(p_user_id uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_mandates
     SET auto_released_count = auto_released_count + 1
   WHERE user_id = p_user_id
  RETURNING auto_released_count;
$$;

REVOKE ALL ON FUNCTION public.agent_note_auto_release(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_note_auto_release(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.agent_cancel_pending(p_submission_id bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.agent_submissions
     SET status = 'blocked',
         release_refusal = 'cancelled-by-you',
         claimable_at = NULL
   WHERE id = p_submission_id
     AND user_id = auth.uid()
     AND submitted_at IS NULL
     AND claimed_at IS NULL
     AND claimable_at IS NOT NULL
     AND claimable_at > now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_cancel_pending(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_cancel_pending(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agent_claim_submission(p_worker text, p_lease_minutes integer DEFAULT 10)
RETURNS SETOF public.agent_submissions
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_submissions s
  SET claimed_at = now(), claimed_by = p_worker, attempts = s.attempts + 1
  WHERE s.id = (
    SELECT c.id FROM public.agent_submissions c
    WHERE c.status = 'ready'
      AND c.released_at IS NOT NULL
      AND c.submitted_at IS NULL
      AND (c.claimable_at IS NULL OR c.claimable_at <= now())
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => GREATEST(p_lease_minutes, 5)))
      AND c.attempts < 3
    ORDER BY c.released_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;