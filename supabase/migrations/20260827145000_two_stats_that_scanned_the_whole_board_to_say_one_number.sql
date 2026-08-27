-- Two stats functions seq-scan the entire corpus, and both have been failing.
--
-- get_entry_level_stats is the ONLY key in the stats cache's stale_parts today
-- (get_stats_cache, 2026-08-27) — it has been failing its 20s refresh long
-- enough that /entry-level-index publishes a FROZEN number. Called directly:
-- 500 57014 at 21.34s / 22.42s / 20.33s, three of three.
--
-- Its body is two full table scans with NO WHERE CLAUSE AT ALL: count(*) FILTER
-- over public.job_board_postings, plus a second scan in the by_category
-- subquery. On 708k rows that is not a query that can be tuned into budget by
-- accident; it never touches an index because there is no predicate to serve.
--
-- AND IT COUNTS POSTINGS THE BOARD REFUSES TO SERVE. Every read path carries
-- `missing_since IS NULL` and the 30-day window; this one carries neither, so
-- the "verified entry-level openings right now" tile has been publishing
-- ~65,952 against a fenced figure near 54,600-58,200 — roughly 11k postings,
-- ~17% inflation, on a page whose entire pitch is that its numbers are real.
--
-- get_stale_board_count has the same shape and a worse consumer. It is a
-- heartbeat check — the thing that notices when boards stop being verified —
-- and scan-heartbeat wraps it in RPC_MS = 10_000 while the function itself
-- allows 20s, so the wrapper gives up first. Measured: 2 of 3 calls exceeded
-- 20s outright, the third returned at 10.66s, which is still over the
-- heartbeat's own limit. In practice that check has been dead, and its failure
-- is swallowed by the surrounding catch — the exact "swallowed catch deletes
-- the check" failure the comment above it in scan-heartbeat already warns about
-- for two OTHER functions.
--
-- Its cost is self-inflicted: it LEFT JOINs 708k postings to the verification
-- table and takes DISTINCT afterwards, when the distinct set is ~23k tokens.
-- Deduplicate first, then join 23k rows.

SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '20min';
SET LOCAL maintenance_work_mem = '256MB';

-- Serves the entry-level scan inside the serving set. Partial on
-- `missing_since IS NULL` so it covers only the ~593k servable rows, and the
-- INCLUDE list carries every column the aggregate reads, so the scan never
-- touches the heap. DROP-first for the same self-healing reason as
-- 20260826010000: an interrupted CONCURRENTLY build elsewhere leaves an INVALID
-- index that CREATE INDEX IF NOT EXISTS would skip forever.
DROP INDEX IF EXISTS public.job_board_postings_entry_serving_idx;
CREATE INDEX job_board_postings_entry_serving_idx
  ON public.job_board_postings (experience_band, effective_posted)
  INCLUDE (company_token, category, remote)
  WHERE missing_since IS NULL;

-- Serves the DISTINCT in get_stale_board_count as an index-only scan: one
-- column, partial, ~593k entries and no heap access to find ~23k tokens.
DROP INDEX IF EXISTS public.job_board_postings_token_serving_idx;
CREATE INDEX job_board_postings_token_serving_idx
  ON public.job_board_postings (company_token)
  WHERE missing_since IS NULL;

ANALYZE public.job_board_postings;

-- total_open IS NOT RECOMPUTED HERE, and that is the point.
--
-- The board already publishes exactly this number: refresh_headline_open()
-- (20260826171900) counts `missing_since IS NULL AND effective_posted >= now()
-- - interval '30 days'` and writes it to job_board_meta.k='refresh' ->
-- coverage.open, which the list endpoint serves as `total`. Computing it a
-- second time here would be a fifth independent spelling of "openings on this
-- board", and two spellings of one statistic is precisely how two surfaces
-- start disagreeing about the same corpus. It reads the published one.
--
-- If coverage.open is absent the function returns NULL rather than a guess.
-- That is the house rule — no count is better than a stale one — and the page
-- renders a blank tile instead of a confident wrong number.
--
-- SECURITY DEFINER IS RESTATED, NOT INHERITED. 20260827130000 ALTERed this
-- function to DEFINER so it would survive the removal of anon's SELECT on
-- job_board_postings. CREATE OR REPLACE preserves only ownership and grants —
-- every other property reverts to what this command says, so omitting the
-- keyword here would silently revert it to INVOKER and it would return zero
-- rows to anon instead of an error. Same for search_path and statement_timeout.
--
-- The RETURNS TABLE type is unchanged, so CREATE OR REPLACE cannot create an
-- overload. Adding a column would make this DROP + CREATE, and that DROP must
-- come from the catalog rather than a hand-written signature.
CREATE OR REPLACE FUNCTION public.get_entry_level_stats()
RETURNS TABLE (total_entry bigint, total_open bigint, companies_with_entry bigint, remote_entry bigint, by_category jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH entry AS MATERIALIZED (
    SELECT p.company_token, p.category, p.remote
    FROM public.job_board_postings p
    WHERE p.experience_band = 'entry'
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
  )
  SELECT
    (SELECT count(*) FROM entry),
    (SELECT (v -> 'coverage' ->> 'open')::bigint
       FROM public.job_board_meta WHERE k = 'refresh'),
    (SELECT count(DISTINCT company_token) FROM entry),
    (SELECT count(*) FROM entry WHERE remote),
    (SELECT jsonb_object_agg(t.category, t.n)
       FROM (SELECT category, count(*)::int AS n
               FROM entry
              WHERE category IS NOT NULL
              GROUP BY category ORDER BY n DESC LIMIT 12) t);
$$;
GRANT EXECUTE ON FUNCTION public.get_entry_level_stats() TO anon, authenticated;

-- Deduplicate, THEN join. Same answer, ~23k rows through the join instead of
-- 708k, and the fence means a board whose every posting has been withdrawn no
-- longer counts as one waiting to be verified — which is what "stale board"
-- was supposed to mean. SECURITY DEFINER restated for the reason above.
CREATE OR REPLACE FUNCTION public.get_stale_board_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT count(*)::int
  FROM (
    SELECT DISTINCT p.company_token
    FROM public.job_board_postings p
    WHERE p.missing_since IS NULL
  ) b
  LEFT JOIN public.job_board_verifications v ON v.company_token = b.company_token
  WHERE v.verified_at IS NULL OR v.verified_at < now() - interval '24 hours';
$$;
GRANT EXECUTE ON FUNCTION public.get_stale_board_count() TO anon, authenticated;
