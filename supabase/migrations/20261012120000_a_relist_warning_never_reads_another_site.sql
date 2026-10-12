-- A RELIST WARNING NEVER READS ANOTHER SITE (accuracy spec Track 1, A2).
--
-- The collector calls a takedown "superseded" (re-listed) when a posting with
-- the same normalised title is live on the board at the moment it closes
-- (job-board/index.ts, the title key is normalize.ts normalizeCloseTitle). The
-- title key carries no location. On a board that lists one title at many
-- locations, every real takedown therefore reads as a re-post:
--
--   Centria Autism: 2,967 roles "came back" against 43 taken down; its
--     Greenhouse feed held 1,262 posts over 565 requisitions, 97% sharing a
--     title with another post but only 7% sharing title AND location
--     (2026-10-11).
--   Benchmark PT 116 against 24; BAYADA, Carvana, ouihelp, EquipmentShare,
--     URPT and others: the lander's "came back" caution fired on 81 of 1,506
--     sampled boards, and the gate passed every one of them.
--
-- Two readers here.
--
-- 1. board_multi_site_title_share(p_tokens): for each board, the share of its
--    live rows whose normalised title is live at another location on the same
--    board (location = the region code plus the first comma-separated part of
--    the location string, lower-cased), and how many live rows it was
--    measured over. get_company_fill_curve (20261012121000) publishes both,
--    and the shared hiring-record gate (src/lib/hiring-record-gate.ts) calls
--    the re-post test unreliable where the share is at least 0.20 and the
--    roles that "came back" reach max(10, a quarter of those taken down). A
--    board with no live row answers NULL: unknown, and the gate refuses on it.
--    PRIVATE: it reads job_board_postings, which no client may read
--    (20260827130000). It is a SECURITY DEFINER only so the definer readers
--    that call it run it with the owner's rights; service_role alone may
--    execute it.
--
-- 2. get_repost_index() re-issued so the Explore employer check ("Re-lists
--    roles: N+ re-postings ...", now the neutral sentence in
--    explore.repostWarn) no longer names a board whose re-post test cannot be
--    trusted: only a board we read to its end (observability bucket
--    full_read; a lap-read board's test sees one visit's window, owner
--    decision GD5) whose live titles are not spread over many locations
--    (multi-site share under 0.20, or no live rows to say). The index's own
--    gate -- at least 25 re-post events and at least 5 per affected title --
--    already implies far more than ten roles back, so the share term alone
--    carries the gate's "came back" floor here. The shape, the grants
--    (service_role only: the hourly stats cache builds it) and the cache key
--    are unchanged, and the next refresh-stats-cache picks it up.
--
-- Safe to run twice; ends with a self-check that raises.

SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.board_multi_site_title_share(p_tokens text[])
RETURNS TABLE (company_token text, multi_site_title_share numeric, multi_site_n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS tok
  ),
  live AS (
    SELECT p.company_token AS tok,
           public.normalize_close_title(p.title) AS tkey,
           lower(COALESCE(p.region_code, '')) || '|' || lower(btrim(split_part(COALESCE(p.location, ''), ',', 1))) AS skey
    FROM public.job_board_postings p
    JOIN toks ON toks.tok = p.company_token
    WHERE p.missing_since IS NULL
  ),
  per_title AS (
    SELECT l.tok, l.tkey, count(*) AS n, count(DISTINCT l.skey) AS sites
    FROM live l
    GROUP BY l.tok, l.tkey
  )
  SELECT t.tok,
         round(COALESCE(sum(pt.n) FILTER (WHERE pt.sites > 1), 0)::numeric / NULLIF(sum(pt.n), 0), 4),
         COALESCE(sum(pt.n), 0)::int
  FROM toks t
  LEFT JOIN per_title pt ON pt.tok = t.tok
  GROUP BY t.tok;
$$;
COMMENT ON FUNCTION public.board_multi_site_title_share(text[]) IS
  'Per board: the share of live rows (missing_since IS NULL) whose '
  'normalize_close_title(title) is live at more than one location on the same '
  'board, location = lower(region_code) | lower(first comma part of location), '
  'and the number of live rows it was measured over. NULL share on a board with '
  'no live row (unknown). The collector''s re-post test reads the title alone, '
  'so on a board whose titles are spread over many locations a real takedown '
  'reads as a re-post; with the role counts, this share is how the hiring-record '
  'gate decides the test reads other sites (20261012120000). Service role only.';
REVOKE ALL ON FUNCTION public.board_multi_site_title_share(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.board_multi_site_title_share(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.board_multi_site_title_share(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.board_multi_site_title_share(text[]) TO service_role;

-- The index, dropped by catalogue enumeration (the live database has held
-- overloads no migration describes) and re-created with the same shape.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'get_repost_index'
       AND pg_get_function_identity_arguments(p.oid) <> ''
  LOOP
    RAISE NOTICE 'dropping % (an overload the re-issue does not define)', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_repost_index()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '90s'
AS $$
  WITH sup AS (
    SELECT company_token, title, count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
      AND closed_at >= now() - interval '180 days'
      AND absence_basis IS DISTINCT FROM 'lap_backfill'
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token,
           sum(n)::int AS events,
           count(*)::int AS roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 25
       AND sum(n)::numeric / GREATEST(count(*), 1) >= 5
  ),
  live AS (
    SELECT company_token
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  -- A board read to its end: the one read whose re-post test sees the whole
  -- board when a role closes (owner decision GD5).
  read_whole AS (
    SELECT o.company_token
    FROM public.job_board_board_observability o
    WHERE o.bucket = 'full_read'
  ),
  -- Measured only over the boards that cleared the gate, so the extra read
  -- is a few hundred boards, not the catalogue.
  sites AS (
    SELECT s.company_token, s.multi_site_title_share
    FROM public.board_multi_site_title_share(ARRAY(SELECT a.company_token FROM agg a)) s
  )
  SELECT COALESCE(
    jsonb_object_agg(a.company_token, jsonb_build_array(a.events, a.roles, a.days)),
    '{}'::jsonb)
  FROM agg a
  JOIN live l ON l.company_token = a.company_token
  JOIN read_whole w ON w.company_token = a.company_token
  LEFT JOIN sites st ON st.company_token = a.company_token
  WHERE COALESCE(st.multi_site_title_share, 0) < 0.20;
$$;
COMMENT ON FUNCTION public.get_repost_index() IS
  'token -> [repost_events, reposted_roles, days] for employers whose re-list '
  'RATE clears 5 per affected role on at least 25 events, still serving roles, '
  'within 180 days. Gated on a rate because repost_events is size-correlated: '
  'the two largest employers by raw events re-list BELOW the median rate, so a '
  'top-N gate would warn about ordinary large employers and miss the worst. A '
  'miss means "did not clear this gate", never "does not re-post" — nothing may '
  'render a clean bill from it.'
  ' ADMITTED ABSENCE BASES: full_read, lap, and NULL -- NULL is a row '
  'written before the column existed on 2026-09-08 and is a full_read '
  'closure, not an unknown one. lap_backfill is EXCLUDED and must stay '
  'excluded: it is a takedown from a big board''s FIRST observable laps, '
  'so its closed_at is the day we could finally see it and is late by an '
  'unknown amount up to the freshness window. '
  'Both terms of the published RATE are computed from closed_at -- the '
  'event count and the `days` span it is divided by. '
  'ONLY A BOARD WHOSE RE-POST TEST CAN BE TRUSTED (20261012120000): its '
  'observability bucket is full_read (a lap-read board''s test sees one '
  'visit''s window and files re-posts as takedowns, owner decision GD5) and '
  'its live titles are not spread over many locations '
  '(board_multi_site_title_share under 0.20; the test reads the title alone, so '
  'there a takedown reads as a re-post: Centria Autism 2,967 back against 43 '
  'down on 2026-10-11). A board left out is not "does not re-post" either.';
REVOKE ALL ON FUNCTION public.get_repost_index() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_repost_index() FROM anon;
REVOKE ALL ON FUNCTION public.get_repost_index() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_repost_index() TO service_role;

DO $$
DECLARE body text;
BEGIN
  IF to_regprocedure('public.board_multi_site_title_share(text[])') IS NULL THEN
    RAISE EXCEPTION 'self-check 20261012120000: board_multi_site_title_share was not created';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.board_multi_site_title_share(text[])'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.board_multi_site_title_share(text[])'::regprocedure
                     AND p.proconfig::text LIKE '%search_path=public%') THEN
    RAISE EXCEPTION 'self-check 20261012120000: board_multi_site_title_share must be a definer with its search_path set';
  END IF;
  IF has_function_privilege('anon', 'public.board_multi_site_title_share(text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.board_multi_site_title_share(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012120000: a client role can execute board_multi_site_title_share, which reads job_board_postings';
  END IF;
  IF has_function_privilege('anon', 'public.get_repost_index()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_repost_index()', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check 20261012120000: a client role can execute get_repost_index';
  END IF;
  SELECT pg_get_functiondef('public.get_repost_index()'::regprocedure) INTO body;
  IF body NOT LIKE '%board_multi_site_title_share%' OR body NOT LIKE '%''full_read''%' THEN
    RAISE EXCEPTION 'self-check 20261012120000: get_repost_index was re-issued without the full-read and multi-site terms';
  END IF;
  -- Behaviour on a token that does not exist: one row, share unknown.
  IF (SELECT count(*) FROM public.board_multi_site_title_share(ARRAY['20261012120000-self-check'])) <> 1
     OR (SELECT multi_site_title_share FROM public.board_multi_site_title_share(ARRAY['20261012120000-self-check'])) IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261012120000: an unknown board must answer one row with an unknown share';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
