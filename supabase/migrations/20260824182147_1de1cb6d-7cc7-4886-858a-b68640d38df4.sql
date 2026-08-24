-- A POSTING THAT AGED OUT MUST NOT WALK BACK IN.
--
-- The board advertises a 30-day freshness cap and was serving a Videographer
-- role posted 2014-05-23. It was not a row the freshness sweep had missed:
-- its first_seen was 09:25 THIS MORNING, and all 1,000 stale bamboohr rows
-- sampled had a first_seen of today. They are re-inserted continuously.
--
-- The loop, measured 2026-08-24:
--   1. bamboohr and rippling list payloads carry no posting date, so the
--      ingest freshness filter (isDatedBefore) cannot fire — it only drops a
--      row whose date is KNOWN to be old. The row enters as undated.
--   2. The posted-date backfill later fetches the real date: 2014.
--   3. The pass-end freshness sweep sees effective_posted far past the cap
--      and deletes the row.
--   4. The next rotation re-fetches that board and inserts it again, because
--      "already stored" is the only thing that suppresses an insert and the
--      row is no longer stored.
-- Round and round, ~20,600 rows at the time of writing, every one of them
-- re-created today.
--
-- TWO CONSEQUENCES, AND THE SECOND IS WORSE. The board serves jobs a decade
-- old under a 30-day promise — and each lap writes a job_board_exits row, so
-- the public "roles filled or closed today" figure has been counting the same
-- postings dying over and over. A stat fed by artificial events is the defect
-- this codebase treats most seriously; it is why the closure log is never
-- allowed synthetic entries.
--
-- THE TOMBSTONE. An ATS posting id is stable and so is its posting date:
-- bamboohr id 5 at that employer is that same 2014 job every time we fetch
-- it. So remembering "this id aged out, and the date it carried" is enough
-- for ingest to refuse it without re-deriving anything. A genuine re-post
-- gets a new id from the ATS, so this cannot suppress fresh work.
--
-- Bounded and self-healing: rows expire after 180 days, after which an id may
-- re-enter (a vendor recycling ids eventually gets a second chance). Service
-- role only — this is internal bookkeeping, not published data, and it is NOT
-- the lifecycle log: nothing here is a closure event and nothing here may
-- ever be read as one.

CREATE TABLE IF NOT EXISTS public.job_board_aged_out (
  id            text PRIMARY KEY,
  source        text,
  company_token text,
  posted_at     timestamptz,   -- the employer-stated date that aged it out
  aged_at       timestamptz NOT NULL DEFAULT now()
);

-- The ingest lookup is by posting id (primary key). This index serves the
-- expiry prune and the per-board diagnostics instead.
CREATE INDEX IF NOT EXISTS idx_job_board_aged_out_aged_at
  ON public.job_board_aged_out (aged_at);

ALTER TABLE public.job_board_aged_out ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_aged_out FROM anon, authenticated;
GRANT ALL ON public.job_board_aged_out TO service_role;

-- Seed from the rows standing right now, THEN remove them. Order matters: a
-- delete without the tombstone would be undone by the next rotation, which is
-- precisely the loop being closed.
INSERT INTO public.job_board_aged_out (id, source, company_token, posted_at)
SELECT id, source, company_token, effective_posted
FROM public.job_board_postings
WHERE effective_posted < now() - interval '30 days'
ON CONFLICT (id) DO NOTHING;

-- Silently, deliberately: these postings have already been counted as exits
-- many times over by the churn. Writing 20,600 more ledger rows would deepen
-- the same false public number this migration exists to stop.
DELETE FROM public.job_board_postings
WHERE effective_posted < now() - interval '30 days';