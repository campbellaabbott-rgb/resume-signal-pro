-- /pay-transparency HOLDS A REQUEST WORKER FOR 15 SECONDS PER PAGE VIEW.
--
-- Measured 2026-08-12: get_pay_transparency 14.92s, get_transparency_coverage
-- 4.83s (and 57014 under load — it was the first symptom of today's incident).
-- Both are full-table aggregates over 617k rows, both are granted to anon, and
-- the page calls both ON MOUNT. Every visitor who opens the Pay Transparency
-- Index runs ~20 seconds of aggregate scans against the live database.
--
-- This is the exact defect get_transparent_employers had ("held a worker for
-- 26s per Explore page view until 20260810180000"), fixed the same way: the
-- aggregates run ONCE AN HOUR under cron, land in a meta row, and the page
-- reads the row — a PK lookup.
--
-- DELIBERATELY NOT CHANGED IN THIS MIGRATION: the numbers themselves. Both
-- functions count the WHOLE postings table — no missing_since IS NULL, no
-- 30-day window — so the page's "live postings we track" copy overstates the
-- served board by the aged/missing tail (~0.6% today). That is a real accuracy
-- item, but bundling a data-definition change into a caching change would make
-- both harder to verify; this migration moves the SAME numbers off the request
-- path, byte for byte. The serving-predicate fix is a follow-up with its own
-- verification.
CREATE OR REPLACE FUNCTION public.refresh_transparency_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
-- Callee timeouts override the caller's: the two inner functions carry 25s
-- each, so this bound covers their sum with headroom, not a single statement.
SET statement_timeout = '3min'
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'pay',       public.get_pay_transparency(),
    'coverage',  public.get_transparency_coverage(),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('transparency_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_transparency_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_transparency_cache() TO service_role;

-- The read the page actually makes: one PK lookup, same shape as
-- get_explore_cache. Returns NULL until the first refresh has run; the
-- frontend falls back to the direct RPCs in that window.
CREATE OR REPLACE FUNCTION public.get_transparency_cache()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT v FROM public.job_board_meta WHERE k = 'transparency_cache';
$$;

GRANT EXECUTE ON FUNCTION public.get_transparency_cache() TO anon, authenticated;

COMMENT ON FUNCTION public.get_transparency_cache() IS
  'Hourly-computed Pay Transparency Index payload: {pay, coverage, '
  'computed_at}. The page reads this PK lookup; the aggregates behind it '
  '(get_pay_transparency at 14.9s, get_transparency_coverage at 4.8s, '
  'measured) run only under cron. Never aggregate on the request path.';

-- The two heavy functions become cron-only. The frontend ships a cache-first
-- read with a fallback to these, so ordering is safe in BOTH deploy windows:
-- frontend-first means the fallback still finds them granted (this migration
-- has not run); migration-first means the cache already answers and the
-- fallback never fires.
REVOKE ALL ON FUNCTION public.get_pay_transparency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pay_transparency() TO service_role;
REVOKE ALL ON FUNCTION public.get_transparency_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_transparency_coverage() TO service_role;

-- Hourly at :37, offset from the explore refresh at :07 so the two aggregate
-- passes never share a window.
--
-- Unschedule-first makes the migration re-runnable, and it is row-driven
-- rather than a DO block for two reasons paid for in this repo: DO blocks in
-- migrations have caused connection-level aborts that rolled back the DDL
-- around them, and cron.unschedule(name) THROWS when the job does not exist —
-- which is exactly the state on first apply. A SELECT over cron.job unschedules
-- when present and returns zero rows when not, erroring in neither case.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'transparency-cache-hourly';
SELECT cron.schedule('transparency-cache-hourly', '37 * * * *', 'SELECT public.refresh_transparency_cache()');

-- Prime the row so the page never waits an hour for its first paint.
SELECT public.refresh_transparency_cache();

NOTIFY pgrst, 'reload schema';
