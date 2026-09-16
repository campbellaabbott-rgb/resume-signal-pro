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

REVOKE ALL ON FUNCTION public.agent_pass_refund_on_failure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_refund_on_failure() TO service_role;