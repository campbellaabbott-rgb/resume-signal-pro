-- THE FREE-TEXT OR-TREE HAD TWO UNINDEXED ARMS, AND ONE IS ENOUGH TO LOSE.
--
-- buildQuery emits, once per term:
--   title ILIKE '%q%' OR company ILIKE '%q%' OR department ILIKE '%q%'
--
-- A BitmapOr requires EVERY arm to have an index path. 20260713210000 declared
-- trigram indexes on all four text columns; only title (20260720220847) and
-- location (20260726171432) were ever rebuilt. company and department were
-- never built. One unindexable arm collapses the whole tree onto a full scan
-- and drags the indexed title arm down with it.
--
-- company LOOKS indexed and is not, for this predicate. 20260821170000 built
-- job_board_postings_company_simple_fts_idx over to_tsvector('simple', company)
-- — an FTS index, which serves ?company=wfts(simple).X and cannot serve
-- ILIKE '%x%'. Different operator, different index, no help here.
--
-- MEASURED 2026-08-25, live, anon REST, the board's exact 23-column select, the
-- exact serving fence, ORDER BY effective_posted DESC NULLS LAST + id ASC,
-- LIMIT 60, three interleaved rounds, a zero-match six-character term so the
-- scan cannot stop early:
--
--   title alone ................. 0.203-0.206 s   indexed
--   location alone .............. 0.203-0.222 s   indexed
--   OR(title, location) ......... 0.215-0.249 s   BitmapOr works ACROSS columns
--   OR(title, department) ....... 2.054-2.889 s   collapses
--   OR(title, company) .......... 2.483-2.882 s   collapses
--   OR(title, company, dept) .... 2.652-3.232 s   the board's real predicate,
--                                                 intermittently HTTP 500 at the
--                                                 3 s anon timeout
--
-- Real terms, today vs. an all-arms-indexed proxy on the same term:
--   camarero  2.78-2.81 s -> 0.24-0.32 s      welder  0.57-0.62 s -> 0.23-0.25 s
--   nurse     0.23-0.26 s -> 0.30-0.36 s      engineer 0.24-0.40 s -> 0.45-0.67 s
--
-- SO THIS IS A TRADE, NOT A FREE WIN. Head terms get slower — the planner picks
-- the bitmap path where a backward index walk was already cheap — by roughly
-- +170 to +470 ms. Tail terms go from seconds and intermittent 500s to under
-- 300 ms. A board that serves Spanish and German job titles cannot answer
-- "camarero" in 8 seconds to keep "engineer" at 240 ms.
--
-- It also defuses a second effect for free: needInlineCount re-runs the WHOLE
-- page with count: "exact" whenever count_jobs_capped loses its 1500 ms race,
-- which is why page_query is bimodal (welder 708 ms when the count wins, 3324 ms
-- when it loses; nurse 132 ms vs 1627 ms). Once the count returns in ~0.3 s it
-- always wins, and the second page run stops firing.
--
-- RESULTS DO NOT CHANGE. The predicate text is untouched. pg_trgm is a LOSSY
-- index: the bitmap heap scan carries a Recheck Cond on the original ILIKE and
-- re-evaluates it per candidate row, so trigram semantics never reach the
-- answer. That is precisely why this is a trigram index and NOT a swap to
-- search_tsv — a tsvector match is stemmed and token-based and would silently
-- change which jobs a search returns.
--
-- PLAIN CREATE INDEX, NOT CONCURRENTLY, DELIBERATELY. The migration runner
-- wraps each file in a transaction, where CONCURRENTLY raises 25001 and applies
-- nothing (recorded in 20260725140000, 20260725160000, 20260817190000). The
-- pg_cron one-shot written to work around that has a bad record on THIS table:
-- the location trigram index took four attempts, and 20260821190000 documents
-- an index that silently never built because a schedule and its unschedule
-- shipped in one push — a failure mode indistinguishable from success. A plain
-- build takes a SHARE lock: readers are unaffected and the refresh rotation's
-- writes queue behind it for the duration. That is the same trade
-- 20260720220847 made for the title trigram index, which measures healthy today.
--
-- DROP FIRST: an interrupted CREATE INDEX CONCURRENTLY leaves an INVALID index
-- that CREATE INDEX IF NOT EXISTS would then skip forever. On a nonexistent
-- index DROP IF EXISTS takes no lock, so this is free in the expected case and
-- self-healing in the bad one.

SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '20min';
SET LOCAL maintenance_work_mem = '256MB';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS public.job_board_postings_company_trgm_idx;
CREATE INDEX job_board_postings_company_trgm_idx
  ON public.job_board_postings USING gin (company gin_trgm_ops);

DROP INDEX IF EXISTS public.job_board_postings_department_trgm_idx;
CREATE INDEX job_board_postings_department_trgm_idx
  ON public.job_board_postings USING gin (department gin_trgm_ops);

ANALYZE public.job_board_postings;
