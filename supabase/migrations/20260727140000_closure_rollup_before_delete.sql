-- The lifecycle log is the one asset here that cannot be bought, scraped or
-- backfilled — and a cron has been quietly scheduled to start destroying it.
--
-- 20260714150000 scheduled 'job-board-closures-retention' at 03:17 daily:
--   DELETE FROM job_board_closures WHERE closed_at < now() - interval '180 days'
-- with no aggregate anywhere (grepped: no rollup table exists). The raw log is
-- the ONLY record that a given employer ever filled a role. Under that cron the
-- moat is permanently capped at a rolling six months: on day 181 the evidence
-- for day 1 is gone forever, and no later work can recover it, because a
-- takedown leaves no artifact anywhere else in the world.
--
-- The raw rows genuinely should not live forever — they carry per-posting
-- detail nobody needs at that age. The fix is not to keep everything; it is to
-- NEVER delete a row whose month has not been summarised first.
--
-- Percentiles are computed AT ROLLUP TIME, while the raw rows still exist, so
-- the stored p50/p75 are exact for that month rather than a reconstruction
-- from buckets. That keeps the honesty fence intact: what we publish later is
-- a real measured percentile, just fixed at month grain.

CREATE TABLE IF NOT EXISTS public.job_board_closure_rollup (
  company_token   text        NOT NULL,
  company         text        NOT NULL DEFAULT '',
  category        text        NOT NULL DEFAULT 'other',
  month           date        NOT NULL,          -- first day of the month
  fills           integer     NOT NULL DEFAULT 0, -- genuine: stood >= 7d, not superseded
  relists         integer     NOT NULL DEFAULT 0, -- superseded closures
  p50_days_open   numeric,
  p75_days_open   numeric,
  first_closed_at timestamptz,
  last_closed_at  timestamptz,
  rolled_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_token, category, month)
);

ALTER TABLE public.job_board_closure_rollup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "closure_rollup_public_read" ON public.job_board_closure_rollup;
CREATE POLICY "closure_rollup_public_read"
  ON public.job_board_closure_rollup FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS job_board_closure_rollup_month_idx
  ON public.job_board_closure_rollup (month DESC);

-- Summarise every CLOSED month older than p_keep_days, then delete only raw
-- rows whose month is provably present in the rollup. Returns what it did so
-- the heartbeat can watch it.
CREATE OR REPLACE FUNCTION public.roll_up_and_prune_closures(p_keep_days integer DEFAULT 180)
RETURNS TABLE (months_rolled integer, rows_pruned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(p_keep_days, 30));
  v_months integer := 0;
  v_pruned integer := 0;
BEGIN
  -- 1. Roll up. Percentiles are exact here because the raw rows still exist.
  WITH src AS (
    SELECT
      c.company_token,
      max(c.company) AS company,
      COALESCE(NULLIF(c.category, ''), 'other') AS category,
      date_trunc('month', c.closed_at)::date AS month,
      count(*) FILTER (
        WHERE NOT c.superseded
          AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
          AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
      )::int AS fills,
      count(*) FILTER (WHERE c.superseded)::int AS relists,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL) AS p50,
      percentile_cont(0.75) WITHIN GROUP (
        ORDER BY extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0
      ) FILTER (WHERE NOT c.superseded AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL) AS p75,
      min(c.closed_at) AS first_c,
      max(c.closed_at) AS last_c
    FROM public.job_board_closures c
    WHERE c.closed_at < v_cutoff
      AND c.company_token <> ''
    GROUP BY c.company_token, COALESCE(NULLIF(c.category, ''), 'other'), date_trunc('month', c.closed_at)::date
  )
  INSERT INTO public.job_board_closure_rollup AS r
    (company_token, company, category, month, fills, relists, p50_days_open, p75_days_open, first_closed_at, last_closed_at, rolled_at)
  SELECT company_token, company, category, month, fills, relists,
         round(p50::numeric, 1), round(p75::numeric, 1), first_c, last_c, now()
  FROM src
  ON CONFLICT (company_token, category, month) DO UPDATE SET
    fills = EXCLUDED.fills,
    relists = EXCLUDED.relists,
    p50_days_open = EXCLUDED.p50_days_open,
    p75_days_open = EXCLUDED.p75_days_open,
    first_closed_at = LEAST(r.first_closed_at, EXCLUDED.first_closed_at),
    last_closed_at = GREATEST(r.last_closed_at, EXCLUDED.last_closed_at),
    rolled_at = now();
  GET DIAGNOSTICS v_months = ROW_COUNT;

  -- 2. Prune ONLY what is provably summarised. If step 1 failed or skipped a
  -- month, its raw rows survive to be rolled up on the next run — the log is
  -- never destroyed ahead of its summary.
  DELETE FROM public.job_board_closures c
  WHERE c.closed_at < v_cutoff
    AND EXISTS (
      SELECT 1 FROM public.job_board_closure_rollup rr
      WHERE rr.company_token = c.company_token
        AND rr.category = COALESCE(NULLIF(c.category, ''), 'other')
        AND rr.month = date_trunc('month', c.closed_at)::date
    );
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  RETURN QUERY SELECT v_months, v_pruned;
END;
$$;

GRANT EXECUTE ON FUNCTION public.roll_up_and_prune_closures(integer) TO service_role;

-- Replace the destructive cron with the safe one. Same 03:17 slot.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- The old job deleted with no summary. It must not survive this migration.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-closures-retention') THEN
      PERFORM cron.unschedule('job-board-closures-retention');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-closures-rollup-retention') THEN
      PERFORM cron.schedule(
        'job-board-closures-rollup-retention',
        '17 3 * * *',
        $job$ SELECT public.roll_up_and_prune_closures(180); $job$
      );
    END IF;
  END IF;
END $$;
