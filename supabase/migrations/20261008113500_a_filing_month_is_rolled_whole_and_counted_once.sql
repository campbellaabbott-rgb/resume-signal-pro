-- A FILING MONTH IS ROLLED WHOLE, AND COUNTED ONCE.
--
-- roll_up_and_prune_layoff_filings (20260918100900) copies the closure
-- rollup's shape and its defect (register L13-16): it read
-- `event_date < current_date - p_keep_days`, grouped by month, upserted with
-- `filings = EXCLUDED.filings`, then deleted the rows it had read. Whenever
-- the cutoff falls inside a month, that month is rolled in slices and each
-- slice OVERWRITES the last, while every slice's rows are deleted -- the month
-- keeps only its last slice. The monthly cron on the 1st with 365 days lands
-- the cutoff on a 1st in ordinary years, which is why nothing has been lost;
-- a leap year (2028-03-01 minus 365 days is 2027-03-02) or any other argument
-- cuts a month. And a filing can arrive AFTER its month was rolled -- the
-- mirror reads state WARN lists whose notices are often dated in the past --
-- and the next run then overwrote that month's count with the late arrival
-- alone.
--
-- THE FIX. Only WHOLE months that ended on or before the cutoff are rolled,
-- and the rows are DELETED AND COUNTED IN ONE STATEMENT (a DELETE ... RETURNING
-- feeding the rollup's upsert), so the rows counted are exactly the rows
-- removed: nothing is destroyed ahead of its summary, and a filing written
-- while the job runs is either in both or in neither. Because every row a
-- run counts leaves the table in that run, the upsert ADDS to the month
-- (filings = r.filings + EXCLUDED.filings): a late filing joins its month
-- instead of replacing it. The keep window, its 180-day floor, the read-log
-- trim, the return shape, the header, the grants (service_role only) and the
-- monthly cron are unchanged.

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
  WITH moved AS (
    DELETE FROM public.layoff_filings f
     WHERE (date_trunc('month', f.event_date) + interval '1 month')::date <= v_cutoff
    RETURNING date_trunc('month', f.event_date)::date AS month,
              f.source AS source,
              COALESCE(f.state::text, '') AS state,
              f.workers AS workers
  ),
  src AS (
    SELECT m.month, m.source, m.state, count(*)::int AS filings, sum(m.workers)::bigint AS workers_sum
    FROM moved m
    GROUP BY m.month, m.source, m.state
  ),
  rolled AS (
    INSERT INTO public.layoff_filing_rollup AS r (month, source, state, filings, workers_sum, rolled_at)
    SELECT s.month, s.source, s.state, s.filings, s.workers_sum, now()
    FROM src s
    ON CONFLICT (month, source, state) DO UPDATE SET
      filings     = r.filings + EXCLUDED.filings,
      workers_sum = CASE WHEN r.workers_sum IS NULL AND EXCLUDED.workers_sum IS NULL THEN NULL
                         ELSE COALESCE(r.workers_sum, 0) + COALESCE(EXCLUDED.workers_sum, 0) END,
      rolled_at   = now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM rolled)::int, (SELECT count(*) FROM moved)::int
    INTO v_months, v_pruned;

  DELETE FROM public.layoff_read_log l WHERE l.read_at < now() - interval '90 days';
  GET DIAGNOSTICS v_log = ROW_COUNT;

  RETURN QUERY SELECT v_months, v_pruned, v_log;
END;
$$;

COMMENT ON FUNCTION public.roll_up_and_prune_layoff_filings(int) IS
  'Monthly retention for layoff_filings: deletes the filings of WHOLE months '
  'that ended on or before the keep window (default 365 days, floored at 180 so '
  'the partition''s cohort plus lookback always has its filings) and counts '
  'exactly those rows into layoff_filing_rollup in the same statement, ADDING '
  'to the month so a filing that arrives after its month was rolled joins it '
  '(20261008113500; it used to roll by date, overwrite the month and delete, '
  'so a month cut by the cutoff or reached by a late filing kept only its last '
  'slice). Also trims layoff_read_log to 90 days. service_role only; scheduled '
  'monthly.';

REVOKE ALL ON FUNCTION public.roll_up_and_prune_layoff_filings(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_layoff_filings(int) TO service_role;

DO $$
DECLARE n int; src text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings';
  IF n <> 1 THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'roll_up_and_prune_layoff_filings';
  IF src NOT LIKE '%r.filings + EXCLUDED.filings%' OR src NOT LIKE '%interval ''1 month'')::date <= v_cutoff%' THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: the rollup does not roll whole months additively';
  END IF;
  IF has_function_privilege('anon', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.roll_up_and_prune_layoff_filings(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'roll_up_and_prune_layoff_filings: a client role can execute the filing prune';
  END IF;
END $$;
