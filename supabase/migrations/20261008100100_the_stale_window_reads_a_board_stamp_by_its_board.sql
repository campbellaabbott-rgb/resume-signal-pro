-- THE STALE WINDOW READS A BOARD STAMP BY ITS BOARD.
--
-- job-board 2026-09-09.91 stamps a board on a SHARED token (139 tokens carried
-- by two or three vendors, e.g. lush = greenhouse + personio) under its own key,
-- `source:token`, beside the bare token every other reader joins on (n428 in
-- docs/job-board-index-notes.md). Until then one board's read kept its twin's
-- rows "rechecked": greenhouse:lush served 19 postings already gone from its
-- feed on 2026-10-06 while personio:lush read.
--
-- get_stalest_boards matched a stamp to its postings by `company_token = tok`.
-- A per-board key names no posting's company_token, so a deferred twin's stale
-- stamp, the one row the stale lane should see, held no rows and was dropped.
-- This body resolves the key: `source:token` probes the token's rows of that
-- vendor only; a bare token probes every row on the token, exactly as before.
--
-- WHAT DOES NOT CHANGE. The identity (p_limit, p_min_age_hours, p_exclude), the
-- seven OUT names and types, the oldest-first scan with the exclusion inside
-- the capped walk (c_scan_cap 2000, c_exclude_cap 2000, NULL elements removed),
-- STABLE, SECURITY DEFINER with search_path pinned, the 5s statement_timeout and
-- the grants (service_role only since the census). p_exclude still matches a stamp's company_token exactly; the
-- .91 lane sends board keys there (a bare token for every board not on a
-- shared token, so nothing else moves).
--
-- WHAT A READER SHOULD KNOW. A bare row on a shared token is still returned
-- when it is stale (every twin failed); the lane drops it and reads the
-- per-board rows, which are at least as old. The freshness rollup is untouched
-- and still reads bare stamps, so a deferred twin's per-board row can be older
-- than the rollup's max: with p_exclude = '{}' row one is no longer the
-- rollup's max by construction once a per-board row is the oldest stamp.
--
-- Same signature, so CREATE OR REPLACE replaces in place: no overload can be
-- created and no drop is needed. One function per file (the OUT-parameter guard
-- slices the newest migration naming a function). Every column reference is
-- alias-qualified (42702: the OUT names are in scope in the body).

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
  keyed AS (
    -- A board key: `source:token` on a shared token, else the bare token. No
    -- catalogued token contains a colon.
    SELECT o.tok, o.stamp_at,
      CASE WHEN strpos(o.tok, ':') > 0 THEN split_part(o.tok, ':', 2) ELSE o.tok END AS key_token,
      CASE WHEN strpos(o.tok, ':') > 0 THEN split_part(o.tok, ':', 1) END AS key_source
    FROM oldest o
  ),
  held AS (
    SELECT k.tok, k.stamp_at, k.key_token, k.key_source
    FROM keyed k
    WHERE EXISTS (
      SELECT 1 FROM public.job_board_postings p
      WHERE p.company_token = k.key_token
        AND (k.key_source IS NULL OR p.source = k.key_source)
    )
    ORDER BY k.stamp_at ASC
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
    WHERE p.company_token = h.key_token
      AND (h.key_source IS NULL OR p.source = h.key_source)
  ) agg
  ORDER BY h.stamp_at ASC;
END
$$;

COMMENT ON FUNCTION public.get_stalest_boards(integer, integer, text[]) IS
  'The oldest verification stamps that still hold posting rows, oldest first, '
  'minus p_exclude (exact company_token match): stamp key, vendor, stamp time, '
  'age in minutes, total rows, live rows (missing_since IS NULL), newest '
  'effective_posted. A stamp key is a bare token, or source:token for a board on '
  'a token two vendors share (job-board .91); the second probes that vendor''s '
  'rows only. p_exclude (default ''{}'', NULL elements ignored, capped at 2000) '
  'is evaluated per index tuple INSIDE the capped scan, so excluded stamps '
  'consume no cap slot. p_min_age_hours (default 72) floors the age; p_limit '
  '(default 20, max 200) caps the rows; the inner scan stops at c_scan_cap = '
  '2000 surviving stamps. SECURITY DEFINER because job_board_postings is closed '
  'to anon (20260827130000); returns keys and counts only. Classified by '
  'job-board/stale-lane.ts. Board keys resolved since 20261008100100.';

-- Closed to every client role, as the census (20261004110000) left it: its one
-- caller is job-board with the service key.
REVOKE ALL ON FUNCTION public.get_stalest_boards(integer, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stalest_boards(integer, integer, text[]) TO service_role;

-- Self-verifying, from the catalog: one signature, the same identity, definer
-- with its search_path pinned, and a body that resolves a board key.
DO $$
DECLARE
  v_count  integer;
  v_args   text;
  v_secdef boolean;
  v_config text[];
  v_src    text;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'get_stalest_boards';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'get_stalest_boards has % signatures in pg_proc; a named-argument call would be ambiguous (PGRST203)', v_count;
  END IF;
  SELECT pg_get_function_identity_arguments(pr.oid), pr.prosecdef, pr.proconfig, pr.prosrc
  INTO v_args, v_secdef, v_config, v_src
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
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
  IF v_src NOT LIKE '%p.source = k.key_source%' OR v_src NOT LIKE '%p.source = h.key_source%' THEN
    RAISE EXCEPTION 'get_stalest_boards does not resolve a board key to its own vendor''s rows';
  END IF;
  IF has_function_privilege('anon', 'public.get_stalest_boards(integer,integer,text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_stalest_boards(integer,integer,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_stalest_boards is callable by a client role; the census closed it';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
