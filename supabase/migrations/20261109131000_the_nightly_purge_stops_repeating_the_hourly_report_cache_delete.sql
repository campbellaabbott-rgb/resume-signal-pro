-- THE NIGHTLY PURGE STOPS REPEATING THE HOURLY REPORT-CACHE DELETE (cost
-- audit 2026-11-08, db-cadence lane, "do first" #14, second half).
--
-- 'scan-cache-and-telemetry-purge' ('10 4 * * *', 20260704200000 /
-- 20260705162706) runs four deletes in one command. Its first deletes
-- scan_report_cache rows older than seven days -- and since 20261004150000
-- 'scan-report-cache-retention' runs that same delete, same predicate, every
-- hour at minute 13. At 04:10 the hourly job ran 57 minutes earlier and runs
-- again 3 minutes later, so the nightly copy can only ever remove what the
-- 04:13 run would remove three minutes on. It is removed here; the other three
-- deletes (rate_limits after 3 days, detection_telemetry after 90,
-- consumed pro_grants after 90) are kept as they are, in their order.
--
-- The promise the privacy page makes -- the report cache purged every hour --
-- is the hourly job's, and it is untouched.
--
-- The command also gains SET statement_timeout = '2min' in front: the cap the
-- cron session already applies (20261003220000), now written where
-- get_cron_health can read it. Measured read-only on 2026-11-08 the whole
-- command takes 0.0 s, so the change is hygiene, not a saving in time.
--
-- The rewrite works on the LIVE command text, because two spellings of it
-- were written (upper and lower case): the report-cache delete is cut out by
-- pattern, whatever its case, and nothing else in the command is retyped. It
-- runs only when the job exists AND the hourly job that makes the delete
-- redundant exists; otherwise nothing changes, with a notice.
--
-- Safe to re-run: a command already rewritten has no report-cache delete left
-- to cut and already starts with its timeout, so a second run changes nothing.

DO $$
DECLARE
  v_id bigint;
  v_cmd text;
  v_new text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no nightly purge to rewrite';
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'scan-cache-and-telemetry-purge';
  IF v_id IS NULL THEN
    RAISE NOTICE 'no scan-cache-and-telemetry-purge job here; nothing to rewrite';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'scan-report-cache-retention'
                    AND j.command ~* 'delete[[:space:]]+from[[:space:]]+public\.scan_report_cache') THEN
    RAISE NOTICE 'the hourly scan-report-cache-retention job is not here, so the nightly report-cache delete is the only one and is kept';
    RETURN;
  END IF;

  v_new := regexp_replace(v_cmd,
    '[[:space:]]*delete[[:space:]]+from[[:space:]]+public\.scan_report_cache[[:space:]]+where[[:space:]]+created_at[[:space:]]*<[[:space:]]*now\(\)[[:space:]]*-[[:space:]]*interval[[:space:]]*''7 days''[[:space:]]*;',
    '', 'gi');
  v_new := btrim(v_new, E' \t\r\n');
  IF v_new !~* '^SET[[:space:]]+statement_timeout' THEN
    v_new := 'SET statement_timeout = ''2min''; ' || v_new;
  END IF;
  IF v_new IS DISTINCT FROM v_cmd THEN
    PERFORM cron.alter_job(v_id, command => v_new);
  END IF;
END $$;

DO $$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'scan-cache-and-telemetry-purge';
  IF v_cmd IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'scan-report-cache-retention'
                    AND j.command ~* 'delete[[:space:]]+from[[:space:]]+public\.scan_report_cache') THEN
    RETURN;
  END IF;
  IF v_cmd ~* 'scan_report_cache' THEN
    RAISE EXCEPTION 'self-check: the nightly purge still deletes from scan_report_cache: %', v_cmd;
  END IF;
  IF v_cmd !~* '^SET[[:space:]]+statement_timeout' THEN
    RAISE EXCEPTION 'self-check: the nightly purge sets no statement_timeout: %', v_cmd;
  END IF;
  IF v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.rate_limits'
     OR v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.detection_telemetry'
     OR v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.pro_grants' THEN
    RAISE EXCEPTION 'self-check: the nightly purge lost one of the deletes it keeps: %', v_cmd;
  END IF;
END $$;
