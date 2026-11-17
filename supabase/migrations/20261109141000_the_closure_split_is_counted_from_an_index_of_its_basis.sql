-- lovable-cron-fallback-reviewed: no sub-hourly cron; every job this file schedules runs at most once an hour (reviewed 2026-11-16 by the project owner).
--
-- THE CLOSURE SPLIT IS COUNTED FROM AN INDEX OF ITS BASIS.
--
-- Cost audit 2026-11-08, "Closure population". refresh_closure_population()
-- splits the whole closure log by absence_basis twice an hour (its logsplit
-- CTE: one count(*) FILTER pass over public.job_board_closures). The log is
-- kept and grows every day, and nothing indexes absence_basis, so each pass
-- reads the entire heap -- estimated at ~1.4 GB per run, 48 runs a day, a
-- cost that only rises.
--
-- THE FIX IS AN INDEX ON THE ONE COLUMN THE SPLIT READS:
--   job_board_closures_absence_basis_idx ON public.job_board_closures (absence_basis)
-- absence_basis takes four values (full_read, lap, lap_backfill, NULL), so the
-- btree deduplicates to a small fraction of the heap and the planner can
-- answer the grouped count with an index-only scan. No query, payload or
-- published number changes: the counts are the same counts, read from a
-- smaller structure. absence_basis is written once at insert and never
-- updated (the collector's later writes touch suspect only), so the index adds
-- one small entry per closure and does not disturb HOT updates of suspect.
--
-- WHY A CRON AND NOT THIS FILE. The table is large and written all day; a
-- plain CREATE INDEX would hold a SHARE lock against the collector for the
-- whole build, and CREATE INDEX CONCURRENTLY cannot run inside the
-- transaction this file applies in. So the repo's one-shot pattern
-- (20260909224000, after 20260909216000): a builder job whose command is the
-- single CONCURRENTLY statement -- no SET in front of it, a multi-statement
-- command runs as one implicit transaction and the build refuses it -- and a
-- watcher that unschedules both once the index is valid.
--
-- WHEN. The builder fires at :44, clear of the closure-population refresh
-- (:09/:39), the stats cache (:27, about six minutes), the explore cache
-- (:07), the facet sweep (:02/:17/:32/:47 once 20261109120000 applies), the
-- upkeep (:x2/:x7) and the stats rollup (:00/:30 once 20261109121000
-- applies), because a concurrent build waits for
-- every older snapshot in the database. The watcher looks once an hour, at :14
-- (half an hour after the builder starts), so nothing here runs more often
-- than hourly; a valid index is retired within the hour.
--
-- IT GIVES UP. A concurrent build that is cancelled leaves an INVALID index
-- that writers still maintain. The watcher drops an invalid index only when no
-- build is in progress (pg_stat_progress_create_index) and only under a
-- two-second lock_timeout, so the drop can never queue behind the collector.
-- After the builder has failed three times (cron.job_run_details) the watcher
-- unschedules both jobs and leaves the log exactly as it is today -- the
-- refresh keeps counting from the heap, which is correct, only dearer.
--
-- Guarded for a database without pg_cron (a NOTICE names the statement to run
-- by hand). Re-runnable: an index already present schedules nothing, and an
-- existing job of either name is left as it is. Self-verifying below.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent: build job_board_closures_absence_basis_idx by hand (CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_closures_absence_basis_idx ON public.job_board_closures (absence_basis))';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'job_board_closures_absence_basis_idx') THEN
    RAISE NOTICE 'job_board_closures_absence_basis_idx already present; nothing scheduled';
    RETURN;
  END IF;

  -- ONE statement, no SET in front of it.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-closures-absence-basis-idx') THEN
    PERFORM cron.schedule(
      'oneshot-closures-absence-basis-idx', '44 * * * *',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_closures_absence_basis_idx ON public.job_board_closures (absence_basis)');
  END IF;

  -- The watcher: a valid index unschedules both jobs; an invalid one is
  -- dropped when no build is running so the next hour can try again; the
  -- third failed build ends the attempt.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-closures-absence-basis-idx-watch') THEN
    PERFORM cron.schedule(
      'oneshot-closures-absence-basis-idx-watch', '14 * * * *',
      $job$
      DO $w$
      DECLARE
        v_valid    boolean;
        v_building boolean;
        v_failed   integer;
      BEGIN
        SELECT i.indisvalid INTO v_valid
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'job_board_closures_absence_basis_idx';
        SELECT EXISTS (
          SELECT 1
            FROM pg_stat_progress_create_index p
            JOIN pg_class c ON c.oid = p.index_relid
           WHERE c.relname = 'job_board_closures_absence_basis_idx'
        ) INTO v_building;
        SELECT count(*)::integer INTO v_failed
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
         WHERE j.jobname = 'oneshot-closures-absence-basis-idx'
           AND d.status = 'failed';

        IF v_valid IS FALSE AND NOT v_building THEN
          BEGIN
            SET LOCAL lock_timeout = '2s';
            DROP INDEX IF EXISTS public.job_board_closures_absence_basis_idx;
            v_valid := NULL;
          EXCEPTION WHEN lock_not_available THEN
            RAISE NOTICE 'job_board_closures_absence_basis_idx is invalid but locked; the next look tries again';
          END;
        END IF;

        IF v_valid IS TRUE OR (v_failed >= 3 AND v_valid IS NULL AND NOT v_building) THEN
          IF v_valid IS NOT TRUE THEN
            RAISE NOTICE 'job_board_closures_absence_basis_idx failed % builds; giving up, the refresh keeps reading the heap', v_failed;
          END IF;
          IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-closures-absence-basis-idx') THEN
            PERFORM cron.unschedule('oneshot-closures-absence-basis-idx');
          END IF;
          IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-closures-absence-basis-idx-watch') THEN
            PERFORM cron.unschedule('oneshot-closures-absence-basis-idx-watch');
          END IF;
        END IF;
      END $w$;
      $job$);
  END IF;
END $$;

-- The end state: either the index is already there and valid, or both jobs
-- are scheduled, the builder's command is the single concurrent statement.
DO $verify$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'job_board_closures_absence_basis_idx' AND i.indisvalid
  ) THEN
    RETURN;
  END IF;
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'oneshot-closures-absence-basis-idx';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'job_board_closures_absence_basis_idx is neither built nor scheduled';
  END IF;
  IF v_cmd !~* '^\s*CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_closures_absence_basis_idx ON public\.job_board_closures \(absence_basis\)\s*;?\s*$' THEN
    RAISE EXCEPTION 'the absence_basis builder is not the single concurrent statement: %', v_cmd;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-closures-absence-basis-idx-watch') THEN
    RAISE EXCEPTION 'the absence_basis builder has no watcher, so it would never stop';
  END IF;
END
$verify$;
