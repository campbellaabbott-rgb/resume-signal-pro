-- THE STALE WINDOW FILLS WITH WHAT IT CANNOT FIX.
--
-- LIVE, the first pass after job-board 2026-09-09.70 deployed (status.staleLane,
-- read anonymously 2026-09-10):
--
--   { rpc: "ok", asked: 60, windowFull: true,
--     classes: { oversize: 59, prototype_name: 1, unexplained: 0,
--                uncatalogued: 0, dormant: 0, failing: 0, unresolved: 0 },
--     selected: [], fetched: 0 }
--
-- get_stalest_boards (20260909218000) returns the oldest stamps that still
-- hold rows, and the OLDEST stamps belong to the boards that can never stamp:
-- 59 of the 60 rows are in the OVERSIZE registry (the list response aborts
-- over the byte budget before parse, so a visit cannot succeed) and the
-- sixtieth is 'constructor', the Object.prototype name. Every one of them is
-- classified correctly, nothing is fetched, and the classification is the
-- whole result: the window is 60 wide, the permanent residents number more
-- than 60, and the first board a fetch could actually help sits behind the
-- window on every pass, forever. Widening the window from 20 to 60 (.69)
-- bought nothing because the residents outnumber any window; 145 boards are
-- in the registry today and the registry's cap is 200.
--
-- THE FIX THE WIRING BUILD NAMED: p_exclude. The lane already KNOWS the two
-- sets that fill the window -- OVERSIZE_BOARDS is loaded before the lane runs,
-- and the tries map it reads from meta stale_lane names every 'unresolved'
-- token -- plus the twelve Object.prototype property names that must never be
-- fetched through a token-keyed map. It sends that union as p_exclude, and the
-- window holds only what it could not already explain.
--
-- WHERE THE EXCLUSION SITS, and why it is INSIDE the capped scan. The inner
-- scan walks job_board_verifications_verified_at_idx oldest-first and stops
-- after c_scan_cap surviving stamps. The exclusion is a predicate on that
-- walk, evaluated per index tuple BEFORE the LIMIT, so an excluded stamp
-- consumes no cap slot: the walk steps over it and reads the next tuple.
-- Applied AFTER the cap instead (a post-filter on the 2,000 oldest), the fix
-- would have reproduced the bug one level up -- 2,000 oldest stamps, the
-- residents removed, the rest returned -- correct today, and clogged again the
-- day the residents outnumber 2,000. The pglite harness
-- (scripts/verify-migration-20260909222000.mjs) proves the placement: 2,000
-- excluded stamps -- exactly c_scan_cap -- older than five live ones, and the
-- five come back, where a post-filter on the capped 2,000 would return none.
--
-- WHEN THE EXCLUSION LIST EXCEEDS THE CAP. c_scan_cap bounds SURVIVING stamps,
-- not examined ones, so the length of p_exclude does not interact with it: a
-- list longer than the cap is just more tuples the walk steps over. The cost
-- of stepping is bounded by the index itself -- 33,574 stamps live, single-
-- digit milliseconds -- and by c_exclude_cap on the array: elements past the
-- 2,000th are dropped (v_exclude is sliced, never rejected), so a runaway
-- caller degrades to "some residents re-enter the window" -- the pre-fix
-- state, visible as windowFull -- and never to an error or a full-table scan
-- over a 100,000-element = ANY. The lane sends at most STALE_EXCLUDE_MAX
-- (400: 12 prototype names + the 200-entry registry cap + up to 188
-- unresolved tokens; see stale-lane.ts), a fifth of that ceiling.
--
-- A NULL ELEMENT WOULD HAVE BLANKED THE WINDOW. `tok = ANY(ARRAY[NULL])` is
-- NULL, NOT NULL is NULL, and a NULL predicate drops the row -- every row. A
-- caller that let one null through would receive zero rows and an HTTP 200,
-- the silent shape this repo keeps meeting. array_remove(..., NULL) makes the
-- predicate two-valued before it is evaluated; the harness sends a null and
-- gets the full window back.
--
-- DROP + CREATE, NOT A THIRD PARAMETER UNDER CREATE OR REPLACE ALONE. Adding
-- p_exclude changes the identity signature: (integer, integer) becomes
-- (integer, integer, text[]), and CREATE OR REPLACE on the new signature
-- leaves the old one standing. A call that names only p_limit and
-- p_min_age_hours -- which is exactly what the .70 bundle sends until the
-- .71 bundle lands -- would then match BOTH and PostgREST answers PGRST203
-- (the 2026-08-20 search outage, src/test/changing-a-signature-must-drop-
-- the-old-one.test.ts). So the two-parameter signature is dropped first, in
-- this transaction, and the DO block below refuses to commit if pg_proc still
-- holds more than one get_stalest_boards. The .70 bundle keeps working across
-- the gap: named-argument resolution fills p_exclude from its DEFAULT. The
-- .71 bundle, if it lands BEFORE this migration, gets PGRST202 (no function
-- takes p_exclude) and retries once without it -- the lane is never worse
-- than .70's.
--
-- WHAT DOES NOT CHANGE. The seven OUT names, their order and types; the
-- population predicate (stamp EXISTS postings, no missing_since filter) and
-- the oldest-first ordering before any limit, so with p_exclude = '{}' the
-- first row is still the rollup's max by construction and 20260909218000's
-- self-check still holds; c_scan_cap = 2000; the clamps on p_limit and
-- p_min_age_hours; STABLE, SECURITY DEFINER with search_path pinned (the
-- postings side is closed to anon since 20260827130000), statement_timeout
-- 5s; the grants. The index from 20260909218000 is reused, not rebuilt.
--
-- ONE FUNCTION PER MIGRATION FILE: the OUT-parameter guard slices the newest
-- migration naming a function from its first $$ to its last. RETURNS TABLE
-- names are distinct from every column of both tables the body touches, and
-- every column reference is alias-qualified anyway (42702).

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
  -- The inner scan's ceiling on SURVIVING stamps (unchanged from
  -- 20260909218000). Excluded stamps do not count against it.
  c_scan_cap    constant integer := 2000;
  -- The exclusion array's ceiling. Elements past it are dropped, never
  -- rejected: the caller degrades to the pre-fix window, not to an error.
  c_exclude_cap constant integer := 2000;
  v_limit    integer  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_min_age  interval := make_interval(hours => GREATEST(COALESCE(p_min_age_hours, 72), 0));
  -- NULL array -> empty; NULL elements removed (one would drop every row);
  -- then capped.
  v_exclude  text[]   := (array_remove(COALESCE(p_exclude, '{}'::text[]), NULL))[1:c_exclude_cap];
BEGIN
  RETURN QUERY
  WITH oldest AS (
    -- Oldest stamps first, from the index, with the exclusion evaluated per
    -- tuple BEFORE the cap: an excluded stamp is stepped over, not counted.
    SELECT ver.company_token AS tok, ver.verified_at AS stamp_at
    FROM public.job_board_verifications ver
    WHERE ver.verified_at < now() - v_min_age
      AND NOT (ver.company_token = ANY(v_exclude))
    ORDER BY ver.verified_at ASC
    LIMIT c_scan_cap
  ),
  held AS (
    -- The rollup's own population predicate: a stamp whose token still holds
    -- ANY posting row, live or missing. Deliberately not `missing_since IS
    -- NULL` -- with an empty exclusion this function still measures what the
    -- rollup measures, so its first row can be checked against the rollup's
    -- max. live_rows below is where the two are told apart.
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
    -- One probe of job_board_postings_company_idx per surviving token.
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

-- Closed to every inherited grantee first, then opened by name. PUBLIC and
-- anon are different roles; revoking one and not the other is the half-measure
-- src/test/revoking-from-public-does-not-revoke-from-anon.test.ts exists for.
REVOKE ALL ON FUNCTION public.get_stalest_boards(integer, integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stalest_boards(integer, integer, text[]) TO anon, authenticated, service_role;

-- Self-verifying, from the catalog: exactly ONE get_stalest_boards survives
-- (the PGRST203 shape is refused at apply time, not discovered by a caller),
-- it carries p_exclude, it is definer with its search_path pinned, and the
-- index it walks exists.
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
