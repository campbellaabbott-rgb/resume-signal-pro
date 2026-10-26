-- THE PERK SWEEP RUNS EVERY MINUTE UNDER A LEASE, AND THE ROLLUP NIGHTLY UNDER A BUDGET.
--
-- Company profiles, phase 1 (plan 2026-10-11, section 6 A). Two jobs:
--
--   employer-perks-sweep   * * * * *       a POST to the employer-profiles
--                                          function, {"action":"sweep"}. The
--                                          function takes a 90-second lease
--                                          (an overlapping minute skips), reads
--                                          up to 300 postings in board order
--                                          (open roles descending) and stops at
--                                          20 seconds or the pause switch.
--   employer-perks-rollup  13,43 0,1 * * * four ticks a night, 00:13 to 01:43
--                                          UTC, of employer_perk_rollup_tick:
--                                          50k-row keyset chunks, a 90-second
--                                          budget checked between chunks, the
--                                          cursor persisted, and a lap that
--                                          finished today waits for tomorrow.
--
-- WHY THOSE MINUTES. The heavy hourly jobs sit at :05 and :35 (ghost stats),
-- :07 (explore cache), :09 and :39 (closure population), :27 (stats cache)
-- and :37 (transparency); the nightly ones run from 02:30 (snapshots) to
-- 05:10 (layoff partition). :13 and :43 between midnight and two touch none
-- of them; the rollup reads only its own tables plus one primary-key probe
-- per perk row to prune what left the serving set.
--
-- EVERY COMMAND SETS ITS OWN statement_timeout, FIRST. A function's SET never
-- extends a pg_cron run (20261003220000): the rollup's 110 s is in its
-- command, above its own 90 s budget, so a tick always ends on its own and
-- commits; the sweep's command only queues an HTTP request (15 s).
--
-- THE CRON IDENTIFIES ITSELF. The sweep carries x-employer-profiles-cron, a
-- key generated into the vault here on first application and left untouched
-- after; the function compares it through employer_profiles_cron_key_matches
-- (service role, a boolean, never the key) and answers anything else 401.
-- pg_net waits 25 s for the answer, so a refusal lands in net._http_response
-- where cron_http_refusals (20261009143000) counts it.
--
-- Guarded for a database without pg_cron or the vault (a local replay
-- applies the file as a no-op there). Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

-- The key, generated once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'vault is not installed here; employer_profiles_cron_key not generated (the sweep kicks will carry no header)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'employer_profiles_cron_key') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'employer_profiles_cron_key'
    );
    RAISE NOTICE 'generated employer_profiles_cron_key; the perk sweep is armed';
  ELSE
    RAISE NOTICE 'employer_profiles_cron_key already present; left untouched';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.employer_profiles_cron_key_matches(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_ok boolean := false;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name = $1 AND s.decrypted_secret = $2)'
     INTO v_ok USING 'employer_profiles_cron_key', p_key;
  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.employer_profiles_cron_key_matches(text) IS
  'True when the argument equals the vault-held employer_profiles_cron_key the perk sweep cron sends as x-employer-profiles-cron. '
  'Returns a boolean and never the key. An empty, short or missing key never matches. service_role only.';

REVOKE ALL ON FUNCTION public.employer_profiles_cron_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employer_profiles_cron_key_matches(text) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'employer_profiles_cron_key_matches'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- The schedules.
DO $$
DECLARE
  j text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; the perk schedules were not created';
    RETURN;
  END IF;

  FOREACH j IN ARRAY ARRAY['employer-perks-sweep', 'employer-perks-rollup'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;

  PERFORM cron.schedule(
    'employer-perks-sweep',
    '* * * * *',
    $job$SET statement_timeout = '15s'; SELECT net.http_post(url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/employer-profiles', headers := jsonb_build_object('Content-Type', 'application/json', 'x-employer-profiles-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'employer_profiles_cron_key' LIMIT 1)), body := '{"action":"sweep"}'::jsonb, timeout_milliseconds := 25000) WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'employer_profiles_cron_key');$job$
  );

  PERFORM cron.schedule(
    'employer-perks-rollup',
    '13,43 0,1 * * *',
    $job$SET statement_timeout = '110s'; SELECT public.employer_perk_rollup_tick(90000);$job$
  );

  RAISE NOTICE 'perk schedules created: sweep every minute, rollup at 00:13, 00:43, 01:13 and 01:43 UTC';
END $$;

-- Self-verifying: both jobs active, on their schedules, each command opening
-- with its own statement_timeout, the sweep carrying its key header.
DO $verify$
DECLARE
  r record;
BEGIN
  IF NOT has_function_privilege('service_role', to_regprocedure('public.employer_profiles_cron_key_matches(text)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.employer_profiles_cron_key_matches(text)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.employer_profiles_cron_key_matches(text)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'employer_profiles_cron_key_matches is not service-role only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT w.name, w.schedule, w.timeout, j.schedule AS got_schedule, j.command, j.active
      FROM (VALUES ('employer-perks-sweep', '* * * * *', '15s'),
                   ('employer-perks-rollup', '13,43 0,1 * * *', '110s')) AS w(name, schedule, timeout)
      LEFT JOIN cron.job j ON j.jobname = w.name
  LOOP
    IF r.command IS NULL OR NOT COALESCE(r.active, true) THEN
      RAISE EXCEPTION 'perk cron % is not active after scheduling', r.name;
    END IF;
    IF r.got_schedule <> r.schedule THEN
      RAISE EXCEPTION 'perk cron % runs at % but this file names %', r.name, r.got_schedule, r.schedule;
    END IF;
    IF position(format('SET statement_timeout = ''%s'';', r.timeout) IN r.command) <> 1 THEN
      RAISE EXCEPTION 'perk cron % does not open with its own statement_timeout of %', r.name, r.timeout;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'employer-perks-sweep'
                  AND command LIKE '%x-employer-profiles-cron%' AND command LIKE '%"action":"sweep"%') THEN
    RAISE EXCEPTION 'employer-perks-sweep does not send its key header and the sweep action';
  END IF;
END
$verify$;
