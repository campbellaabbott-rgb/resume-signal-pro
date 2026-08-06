-- THE SAFETY NET FOR "SOMEBODY PAID AND GOT NOTHING" CANNOT SAY WHETHER IT RUNS.
--
-- Audited 2026-08-06. reconcile-stripe is the last line of defence on money: it
-- lists recent PAID Stripe sessions, finds the ones with no delivery marker, and
-- emails the owner to recover them. It is scheduled daily at 15:17 UTC by
-- 20260714130000.
--
-- It emails ONLY when it finds orphans. So on a healthy day it is silent — and
-- on a day when the cron is dead it is also silent. One observable value, two
-- states, and the reassuring one is the default reading. That is the same fault
-- already fixed three times today (the maintenance key, the wake config, email
-- delivery), sitting on the highest-stakes job in the system.
--
-- The migration that created the cron proves the migration ran. It does not
-- prove the job still exists or still fires: `cron.job` is not anon-readable,
-- and reconcile-stripe wrote no run stamp, so "has the reconciliation ever run"
-- was unanswerable from outside without a service key.
--
-- WHY THE CRON STAMPS ITSELF RATHER THAN THE FUNCTION STAMPING ON body.source.
-- apply-agent derives its trigger from `{"source":"cron"}` in the request body,
-- which is sound THERE because apply-agent requires a JWT — forging it costs a
-- credential. reconcile-stripe is `verify_jwt = false` and has no secret gate
-- (deliberately: counts-only response, email to a fixed owner address). Copying
-- the body-source pattern onto an open endpoint would let anyone on the internet
-- set this light green, and the likelier version is not an attacker at all — it
-- is us curling the function with the cron's own body to test it, and thereby
-- manufacturing proof of a schedule that never fired.
--
-- So the timestamp is written by the scheduled SQL itself. Only pg_cron executes
-- it, the function is revoked from PUBLIC, and `job_board_meta` is closed to
-- anon by RLS. Nothing reachable over HTTP can advance it. A hand-run of the
-- edge function still records its counts — it simply cannot claim to be the
-- schedule.
--
-- The alternative was a shared cron secret. Rejected: an unset secret would mean
-- the stamp never says "cron", which renders the light permanently red and
-- therefore ignored — a new silent gate to replace the one being removed. This
-- needs no secret to keep working.

CREATE OR REPLACE FUNCTION public.reconcile_stripe_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Unchanged from the original schedule: same URL, same headers, same 48h
  -- lookback that clears Stripe's webhook retry window while staying inside the
  -- 30-day used_stripe_sessions retention.
  PERFORM net.http_post(
    url     := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/reconcile-stripe',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{"lookbackHours": 48}'::jsonb
  );

  -- Stamped AFTER the post is queued, and deliberately not conditional on the
  -- sweep's outcome. This field answers exactly one question — "did the schedule
  -- fire?" — and must not be silently widened into "did the sweep succeed",
  -- which is what the counts stamp written by the function itself is for.
  -- Two fields, two questions; neither able to answer for the other.
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('reconcile_stripe_cron', jsonb_build_object('lastCronAt', now()), now())
  ON CONFLICT (k) DO UPDATE
    SET v = jsonb_build_object('lastCronAt', now()), updated_at = now();
END;
$fn$;

-- Nothing with an HTTP path may execute this. That restriction IS the guarantee
-- that lastCronAt means what it says; a GRANT to anon here would quietly undo
-- the entire point of the migration.
REVOKE ALL ON FUNCTION public.reconcile_stripe_tick() FROM PUBLIC;

COMMENT ON FUNCTION public.reconcile_stripe_tick() IS
  'Scheduled entry point for reconcile-stripe. Posts to the function and stamps '
  'job_board_meta.reconcile_stripe_cron.lastCronAt. Callable only by the '
  'scheduler, which is what makes that timestamp trustworthy as proof the '
  'payment safety net still fires.';

-- Repoint the existing schedule at the tick. Unschedule-then-schedule rather
-- than a conditional create: the job already exists from 20260714130000, so a
-- NOT EXISTS guard like that migration's would make this a no-op and the stamp
-- would never appear.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stripe') THEN
      PERFORM cron.unschedule('reconcile-stripe');
    END IF;
    -- Same time as before. Moving it would silently change which Stripe window
    -- gets swept and is not what this migration is for.
    PERFORM cron.schedule(
      'reconcile-stripe',
      '17 15 * * *',
      $job$ SELECT public.reconcile_stripe_tick(); $job$
    );
  END IF;
END $$;
