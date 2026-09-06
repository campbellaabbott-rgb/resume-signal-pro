-- A CLOSURE BATCH MUST CARRY ITS OWN ALIBI, AND A CENSORED ROW MUST CARRY ITS
-- OWN ORIGIN.
--
-- Measured live 2026-09-06: get_category_fill_speed reports median_days_open of
-- 14.9 to 16.3 across ALL EIGHTEEN categories over ~600k closures. Nursing,
-- law, retail and ML research agree to within 1.4 days. At those sample sizes
-- the standard error on each median is well under a day, so the agreement is
-- not sampling noise. It is the shape of the window we look through: the ingest
-- ages a posting out at FRESH_WINDOW_DAYS = 30, and every fill surface then
-- deletes everything that closed in under a week. A median drawn from a support
-- of one week to one month lands near fifteen days whatever employers actually
-- do. We have been publishing half of our own retention cap and calling it
-- time-to-fill.
--
-- The estimator that replaces it (docs/hiring-health-model.md) treats age-outs
-- and still-live roles as CENSORED OBSERVATIONS rather than as absences, and
-- treats relists as a COMPETING EVENT rather than as censoring. It cannot be
-- written until this migration lands, because it needs three facts the tables
-- do not currently record. This file adds them and nothing else; no function
-- changes here.
--
-- 1. WHETHER A CLOSURE BATCH IS TRUSTWORTHY.
--
-- The collector already suppresses closure logging on a TRUNCATED fetch
-- (`windowed`: the vendor's own advertised total exceeded what we fetched).
-- That guard cannot see the other failure. A board that answers 200 with a
-- valid, nearly empty list reports a feed total equal to what we got, so
-- `windowed` is false, and every stored posting for that employer is written
-- into the closure log in the same second as an employer takedown. A
-- collection failure becomes several hundred fills, and nothing downstream can
-- tell it from the real thing.
--
-- suspect / batch_removed / batch_live_before make that decision AUDITABLE.
-- The batch is still inserted -- the closure log is the one asset here that
-- cannot be re-derived later, so refusing to write it is a permanent loss --
-- and it carries the two numbers that produced the doubt, so a reader can
-- recompute the call or overturn it. Exclusion happens at READ time, in the
-- estimator.
--
-- NOTHING IS BACKFILLED. Historical rows keep suspect = false and, more
-- usefully, batch_live_before IS NULL, which is an exact marker of "written
-- before the collector stamped its batch". The read path uses that marker to
-- decide which rows still need the retroactive proxy (group the unstamped rows
-- by (company_token, closed_at) and drop a bucket whose count exceeds
-- max(5, 0.30 x that company's current open roles)). The proxy therefore
-- retires itself as stamped history accumulates, instead of second-guessing
-- the collector forever.
--
-- The batch key is (company_token, closed_at) EXACTLY, not an hour bucket.
-- docs/hiring-health-model.md 6 proposed date_trunc('hour', closed_at) as a
-- proxy for a batch id. It turns out we do not need a proxy: the collector
-- computes one `closedAt` per board pass and reuses it for every 200-row chunk
-- and both exit inserts, so the timestamp IS the batch id. Hour bucketing would
-- be strictly worse -- the hot lane runs several passes an hour, and merging
-- distinct passes into one bucket would let a run of small legitimate
-- takedowns add up past the threshold and delete real fills.
--
-- There is no promotion job. docs 6 describes suspect batches being promoted
-- back to counted after a later successful fetch declines to restore the
-- postings. That is not in this change and nothing is missing: as specified,
-- suspect is permanent. The collector's two-pass grace and its 6h shrink
-- ratchet already deliver most of what promotion would, and a promoter that
-- nobody wrote is worse than one nobody promised.
--
-- 2. THE ORIGIN OF A CENSORED OBSERVATION.
--
-- job_board_exits has no posted_at. Its days_on_board is documented as "days
-- from the company-stated post date (fallback: our first_seen)" and three of
-- its four write sites do exactly that fallback -- including the freshness
-- sweep, which is the main producer of age-outs. So `days_on_board IS NOT NULL`
-- does not mean "dated", and censoring an age-out at days_on_board would put a
-- first_seen-based duration into the estimator on the majority of censored
-- rows. That is the same substitution as the 2.8-day-median incident: our
-- discovery time published as the employer's posting date.
--
-- Adding posted_at (nullable) fixes it going forward and is honest about
-- history: existing rows get NULL, fall out of the dated cohort, and are
-- disclosed through dated_coverage rather than quietly averaged in. There is no
-- backfill available -- the postings rows were hard-deleted, which is why the
-- exit ledger exists at all.
--
-- 3. INDEXES THE ESTIMATOR CANNOT SURVIVE WITHOUT.
--
-- job_board_exits has indexes on (exited_at) and (category, exit_reason,
-- exited_at) and NOTHING on company_token, so a per-company curve would seq-scan
-- the entire ledger once per call. job_board_closures has (company_token,
-- closed_at) with no INCLUDE list, so every risk-set row costs a heap fetch,
-- and nothing at all on category, which is how the category curve groups.
--
-- DROP-first rather than CREATE INDEX IF NOT EXISTS, for the reason
-- 20260827145000 recorded: an interrupted CONCURRENTLY build elsewhere leaves
-- an INVALID index that IF NOT EXISTS skips forever, so the "safe" form is the
-- one that can never heal.
--
-- No CHECK constraint is added on the new columns. 20260818050000 recorded why:
-- on a table this size a validating CHECK takes ACCESS EXCLUSIVE and full-scans.

SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '20min';
SET LOCAL maintenance_work_mem = '256MB';

-- Adding a column with a non-volatile DEFAULT does not rewrite the table on
-- PG11+; the default is stored in the catalog and materialised on write.
ALTER TABLE public.job_board_closures
  ADD COLUMN IF NOT EXISTS suspect           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_removed     integer,
  ADD COLUMN IF NOT EXISTS batch_live_before integer;

COMMENT ON COLUMN public.job_board_closures.suspect IS
  'True when this row was written in a batch that removed more than '
  'max(5, 0.30 x the live count for that source before the pass). Marks, never '
  'suppresses: the row is still inserted and the estimator excludes it at read '
  'time. Rows predating the collector guard have suspect = false AND '
  'batch_live_before NULL, which is what tells a reader the retroactive proxy '
  'still applies to them.';

COMMENT ON COLUMN public.job_board_closures.batch_removed IS
  'Postings removed in the pass that wrote this row, excluding freshness-cap '
  'age-outs (those produce exit-ledger rows, not closures). Numerator of the '
  'feed-dark ratio; NULL on rows written before 2026-09-06.';

COMMENT ON COLUMN public.job_board_closures.batch_live_before IS
  'Live postings for this source immediately before the pass that wrote this '
  'row. Denominator of the feed-dark ratio, and the marker of a stamped batch: '
  'NULL means the row predates the guard and the read-time proxy applies.';

-- Nullable on purpose. NULL = undated: the row contributes to COUNTS and never
-- to a duration. No backfill exists; the postings were hard-deleted.
ALTER TABLE public.job_board_exits
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

COMMENT ON COLUMN public.job_board_exits.posted_at IS
  'Employer-stated post date, copied at exit time. The estimator censors at '
  'ceil((exited_at - posted_at)/86400) and never reads days_on_board, which '
  'three of four write sites compute on COALESCE(posted_at, first_seen) and '
  'which therefore carries a mixed origin basis no column can distinguish.';

-- Serves the per-company risk set: token-scoped, newest first, and every column
-- the FILL/RELIST arm reads is in the INCLUDE list so the scan stays off the
-- heap.
--
-- job_board_closures_company_idx is DROPPED rather than kept beside it. The
-- header of this file previously claimed the old one "still serves equality
-- probes"; that is not true of any query. Both indexes have the identical key
-- (company_token, closed_at DESC) and the new one only adds an INCLUDE payload,
-- which never makes an index less usable -- so every reader of closures-by-token
-- plans onto the covering index and the old one is pure insert-time cost on the
-- collector's hot 200-row closure inserts, the path already under
-- WORKER_RESOURCE_LIMIT pressure. Keeping a strictly-dominated duplicate index
-- on the hottest write path is not caution, it is a write tax nobody reads.
DROP INDEX IF EXISTS public.job_board_closures_curve_idx;
CREATE INDEX job_board_closures_curve_idx
  ON public.job_board_closures (company_token, closed_at DESC)
  INCLUDE (posted_at, superseded, suspect, batch_live_before, category);

DROP INDEX IF EXISTS public.job_board_closures_company_idx;

-- Serves the category curve, which groups ~600k closures by category over a
-- trailing window. There is no category index on this table today at all.
DROP INDEX IF EXISTS public.job_board_closures_category_curve_idx;
CREATE INDEX job_board_closures_category_curve_idx
  ON public.job_board_closures (category, closed_at DESC)
  INCLUDE (company_token, posted_at, superseded, suspect, batch_live_before);

-- The one index the estimator cannot survive without: without it every call to
-- the per-company curve seq-scans the whole exit ledger.
DROP INDEX IF EXISTS public.job_board_exits_company_idx;
CREATE INDEX job_board_exits_company_idx
  ON public.job_board_exits (company_token, exited_at DESC)
  INCLUDE (exit_reason, posted_at, days_on_board);

-- The LIVE arm of both curves reads currently-served postings and reads
-- posted_at off each one. The existing serving indexes key on effective_posted
-- (a COALESCEd column) and do not carry posted_at, so without these the
-- censored-live arm heap-fetches every serving row.
--
-- THE PREDICATE IS `missing_since IS NULL` ALONE, and the earlier
-- `AND posted_at IS NOT NULL` has been deleted. A partial index is only usable
-- when the query's own restriction clauses IMPLY its predicate, and neither
-- live arm can assert posted_at IS NOT NULL: both deliberately admit undated
-- serving rows so undated_n and dated_coverage can be computed, handling the
-- NULL inside a CASE instead. With the extra conjunct the planner could never
-- choose either index, so the category curve full-scanned ~593k serving rows
-- inside its 60s budget while both indexes still charged write amplification on
-- the highest-churn table in the schema -- the one 20260830200000 had to
-- re-tune autovacuum for. Indexing the whole serving set costs a little more
-- space and is the only form the queries can actually use; posted_at stays as
-- the second key column so the dated rows still sort and read index-only.
DROP INDEX IF EXISTS public.job_board_postings_dated_live_token_idx;
CREATE INDEX job_board_postings_dated_live_token_idx
  ON public.job_board_postings (company_token, posted_at)
  WHERE missing_since IS NULL;

DROP INDEX IF EXISTS public.job_board_postings_dated_live_cat_idx;
CREATE INDEX job_board_postings_dated_live_cat_idx
  ON public.job_board_postings (category, posted_at)
  WHERE missing_since IS NULL;

ANALYZE public.job_board_closures;
ANALYZE public.job_board_exits;
ANALYZE public.job_board_postings;
