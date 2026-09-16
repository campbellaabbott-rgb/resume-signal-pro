-- A REFUND IS THE PIPELINE'S TO GIVE, NEVER THE OWNER'S TO TAKE.
--
-- The refund trigger (20260917150000) is SECURITY DEFINER and fires on the
-- status shapes the pipeline writes — and a row's owner holds UPDATE on
-- agent_submissions through RLS, so the same shapes could be written from a
-- browser session: status blocked with an error, again and again, on one
-- submission. Every cycle handed one application back, and the rows it
-- refunded could be set back to ready and claimed by the worker afresh. A
-- pass sold as ten applications was ten applications a cycle.
--
-- The fix is who, not what. The shapes stay exactly as 150000 defined them;
-- the function now asks which role the request arrived under and gives
-- nothing back when it is the row's owner (authenticated) or nobody (anon).
-- The pipeline's writers — apply-agent's insert, apply-broker's patch for
-- the worker — arrive as service_role; pg_cron and a maintenance session
-- carry no claims at all; both still refund. The role is read from the JWT
-- claims the API gateway sets for every request (the newer whole-claims
-- setting first, the older per-claim setting as a fallback), never from
-- current_user, which inside a definer function is the definer.
--
-- The companion migration (20260917180000) narrows the owner's UPDATE to the
-- columns the account panels write, so pass_id and pass_refunded_at cannot be
-- moved by the owner either — the two together close both legs.
--
-- Same signature, CREATE OR REPLACE; the trigger is re-created identically so
-- a runner that drops it while replacing the function leaves it in place.

CREATE OR REPLACE FUNCTION public.agent_pass_refund_on_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );
  IF v_role IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;
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

REVOKE ALL ON FUNCTION public.agent_pass_refund_on_failure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_refund_on_failure() TO service_role;
