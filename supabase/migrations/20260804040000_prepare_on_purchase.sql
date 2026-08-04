-- PAY, THEN WAIT UP TO AN HOUR FOR ANYTHING TO HAPPEN.
--
-- apply-agent runs hourly at :23. Nothing else invokes it. So somebody who
-- subscribes at :24 sees an empty queue for fifty-nine minutes, at the exact
-- moment their expectations are highest and their patience for a paid product
-- is lowest. The most likely conclusion is that it does not work.
--
-- The stripe-webhook already fixed the sibling hole — agent_subscribers used to
-- be written only when the Account page loaded, so a subscriber who paid on a
-- phone and closed the tab missed the first morning entirely. Its own comment
-- says so. This is the same shape one layer down: the entitlement now lands
-- immediately, and nothing prepares anything until the next hour turns.
--
-- WHY A FUNCTION AND NOT A FETCH FROM THE WEBHOOK. apply-agent is maintenance-
-- gated, and the key lives in the vault. An edge function poking it would have
-- to read that secret, which means a production credential moving through
-- application code for no reason. This mirrors the cron EXACTLY — same URL,
-- same vault lookup, same WHERE guard — so the key never leaves the database.
--
-- FIRES NOTHING WHEN THE VAULT IS EMPTY, deliberately, and that is the same
-- reasoning the cron's own comment gives: a call that 403s on every purchase is
-- indistinguishable from one that works until somebody reads the logs, and
-- nobody reads the logs of a thing they believe is fine.

CREATE OR REPLACE FUNCTION public.agent_prepare_now()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_key boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'apply_agent_maintenance_key'
  ) INTO v_has_key;

  IF NOT v_has_key THEN
    -- Not an error. The hourly cron is the floor; this only ever removes wait,
    -- so its absence degrades to "you get your queue at :23" rather than to a
    -- failure the caller has to handle.
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/apply-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-key',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'apply_agent_maintenance_key' LIMIT 1)
    ),
    -- Marked so a run triggered by a purchase is distinguishable from the cron
    -- in the run stamp. `lastRunTrigger` already reports this, and "did the
    -- purchase path fire" is otherwise unanswerable without reading logs.
    body := jsonb_build_object('source', 'purchase')
  );
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.agent_prepare_now() IS
  'Kick apply-agent immediately instead of waiting for the :23 cron. Called by stripe-webhook '
  'when an agent subscription activates. Returns false (not an error) when the vault key is '
  'absent, so the hourly cron remains the floor. The maintenance key never leaves the database.';

REVOKE ALL ON FUNCTION public.agent_prepare_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_prepare_now() TO service_role;
