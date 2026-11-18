-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- A PRUNED MONTH IS NEVER WRITTEN TO AGAIN (S14X-158).
--
-- roll_up_and_prune_layoff_filings (20261110160000) floors its keep window
-- at 180 days: v_cutoff := current_date - GREATEST(COALESCE(p_keep_days, 365),
-- 180). The writers keep 365 days (LAYOFF_RETENTION_DAYS in
-- supabase/functions/layoff-filings/index.ts; the EDGAR backfill searches a
-- year of filings), so a run asked for fewer than 365 days would delete and
-- roll up months the next read writes again, and the rollup would count a
-- filing twice. The cron passes 365 today, so the defect is latent; the
-- floor now IS the writers' window. The writers refuse a row dated before
-- the first day of the month the prune keeps (upsertRows in the same
-- function), so an 8-K filed inside the window with a report date in an
-- already-rolled month is never stored.
--
-- Re-issued from the hotfix's catalogue body (one anchor, refused if it
-- drifted). Return shape, grants (service_role only) and the cron are
-- unchanged. Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '1min';

DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.roll_up_and_prune_layoff_filings(int)'::regprocedure);
  v_anchor text := 'GREATEST(COALESCE(p_keep_days, 365), 180)';
  v_floor  text := 'GREATEST(COALESCE(p_keep_days, 365), 365)';
BEGIN
  IF position(v_floor IN v_def) > 0 THEN
    RAISE NOTICE 'roll_up_and_prune_layoff_filings already keeps the writers'' 365 days';
  ELSIF position(v_anchor IN v_def) = 0 OR position('non_workforce_n = r.non_workforce_n + EXCLUDED.non_workforce_n' IN v_def) = 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: the live body is not the one 20261110160000 wrote; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, v_floor);
  END IF;
END
$mig$;

COMMENT ON FUNCTION public.roll_up_and_prune_layoff_filings(int) IS
  'Monthly retention for layoff_filings: deletes the filings of WHOLE months that ended on or before '
  'the keep window (default 365 days, floored at 365, the writers'' own window: 20261112181000) and '
  'counts exactly those rows into layoff_filing_rollup in the same statement, each in one column: '
  'filings and workers_sum for what the readers show (status active, a WARN notice or an 8-K workforce '
  'event), and superseded_n, amendment_n, rescinded_n and non_workforce_n for the rest, so the five add '
  'up to the rows pruned (20261110160000). Also trims layoff_read_log to 90 days. service_role only; '
  'scheduled monthly.';

DO $verify$
DECLARE
  src text;
BEGIN
  SELECT p.prosrc INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings';
  IF position('GREATEST(COALESCE(p_keep_days, 365), 365)' IN src) = 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings still prunes months the writers write again';
  END IF;
  IF position('f.status = ''active'' AND (f.source <> ''sec_8k_205'' OR f.is_workforce_event IS TRUE)' IN regexp_replace(src, '\s+', ' ', 'g')) = 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings lost the one-column-per-row count';
  END IF;
  IF has_function_privilege('anon', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: a client role can execute the filing prune';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: service_role cannot execute it';
  END IF;
END
$verify$;
