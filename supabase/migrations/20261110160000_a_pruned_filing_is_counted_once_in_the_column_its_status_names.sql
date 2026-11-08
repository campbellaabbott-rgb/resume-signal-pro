-- A PRUNED FILING IS COUNTED ONCE, IN THE COLUMN ITS STATUS NAMES (sweep
-- M-S14-040; the hotfix of 2026-11-10, privacy lane).
--
-- roll_up_and_prune_layoff_filings (last defined in 20261008113500) deletes
-- the filings of whole months older than the keep window and counts them into
-- layoff_filing_rollup in the same statement. It counted EVERY deleted row as
-- a filing and added the workers of every row. But the table stores more than
-- events: a WARN amendment chain keeps its ancestors (status superseded) and
-- its rescinded notices (status rescinded), an 8-K/A is stored with status
-- amendment, and an exit-cost 8-K Item 2.05 is active with is_workforce_event
-- not TRUE. Every reader shows only status 'active' rows, and an 8-K only as a
-- workforce event (20261009160000). So the only record left after the monthly
-- prune overstated both the filings and the workers: an updated notice was
-- counted twice, with both headcounts added. The prune is irreversible, and
-- the next run is the 'layoff-rollup-retention' cron at 20 4 1 * * on
-- 2026-12-01.
--
-- THE FIX. Every pruned row lands in exactly one column:
--   filings, workers_sum  status 'active' and (a WARN notice, or an 8-K whose
--                         is_workforce_event IS TRUE): what the readers show;
--   non_workforce_n       status 'active', an 8-K that is not a workforce event;
--   superseded_n          status 'superseded' or 'amended' (an earlier notice a
--                         later one in its chain replaced);
--   amendment_n           status 'amendment' (an 8-K/A);
--   rescinded_n           status 'rescinded'.
-- The five counts add up to the rows the run deleted. A row whose status fits
-- none of them stops the run before anything is deleted.
--
-- MONTHS ROLLED BEFORE THIS FILE keep NULL in the four new columns: their
-- filings counted every pruned row and their workers_sum every row's workers,
-- and the rows are gone, so they cannot be split. A late filing that joins
-- such a month is counted by that same rule, so the month stays one rule
-- whole.
--
-- Unchanged: the whole-month rule, the 180-day floor, the read-log trim, the
-- return shape, the grants (service_role only), the cron. Self-verifying, safe
-- to re-run.

SET LOCAL statement_timeout = '5min';

ALTER TABLE public.layoff_filing_rollup ADD COLUMN IF NOT EXISTS superseded_n int;
ALTER TABLE public.layoff_filing_rollup ADD COLUMN IF NOT EXISTS amendment_n int;
ALTER TABLE public.layoff_filing_rollup ADD COLUMN IF NOT EXISTS rescinded_n int;
ALTER TABLE public.layoff_filing_rollup ADD COLUMN IF NOT EXISTS non_workforce_n int;

COMMENT ON COLUMN public.layoff_filing_rollup.filings IS
  'Pruned filings the readers would show: status active and a WARN notice or an 8-K workforce event '
  '(20261110160000). On a month rolled before that file (superseded_n IS NULL), every pruned row.';
COMMENT ON COLUMN public.layoff_filing_rollup.workers_sum IS
  'Workers of the rows counted in filings, NULL when none stated one. On a month rolled before '
  '20261110160000 (superseded_n IS NULL), the workers of every pruned row.';
COMMENT ON COLUMN public.layoff_filing_rollup.superseded_n IS
  'Pruned rows with status superseded or amended. NULL: the month was rolled before 20261110160000, '
  'when filings counted every row.';
COMMENT ON COLUMN public.layoff_filing_rollup.amendment_n IS
  'Pruned rows with status amendment (an 8-K/A). NULL as superseded_n.';
COMMENT ON COLUMN public.layoff_filing_rollup.rescinded_n IS
  'Pruned rows with status rescinded. NULL as superseded_n.';
COMMENT ON COLUMN public.layoff_filing_rollup.non_workforce_n IS
  'Pruned active 8-K Item 2.05 rows whose is_workforce_event is not TRUE (an exit or disposal cost, '
  'not a workforce reduction). NULL as superseded_n.';

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_layoff_filings(p_keep_days int DEFAULT 365)
RETURNS TABLE (lr_months_rolled int, lr_filings_pruned int, lr_log_rows_pruned int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_cutoff     date := current_date - GREATEST(COALESCE(p_keep_days, 365), 180);
  v_months     int := 0;
  v_pruned     int := 0;
  v_unclassed  int := 0;
  v_log        int := 0;
BEGIN
  WITH moved AS (
    DELETE FROM public.layoff_filings f
     WHERE (date_trunc('month', f.event_date) + interval '1 month')::date <= v_cutoff
    RETURNING date_trunc('month', f.event_date)::date AS month,
              f.source AS source,
              COALESCE(f.state::text, '') AS state,
              f.workers AS workers,
              CASE
                WHEN f.status = 'active' AND (f.source <> 'sec_8k_205' OR f.is_workforce_event IS TRUE) THEN 'filing'
                WHEN f.status = 'active' THEN 'non_workforce'
                WHEN f.status IN ('superseded', 'amended') THEN 'superseded'
                WHEN f.status = 'amendment' THEN 'amendment'
                WHEN f.status = 'rescinded' THEN 'rescinded'
              END AS kind
  ),
  src AS (
    SELECT m.month, m.source, m.state,
           count(*) FILTER (WHERE m.kind = 'filing')::int          AS filings,
           sum(m.workers) FILTER (WHERE m.kind = 'filing')::bigint AS workers_sum,
           count(*) FILTER (WHERE m.kind = 'superseded')::int      AS superseded_n,
           count(*) FILTER (WHERE m.kind = 'amendment')::int       AS amendment_n,
           count(*) FILTER (WHERE m.kind = 'rescinded')::int       AS rescinded_n,
           count(*) FILTER (WHERE m.kind = 'non_workforce')::int   AS non_workforce_n,
           count(*)::int                                           AS rows_n,
           sum(m.workers)::bigint                                  AS workers_all
    FROM moved m
    GROUP BY m.month, m.source, m.state
  ),
  ruled AS (
    SELECT s.*, COALESCE(prior.every_row, false) AS every_row
    FROM src s
    LEFT JOIN LATERAL (
      SELECT (p.superseded_n IS NULL) AS every_row
      FROM public.layoff_filing_rollup p
      WHERE p.month = s.month AND p.source = s.source AND p.state = s.state
    ) prior ON true
  ),
  rolled AS (
    INSERT INTO public.layoff_filing_rollup AS r
           (month, source, state, filings, workers_sum, superseded_n, amendment_n, rescinded_n, non_workforce_n, rolled_at)
    SELECT u.month, u.source, u.state,
           CASE WHEN u.every_row THEN u.rows_n ELSE u.filings END,
           CASE WHEN u.every_row THEN u.workers_all ELSE u.workers_sum END,
           CASE WHEN u.every_row THEN NULL ELSE u.superseded_n END,
           CASE WHEN u.every_row THEN NULL ELSE u.amendment_n END,
           CASE WHEN u.every_row THEN NULL ELSE u.rescinded_n END,
           CASE WHEN u.every_row THEN NULL ELSE u.non_workforce_n END,
           now()
    FROM ruled u
    ON CONFLICT (month, source, state) DO UPDATE SET
      filings         = r.filings + EXCLUDED.filings,
      workers_sum     = CASE WHEN r.workers_sum IS NULL AND EXCLUDED.workers_sum IS NULL THEN NULL
                             ELSE COALESCE(r.workers_sum, 0) + COALESCE(EXCLUDED.workers_sum, 0) END,
      superseded_n    = r.superseded_n + EXCLUDED.superseded_n,
      amendment_n     = r.amendment_n + EXCLUDED.amendment_n,
      rescinded_n     = r.rescinded_n + EXCLUDED.rescinded_n,
      non_workforce_n = r.non_workforce_n + EXCLUDED.non_workforce_n,
      rolled_at       = now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM rolled)::int,
         (SELECT count(*) FROM moved)::int,
         (SELECT count(*) FROM moved m WHERE m.kind IS NULL)::int
    INTO v_months, v_pruned, v_unclassed;

  IF v_unclassed > 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: % pruned row(s) have a status no rollup column counts; nothing was deleted', v_unclassed;
  END IF;

  DELETE FROM public.layoff_read_log l WHERE l.read_at < now() - interval '90 days';
  GET DIAGNOSTICS v_log = ROW_COUNT;

  RETURN QUERY SELECT v_months, v_pruned, v_log;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_layoff_filings(int) IS
  'Monthly retention for layoff_filings: deletes the filings of WHOLE months that ended on or before '
  'the keep window (default 365 days, floored at 180) and counts exactly those rows into '
  'layoff_filing_rollup in the same statement, each in one column: filings and workers_sum for what '
  'the readers show (status active, a WARN notice or an 8-K workforce event), and superseded_n, '
  'amendment_n, rescinded_n and non_workforce_n for the rest, so the five add up to the rows pruned '
  '(20261110160000; it used to count every row as a filing). A month rolled before that file keeps '
  'its every-row count. Also trims layoff_read_log to 90 days. service_role only; scheduled monthly.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_layoff_filings(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_layoff_filings(int) TO service_role;
REVOKE ALL ON TABLE public.layoff_filing_rollup FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE
  n   int;
  src text;
  c   text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings';
  IF n <> 1 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: expected exactly one definition, found %', n;
  END IF;

  FOREACH c IN ARRAY ARRAY['superseded_n', 'amendment_n', 'rescinded_n', 'non_workforce_n'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'layoff_filing_rollup'
         AND column_name = c AND data_type = 'integer'
    ) THEN
      RAISE EXCEPTION 'layoff_filing_rollup has no integer column %', c;
    END IF;
    IF has_column_privilege('anon', 'public.layoff_filing_rollup', c, 'SELECT')
       OR has_column_privilege('authenticated', 'public.layoff_filing_rollup', c, 'SELECT') THEN
      RAISE EXCEPTION 'a client role can read layoff_filing_rollup.%', c;
    END IF;
  END LOOP;

  SELECT regexp_replace(p.prosrc, '\s+', ' ', 'g') INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings';
  IF position('f.status = ''active'' AND (f.source <> ''sec_8k_205'' OR f.is_workforce_event IS TRUE)' IN src) = 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings still counts rows the readers never show as filings';
  END IF;
  IF position('non_workforce_n = r.non_workforce_n + EXCLUDED.non_workforce_n' IN src) = 0
     OR position('m.kind IS NULL' IN src) = 0
     OR position('interval ''1 month'')::date <= v_cutoff' IN src) = 0 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings does not roll whole months into one column per row';
  END IF;

  IF has_function_privilege('anon', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: a client role can execute the filing prune';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: service_role cannot execute it';
  END IF;
  IF has_table_privilege('anon', 'public.layoff_filing_rollup', 'SELECT')
     OR has_table_privilege('authenticated', 'public.layoff_filing_rollup', 'SELECT') THEN
    RAISE EXCEPTION 'a client role can read layoff_filing_rollup';
  END IF;
END
$verify$;
