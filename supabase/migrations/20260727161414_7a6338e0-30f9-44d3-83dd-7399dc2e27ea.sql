-- === 20260727120000_employer_benchmarks_v3_superseded_and_depth.sql ===
DROP FUNCTION IF EXISTS public.get_employer_benchmarks(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_employer_benchmarks(
  p_days integer DEFAULT 90,
  p_min_closures integer DEFAULT 25,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  company text,
  closures bigint,
  median_days_open numeric,
  window_days integer,
  observed_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH q AS (
    SELECT
      c.company,
      extract(epoch FROM (c.closed_at - COALESCE(c.posted_at, c.first_seen))) / 86400.0 AS days_open,
      c.closed_at
    FROM public.job_board_closures c
    WHERE c.closed_at >= now() - make_interval(days => LEAST(GREATEST(p_days, 7), 365))
      AND c.company <> ''
      AND COALESCE(c.posted_at, c.first_seen) IS NOT NULL
      AND NOT c.superseded
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) <= interval '365 days'
  ),
  depth AS (
    SELECT GREATEST(1, CEIL(EXTRACT(epoch FROM (now() - MIN(closed_at))) / 86400.0))::integer AS d
    FROM q
  )
  SELECT
    q.company,
    count(*)::bigint AS closures,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY q.days_open)::numeric, 1) AS median_days_open,
    (SELECT d FROM depth) AS window_days,
    (SELECT d FROM depth) AS observed_days
  FROM q
  GROUP BY q.company
  HAVING count(*) >= GREATEST(p_min_closures, 5)
  ORDER BY median_days_open ASC, closures DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.get_employer_benchmarks(integer, integer, integer) TO anon, authenticated, service_role;

-- === 20260727130000_application_lifecycle.sql ===
CREATE OR REPLACE FUNCTION public.get_application_lifecycle(p_job_ids text[])
RETURNS TABLE (
  job_id text,
  outcome text,
  closed_at timestamptz,
  days_standing numeric,
  relisted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_job_ids[1:500]) AS jid
  ),
  cl AS (
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.first_seen, c.company_token, c.title
    FROM public.job_board_closures c
    WHERE c.posting_id = ANY(p_job_ids[1:500])
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    SELECT p.id, p.posted_at, p.first_seen
    FROM public.job_board_postings p
    WHERE p.id = ANY(p_job_ids[1:500])
  )
  SELECT
    ids.jid AS job_id,
    CASE
      WHEN liv.id IS NOT NULL AND cl.posting_id IS NOT NULL THEN 'came_down_relisted'
      WHEN liv.id IS NOT NULL THEN 'still_standing'
      WHEN cl.posting_id IS NOT NULL THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_board_postings p2
          WHERE p2.company_token = cl.company_token
            AND lower(p2.title) = lower(cl.title)
            AND COALESCE(p2.posted_at, p2.first_seen) >= cl.closed_at
        ) THEN 'came_down_relisted' ELSE 'came_down' END
      ELSE 'not_observed'
    END AS outcome,
    cl.closed_at,
    CASE
      WHEN cl.posting_id IS NOT NULL AND COALESCE(cl.posted_at, cl.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (cl.closed_at - COALESCE(cl.posted_at, cl.first_seen))) / 86400.0)::numeric, 1)
      WHEN liv.id IS NOT NULL AND COALESCE(liv.posted_at, liv.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (now() - COALESCE(liv.posted_at, liv.first_seen))) / 86400.0)::numeric, 1)
      ELSE NULL
    END AS days_standing,
    (cl.posting_id IS NOT NULL AND liv.id IS NOT NULL) AS relisted
  FROM ids
  LEFT JOIN cl  ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_lifecycle(text[]) TO anon, authenticated, service_role;

-- === 20260727140000_closure_rollup_before_delete.sql ===
CREATE TABLE IF NOT EXISTS public.job_board_closure_rollup (
  company_token   text        NOT NULL,
  company         text        NOT NULL DEFAULT '',
  category        text        NOT NULL DEFAULT 'other',
  month           date        NOT NULL,
  fills           integer     NOT NULL DEFAULT 0,
  relists         integer     NOT NULL DEFAULT 0,
  p50_days_open   numeric,
  p75_days_open   numeric,
  first_closed_at timestamptz,
  last_closed_at  timestamptz,
  rolled_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_token, category, month)
);

GRANT SELECT ON public.job_board_closure_rollup TO anon, authenticated;
GRANT ALL ON public.job_board_closure_rollup TO service_role;

ALTER TABLE public.job_board_closure_rollup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "closure_rollup_public_read" ON public.job_board_closure_rollup;
CREATE POLICY "closure_rollup_public_read"
  ON public.job_board_closure_rollup FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS job_board_closure_rollup_month_idx
  ON public.job_board_closure_rollup (month DESC);

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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
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