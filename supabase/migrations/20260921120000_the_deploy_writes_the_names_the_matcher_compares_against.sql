-- THE DEPLOY WRITES THE NAMES THE MATCHER COMPARES AGAINST.
--
-- Measured 2026-09-21: the poller ran (317 WARN rows, EDGAR read), the
-- matcher ran, and public.layoff_board_names was EMPTY. Its only writer was
-- an operator script that needs the service key, which is not held outside
-- the platform. With nothing to compare against, the exact rule answered no
-- rows for two-word filers (Williams-Sonoma, Trade Desk) and the filed arm
-- of the partition held only the six CIK-alias employers.
--
-- The fix is in the function: layoff-filings gained an action that builds
-- the mirror rows from the catalogue its bundle imports and writes them
-- through layoff_board_names_mirror (unchanged, service_role only). This
-- migration adds the ONE cron row that kicks it and lets the read log
-- record the run.
--
--   layoff-mirror-daily   0 5 * * *   daily, ten minutes before the existing
--                                     matcher-then-partition row at 05:10,
--                                     so the names are current when the
--                                     matcher reads them. chain:false -- the
--                                     05:10 row does the rebuild; a manual
--                                     POST with chain:true does both at once.
--
-- The read log's kind list was a closed CHECK of six values; it now admits
-- the seventh so the mirror's row lands instead of failing the insert. No
-- function is created or replaced here.

SET LOCAL statement_timeout = '2min';

-- The read log admits the mirror's kind.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.layoff_read_log') IS NULL THEN
    RAISE NOTICE 'layoff_read_log is absent here; the kind check was not widened';
    RETURN;
  END IF;
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.layoff_read_log'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.layoff_read_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.layoff_read_log
    ADD CONSTRAINT layoff_read_log_kind_check
    CHECK (kind IN ('edgar_atom', 'edgar_fts_audit', 'edgar_backfill', 'warn', 'matcher', 'partition', 'mirror'));
END $$;

-- The schedule: one row, before the matcher.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; layoff-mirror-daily was not created';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'layoff-mirror-daily') THEN
    PERFORM cron.unschedule('layoff-mirror-daily');
  END IF;

  PERFORM cron.schedule(
    'layoff-mirror-daily',
    '0 5 * * *',
    $job$
    SELECT net.http_post(
      url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/layoff-filings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-layoff-cron', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key' LIMIT 1)
      ),
      body := '{"action":"mirror","chain":false}'::jsonb
    )
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'layoff_cron_key');
    $job$
  );

  RAISE NOTICE 'layoff-mirror-daily scheduled at 05:00 UTC, before the 05:10 matcher';
END $$;

-- Self-verifying: the row is active at the minute named above, the read log
-- takes the new kind, and the mirror precedes the matcher row on the clock.
DO $$
DECLARE
  got   text;
  mine  int;
  their text;
  def   text;
BEGIN
  IF to_regclass('public.layoff_read_log') IS NOT NULL THEN
    SELECT pg_get_constraintdef(c.oid) INTO def
      FROM pg_constraint c
     WHERE c.conrelid = 'public.layoff_read_log'::regclass AND c.conname = 'layoff_read_log_kind_check';
    IF def IS NULL OR def NOT LIKE '%mirror%' THEN
      RAISE EXCEPTION 'layoff_read_log kind check does not admit the mirror kind: %', COALESCE(def, '<missing>');
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.schedule INTO got FROM cron.job j WHERE j.jobname = 'layoff-mirror-daily' AND j.active LIMIT 1;
  IF got IS NULL THEN
    RAISE EXCEPTION 'layoff-mirror-daily is not active after scheduling';
  END IF;
  IF got <> '0 5 * * *' THEN
    RAISE EXCEPTION 'layoff-mirror-daily runs at % but this file names 0 5 * * *', got;
  END IF;
  SELECT j.schedule INTO their FROM cron.job j WHERE j.jobname = 'layoff-partition-refresh' AND j.active LIMIT 1;
  IF their IS NOT NULL THEN
    mine := split_part(got, ' ', 2)::int * 60 + split_part(got, ' ', 1)::int;
    IF mine >= split_part(their, ' ', 2)::int * 60 + split_part(their, ' ', 1)::int THEN
      RAISE EXCEPTION 'layoff-mirror-daily (%) must run before layoff-partition-refresh (%)', got, their;
    END IF;
  END IF;
END $$;
