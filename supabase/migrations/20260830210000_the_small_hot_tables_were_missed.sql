-- THE SMALL TABLE THE ROTATION REWRITES END TO END, EVERY PASS.
--
-- 20260830200000 tuned autovacuum for job_board_postings and job_board_meta and
-- it worked: phaseMs.page_query on the cheapest board call fell from 29,455ms to
-- 2,015ms. The same measurement exposed the next one —
--
--   phaseMs.attachRecheckedAt = 15,104ms
--
-- for a lookup of ONE company_token. job_board_verifications is
-- (company_token text PRIMARY KEY, verified_at timestamptz): a single-key probe
-- against a primary key on ~24k rows, which is microseconds on a healthy table.
-- Fifteen seconds is not a query problem, it is a dead-tuple problem, and this
-- table earns them faster than any other on the board: the rotation stamps
-- verified_at for EVERY board it visits, so all ~24k rows are UPDATEd on every
-- full pass, forever. A table whose entire contents turn over on a loop is the
-- textbook case for aggressive autovacuum, and it was left on the defaults.
--
-- Small tables are not exempt from the scale-factor trap — they are the reason
-- for the THRESHOLD. At 20% of 24k rows autovacuum waits for ~4,800 dead
-- tuples, which one rotation pass produces several times over, and the default
-- cost_limit then makes the cleanup lose to the writer. The fix is the same
-- shape as the big table's: wake early, work fast, never schedule a VACUUM.
--
-- The other per-pass ledgers get the same treatment for the same reason. They
-- are all small, all written on every pass, and all invisible until one of them
-- is suddenly fifteen seconds.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_board_verifications',   -- every board, every pass (the 15s above)
    'job_board_aged_out',        -- tombstones written by the freshness sweep
    'job_board_exits',           -- the closure ledger the lifecycle moat depends on
    'job_board_closures'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r') THEN
      EXECUTE format(
        'ALTER TABLE public.%I SET ('
        || 'autovacuum_vacuum_scale_factor = 0.02, '
        || 'autovacuum_vacuum_threshold = 200, '     -- small tables need a small floor, not 20%%
        || 'autovacuum_analyze_scale_factor = 0.02, '
        || 'autovacuum_analyze_threshold = 200, '
        || 'autovacuum_vacuum_cost_limit = 2000)', t);
      RAISE NOTICE 'autovacuum tuned: %', t;
    END IF;
  END LOOP;
END $$;

-- fillfactor on the one table that is pure UPDATE churn: verified_at is not
-- indexed, so leaving free space on the page lets Postgres do HOT updates —
-- the new row version lands on the same page and no index has to be touched.
-- That is the difference between a stamp costing one page write and costing an
-- index write per board, ~24k times a pass.
ALTER TABLE public.job_board_verifications SET (fillfactor = 70);

-- Self-verifying, same rule as the last one: a migration that silently no-ops
-- is worse than one that fails.
DO $$
DECLARE opts text[];
BEGIN
  SELECT reloptions INTO opts FROM pg_class WHERE oid = 'public.job_board_verifications'::regclass;
  IF opts IS NULL OR NOT (array_to_string(opts, ',') LIKE '%autovacuum_vacuum_scale_factor=0.02%') THEN
    RAISE EXCEPTION 'autovacuum tuning did not apply to job_board_verifications (reloptions: %)', opts;
  END IF;
END $$;
