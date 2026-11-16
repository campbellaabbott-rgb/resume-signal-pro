-- SUB-HOURLY CRON REVIEW MARKER: not required. Every job this file schedules
-- runs once a day (reviewed 2026-11-16 under the owner's instruction "we need
-- maximum cost savings").
--
-- THE DATABASE SIZE IS WRITTEN DOWN ONCE A NIGHT (cost wave 2, 2026-11-16,
-- plan item BN-2: ID-03).
--
-- WHY. Lovable Cloud grows the disk in one-way steps that raise the bill, and
-- the date of the next step decides when the owner must act. Today that date
-- rests on two hand readings (23.17 GB on 2026-10-17 and an estimate since):
-- scan-heartbeat keeps the database size only inside its error text, and the
-- two size readers (get_db_size_stats, get_storage_footprint) answer the
-- service role alone, so no series exists. This file starts one.
--
-- WHAT. public.stamp_storage_sizes() reads pg_database_size and the twelve
-- largest tables and materialized views in every schema (their indexes and
-- TOAST included, by pg_total_relation_size), and puts that entry at the head
-- of a ring of the last 60 nights in job_board_meta k = 'storage_size_ring'
-- ({entries: [{at, db_bytes, top: [{rel, bytes}]}], keep: 60}, newest
-- first). It stores sizes and relation names only, never a row. It runs as
-- its caller (no SECURITY DEFINER): the job runs as the scheduling role, and
-- only the service role may call it by hand. A daily job at 11:11 UTC, clear
-- of the 02:30-06:41 snapshot window and of the hourly :27 stats cache, calls
-- it with SET statement_timeout = '60s' in the command, since a function's
-- own SET never times a cron run. The function sets lock_timeout = '10s'
-- (read at each lock wait, so a function's own SET does bound it): sizing a
-- table takes a brief share lock on it and its indexes, and a table held by
-- someone's DDL makes the call fail in ten seconds instead of waiting. The
-- first entry is written as this file applies; a failure there, a lock
-- timeout or a cancel included, only warns, and the night's job takes the
-- next.
--
-- READ IT in the SQL editor:
--   SELECT e->>'at' AS at, pg_size_pretty((e->>'db_bytes')::bigint) AS db
--     FROM public.job_board_meta m,
--          jsonb_array_elements(m.v->'entries') e
--    WHERE m.k = 'storage_size_ring';
--
-- Safe to re-run: the function is replaced whole, cron.schedule replaces the
-- job of the same name, and a second seed only adds one more entry.

CREATE OR REPLACE FUNCTION public.stamp_storage_sizes()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
SET statement_timeout = '60s'
SET lock_timeout = '10s'
AS $fn$
DECLARE
  v_entry jsonb;
  v_ring jsonb;
BEGIN
  SELECT jsonb_build_object(
           'at', now(),
           'db_bytes', pg_database_size(current_database()),
           'top', coalesce((
             SELECT jsonb_agg(jsonb_build_object('rel', t.rel, 'bytes', t.bytes) ORDER BY t.bytes DESC, t.rel)
               FROM (SELECT n.nspname || '.' || c.relname AS rel, pg_total_relation_size(c.oid) AS bytes
                       FROM pg_class c
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE c.relkind IN ('r', 'm')
                        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                        AND n.nspname !~ '^pg_toast'
                      ORDER BY pg_total_relation_size(c.oid) DESC, 1
                      LIMIT 12) t), '[]'::jsonb))
    INTO v_entry;

  SELECT m.v -> 'entries' INTO v_ring FROM public.job_board_meta m WHERE m.k = 'storage_size_ring';
  IF v_ring IS NULL OR jsonb_typeof(v_ring) <> 'array' THEN
    v_ring := '[]'::jsonb;
  END IF;
  v_ring := jsonb_build_array(v_entry) || coalesce(
    (SELECT jsonb_agg(x.e ORDER BY x.o) FROM jsonb_array_elements(v_ring) WITH ORDINALITY AS x(e, o) WHERE x.o < 60),
    '[]'::jsonb);

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('storage_size_ring', jsonb_build_object('entries', v_ring, 'keep', 60), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;

  RETURN v_entry;
END
$fn$;

REVOKE ALL ON FUNCTION public.stamp_storage_sizes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_storage_sizes() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'storage-size-stamp', '11 11 * * *',
      $job$SET statement_timeout = '60s'; SELECT public.stamp_storage_sizes();$job$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed here; call public.stamp_storage_sizes() once a day by hand';
  END IF;
END $$;

DO $$
BEGIN
  PERFORM public.stamp_storage_sizes();
EXCEPTION WHEN OTHERS OR query_canceled THEN
  -- OTHERS never matches query_canceled, so a timeout's cancel is named too.
  RAISE WARNING 'first storage size entry not written (non-fatal; the nightly job takes the next): %', SQLERRM;
END $$;

DO $$
DECLARE
  v_fn regprocedure := to_regprocedure('public.stamp_storage_sizes()');
  v_cfg text[];
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'self-check: public.stamp_storage_sizes() is missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'stamp_storage_sizes') <> 1 THEN
    RAISE EXCEPTION 'self-check: more than one public.stamp_storage_sizes exists';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_fn;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn) THEN
    RAISE EXCEPTION 'self-check: stamp_storage_sizes() must run as its caller';
  END IF;
  IF NOT ('statement_timeout=60s' = ANY (v_cfg)) OR NOT ('lock_timeout=10s' = ANY (v_cfg))
     OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'self-check: stamp_storage_sizes() lost its search_path or a timeout: %', v_cfg;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role may call stamp_storage_sizes()';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: the service role cannot call stamp_storage_sizes()';
  END IF;
  -- Two IFs, not one AND: PL/pgSQL plans an IF condition as one query, so a
  -- single AND would resolve cron.job even where pg_cron is absent.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (
         SELECT 1 FROM cron.job j
          WHERE j.jobname = 'storage-size-stamp' AND j.schedule = '11 11 * * *' AND j.active
            AND j.command ~ '^SET statement_timeout = ''60s''; SELECT public\.stamp_storage_sizes\(\);$') THEN
      RAISE EXCEPTION 'self-check: storage-size-stamp is not scheduled daily at 11:11 with its timeout in the command';
    END IF;
  END IF;
END $$;
