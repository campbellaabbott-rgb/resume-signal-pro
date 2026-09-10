-- EVERY STALE BOARD IS NAMED AND CLASSIFIED.
--
-- get_freshness_stats() publishes four numbers and names no board. Live on
-- 2026-09-10 02:45 UTC (computed_at of the 'freshness' rollup row; population
-- = every verification stamp whose token still holds at least one posting
-- row, live or not):
--
--   boards 33,574   p50 168.8 min   p95 346.5 min   max_min 20,961.0 (14.6 d)
--
-- The oldest twelve stamps, read from job_board_verifications with the anon
-- key at the same time (the table is anon-readable; that is by design and is
-- not changed here):
--
--   constructor      2026-08-26 13:24    applied          2026-08-26 23:44
--   duravermeer      2026-08-29 15:55    cgsfederal       2026-08-29 16:06
--   cscgeneration-2  2026-08-30 23:54    aaff             2026-08-31 00:24
--   gopuff           2026-08-31 00:24    paytmpayments    2026-08-31 00:24
--   aloyoga          2026-08-31 00:34    gorh             2026-08-31 00:34
--   trilongroup      2026-08-31 07:55    feverup          2026-08-31 08:04
--
-- 'constructor' at 13:24 on 08-26 is 14 d 13 h 21 m before 02:45 on 09-10 =
-- 20,961 minutes: the published max_min, to the minute.
--
-- A PREMISE REFUTED ON THE WAY. The working theory was that 'constructor' and
-- 'applied' are uncatalogued tokens, because a string-literal grep of
-- sources.ts finds neither. Evaluating JOB_SOURCES finds both: ashby
-- "Constructor" and ashby "Applied", packed `u(...)` entries that no grep for
-- a quoted token can see. Eight of the twelve oldest stamps are HOT tokens.
-- The tail is not orphans; it is catalogued boards the rotation reaches and
-- cannot stamp. Classified against the state /status exposes anonymously on
-- 2026-09-10 03:06 UTC (job-board 2026-09-09.67):
--
--   prototype_name  constructor -- 'constructor' in Object.prototype. Every
--                   cold slice runs classifyDormancy(eligible, dormant) and
--                   dormancy.ts reads `dormant[t]`: for this token that is
--                   Object, not undefined, `now - Object` is NaN, and the
--                   board lands in `skip` as "dormant, not due" -- on EVERY
--                   slice, since 2026-07-14 (371a1217). Its only stamps come
--                   from demand fetches, which bypass the skip-list. The
--                   executable proof is in src/test/a-token-named-
--                   constructor-reads-a-function-from-the-map.test.ts.
--   oversize (7)    cgsfederal 36.5 MB, cscgeneration-2 15.9, paytmpayments
--                   11.7, gopuff 8.1, trilongroup 6.5, gorh 4.4, aaff 4.0 --
--                   in the OVERSIZE registry (145 boards). The list response
--                   aborts over the byte budget before parse, so a successful
--                   visit is impossible and no stamp can land. Five are HOT:
--                   fetched every hot phase, failing identically every time.
--   undetermined    applied, duravermeer, aloyoga, feverup -- the registry
--   from anon (4)   shows its top 50 of 145 and the dormant list is a count
--                   (279), so these four need the meta rows the lane will
--                   hold; nothing anon-visible names their cause.
--
-- WHY THE ROWS PERSIST AND THE ROLLUP COUNTS THEM, each link correct alone:
--   1. 20260827182000 changed the 03:41 sweep from DELETING an unverified
--      board's postings to STAMPING missing_since on them. Right: history.
--      It also means an oversize board's postings go DARK 48 h after its
--      last complete read, while the employer's board is alive and large.
--   2. 20260719140000's 03:51 orphan cleanup deletes a stamp only when its
--      token has NO posting rows. After (1) the rows never go, so the stamp
--      never goes. Also right, for the world it was written in.
--   3. The rollup's population predicate (20260904090000, unchanged since
--      20260719140000) is `EXISTS postings` with no missing_since filter. It
--      was written to mean "boards actually serving"; (1) silently changed
--      what it means, and the freshness figure now includes boards the site
--      stopped serving days ago.
--   (The orphan prune being blocked -- catalogSize 44,542 < highwater 44,544
--   -- is real and unrelated: it only ever touches uncatalogued tokens, and
--   none of these is one.)
--
-- None of that is fixed here (the rollup is another migration's body; the
-- dormancy map and the byte budget are index.ts's). What this file does is
-- make the tail NAMEABLE: a bounded, anon-callable read of the oldest stamps
-- that still hold rows, with enough per-board fact (vendor, total rows, live
-- rows, newest effective date) for job-board/stale-lane.ts to classify each
-- one without guessing.
--
-- THE SELF-CHECK, BY CONSTRUCTION. The population here is the rollup's
-- population, predicate for predicate (stamp EXISTS postings, no missing_since
-- filter), ordered by verified_at ascending BEFORE any limit. So the first row
-- returned is the rollup's max: at the instant the rollup computed,
--   first.age_min == freshness.max_min
-- and at any later instant first.age_min == max_min + minutes since
-- computed_at (± 0.1 from rounding). If that ever fails, one of two things
-- changed and both are worth knowing: the rollup's predicate moved (the fix
-- described above landed — then update this comment), or more than
-- c_scan_cap stamps with ZERO rows sit older than the oldest stamp with rows,
-- which the 03:51 cleanup makes impossible for longer than a day. The default
-- p_min_age_hours of 72 does not disturb the check: a fleet whose oldest
-- stamp is under 72 h returns no rows, and "nothing older than three days"
-- is the right answer for a stale lane to receive.
--
-- WHY SECURITY DEFINER. job_board_verifications is anon-readable (policy
-- USING (true) + GRANT SELECT since 20260715040741), job_board_postings is
-- NOT (20260827130000 revoked SELECT from anon and dropped the policy; a live
-- anon read on 2026-09-10 returns 42501). An INVOKER body would read the
-- postings side as zero rows and HTTP 200 -- every board would look like an
-- orphan -- which is the silent shape the lockdown migration warns about.
-- DEFINER with search_path pinned, per the repo pattern. What it exposes: a
-- board token (already public: the token IS the company page's address and
-- the verifications table already lists every one), its vendor, and three
-- counts. No posting text, no url, no salary. Grants are explicit below.
--
-- WHY THE SCAN IS CAPPED. The oldest-first scan walks the new index and stops
-- at c_scan_cap stamps; only the p_limit survivors of the EXISTS test are
-- aggregated, one index probe on job_board_postings_company_idx each. That is
-- the whole cost: bounded by two named numbers, never by the table.
--
-- THE INDEX. job_board_verifications had a primary key on company_token and
-- nothing on verified_at; "oldest stamp first" was a 33.6k-row sort every
-- call. The table is small (33,574 rows live), so a plain CREATE INDEX is
-- milliseconds -- but it takes SHARE on a table the refresh upserts one row
-- into per successful board, continuously. lock_timeout makes the build fail
-- loudly rather than queue behind that write loop (the 2026-07-19 wedge
-- shape), and NOTHING ELSE runs in this transaction: no seed, no PERFORM,
-- no measurement holding the lock (the 20260909211000 lesson).

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS job_board_verifications_verified_at_idx
  ON public.job_board_verifications (verified_at ASC, company_token);

-- One function per migration file: the OUT-parameter guard slices the newest
-- migration naming a function from its first $$ to its last, so a second
-- function in this file would be read as part of this one's body.
--
-- RETURNS TABLE names are DISTINCT from every column of both tables the body
-- touches (verifications: company_token, verified_at, feed_total; postings:
-- company_token, source, missing_since, effective_posted, ...). In plpgsql
-- every OUT name is a variable in scope for the whole body; a shared name is
-- the 42702 that took get_board_flow and api_key_check down. Every column
-- reference below is alias-qualified anyway.
CREATE OR REPLACE FUNCTION public.get_stalest_boards(
  p_limit integer DEFAULT 20,
  p_min_age_hours integer DEFAULT 72
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
  -- The inner scan's ceiling: how many of the oldest stamps are examined for
  -- the EXISTS test. 2,000 is sixty times the default page and far above the
  -- number of zero-row stamps the 03:51 cleanup lets accumulate in a day.
  c_scan_cap constant integer := 2000;
  v_limit    integer  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
  v_min_age  interval := make_interval(hours => GREATEST(COALESCE(p_min_age_hours, 72), 0));
BEGIN
  RETURN QUERY
  WITH oldest AS (
    -- Oldest stamps first, from the index, before any other predicate: this
    -- ordering is what makes the first row the rollup's max by construction.
    SELECT ver.company_token AS tok, ver.verified_at AS stamp_at
    FROM public.job_board_verifications ver
    WHERE ver.verified_at < now() - v_min_age
    ORDER BY ver.verified_at ASC
    LIMIT c_scan_cap
  ),
  held AS (
    -- The rollup's own population predicate: a stamp whose token still holds
    -- ANY posting row, live or missing. Deliberately not `missing_since IS
    -- NULL` -- this function measures what the rollup measures, so its first
    -- row can be checked against the rollup's max. live_rows below is where
    -- the two are told apart.
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

COMMENT ON FUNCTION public.get_stalest_boards(integer, integer) IS
  'The oldest verification stamps that still hold posting rows, oldest first: '
  'token, vendor, stamp time, age in minutes, total rows, live rows '
  '(missing_since IS NULL), newest effective_posted. Population = the '
  '''freshness'' rollup''s (stamp EXISTS postings, no missing_since filter), '
  'ordered before any limit, so the first row''s age_min equals '
  'get_freshness_stats().max_min plus the minutes since its computed_at. '
  'p_min_age_hours (default 72) floors the age; p_limit (default 20, max 200) '
  'caps the rows; the inner scan stops at c_scan_cap = 2000 stamps. SECURITY '
  'DEFINER because job_board_postings is closed to anon (20260827130000) and '
  'an invoker read would count every board as an orphan; returns tokens and '
  'counts only. Classified by job-board/stale-lane.ts.';

-- Closed to every inherited grantee first, then opened by name. PUBLIC and
-- anon are different roles; revoking one and not the other is the half-measure
-- src/test/revoking-from-public-does-not-revoke-from-anon.test.ts exists for.
REVOKE ALL ON FUNCTION public.get_stalest_boards(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stalest_boards(integer, integer) TO anon, authenticated, service_role;

-- Self-verifying, from the catalog, without touching either table: the
-- function is definer with its search_path pinned, and the index exists.
DO $$
DECLARE
  v_secdef boolean;
  v_config text[];
BEGIN
  SELECT pr.prosecdef, pr.proconfig INTO v_secdef, v_config
  FROM pg_proc pr
  JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'get_stalest_boards';
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
    RAISE EXCEPTION 'job_board_verifications_verified_at_idx was not created';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
