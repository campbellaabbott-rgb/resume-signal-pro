-- A SEND THAT NEVER HAPPENED GIVES ITS APPLICATION BACK — by the path that records it.
--
-- "A failed application refunds by the same path that records failure"
-- (owner). Two writers record failure on agent_submissions and share no
-- code: apply-agent INSERTS the row (a duplicate of an earlier packet lands
-- as status stale, at insert, and never moves again), and the worker
-- PATCHES it through apply-broker (a vendor with no adapter or an uncertain
-- submit lands as status blocked with attempts set to the never-retry
-- sentinel; a refused fill lands as status blocked with a non-empty error).
-- A trigger on the table is the only place both writers meet, so the refund
-- lives here and neither writer has to know about passes.
--
-- EXACTLY THESE SHAPES, AND NO OTHERS.
--   refund   stale (insert-only)
--   refund   blocked with the attempts column at the never-retry sentinel
--   refund   blocked with a non-empty error (a refused fill)
--   keep     blocked with zero attempts and no error — preparation-time
--            blockers: a human must act, the application is still theirs
--   keep     failed — no code path writes it; a trigger on it would be a
--            guard over nothing
--   keep     submitted — the application happened.
-- AFTER INSERT is required because stale is written at insert and never
-- updated. UPDATE OF status keeps the trigger off the row's own bookkeeping
-- updates (claims, leases, evidence), including the refund stamp below.
--
-- IDEMPOTENT BY THE WHEN CLAUSE. The refund stamps pass_refunded_at on the
-- submission row; the WHEN clause requires it to be NULL, so a second
-- status write on the same row — a worker re-patching blocked, a re-run —
-- cannot give the application back twice. greatest(..., 0) keeps the pass
-- count within its CHECK even if a row is refunded after a manual reset.
--
-- THE REFUND LANDS WHETHER OR NOT THE PASS IS STILL LIVE. If the session
-- has ended it is a recorded fact for the metrics (applications used
-- against applications sent), not a usable credit — copy says applications
-- lapse with the session. Only rows a pass paid for (pass_id set) are in
-- scope; subscription-funded rows never reach the function.

CREATE OR REPLACE FUNCTION public.agent_pass_refund_on_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'stale'
     OR (NEW.status = 'blocked' AND (NEW.attempts >= 99 OR coalesce(NEW.error, '') <> '')) THEN
    UPDATE public.agent_passes ap
       SET applications_used = greatest(ap.applications_used - 1, 0)
     WHERE ap.id = NEW.pass_id;
    UPDATE public.agent_submissions s
       SET pass_refunded_at = now()
     WHERE s.id = NEW.id AND s.pass_refunded_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS agent_pass_refund_trg ON public.agent_submissions;
CREATE TRIGGER agent_pass_refund_trg
  AFTER INSERT OR UPDATE OF status ON public.agent_submissions
  FOR EACH ROW
  WHEN (NEW.pass_id IS NOT NULL AND NEW.pass_refunded_at IS NULL)
  EXECUTE FUNCTION public.agent_pass_refund_on_failure();

-- A trigger function is invoked by the executor, not by a caller, so no
-- role needs EXECUTE on it — and it is SECURITY DEFINER because the row's
-- owner (who may cancel their own packet through RLS) has no grant on
-- agent_passes. Locked by name all the same: an anonymous caller must not
-- be able to invoke it directly.
REVOKE ALL ON FUNCTION public.agent_pass_refund_on_failure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_refund_on_failure() TO service_role;
