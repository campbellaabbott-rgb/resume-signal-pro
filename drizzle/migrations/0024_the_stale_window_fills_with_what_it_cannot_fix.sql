DROP FUNCTION IF EXISTS public.get_stalest_boards(integer, integer);

CREATE OR REPLACE FUNCTION public.get_stalest_boards(
  p_limit integer DEFAULT 20,
  p_min_age_hours integer DEFAULT 72,
  p_exclude text[] DEFAULT '{}'
)
RETURNS TABLE (
  stale_token text,
  stale_vendor text,
  stamped_at timestamptz,
  age_min numeric,
  posting_rows bigint,
  live_rows bigint,
  newest_effective timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '5s'
AS $$
DECLARE
  c_scan_cap    constant integer := 2000;
  c_exclude_cap constant integer := 2000;
  v_limit    integer  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_min_age  interval := make_interval(hours => GREATEST(COALESCE(p_min_age_hours, 72), 0));
  v_exclude  text[]   := (array_remove(COALESCE(p_exclude, '{}'::text[]), NULL))[1:c_exclude_cap];
BEGIN
  RETURN QUERY
  WITH oldest AS (
    SELECT ver.company_token AS tok, ver.verified_at AS stamp_at
    FROM public.job_board_verifications ver
    WHERE ver.verified_at < now() - v_min_age
      AND NOT (ver.company_token = ANY(v_exclude))
    ORDER BY ver.verified_at ASC
    LIMIT c_scan_cap
  ),
  held AS (
    SELECT o.tok, o.stamp_at
    FROM oldest o
    WHERE EXISTS (
      SELECT 1 FROM public.job_board_postings p
      WHERE p.company_token = o.tok
    )
    ORDER BY o.stamp_at ASC
    LIMIT v_limit
  )
  SELECT
    h.tok,
    agg.vendor,
    h.stamp_at,
    round((EXTRACT(EPOCH FROM (now() - h.stamp_at)) / 60.0)::numeric, 1),
    agg.rows_all,
    agg.rows_live,
    agg.newest
  FROM held h
  CROSS JOIN LATERAL (
    SELECT
      max(p.source)                                    AS vendor,
      count(*)                                         AS rows_all,
      count(*) FILTER (WHERE p.missing_since IS NULL)  AS rows_live,
      max(p.effective_posted)                          AS newest
    FROM public.job_board_postings p
    WHERE p.company_token = h.tok
  ) agg
  ORDER BY h.stamp_at ASC;
END
$$;

COMMENT ON FUNCTION public.get_stalest_boards(integer, integer, text[]) IS
  'The oldest verification stamps that still hold posting rows, oldest first, '
  'minus p_exclude: token, vendor, stamp time, age in minutes, total rows, '
  'live rows (missing_since IS NULL), newest effective_posted. Population = '
  'the ''freshness'' rollup''s (stamp EXISTS postings, no missing_since '
  'filter), ordered before any limit, so with p_exclude = ''{}'' the first '
  'row''s age_min equals get_freshness_stats().max_min plus the minutes since '
  'its computed_at. p_exclude (default ''{}'', NULL elements ignored, capped '
  'at 2000) is evaluated per index tuple INSIDE the capped scan, so excluded '
  'stamps consume no cap slot -- the stale lane sends oversize, unresolved and '
  'Object.prototype-named tokens so they never occupy its window. '
  'p_min_age_hours (default 72) floors the age; p_limit (default 20, max 200) '
  'caps the rows; the inner scan stops at c_scan_cap = 2000 surviving stamps. '
  'SECURITY DEFINER because job_board_postings is closed to anon '
  '(20260827130000); returns tokens and counts only. Classified by '
  'job-board/stale-lane.ts. Revised from (integer, integer) in 20260909222000; '
  'the old signature is dropped so named-argument calls resolve to one candidate.';

REVOKE ALL ON FUNCTION public.get_stalest_boards(integer, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stalest_boards(integer, integer, text[]) TO anon, authenticated, service_role;

DO $$
DECLARE
  v_count  integer;
  v_args   text;
  v_secdef boolean;
  v_config text[];
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc pr
  JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'get_stalest_boards';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'get_stalest_boards has % signatures in pg_proc; a named-argument call would be ambiguous (PGRST203)', v_count;
  END IF;
  SELECT pg_get_function_identity_arguments(pr.oid), pr.prosecdef, pr.proconfig
  INTO v_args, v_secdef, v_config
  FROM pg_proc pr
  JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'get_stalest_boards';
  IF v_args IS DISTINCT FROM 'p_limit integer, p_min_age_hours integer, p_exclude text[]' THEN
    RAISE EXCEPTION 'get_stalest_boards identity is (%), not (p_limit integer, p_min_age_hours integer, p_exclude text[])', v_args;
  END IF;
  IF v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'get_stalest_boards is not SECURITY DEFINER; anon would read the postings side as empty';
  END IF;
  IF v_config IS NULL OR NOT (array_to_string(v_config, ',') LIKE '%search_path=public, pg_temp%') THEN
    RAISE EXCEPTION 'get_stalest_boards has no pinned search_path';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class ic
    JOIN pg_namespace ns ON ns.oid = ic.relnamespace
    WHERE ns.nspname = 'public' AND ic.relname = 'job_board_verifications_verified_at_idx' AND ic.relkind = 'i'
  ) THEN
    RAISE EXCEPTION 'job_board_verifications_verified_at_idx is missing; apply 20260909218000 first';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';