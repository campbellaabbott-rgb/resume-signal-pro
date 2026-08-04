ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS last_prepare_kick_at timestamptz;

COMMENT ON COLUMN public.agent_mandates.last_prepare_kick_at IS
  'When this mandate last triggered an immediate apply-agent run. Throttles the on-save kick; NULL means never kicked and is always eligible.';

CREATE OR REPLACE FUNCTION public.agent_kick_on_mandate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(NEW.active, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.last_prepare_kick_at IS NOT NULL
     AND NEW.last_prepare_kick_at > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  NEW.last_prepare_kick_at := now();

  BEGIN
    PERFORM public.agent_prepare_now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_kick_on_mandate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_mandates_kick_prepare ON public.agent_mandates;
CREATE TRIGGER agent_mandates_kick_prepare
  BEFORE INSERT OR UPDATE OF active ON public.agent_mandates
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_kick_on_mandate();

COMMENT ON FUNCTION public.agent_kick_on_mandate() IS
  'Starts an apply-agent run the moment a mandate is created or switched back on, instead of at purchase. Throttled to one kick per five minutes per mandate, and never fails the save: the hourly cron stays the floor.';