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
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.agent_mandates m WHERE m.user_id = c.user_id
        )
        OR (
          SELECT count(*) FROM public.agent_submissions d
           WHERE d.user_id = c.user_id
             AND d.submitted_at >= date_trunc('day', now())
        ) < COALESCE(
          (SELECT m.auto_apply_daily_cap FROM public.agent_mandates m
            WHERE m.user_id = c.user_id),
          2147483647
        )
      )
    ORDER BY c.released_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.agent_claim_submission(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_claim_submission(text, integer) TO service_role;

COMMENT ON FUNCTION public.agent_claim_submission(text, integer) IS
  'Hands one ready packet to a worker. Gates: released, unsubmitted, past its cancel window, not leased, under 3 attempts, AND under the candidate''s daily cap counted on submissions today.';