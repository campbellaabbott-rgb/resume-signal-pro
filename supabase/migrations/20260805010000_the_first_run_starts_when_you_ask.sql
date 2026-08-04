-- THE INSTANT-START FIRED AT THE WRONG MOMENT.
--
-- 20260804040000 made stripe-webhook call agent_prepare_now() the instant an
-- agent subscription activates, so a subscriber who paid at :24 would not stare
-- at an empty queue for fifty-nine minutes. The reasoning was right and the
-- trigger point was wrong.
--
-- apply-agent's first act is `agent_mandates WHERE active = true`. At the moment
-- of PURCHASE the buyer has no mandate row — nothing creates one at checkout,
-- and the only two writers are the two Account panels the person drives by hand
-- afterwards. So the kick runs, finds nobody, and does nothing. It cost a
-- function invocation and bought exactly zero seconds.
--
-- The wait it was meant to remove is still there, just moved: pay, set up the
-- mandate, and THEN wait up to fifty-nine minutes for :23. That is the worst
-- possible placement of the wait, because it lands immediately after the person
-- has finished typing in their answers and is watching for something to happen.
--
-- SO THE KICK BELONGS ON THE MANDATE, NOT ON THE PAYMENT. This fires when a
-- mandate is created, and when a dormant one is switched back on — the two
-- moments where somebody has just declared they want the agent working.
--
-- WHY A TRIGGER RATHER THAN A CALL FROM THE PANEL. agent_prepare_now is granted
-- to service_role alone and holds the maintenance key in the vault; exposing it
-- to `authenticated` would hand every signed-in account a button that invokes a
-- paid AI pipeline. A trigger keeps the whole path server-side, needs no new
-- grant, and cannot be called out of band.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS last_prepare_kick_at timestamptz;

COMMENT ON COLUMN public.agent_mandates.last_prepare_kick_at IS
  'When this mandate last triggered an immediate apply-agent run. Throttles the '
  'on-save kick; NULL means never kicked and is always eligible.';

CREATE OR REPLACE FUNCTION public.agent_kick_on_mandate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- so the call to agent_prepare_now passes its EXECUTE check
SET search_path = public
AS $$
BEGIN
  -- Only when the agent is actually meant to be working. A row saved with
  -- active = false is somebody configuring, not somebody asking.
  IF NOT COALESCE(NEW.active, false) THEN
    RETURN NEW;
  END IF;

  -- THROTTLE. Without it, toggling `active` in a loop is a free way to invoke a
  -- paid AI pipeline from a signed-in account. Five minutes is far below the
  -- hourly cron it front-runs and far above any honest double-click.
  --
  -- NULL is eligible, deliberately: every mandate that existed before this
  -- column did must still get its first kick.
  IF NEW.last_prepare_kick_at IS NOT NULL
     AND NEW.last_prepare_kick_at > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  NEW.last_prepare_kick_at := now();

  -- NEVER FAIL THE SAVE. The person's mandate is the thing that matters; the
  -- head start is a convenience. If the vault key is missing or pg_net is
  -- unhappy, agent_prepare_now returns false or raises, and either way the
  -- hourly cron remains the floor — exactly as it did before this existed.
  BEGIN
    PERFORM public.agent_prepare_now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_kick_on_mandate() FROM PUBLIC, anon, authenticated;

-- BEFORE, not AFTER: it lets the throttle stamp be written as part of the same
-- row rather than as a second UPDATE, which would re-enter this trigger.
--
-- `UPDATE OF active` narrows the update case to the switch being flipped —
-- editing a cap or a blocklist must not re-kick, and the daily writes those
-- panels make would otherwise fire this constantly.
DROP TRIGGER IF EXISTS agent_mandates_kick_prepare ON public.agent_mandates;
CREATE TRIGGER agent_mandates_kick_prepare
  BEFORE INSERT OR UPDATE OF active ON public.agent_mandates
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_kick_on_mandate();

COMMENT ON FUNCTION public.agent_kick_on_mandate() IS
  'Starts an apply-agent run the moment a mandate is created or switched back on, '
  'instead of at purchase — at purchase the buyer has no mandate yet and the run '
  'finds nobody. Throttled to one kick per five minutes per mandate, and never '
  'fails the save: the hourly cron stays the floor.';
