-- SUB-HOURLY CRON REVIEW MARKER
-- reviewed: 2026-11-16 by the project owner, who approves this schedule as written.
-- job: job-board-stats-rollup (an existing job, altered in place).
-- schedule: '*/15 * * * *' today -> '*/30 * * * *' after this file (half as often).
-- why sub-hourly: the public data API (public-api 2026-11-09.1, live) already
--   tells its users this rollup is recomputed every 30 minutes.
-- load: lower than today. 48 runs a day instead of 96, and each run reads the
--   live postings once instead of twice.
-- new standing sub-hourly jobs: none.
--
-- THE COVERAGE ROLLUP READS THE POSTINGS ONCE, EVERY HALF HOUR (cost audit
-- 2026-11-08, db-cadence lane, "do first" #6).
--
-- refresh_job_board_stats() writes three rows of job_board_stats_rollup:
-- freshness, date_coverage and desc_coverage. The last two were two separate
-- grouped passes over every live posting -- the same WHERE, the same GROUP BY
-- source, one counting posted_at and the other counting stored descriptions
-- -- so every run read the live postings twice to produce two lists that
-- share their source and total columns. The job ran every fifteen minutes
-- ('job-board-stats-rollup', '*/15 * * * *'): measured read-only from
-- get_cron_health on 2026-11-08, 96 runs a day, 3.1 s last and 7.4 s at most.
--
-- WHAT CHANGES.
--   ONE PASS. A single grouped pass counts total, dated and described per
--   source, into one list held in a variable. Each of the two rows is then
--   written from that list in its own block, in the same order (total
--   descending) and with exactly the keys it had: date_coverage
--   {source, total, dated}, desc_coverage {source, total, described}. A pass
--   that fails or times out skips BOTH rows, and each keeps its previous value
--   under its own older computed_at, as a failed block always did; a failure
--   in one write still leaves the other written.
--   EVERY HALF HOUR. The job is altered in place to '*/30 * * * *', keeping
--   its id, its active flag and its SET statement_timeout = '4min' in front of
--   the call. Both rows are read by readers that publish their asOf beside
--   them (job-board status, /v1/stats), and the freshness row's p50 is in the
--   hours, so a half-hour cadence states nothing the row cannot keep.
--
-- THE FRESHNESS BLOCK IS BYTE-IDENTICAL to 20260909221000, the latest
-- definition (checked: no later migration redefines this function). The
-- header, the 4min budget and the revoke are the same.
--
-- PUBLISHED CADENCE. Two published sentences name fifteen minutes and must
-- move with this file: the data pages' "recomputed every 15 minutes"
-- (scripts/prerender-seo.mjs DATA_PAGE_CADENCE) and /v1/stats' basis string
-- (supabase/functions/public-api). Both belong to other owners; the deploy
-- notes carry them.
--
-- Safe to re-run: the function is replaced whole, the job is altered only when
-- it exists in cron.job, and the self-check reads both back.

CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
DECLARE
  v_cov jsonb;
BEGIN
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'freshness',
      jsonb_build_object(
        'boards',       count(*) FILTER (WHERE live.is_live),
        'p50_min',      round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'p95_min',      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'max_min',      round((max(live.age_min) FILTER (WHERE live.is_live))::numeric, 1),
        'dark_boards',  count(*) FILTER (WHERE NOT live.is_live),
        'dark_max_min', round((max(live.age_min) FILTER (WHERE NOT live.is_live))::numeric, 1),
        'population',   'verification stamps whose token holds at least one live posting row (missing_since IS NULL); dark_boards = stamps whose token holds rows but none live'
      ),
      now()
    FROM (
      SELECT EXTRACT(EPOCH FROM (now() - ver.verified_at)) / 60.0 AS age_min,
             EXISTS (
               SELECT 1 FROM public.job_board_postings p
               WHERE p.company_token = ver.company_token
                 AND p.missing_since IS NULL
             ) AS is_live
      FROM public.job_board_verifications ver
      WHERE EXISTS (
        SELECT 1 FROM public.job_board_postings p
        WHERE p.company_token = ver.company_token
      )
    ) live
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: freshness unavailable (%)', SQLERRM;
  END;

  -- ONE GROUPED PASS for both coverage rows. Described = holds a stored
  -- description at all: the exact complement of what every sweep lane selects
  -- (description IS NULL), so total minus described per source is that
  -- source's sweep backlog; a null test reads the tuple's bitmap and never
  -- opens the value.
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'dated', dated, 'described', described)
                              ORDER BY total DESC), '[]'::jsonb)
      INTO v_cov
    FROM (
      SELECT source,
             count(*) AS total,
             count(posted_at) AS dated,
             count(*) FILTER (WHERE description IS NOT NULL) AS described
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      v_cov := NULL;
      RAISE WARNING 'stats rollup: date_coverage and desc_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      v_cov := NULL;
      RAISE WARNING 'stats rollup: date_coverage and desc_coverage unavailable (%)', SQLERRM;
  END;

  IF v_cov IS NOT NULL THEN
    BEGIN
      INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
      SELECT
        'date_coverage',
        COALESCE(jsonb_agg(jsonb_build_object('source', e.r -> 'source', 'total', e.r -> 'total', 'dated', e.r -> 'dated')
                           ORDER BY e.n), '[]'::jsonb),
        now()
      FROM jsonb_array_elements(v_cov) WITH ORDINALITY AS e(r, n)
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
    EXCEPTION
      WHEN QUERY_CANCELED THEN
        RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
      WHEN OTHERS THEN
        RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
    END;

    BEGIN
      INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
      SELECT
        'desc_coverage',
        COALESCE(jsonb_agg(jsonb_build_object('source', e.r -> 'source', 'total', e.r -> 'total', 'described', e.r -> 'described')
                           ORDER BY e.n), '[]'::jsonb),
        now()
      FROM jsonb_array_elements(v_cov) WITH ORDINALITY AS e(r, n)
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
    EXCEPTION
      WHEN QUERY_CANCELED THEN
        RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
      WHEN OTHERS THEN
        RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
    END;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.refresh_job_board_stats() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.refresh_job_board_stats() IS
  'Half-hourly rollup writer (cron job-board-stats-rollup, every 30 minutes since '
  '20261109121000) for freshness, date_coverage and desc_coverage. date_coverage '
  'and desc_coverage come from ONE grouped pass over the live postings (total, '
  'dated and described per source), written as two rows with their own keys. '
  'Each row degrades independently: a timeout (QUERY_CANCELED, which WHEN OTHERS '
  'does not catch) or any other failure skips the row and leaves the previous '
  'value standing under its own older computed_at; a failed coverage pass skips '
  'both coverage rows. freshness since 2026-09-10 (20260909221000): population '
  '= verification stamps whose token holds at least one LIVE posting row '
  '(missing_since IS NULL); dark_boards / dark_max_min count the stamps whose '
  'token holds rows but none live. desc_coverage: described = description IS '
  'NOT NULL, the sweep lanes'' own selection complemented, so total - described '
  'is the sweep backlog per source.';

DO $$
DECLARE
  v_id bigint;
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; job-board-stats-rollup is not rescheduled';
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'job-board-stats-rollup';
  IF v_id IS NULL THEN
    RAISE NOTICE 'no job-board-stats-rollup job here; nothing to reschedule';
    RETURN;
  END IF;
  -- The command keeps its own timeout; one that lost it gets it back.
  IF v_cmd !~ '^[[:space:]]*SET statement_timeout' THEN
    v_cmd := 'SET statement_timeout = ''4min''; SELECT public.refresh_job_board_stats();';
  END IF;
  PERFORM cron.alter_job(v_id, schedule => '*/30 * * * *', command => v_cmd);
END $$;

DO $$
DECLARE
  v_src text;
  v_n int;
  v_sched text;
  v_cmd text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('public.refresh_job_board_stats()');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'self-check: refresh_job_board_stats() does not exist';
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_src, 'GROUP BY source', 'g')) <> 1 THEN
    RAISE EXCEPTION 'self-check: refresh_job_board_stats() does not read the live postings by source exactly once';
  END IF;
  IF v_src !~ '''date_coverage''' OR v_src !~ '''desc_coverage''' OR v_src !~ '''freshness''' THEN
    RAISE EXCEPTION 'self-check: refresh_job_board_stats() no longer writes all three rows';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT count(*), max(j.schedule), max(j.command) INTO v_n, v_sched, v_cmd
    FROM cron.job j WHERE j.jobname = 'job-board-stats-rollup';
  IF v_n = 0 THEN
    RETURN;
  END IF;
  IF v_n > 1 OR v_sched <> '*/30 * * * *' THEN
    RAISE EXCEPTION 'self-check: job-board-stats-rollup is % job(s) on %, want one on */30 * * * *', v_n, v_sched;
  END IF;
  IF v_cmd !~ '^[[:space:]]*SET statement_timeout' THEN
    RAISE EXCEPTION 'self-check: job-board-stats-rollup command sets no statement_timeout: %', v_cmd;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
