ALTER TABLE public.agent_submissions
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_refusal text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS agent_submissions_sendable_idx
  ON public.agent_submissions (released_at)
  WHERE status = 'ready' AND released_at IS NOT NULL AND claimed_at IS NULL;

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

CREATE OR REPLACE FUNCTION public.agent_mark_uncertain(p_id bigint, p_reason text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.agent_submissions
  SET status = 'blocked',
      claimed_at = NULL,
      claimed_by = '',
      attempts = 99,
      blockers = blockers || jsonb_build_array(
        jsonb_build_object('kind', 'uncertain-submit', 'detail', p_reason)),
      updated_at = now()
  WHERE id = p_id AND submitted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.agent_mark_uncertain(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_mark_uncertain(bigint, text) TO service_role;

COMMENT ON FUNCTION public.agent_claim_submission(text, integer) IS
  'Atomically leases one released packet. Exactly one worker wins; a stale lease is reclaimed after p_lease_minutes; attempts>=3 is never picked up.';
COMMENT ON FUNCTION public.agent_mark_uncertain(bigint, text) IS
  'A submit whose outcome could not be confirmed. Parks the packet for a human and puts it beyond retry.';