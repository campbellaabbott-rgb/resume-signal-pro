CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (
  company text, company_token text, closed_90d bigint, open_roles bigint,
  tracking_days int, p50_days_open numeric, dated_n int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  WITH open_now AS (
    SELECT company_token, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) AS filled,
           LEAST(GREATEST(EXTRACT(DAY FROM now() - min(c.closed_at))::int, 1), 30) AS tracking_days,
           round((percentile_cont(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (c.closed_at - c.posted_at)) / 86400.0
           ) FILTER (
             WHERE NOT c.superseded
               AND c.posted_at IS NOT NULL
               AND c.closed_at - c.posted_at >= interval '7 days'
           ))::numeric, 0) AS p50_days_open,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.posted_at IS NOT NULL
               AND c.closed_at - c.posted_at >= interval '7 days'
           )::int AS dated_n
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND c.company <> ''
      AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
    GROUP BY c.company_token
    HAVING count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) >= 3
       AND count(*) FILTER (WHERE c.superseded)
           <= count(*) FILTER (
                WHERE NOT c.superseded
                  AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
              )
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n::bigint AS open_roles,
         f.tracking_days, f.p50_days_open, f.dated_n
  FROM fills f
  JOIN open_now o ON o.company_token = f.company_token
  WHERE o.n >= 100
  ORDER BY (f.filled * 100.0 / o.n) DESC, f.filled DESC
  LIMIT GREATEST(p_limit, 1);
$$;

COMMENT ON FUNCTION public.get_actively_hiring_companies(int) IS
  'Employers ranked by FILLS PER 100 SERVED OPEN ROLES, not by absolute fills — '
  'the latter ranked by size under a chip promising a fill record, and its '
  'pre-truncation to the top 60 meant no small employer could place at all. '
  'p50_days_open is the median days a filled role stayed up, from posted_at '
  'ALONE (COALESCE with first_seen publishes our discovery time as the '
  'employer''s posting date). tracking_days is per company; it was the age of '
  'the entire closure log.';

NOTIFY pgrst, 'reload schema';