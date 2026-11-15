-- FOUR DUPLICATE INDEXES ARE DROPPED CONCURRENTLY, AND THEIR TWINS KEPT
-- (cost audit 2026-11-08, db-cadence lane, "do first" #14).
--
-- Each index below is a plain btree on exactly the column its twin already
-- indexes, created by a later migration that did not see the first:
--
--   DROPPED                                   KEPT (same table, same column)
--   job_board_postings_company_token_idx      job_board_postings_company_idx
--     (20260719034003 / 034537 / 090000)        (20260711103500, 144159)
--   idx_temp_resume_expires (20251216022357)  temp_resume_storage_expires_at_idx
--   idx_temp_resume_storage_expires_at          (20261005123000)
--     (20251222180935)
--   idx_ai_response_cache_expires_at          idx_ai_cache_expires
--     (20251222180935)                          (20251222172405)
--
-- job_board_postings_token_serving_idx (company_token, partial on live rows,
-- 20260827145000) is a different index and is not touched. A duplicate costs
-- a second write on every insert and every update that moves the column, on
-- the board's busiest table among them, and the disk to hold it; the planner
-- can use only one of the two. Their sizes are not readable with the anon key,
-- so no saving in bytes is claimed here.
--
-- HOW. DROP INDEX CONCURRENTLY cannot run inside a transaction, and a
-- migration is one, so each drop is its own one-shot pg_cron job (the shape of
-- 20260909216000 and 20260909224000): ONE statement per job, with no SET in
-- front of it, because a multi-statement command runs as one implicit
-- transaction and CONCURRENTLY refuses it. A drop that the session's two
-- minute cap cancels leaves the index invalid, and the next minute's run
-- drops that too. One watcher unschedules each dropper once its index is
-- gone, and itself once every dropper is.
--
-- A DROPPER IS SCHEDULED ONLY AGAINST A PROVEN TWIN: the kept index exists on
-- the same table, is valid, and pg_get_indexdef reads the same once the two
-- names are taken out; and the dropped one backs no constraint. Any pair that
-- fails that is left alone, with a notice. If a twin disappears before its
-- duplicate is dropped, the watcher unschedules that dropper rather than drop
-- the last index on the column.
--
-- ARMED LAST IN STEP 1. While a dropper waits for older transactions, its
-- DROP INDEX CONCURRENTLY holds SHARE UPDATE EXCLUSIVE on the table, and a
-- CREATE TRIGGER or ALTER TABLE on that table queues behind it. So this file
-- carries the stamp that sorts after every wave migration that takes such a
-- lock on job_board_postings, temp_resume_storage or ai_response_cache
-- (20261109150000's trigger on job_board_postings among them, which first
-- carried this file at 20261109130000 and would have timed out behind it).
--
-- Safe to re-run: an index already gone schedules nothing, a dropper already
-- scheduled is not scheduled again, and every name is IF EXISTS. Where pg_cron
-- is not installed, the notice prints the four statements to run by hand.

DO $$
DECLARE
  r record;
  v_dup oid;
  v_twin oid;
  v_scheduled int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; drop the duplicates by hand, one statement at a time: DROP INDEX CONCURRENTLY IF EXISTS public.job_board_postings_company_token_idx; DROP INDEX CONCURRENTLY IF EXISTS public.idx_temp_resume_expires; DROP INDEX CONCURRENTLY IF EXISTS public.idx_temp_resume_storage_expires_at; DROP INDEX CONCURRENTLY IF EXISTS public.idx_ai_response_cache_expires_at';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('oneshot-drop-postings-company-token-idx',     'job_board_postings_company_token_idx', 'job_board_postings_company_idx'),
      ('oneshot-drop-temp-resume-expires-idx',        'idx_temp_resume_expires',              'temp_resume_storage_expires_at_idx'),
      ('oneshot-drop-temp-resume-storage-expires-idx','idx_temp_resume_storage_expires_at',   'temp_resume_storage_expires_at_idx'),
      ('oneshot-drop-ai-response-cache-expires-idx',  'idx_ai_response_cache_expires_at',     'idx_ai_cache_expires')
    ) AS t(job, dup, twin)
  LOOP
    v_dup := to_regclass('public.' || r.dup);
    v_twin := to_regclass('public.' || r.twin);
    IF v_dup IS NULL THEN
      RAISE NOTICE '% is already gone', r.dup;
      CONTINUE;
    END IF;
    IF v_twin IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = v_twin AND i.indisvalid)
       OR (SELECT i.indrelid FROM pg_index i WHERE i.indexrelid = v_dup)
          IS DISTINCT FROM (SELECT i.indrelid FROM pg_index i WHERE i.indexrelid = v_twin)
       OR regexp_replace(pg_get_indexdef(v_dup), '^CREATE (UNIQUE )?INDEX [^ ]+ ', 'CREATE \1INDEX ')
          IS DISTINCT FROM regexp_replace(pg_get_indexdef(v_twin), '^CREATE (UNIQUE )?INDEX [^ ]+ ', 'CREATE \1INDEX ')
       OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = v_dup) THEN
      RAISE NOTICE '% is kept: % is not a valid identical twin on the same table', r.dup, r.twin;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = r.job) THEN
      PERFORM cron.schedule(r.job, '* * * * *', format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', r.dup));
    END IF;
    v_scheduled := v_scheduled + 1;
  END LOOP;

  IF v_scheduled > 0 AND NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'oneshot-drop-duplicate-indexes-watch') THEN
    PERFORM cron.schedule(
      'oneshot-drop-duplicate-indexes-watch', '* * * * *',
      $job$
      DO $w$
      DECLARE
        r record;
        v_left int := 0;
      BEGIN
        FOR r IN
          SELECT * FROM (VALUES
            ('oneshot-drop-postings-company-token-idx',     'public.job_board_postings_company_token_idx', 'public.job_board_postings_company_idx'),
            ('oneshot-drop-temp-resume-expires-idx',        'public.idx_temp_resume_expires',              'public.temp_resume_storage_expires_at_idx'),
            ('oneshot-drop-temp-resume-storage-expires-idx','public.idx_temp_resume_storage_expires_at',   'public.temp_resume_storage_expires_at_idx'),
            ('oneshot-drop-ai-response-cache-expires-idx',  'public.idx_ai_response_cache_expires_at',     'public.idx_ai_cache_expires')
          ) AS t(job, dup, twin)
        LOOP
          IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = r.job) THEN
            CONTINUE;
          END IF;
          IF to_regclass(r.dup) IS NULL OR to_regclass(r.twin) IS NULL THEN
            PERFORM cron.unschedule(r.job);
          ELSE
            v_left := v_left + 1;
          END IF;
        END LOOP;
        IF v_left = 0 AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-drop-duplicate-indexes-watch') THEN
          PERFORM cron.unschedule('oneshot-drop-duplicate-indexes-watch');
        END IF;
      END $w$;
      $job$);
  END IF;
END $$;

DO $$
DECLARE
  r record;
  v_cmd text;
  v_pending int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('oneshot-drop-postings-company-token-idx',     'job_board_postings_company_token_idx', 'job_board_postings_company_idx'),
      ('oneshot-drop-temp-resume-expires-idx',        'idx_temp_resume_expires',              'temp_resume_storage_expires_at_idx'),
      ('oneshot-drop-temp-resume-storage-expires-idx','idx_temp_resume_storage_expires_at',   'temp_resume_storage_expires_at_idx'),
      ('oneshot-drop-ai-response-cache-expires-idx',  'idx_ai_response_cache_expires_at',     'idx_ai_cache_expires')
    ) AS t(job, dup, twin)
  LOOP
    SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = r.job;
    IF v_cmd IS NULL THEN
      CONTINUE;
    END IF;
    v_pending := v_pending + 1;
    IF v_cmd <> format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', r.dup) THEN
      RAISE EXCEPTION 'self-check: % runs %, want the one drop of public.% and nothing else', r.job, v_cmd, r.dup;
    END IF;
    IF to_regclass('public.' || r.twin) IS NULL THEN
      RAISE EXCEPTION 'self-check: % is scheduled while its twin % does not exist', r.job, r.twin;
    END IF;
  END LOOP;
  IF v_pending > 0 AND NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'oneshot-drop-duplicate-indexes-watch') THEN
    RAISE EXCEPTION 'self-check: % dropper(s) scheduled with no watcher to unschedule them', v_pending;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job j
              WHERE j.command ~* 'DROP INDEX[^;]*(job_board_postings_company_idx|job_board_postings_token_serving_idx|temp_resume_storage_expires_at_idx|idx_ai_cache_expires)([^a-z0-9_]|$)') THEN
    RAISE EXCEPTION 'self-check: a pg_cron job would drop an index this file keeps';
  END IF;
END $$;
