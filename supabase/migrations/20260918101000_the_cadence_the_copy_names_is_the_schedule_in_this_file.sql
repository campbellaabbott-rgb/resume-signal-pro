-- THE CADENCE THE COPY NAMES IS THE SCHEDULE IN THIS FILE.
--
-- The screen says filings are "read hourly from SEC EDGAR" and "read nightly
-- from state notices as consolidated by Big Local News" (rendered from
-- LAYOFF_READ_CADENCE in src/config/layoffs.ts, never typed). Those two
-- words are true only while the cron rows below say so, which is why the
-- schedules live in one file the cross-runtime guard can read, and why the
-- words "live", "real time" and "now" never appear beside a filing: EDGAR
-- is honest at the hour, the state side is days behind by construction and
-- New York two months, and anything faster is a claim about the agencies.
--
-- THE CRON IDENTIFIES ITSELF. Every HTTP kick carries x-layoff-cron, a key
-- this migration generates into the vault on first application (the
-- apply-agent's self-arming shape, 20260802190000) and leaves untouched on
-- every later one. The layoff-filings function compares the header through
-- layoff_cron_key_matches (service client), which returns only a boolean
-- and never the key; anything else answers 401. Until that function is
-- deployed the kicks 401 and nothing on screen reads them -- a reader that
-- cannot load discloses nothing, and the read log will show the misses.
--
-- FIVE JOBS, all idempotent by jobname (unschedule then schedule, guarded
-- for a database without pg_cron or the vault so a local replay does not
-- abort every later migration):
--   layoff-edgar-atom        17 * * * *   hourly: one Atom GET, Item 2.05 only
--   layoff-edgar-audit       41 6 * * *   daily: full-text completeness audit
--   layoff-warn              40 3 * * *   nightly, after the courier's 23:22
--                                         UTC run: TX and FL direct, then the
--                                         raw state files by ETag
--   layoff-rollup-retention  20 4 1 * *   monthly: rollup then prune, SQL only
--   layoff-partition-refresh 10 5 * * *   daily, SQL only: the matcher then
--                                         the partition writer. The warn
--                                         action runs both itself at the end
--                                         of its chain; this row is the net
--                                         under it, so the measurement runs
--                                         from day one whether or not the
--                                         function is deployed yet.
-- Never through job-board (its bundle sits at the size cap that silently
-- serves the old version) and never through the rate budget.

SET LOCAL statement_timeout = '2min';

-- The key, generated once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'vault is not installed here; layoff_cron_key not generated (the kicks will carry no header)';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'layoff_cron_key') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'layoff_cron_key'
    );
    RAISE NOTICE 'generated layoff_cron_key; the layoff crons are armed';
  ELSE
    RAISE NOTICE 'layoff_cron_key already present; left untouched';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.layoff_cron_key_matches(p_key text)
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
     INTO v_ok USING 'layoff_cron_key', p_key;
  RETURN COALESCE(v_ok, false);
END;
$$;

COMMENT ON FUNCTION public.layoff_cron_key_matches(text) IS
  'True when the argument equals the vault-held layoff_cron_key the layoff crons send as x-layoff-cron. '
  'Returns a boolean and never the key. An empty, short or missing key never matches. service_role only.';

REVOKE ALL ON FUNCTION public.layoff_cron_key_matches(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layoff_cron_key_matches(text) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'layoff_cron_key_matches'
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
    RAISE NOTICE 'pg_cron is not installed here; the layoff schedules were not created';
    RETURN;
  END IF;

  FOREACH j IN ARRAY ARRAY['layoff-edgar-atom', 'layoff-edgar-audit', 'layoff-warn', 'layoff-rollup-retention', 'layoff-partition-refresh'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;

  PERFORM cron.schedule(
    'layoff-edgar-atom',
    '17 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/layoff-filings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-layoff-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key' LIMIT 1)
      ),
      body := '{"action":"edgar"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key');
    $job$
  );

  PERFORM cron.schedule(
    'layoff-edgar-audit',
    '41 6 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/layoff-filings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-layoff-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key' LIMIT 1)
      ),
      body := '{"action":"edgar_audit"}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key');
    $job$
  );

  PERFORM cron.schedule(
    'layoff-warn',
    '40 3 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/layoff-filings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-layoff-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key' LIMIT 1)
      ),
      body := '{"action":"warn","cursor":null}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key');
    $job$
  );

  PERFORM cron.schedule(
    'layoff-rollup-retention',
    '20 4 1 * *',
    $job$ SELECT public.roll_up_and_prune_layoff_filings(365); $job$
  );

  PERFORM cron.schedule(
    'layoff-partition-refresh',
    '10 5 * * *',
    $job$ SELECT public.layoff_matches_rebuild(); SELECT public.refresh_layoff_partition(); $job$
  );

  RAISE NOTICE 'layoff schedules created: edgar hourly at :17, audit 06:41, warn 03:40, rollup monthly 04:20, partition 05:10 (UTC)';
END $$;

-- Self-verifying: all five rows active with the schedules the copy names.
DO $$
DECLARE
  r record;
  want jsonb := '{"layoff-edgar-atom":"17 * * * *","layoff-edgar-audit":"41 6 * * *","layoff-warn":"40 3 * * *","layoff-rollup-retention":"20 4 1 * *","layoff-partition-refresh":"10 5 * * *"}'::jsonb;
  k text;
  got text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  FOR k IN SELECT jsonb_object_keys(want) LOOP
    SELECT j.schedule INTO got FROM cron.job j WHERE j.jobname = k AND j.active LIMIT 1;
    IF got IS NULL THEN
      RAISE EXCEPTION 'layoff cron % is not active after scheduling', k;
    END IF;
    IF got <> (want->>k) THEN
      RAISE EXCEPTION 'layoff cron % runs at % but the copy names %', k, got, want->>k;
    END IF;
  END LOOP;
END $$;
