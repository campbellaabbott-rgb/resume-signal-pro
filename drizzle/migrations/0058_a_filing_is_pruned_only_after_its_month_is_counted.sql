SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.roll_up_and_prune_layoff_filings(p_keep_days int DEFAULT 365)
RETURNS TABLE (lr_months_rolled int, lr_filings_pruned int, lr_log_rows_pruned int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_cutoff date := current_date - GREATEST(COALESCE(p_keep_days, 365), 180);
  v_months int := 0;
  v_pruned int := 0;
  v_log    int := 0;
BEGIN
  WITH src AS (
    SELECT date_trunc('month', f.event_date)::date AS month,
           f.source,
           COALESCE(f.state::text, '') AS state,
           count(*)::int AS filings,
           sum(f.workers)::bigint AS workers_sum
    FROM public.layoff_filings f
    WHERE f.event_date < v_cutoff
    GROUP BY 1, 2, 3
  )
  INSERT INTO public.layoff_filing_rollup AS r (month, source, state, filings, workers_sum, rolled_at)
  SELECT s.month, s.source, s.state, s.filings, s.workers_sum, now()
  FROM src s
  ON CONFLICT (month, source, state) DO UPDATE SET
    filings     = EXCLUDED.filings,
    workers_sum = EXCLUDED.workers_sum,
    rolled_at   = now();
  GET DIAGNOSTICS v_months = ROW_COUNT;

  DELETE FROM public.layoff_filings f
  WHERE f.event_date < v_cutoff
    AND EXISTS (
      SELECT 1 FROM public.layoff_filing_rollup rr
      WHERE rr.month  = date_trunc('month', f.event_date)::date
        AND rr.source = f.source
        AND rr.state  = COALESCE(f.state::text, '')
    );
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  DELETE FROM public.layoff_read_log l WHERE l.read_at < now() - interval '90 days';
  GET DIAGNOSTICS v_log = ROW_COUNT;

  RETURN QUERY SELECT v_months, v_pruned, v_log;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_layoff_filings(int) IS
  'Monthly retention for layoff_filings: rolls every month older than the keep window (default 365 '
  'days, floored at 180 so the partition''s cohort plus lookback always has its filings) into '
  'layoff_filing_rollup, then deletes only rows whose month is provably rolled up. Also trims '
  'layoff_read_log to 90 days. service_role only; scheduled monthly.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_layoff_filings(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_layoff_filings(int) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;