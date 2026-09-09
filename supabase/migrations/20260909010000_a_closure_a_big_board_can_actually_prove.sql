-- A CLOSURE A BIG BOARD CAN ACTUALLY PROVE.
--
-- MAX_POSTINGS_PER_VISIT is 250, and every paginated fetcher reports
-- `windowed` as "the vendor advertises more than this pass fetched". So every
-- board over the cap is permanently windowed, and the ingest's prune refuses
-- to stamp or log ANY of them -- correctly, because a posting displaced past a
-- page cap is absent while being live (7 of 8 sampled "closures" on a windowed
-- board were still open on the employer's own site, 2026-07-21).
--
-- The cost of that correct refusal was that the largest employers could not
-- produce a closure at all. Of 34 companies in the explore cache 23 are over
-- the cap and hold 98% of their roles; a separate audit put 270 boards at 500+
-- roles = 351,893 postings = 36.4% of inventory. For every one of them the only
-- exit was our own 30-day age-out, so a real takedown stayed on the site for up
-- to a month, and every lifecycle statistic was computed on a population that
-- structurally excluded them while saying nothing about it.
--
-- The fix does not remove the suppression. It gives absence a second, stronger
-- kind of evidence: the deep cursor already walks a big board from offset 0 to
-- a wrap across many visits, and the union of the windows in one such LAP is
-- the whole feed. This migration adds the two columns that make that provable
-- and auditable after the fact.
--
--   lap_epoch  -- on the posting: which lap last SERVED this row.
--   absence_basis -- on the closure: what kind of evidence ended this posting.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: create an index on
-- job_board_postings. Two plain CREATE INDEX statements on that table wedged
-- the whole database on 2026-07-19 (lock queued behind the 24/7 write loop
-- until the pool was exhausted). lap_epoch is only ever read as a payload
-- column of a query already filtered by company_token, so it needs none.

-- ── lap_epoch ────────────────────────────────────────────────────────────────
-- ADD COLUMN with no DEFAULT is a catalogue-only change and does not rewrite
-- the table, but it still needs ACCESS EXCLUSIVE for an instant, and this table
-- is written continuously. Take it under a short lock_timeout and retry rather
-- than queue: a statement that waits here blocks every reader behind it, which
-- is exactly how the 2026-07-19 outage started.
DO $$
DECLARE attempt int := 0;
BEGIN
  SET LOCAL lock_timeout = '3s';
  LOOP
    attempt := attempt + 1;
    BEGIN
      ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS lap_epoch integer;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt >= 10 THEN
        RAISE EXCEPTION 'could not take the lock to add job_board_postings.lap_epoch after % attempts; re-run when the ingest is quieter', attempt;
      END IF;
      RAISE NOTICE 'lock busy, retrying lap_epoch add (attempt %)', attempt;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.job_board_postings.lap_epoch IS
  'WHICH LAP LAST SERVED THIS ROW, on boards too big to read in one visit. It '
  'is OUR bookkeeping and carries no employer meaning whatsoever: not a date, '
  'not an age, not a count. A board over the ingest''s per-visit cap is read '
  'across many visits, offset 0 to a wrap; that whole pass is a LAP, numbered '
  'per board in job_board_meta k=''deep_cursor'' under __laps. Every posting a '
  'lap serves is stamped with the lap''s number, so at the wrap a stored row '
  'still not carrying it was absent from EVERY window of the complete feed -- '
  'which is the only evidence that distinguishes a posting the employer took '
  'down from one displaced past a page cap. NULL means the row has not been '
  'served since its board started lapping (or its board never laps, which is '
  'every board small enough to read in one visit). The lap map is keyed '
  'source:token, not token -- 139 catalog tokens are carried by two vendors -- '
  'and the number is seconds-derived and monotonic rather than a counter, so a '
  'lost lap record can never hand a new lap a number that stale rows already '
  'carry. NULL IS NOT ABSENCE: it is only read against the board''s current lap '
  'number, at a wrap, and only for a lap that opened at an offset that left '
  'work to resume, whose feed was OBSERVED to end (a short or empty page, never '
  'merely "our offset reached the advertised total"), whose advertised total '
  'did not collapse under it, and which stopped within a hundred offsets of '
  'that total. Nothing outside the ingest should read this column.';

-- The DO block above runs inside this migration's transaction and its SET LOCAL
-- therefore stays in force for every statement AFTER it. The next ALTER would
-- inherit the 3s timeout with no retry wrapper of its own, raise
-- lock_not_available with nothing to catch it, and roll back the WHOLE
-- migration -- landing the new function bundle with neither column, which is
-- precisely the state the code degrades to via lapColUnknown, i.e. defect A
-- silently unfixed until someone notices the migration failed.
RESET lock_timeout;

-- ── absence_basis ────────────────────────────────────────────────────────────
-- job_board_closures is written by the same 24/7 ingest loop, so it gets the
-- same short-lock-and-retry treatment rather than queueing behind it.
DO $$
DECLARE attempt int := 0;
BEGIN
  SET LOCAL lock_timeout = '3s';
  LOOP
    attempt := attempt + 1;
    BEGIN
      ALTER TABLE public.job_board_closures ADD COLUMN IF NOT EXISTS absence_basis text;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt >= 10 THEN
        RAISE EXCEPTION 'could not take the lock to add job_board_closures.absence_basis after % attempts; re-run when the ingest is quieter', attempt;
      END IF;
      RAISE NOTICE 'lock busy, retrying absence_basis add (attempt %)', attempt;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;

RESET lock_timeout;

COMMENT ON COLUMN public.job_board_closures.absence_basis IS
  'WHAT KIND OF EVIDENCE ENDED THIS POSTING, because two different kinds now '
  'produce rows in this table and pooling them without saying so is a false '
  'claim about coverage. ''full_read'': the board is small enough that one '
  'fetch returns all of it, so absence is a fact about a single pass -- the '
  'only basis that existed before 2026-09-08. ''lap'': the board advertises '
  'more postings than one visit may fetch, and the id was absent from every '
  'window of a COMPLETE pass over the feed, assembled across visits (see '
  'job_board_postings.lap_epoch), then confirmed a second lap later under the '
  'same two-pass grace. ''lap_backfill'': a lap closure from the board''s FIRST '
  'observable laps -- the backlog of takedowns that accumulated while the page '
  'cap made the board unobservable, up to thirty days of them, all landing at '
  'once with a closed_at of the day we could finally see them. ITS closed_at IS '
  'KNOWN TO BE LATE, by an unknown amount up to the freshness window, so it is '
  'not admissible in ANY duration, tenure or fill-speed statistic; it is a '
  'count of events, not a dated one. NULL means the row predates this column, '
  'i.e. it is a full_read closure logged before 2026-09-08 -- do not read NULL '
  'as unknown quality. THE POPULATIONS HAVE DIFFERENT LATENCY: a full_read '
  'closure is observed within minutes of the takedown, a lap closure within '
  'about two laps of the board, a lap_backfill closure within up to a month. '
  'Any duration or rate computed across them is a mixture. Cut by this column, '
  'or name it. AS OF THIS MIGRATION get_company_fill_curve, '
  'get_category_fill_curve and get_ghost_job_index_stats do NOT yet cut by it '
  'and therefore pool all three -- get_closure_population() returns the counts '
  'that size that mixture, and closing it in those functions is the named '
  'follow-up.';

-- ── the population any published closure number is entitled to claim ─────────
--
-- "Boards read in full" is not the same claim as "employers", and until every
-- board can produce a closure, a number drawn from this table describes a
-- subset that has to be nameable without dashboard SQL. This returns that
-- subset as counts, from the two places that already know it: the daily board
-- ledger (whether the last fetch of each board was truncated, and how much we
-- hold) and the ingest's own lap map.
-- The return shape gained boards_unobserved/first-lap/backfill columns after
-- the first draft, and CREATE OR REPLACE cannot change a function's return
-- type. Dropped first so a re-run lands the current shape instead of failing
-- the whole migration on "cannot change return type of existing function".
DROP FUNCTION IF EXISTS public.get_closure_population();

CREATE OR REPLACE FUNCTION public.get_closure_population()
RETURNS TABLE (
  as_of                   timestamptz,
  boards_full_read        integer,
  postings_full_read      bigint,
  boards_lap_proven       integer,
  postings_lap_proven     bigint,
  boards_lap_pending      integer,
  postings_lap_pending    bigint,
  boards_unprovable       integer,
  postings_unprovable     bigint,
  boards_unobserved       integer,
  postings_unobserved     bigint,
  boards_first_lap        integer,
  first_lap_earliest      text,
  closures_full_read      bigint,
  closures_lap            bigint,
  closures_lap_backfill   bigint,
  closures_pre_basis      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH laps AS (
    SELECT COALESCE((SELECT v -> '__laps' FROM public.job_board_meta WHERE k = 'deep_cursor'), '{}'::jsonb) AS m
  ),
  -- The lap map is keyed source:token (a token is carried by more than one
  -- vendor for 139 catalog entries), while job_board_board_state is keyed by
  -- the bare token. Strip the vendor prefix to join. Tokens themselves cannot
  -- contain ':' -- posting ids are source:token:id -- so the first colon is the
  -- separator, and a legacy bare-token key (dropped by the ingest on its next
  -- hop) still matches itself.
  lapinfo AS (
    SELECT
      CASE WHEN position(':' in e.k) > 0
           THEN substr(e.k, position(':' in e.k) + 1)
           ELSE e.k END              AS tok,
      max(e.v ->> 'w')               AS w,
      min(e.v ->> 'w0')              AS w0
    FROM laps, jsonb_each(laps.m) AS e(k, v)
    GROUP BY 1
  ),
  latest AS (
    -- One row per board: its most recent daily observation, WITHIN A STATED
    -- WINDOW. Without the bound a board that left the catalogue months ago
    -- keeps contributing its last-known stored_count forever, so the postings
    -- figure would describe rows we no longer hold.
    SELECT DISTINCT ON (company_token)
           company_token, state, stored_count
    FROM public.job_board_board_state
    WHERE observed_on >= current_date - 7
    ORDER BY company_token, observed_on DESC
  ),
  classed AS (
    SELECT
      l.company_token,
      COALESCE(l.stored_count, 0)::bigint AS held,
      CASE
        -- Windowed. It can only prove absence across a completed lap, and the
        -- lap map is the ingest's own record of which boards ever have.
        WHEN l.state = 'truncated' THEN
          CASE
            WHEN li.w IS NOT NULL   THEN 'lap_proven'
            WHEN li.tok IS NOT NULL THEN 'lap_pending'
            ELSE 'unprovable'
          END
        -- BUCKET ON THE VALUES THE WRITER ACTUALLY EMITS, never on
        -- `state <> 'truncated'`. The ingest also writes 'error' for a board
        -- whose fetch died, and `state` can be NULL -- and `NULL <> 'truncated'`
        -- is NULL, not true. Either would have fallen into full_read: the one
        -- bucket this function's own comment tells a reader they may publish as
        -- their population, inflated by exactly the boards that produced no
        -- observation at all, while COALESCE(stored_count, 0) swallowed their
        -- postings so the board count and the posting count disagreed about the
        -- same set.
        WHEN l.state IN ('ok', 'dark', 'empty') THEN 'full_read'
        ELSE 'unobserved'
      END AS bucket
    FROM latest l
    LEFT JOIN lapinfo li ON li.tok = l.company_token
  )
  SELECT
    now(),
    COUNT(*) FILTER (WHERE bucket = 'full_read')::integer,
    COALESCE(SUM(held) FILTER (WHERE bucket = 'full_read'), 0),
    COUNT(*) FILTER (WHERE bucket = 'lap_proven')::integer,
    COALESCE(SUM(held) FILTER (WHERE bucket = 'lap_proven'), 0),
    COUNT(*) FILTER (WHERE bucket = 'lap_pending')::integer,
    COALESCE(SUM(held) FILTER (WHERE bucket = 'lap_pending'), 0),
    COUNT(*) FILTER (WHERE bucket = 'unprovable')::integer,
    COALESCE(SUM(held) FILTER (WHERE bucket = 'unprovable'), 0),
    COUNT(*) FILTER (WHERE bucket = 'unobserved')::integer,
    COALESCE(SUM(held) FILTER (WHERE bucket = 'unobserved'), 0),
    (SELECT COUNT(*)::integer FROM lapinfo WHERE w0 IS NOT NULL),
    (SELECT min(w0) FROM lapinfo),
    (SELECT COUNT(*) FROM public.job_board_closures WHERE absence_basis = 'full_read'),
    (SELECT COUNT(*) FROM public.job_board_closures WHERE absence_basis = 'lap'),
    (SELECT COUNT(*) FROM public.job_board_closures WHERE absence_basis = 'lap_backfill'),
    (SELECT COUNT(*) FROM public.job_board_closures WHERE absence_basis IS NULL)
  FROM classed;
$$;

COMMENT ON FUNCTION public.get_closure_population() IS
  'THE POPULATION A CLOSURE NUMBER IS ENTITLED TO CLAIM. Every statistic drawn '
  'from job_board_closures -- fill counts, R(14), the fill curve, the hiring '
  'section -- describes the boards that can PRODUCE a closure, which is not '
  'the same set as "employers" and was silently a small minority of inventory '
  'until 2026-09-08. Five buckets, counted from the latest daily row per board '
  'INSIDE THE LAST SEVEN DAYS plus the ingest''s lap map: (1) boards_full_read '
  '-- state ok/dark/empty, small enough to read in one fetch, absence provable '
  'within a visit, the historical population; (2) boards_lap_proven -- over the '
  'per-visit cap, but a COMPLETE pass over the feed has been assembled across '
  'visits at least once, so closures are now possible here; (3) '
  'boards_lap_pending -- over the cap, being walked, no complete pass yet, so '
  'they report nothing and their silence is not evidence about the employer; '
  '(4) boards_unprovable -- over the cap and unable to complete a lap at all: '
  'vendors whose feed gives us no offset to resume from (ukg, adp, jazzhr, '
  'usajobs), rippling (whose advertised total is our own arithmetic, so a wrap '
  'on it proves nothing), and any tenant that stops serving before its own '
  'stated total. (5) boards_unobserved -- the last observation in the window was '
  'an error or is unreadable, so this function knows NOTHING about them and '
  'says so rather than counting them as read. The postings_* columns are how '
  'many rows we HOLD for each bucket (from job_board_board_state.stored_count, '
  'our count, never the employer''s). boards_first_lap / first_lap_earliest '
  'date the discontinuity: a board''s closures were structurally unobservable '
  'before its first proven lap and observable after, so any cohort whose window '
  'spans that date measures a population that changed mid-window. The '
  'closures_* columns split the log itself by absence_basis; closures_pre_basis '
  'are rows written before the column existed and are all full_read, and '
  'closures_lap_backfill are the first laps'' thirty-day backlog, whose '
  'closed_at is knowingly late and which no duration statistic may include. A '
  'published closure statistic must name at least buckets (1)+(2) as its '
  'population, and must not describe itself as covering employers while (3), '
  '(4) and (5) are non-empty. SECURITY DEFINER because both source tables are '
  'service_role-only; it returns AGGREGATE COUNTS ONLY -- no employer, no '
  'token, no posting -- which is the whole reason it is safe to expose, and the '
  'grants below are deliberate rather than inherited.';

-- NO "REVOKE ... FROM PUBLIC" HERE, DELIBERATELY. PUBLIC and anon are
-- different roles, so revoking one and not the other is the half-measure that
-- left get_top_search_misses reachable, and
-- src/test/revoking-from-public-does-not-revoke-from-anon.test.ts fails it on
-- sight -- correctly. This function is MEANT to be anon-callable: it returns
-- nothing but aggregate counts of which boards our closure statistics can and
-- cannot speak for, which is the disclosure that stops those statistics
-- implying a population they do not cover. There is nothing here to close, so
-- the plain GRANT is the whole story, as it is on every other anon-facing
-- function in this tree. If a per-employer or row-level column is ever added
-- to this shape, that is the moment this decision has to be revisited.
GRANT EXECUTE ON FUNCTION public.get_closure_population() TO anon, authenticated, service_role;
