-- The nightly sweep hard-DELETEs postings, leaving no trace they ever existed.
--
-- 'job-board-verification-sweep' runs at 03:41 and does:
--
--     DELETE FROM public.job_board_postings p
--     WHERE EXISTS (SELECT 1 FROM public.job_board_verifications v
--                   WHERE v.company_token = p.company_token
--                     AND v.verified_at < now() - interval '48 hours');
--
-- No `missing_since` stamp. No row in job_board_closures. No entry in
-- job_board_aged_out. The postings are simply gone, and nothing anywhere records
-- that they were ever on the board.
--
-- THE TRIGGER IS NOT "THE EMPLOYER REMOVED THE JOBS". It is "we did not
-- re-verify this board in 48 hours", which is a statement about OUR rotation,
-- not about the employer. A board stops being verified whenever it stops being
-- SELECTED — a rotation or cursor gap, a selection collision, a blocklist edit,
-- a vendor failing long enough to be skipped. In every one of those cases the
-- jobs are still live at the employer, and the sweep deletes them anyway.
--
-- AND IT CORRUPTS THE ONE ASSET THIS PRODUCT OWNS. The closure log is the thing
-- a scraper-based competitor structurally cannot have: it records when a posting
-- DISAPPEARED. Postings deleted by this sweep exit the corpus without ever being
-- logged as closed, so the ledger silently under-counts, and the derived figures
-- the product publishes from it — median days open, closures logged, the Ghost
-- Job Index — are computed over a history with holes punched in it.
--
-- SOFT, NOT HARD. `missing_since` is the mechanism the board already uses for
-- exactly this, and both serving fences exclude a stamped row, so the visible
-- effect is identical: the postings stop being served the moment the sweep runs.
-- What changes is that they still EXIST, so the existing closure machinery can
-- see them, the two-pass confirmation can do its job, and a board that comes
-- back — the rotation gap closing, the vendor recovering — has its rows
-- un-stamped by the refresh pass (job-board/index.ts:2101) instead of needing a
-- full re-ingest of jobs that never went anywhere.
--
-- ONLY ROWS NOT ALREADY STAMPED, so a board that has been missing for weeks does
-- not have its original disappearance date rewritten every night. That date is
-- what days-open is measured from.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-verification-sweep') THEN
      PERFORM cron.unschedule('job-board-verification-sweep');
    END IF;
    PERFORM cron.schedule(
      'job-board-verification-sweep',
      '41 3 * * *',
      $job$
      UPDATE public.job_board_postings p
         SET missing_since = now()
       WHERE p.missing_since IS NULL
         AND EXISTS (
           SELECT 1 FROM public.job_board_verifications v
           WHERE v.company_token = p.company_token
             AND v.verified_at < now() - interval '48 hours'
         );
      $job$
    );
  END IF;
END $$;

-- Self-verifying: the job must exist, and must not delete.
DO $$
DECLARE cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'job-board-verification-sweep';
  IF cmd IS NULL THEN
    RAISE EXCEPTION 'the verification sweep is not scheduled';
  END IF;
  IF cmd ILIKE '%DELETE FROM public.job_board_postings%' THEN
    RAISE EXCEPTION 'the verification sweep still hard-deletes postings';
  END IF;
  IF cmd NOT ILIKE '%missing_since = now()%' THEN
    RAISE EXCEPTION 'the verification sweep does not stamp missing_since';
  END IF;
END $$;
