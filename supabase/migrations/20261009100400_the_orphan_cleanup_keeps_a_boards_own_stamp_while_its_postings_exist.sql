-- THE ORPHAN CLEANUP KEEPS A BOARD'S OWN STAMP WHILE ITS POSTINGS EXIST
-- (S10-018, platform-debug 2026-10-10; job-board's n428 follow-up).
--
-- job-board .91 (wave 2, n428) stamps a board on a shared token under its own
-- key, `source:token`, beside the bare token, so a twin's read no longer keeps
-- a deferred board "verified". The 48-hour sweep (20261008100000) judges such a
-- board by its own key. But the nightly job-board-verif-orphan-cleanup
-- (20260720164549, '51 3 * * *') deletes every stamp whose company_token
-- matches no posting's company_token. No posting's company_token is ever
-- 'greenhouse:lush', so it deleted EVERY keyed stamp every night.
-- seedBoardStamps then re-seeded the key from the twin's fresh bare stamp on
-- the next slice. A deferred twin's key never aged to 48 hours, and the
-- n428 fix was undone daily (pglite repro: greenhouse:lush at 47 h became
-- 0.1 h after one cleanup and one seed).
--
-- The command now resolves a keyed stamp to its board: the source is the
-- text before the first ':' and the token the rest (job-board's keyToken).
-- It keeps the stamp while a posting of THAT vendor on THAT token exists. A
-- bare stamp is judged exactly as before (any posting on the token). A key
-- whose board has no posting left is still deleted. If the board stays
-- catalogued and shared, the next slice re-seeds it from the token's stamp,
-- which is what an empty board should carry.
--
-- In place, by name: cron.alter_job keeps the job's id, owner, schedule and
-- active flag (the 20261004010000 rule). A host without the job schedules it
-- at its old minute, and a host without pg_cron applies this as a no-op. The
-- command begins with its own statement_timeout, because a function's SET
-- never extends a pg_cron run (20261003220000). It reads the stamp table once
-- and probes postings by company_token per stamp, the same index the old form
-- used. Self-verifying and safe to re-run. job-board's code is unchanged; this
-- file needs no build to be live first.

SET LOCAL statement_timeout = '2min';

DO $$
DECLARE
  v_id bigint;
  c_job constant text := 'job-board-verif-orphan-cleanup';
  c_command constant text := $job$SET statement_timeout = '5min';
      DELETE FROM public.job_board_verifications v
      WHERE NOT EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.company_token = CASE WHEN strpos(v.company_token, ':') > 0
                                     THEN substr(v.company_token, strpos(v.company_token, ':') + 1)
                                     ELSE v.company_token END
          AND (strpos(v.company_token, ':') = 0 OR p.source = split_part(v.company_token, ':', 1))
      );$job$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- no orphan cleanup to teach the per-board stamp';
    RETURN;
  END IF;
  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = c_job;
  IF v_id IS NULL THEN
    PERFORM cron.schedule(c_job, '51 3 * * *', c_command);
  ELSE
    PERFORM cron.alter_job(job_id := v_id, command := c_command);
  END IF;
END $$;

-- Self-verifying: scheduled, bounded, never touches postings, resolves the key
-- to its vendor's rows, and keeps a bare stamp's old rule. What it keeps today
-- is printed (read-only counts).
DO $verify$
DECLARE
  cmd text;
  n_keyed bigint;
  n_keyed_live bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.command INTO cmd FROM cron.job j WHERE j.jobname = 'job-board-verif-orphan-cleanup';
  IF cmd IS NULL THEN
    RAISE EXCEPTION 'job-board-verif-orphan-cleanup is not scheduled';
  END IF;
  IF cmd NOT LIKE 'SET statement_timeout = ''5min'';%' THEN
    RAISE EXCEPTION 'the orphan cleanup does not begin with its own statement_timeout';
  END IF;
  IF cmd ILIKE '%DELETE FROM public.job_board_postings%' OR cmd ILIKE '%UPDATE public.job_board_postings%' THEN
    RAISE EXCEPTION 'the orphan cleanup writes postings';
  END IF;
  IF cmd NOT LIKE '%p.source = split_part(v.company_token, '':'', 1)%'
     OR cmd NOT LIKE '%substr(v.company_token, strpos(v.company_token, '':'') + 1)%' THEN
    RAISE EXCEPTION 'the orphan cleanup does not resolve a source:token stamp to its board';
  END IF;
  IF cmd NOT LIKE '%strpos(v.company_token, '':'') = 0 OR%' THEN
    RAISE EXCEPTION 'the orphan cleanup lost the bare-token rule';
  END IF;
  IF to_regclass('public.job_board_verifications') IS NOT NULL AND to_regclass('public.job_board_postings') IS NOT NULL THEN
    SELECT count(*) INTO n_keyed FROM public.job_board_verifications v WHERE strpos(v.company_token, ':') > 0;
    SELECT count(*) INTO n_keyed_live FROM public.job_board_verifications v
     WHERE strpos(v.company_token, ':') > 0
       AND EXISTS (SELECT 1 FROM public.job_board_postings p
                    WHERE p.company_token = substr(v.company_token, strpos(v.company_token, ':') + 1)
                      AND p.source = split_part(v.company_token, ':', 1));
    RAISE NOTICE 'orphan cleanup: % per-board stamps, % with postings of their own (kept from tonight; the old command deleted all %)', n_keyed, n_keyed_live, n_keyed;
  END IF;
END
$verify$;
