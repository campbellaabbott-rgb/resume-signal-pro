-- THE BOARD CANNOT COUNT ITS OWN REMOTE JOBS.
--
-- Measured live 2026-08-12, three attempts each against a clean control:
--
--     count_jobs_capped, no work-mode filter   ->  1.38s, n=10000 capped
--     count_jobs_capped, p_work_mode=remote    ->  57014 statement timeout
--     count_jobs_capped, p_work_mode=hybrid    ->  57014 statement timeout
--     count_jobs_capped, p_work_mode=onsite    ->  57014 statement timeout
--
-- so /jobs?mode=remote serves rows with `countUnavailable: true` and renders
-- "Showing 20" with no denominator. The single filter a job-seeker reaches for
-- most is the one filter whose size the board cannot state.
--
-- WHY THE EXISTING INDEX DOES NOT COVER IT. 20260725140000 built
--
--     (work_mode, effective_posted DESC) WHERE work_mode IS NOT NULL
--
-- but the query count_jobs_capped assembles is
--
--     WHERE effective_posted >= $1 AND missing_since IS NULL AND work_mode = $2
--
-- Three predicates, two of them indexed. `missing_since IS NULL` is not in the
-- index and not in its partial clause, so every candidate the index scan yields
-- has to be fetched from the heap to test it. That is the cost: not the
-- matching, the verifying.
--
-- It is also why raising the timeout would be the wrong fix. The work is real
-- I/O and it grows with the board; a bigger budget buys a few more months and
-- then fails again, having meanwhile held a worker open for longer on every
-- remote search. The predicate belongs in the index.
--
-- INCLUDING missing_since IS NULL IN THE PARTIAL CLAUSE does two things at
-- once: the heap check disappears (every row in the index already satisfies
-- it), and the index shrinks to only the rows the board can actually serve.
-- Both serving predicates now live where the planner can use them, and the
-- shape matches the serving rule this codebase applies everywhere else —
-- `missing_since IS NULL AND effective_posted >= now() - interval '30 days'`.
--
-- The 30-day half stays a range scan on the second column rather than a partial
-- clause, deliberately: `now()` is not IMMUTABLE, so it cannot appear in an
-- index predicate at all, and a hardcoded date would rot into an index that
-- silently stops covering the window it was built for.
--
-- CONCURRENTLY, because this table serves reads continuously and a plain
-- CREATE INDEX takes an ACCESS EXCLUSIVE lock that stalls every query against
-- it while the index builds.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Run this file on its own — the Supabase SQL editor executes it unwrapped. If
-- a migration runner wraps it in BEGIN/COMMIT it fails with 25001; that is the
-- runner, not this statement, and the fix is to run it standalone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_work_mode_serving_idx
  ON public.job_board_postings (work_mode, effective_posted DESC)
  WHERE work_mode IS NOT NULL AND missing_since IS NULL;

COMMENT ON INDEX public.job_board_postings_work_mode_serving_idx IS
  'Serves the work-mode filtered count. Carries BOTH serving predicates: '
  'work_mode IS NOT NULL and missing_since IS NULL in the partial clause, '
  'effective_posted as the range column. The older work_mode_posted_idx omits '
  'missing_since, which forced a heap fetch per candidate row and timed out '
  'count_jobs_capped on every work mode (measured 2026-08-12).';
