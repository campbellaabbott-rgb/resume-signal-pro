INSERT INTO public.showcase_excluded (company_token, reason) VALUES
  ('dominos',
   'NOT a mill — a verified direct employer whose postings are real per-store vacancies. Excluded from editorial stats on CONCENTRATION alone: 24,566 postings, ~4% of the board, ~97% of them the same four store roles, which would make one brand look like a market trend. Fully served in search, filters and every corpus count.')
ON CONFLICT (company_token) DO UPDATE SET reason = EXCLUDED.reason;

CREATE OR REPLACE FUNCTION public.get_trending_categories()
RETURNS TABLE (category text, last7 int, prior7 int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  SELECT category,
    (count(*) FILTER (WHERE posted_at > now() - interval '7 days'))::int AS last7,
    CASE WHEN (SELECT min(closed_at) FROM public.job_board_closures) <= now() - interval '14 days'
         THEN (count(*) FILTER (WHERE posted_at <= now() - interval '7 days'))::int
         ELSE NULL END AS prior7
  FROM public.job_board_postings
  WHERE posted_at IS NOT NULL AND posted_at > now() - interval '14 days'
    AND first_seen - posted_at < interval '3 days'
    AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY category
  HAVING count(*) FILTER (WHERE posted_at > now() - interval '7 days') >= 20
  ORDER BY 2 DESC LIMIT 15;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_categories() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_hiring_trends()
RETURNS TABLE (week_start date, new_postings int, entry_new int, remote_new int, closed int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public SET statement_timeout = '20s' AS $$
  WITH excluded AS (SELECT company_token FROM public.showcase_excluded),
  epoch AS (
    SELECT date_trunc('week', min(closed_at))::date AS w0 FROM public.job_board_closures
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', now() - interval '28 days'), now(), interval '1 week') d
    WHERE date_trunc('week', d)::date >= COALESCE((SELECT w0 FROM epoch), date_trunc('week', now())::date)
  ),
  posted_live AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n,
      (count(*) FILTER (WHERE experience_band = 'entry'))::int AS entry_new,
      (count(*) FILTER (WHERE remote))::int AS remote_new
    FROM public.job_board_postings
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  posted_closed AS (
    SELECT date_trunc('week', posted_at)::date AS w, count(*)::int AS n
    FROM public.job_board_closures
    WHERE posted_at IS NOT NULL AND posted_at > now() - interval '35 days'
      AND NOT superseded
      AND first_seen IS NOT NULL AND first_seen - posted_at < interval '3 days'
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  ),
  closes AS (
    SELECT date_trunc('week', closed_at)::date AS w, count(*)::int AS closed
    FROM public.job_board_closures
    WHERE closed_at > now() - interval '35 days' AND NOT superseded
      AND company_token NOT IN (SELECT company_token FROM excluded)
    GROUP BY 1
  )
  SELECT weeks.week_start,
         COALESCE(posted_live.n, 0) + COALESCE(posted_closed.n, 0),
         COALESCE(posted_live.entry_new, 0),
         COALESCE(posted_live.remote_new, 0),
         COALESCE(closes.closed, 0)
  FROM weeks
  LEFT JOIN posted_live   ON posted_live.w   = weeks.week_start
  LEFT JOIN posted_closed ON posted_closed.w = weeks.week_start
  LEFT JOIN closes        ON closes.w        = weeks.week_start
  ORDER BY weeks.week_start;
$$;
GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_board_velocity(days integer DEFAULT 7, top_n integer DEFAULT 40)
RETURNS TABLE (company_token text, recent bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_token, count(*)::bigint AS recent
  FROM public.job_board_postings p
  WHERE p.first_seen > now() - make_interval(days => GREATEST(LEAST(days, 30), 1))
    AND p.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
  GROUP BY p.company_token
  HAVING count(*) >= 3
  ORDER BY recent DESC
  LIMIT GREATEST(LEAST(top_n, 200), 1);
$$;
REVOKE ALL ON FUNCTION public.get_board_velocity(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_board_velocity(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_posting_corrections(p_patches jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  n integer;
BEGIN
  IF p_patches IS NULL OR jsonb_typeof(p_patches) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH patch AS (
    SELECT e.value AS p
    FROM jsonb_array_elements(p_patches) AS e(value)
    WHERE jsonb_typeof(e.value) = 'object'
      AND e.value ? 'id'
      AND COALESCE(e.value->>'id', '') <> ''
  ),
  upd AS (
    UPDATE public.job_board_postings t SET
      title     = CASE WHEN patch.p ? 'title'     THEN patch.p->>'title'     ELSE t.title     END,
      location  = CASE WHEN patch.p ? 'location'  THEN patch.p->>'location'  ELSE t.location  END,
      apply_url = CASE WHEN patch.p ? 'apply_url' THEN patch.p->>'apply_url' ELSE t.apply_url END,
      country   = CASE WHEN patch.p ? 'country'   THEN patch.p->>'country'   ELSE t.country   END,
      work_mode = CASE WHEN patch.p ? 'work_mode' THEN patch.p->>'work_mode' ELSE t.work_mode END,
      salary    = CASE WHEN patch.p ? 'salary'    THEN patch.p->>'salary'    ELSE t.salary    END,
      remote    = CASE WHEN patch.p ? 'remote'    THEN (patch.p->>'remote')::boolean ELSE t.remote END
    FROM patch
    WHERE t.id = patch.p->>'id'
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM upd;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_posting_corrections(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_posting_corrections(jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_posting_corrections(jsonb) IS
  'Applies a batch of PARTIAL posting corrections in one statement. Each element is {id, ...changed columns}; a column absent from an element is left untouched. Scoped to the seven vendor-authoritative columns.';