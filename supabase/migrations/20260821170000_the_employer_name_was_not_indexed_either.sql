-- 24,936 EMPLOYERS AND NOT ONE OF THEM IS SEARCHABLE BY NAME.
--
-- The simple-config index on title fixed the stopword class for job titles.
-- Company was left out, and company is where employer names actually live.
-- MEASURED with the anon key just now, against ~600,000 open postings:
--   title=wfts(simple).AT&T     -> HTTP 206, 23 rows   (indexed, instant)
--   company=wfts(simple).AT&T   -> HTTP 500            (sequential scan, timeout)
--   company=ilike.*AT&T*        -> HTTP 500            (trigram needs 3+ alnum)
-- So q="AT&T" can reach the 23 postings with AT&T in their TITLE — a Busser at
-- the AT&T Discovery District, a network engineer at HPE — and none of the 493
-- postings whose EMPLOYER is AT&T. The jobs exist, they are one indexed lookup
-- away, and there is no index.
--
-- This is not an AT&T fix. Every employer whose name the english parser mangles
-- is in the same position: anything with an ampersand, an apostrophe, a
-- stopword or a one-character token. Indexing company under 'simple' makes the
-- whole directory reachable by the name people actually type.
--
-- SAME SHAPE AS THE TITLE INDEX, which is now proven in production: an
-- expression index matching exactly what PostgREST compiles for
-- ?company=wfts(simple).X, so the planner will use it. No column (a stored
-- generated column on 602,880 rows takes an ACCESS EXCLUSIVE lock for a full
-- table rewrite) and no function (search_jobs has a fifteen-parameter signature
-- that cannot be read from here, and getting it wrong is the PGRST203 outage).
--
-- SCHEDULED THROUGH pg_cron, WHICH IS THE FORM THAT ACTUALLY WORKS HERE.
-- My previous attempt wrote the bare CREATE INDEX CONCURRENTLY as a single
-- statement, reasoning that a migration without BEGIN/COMMIT would escape the
-- transaction. It does not — this runner wraps migrations regardless, the
-- statement raises 25001, and the index was ultimately built by the cron
-- one-shot instead (20260821154825/155911/160325). Do not repeat my version.
--
-- Note the body is the PLAIN statement, not wrapped in a DO block: CREATE INDEX
-- CONCURRENTLY cannot run inside one either, which is why the first cron
-- attempt at 154825 had to be replaced by the plain form at 155911.
--
-- UNSCHEDULE AFTER IT BUILDS. 20260821170100 does that and should be applied
-- once the index exists. A one-shot left firing every minute forever is its own
-- recorded incident (20260817230000). The statement is IF NOT EXISTS so the
-- repeats are harmless until then, but harmless is not the same as finished.
--
-- VERIFY LIVE, DO NOT ASSUME:
--   company=wfts(simple).AT&T must return HTTP 200 well under a second,
--   and the row count should be in the hundreds, not 23.

SELECT cron.schedule(
  'oneshot_company_simple_fts_idx',
  '* * * * *',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_company_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', company))'
);
