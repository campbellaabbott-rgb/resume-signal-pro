DROP FUNCTION IF EXISTS public.get_board_flow(integer);

CREATE OR REPLACE FUNCTION public.get_board_flow(p_hours integer DEFAULT 24)
RETURNS TABLE (
  window_hours integer,
  intake bigint,
  closed bigint,
  superseded bigint,
  net bigint,
  serving bigint,
  computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH w AS (SELECT GREATEST(1, LEAST(COALESCE(p_hours, 24), 720)) AS h),
  b AS (SELECT now() - make_interval(hours => (SELECT h FROM w)) AS since),
  i AS (SELECT count(*) AS n FROM public.job_board_postings
          WHERE first_seen >= (SELECT since FROM b)),
  c AS (SELECT count(*) AS n,
               count(*) FILTER (WHERE superseded) AS sup
          FROM public.job_board_closures
          WHERE closed_at >= (SELECT since FROM b)),
  s AS (SELECT count(*) AS n FROM public.job_board_postings
          WHERE missing_since IS NULL
            AND effective_posted >= now() - interval '30 days')
  SELECT (SELECT h FROM w)::integer,
         (SELECT n FROM i)::bigint,
         (SELECT n FROM c)::bigint,
         (SELECT sup FROM c)::bigint,
         ((SELECT n FROM i) - (SELECT n FROM c))::bigint,
         (SELECT n FROM s)::bigint,
         now();
$$;

COMMENT ON FUNCTION public.get_board_flow(integer) IS
  'Intake vs outtake over the last N hours (default 24, max 720). `closed` comes '
  'from the closure log, not from the absence of a row — rows past the serving '
  'window are pruned, so absence cannot be counted. `superseded` is the subset '
  'that came down while an identical title stayed live at the same employer: a '
  're-list, not a role going away. Aggregates only; the log itself stays private.';

GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS job_board_closures_closed_at_idx
  ON public.job_board_closures (closed_at DESC);