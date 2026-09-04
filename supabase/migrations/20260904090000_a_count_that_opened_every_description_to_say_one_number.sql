-- A COUNT THAT OPENED EVERY DESCRIPTION TO SAY ONE NUMBER.
--
-- 20260903210000 added desc_coverage to refresh_job_board_stats(): per source,
-- how many live postings carry a description the scorer would accept, written
-- as `count(*) FILTER (WHERE description IS NOT NULL AND length(description)
-- > 150)`. Reviewed the same day. Two defects, one predicate.
--
-- 1. THE COST. A character count on a UTF-8 database must fully detoast and
--    decompress the value — there is no shortcut through the varlena header
--    as there is for a single-byte encoding. Descriptions are stored up to
--    STORED_DESC_CAP (12,000 chars), so most live out of line in the TOAST
--    relation, and the block therefore read the whole TOAST relation of the
--    ~700k-row hot table every fifteen minutes — ninety-six times a day, in
--    competition with the serving path's buffer cache. The date_coverage
--    block beside it is heap-only (`count(posted_at)` is a null-bitmap test);
--    this one was a new order of magnitude of IO on the same table. And it
--    ran THIRD, in the tail of the one 4-minute statement budget the three
--    INSERTs share (cron in 20260806120000, budget in 20260812234500) — a
--    budget whose freshness scan was already measured hovering at the old
--    edge. Whenever freshness + date_coverage + this exceed four minutes,
--    this is the block QUERY_CANCELED takes: the warning fires every tick,
--    the desc_coverage row never lands (or freezes under an ageing
--    computed_at), and status serves descCoverage null with nothing that
--    says why. The 09-03 pglite validation checked semantics, not cost.
--
-- 2. THE DEFINITION. `> 150` is the scorer's threshold (fit-batch scores a
--    row only past it) — but no WRITER's. Every lane that fills descriptions
--    selects and guards on `.is("description", null)` and never clobbers a
--    stored one; short non-null descriptions do get stored (the list-ingest
--    write has no minimum, and the detail lanes' `.slice(0, DESC_CAP) ||
--    null` nulls only the empty string). So the stat counted "unswept" (the
--    sweep can fill it) together with "swept but short" (the sweep sees no
--    NULL there and cannot), and for a vendor whose list endpoint yields
--    short blurbs describedPct had a permanent floor that the lever it was
--    built to steer — kick the desc sweep — could not move.
--
-- DECISION: described = description IS NOT NULL. Same key, same shape, same
-- reader (status maps source/total/described unchanged); only the predicate
-- moves, and it moves to the sweep lanes' own selection, complemented — so
-- `total - described` per vendor IS the sweep's backlog, the number the
-- lever can move. A null test reads the heap tuple's bitmap and never
-- follows the TOAST pointer: the same cost class as date_coverage. What the
-- stat no longer promises is "scoreable" — a stored-but-short description
-- is a re-fetch lane's problem, and a figure that could not tell the two
-- apart was the wrong instrument for either. The review's cheaper exact
-- form (a bounded substring, then the count) was declined on the second
-- defect alone: cheaper, still a threshold no writer selects on.
--
-- Re-issued from the latest definition (20260903210000 — no later migration
-- redefines this function; checked, the 20260901090000 lesson). The
-- freshness and date_coverage blocks are byte-identical to it, and
-- the-scorer-in-its-own-isolate.test.ts pins that alongside the predicate.

CREATE OR REPLACE FUNCTION public.refresh_job_board_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'freshness',
      jsonb_build_object(
        'boards',   count(*),
        'p50_min',  round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY age_min))::numeric, 1),
        'p95_min',  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY age_min))::numeric, 1),
        'max_min',  round((max(age_min))::numeric, 1)
      ),
      now()
    FROM (
      SELECT EXTRACT(EPOCH FROM (now() - ver.verified_at)) / 60.0 AS age_min
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

  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'date_coverage',
      COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'dated', dated)
                         ORDER BY total DESC), '[]'::jsonb),
      now()
    FROM (
      SELECT source, count(*) AS total, count(posted_at) AS dated
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: date_coverage unavailable (%)', SQLERRM;
  END;

  -- Described = holds a stored description at all: the exact complement of
  -- what every sweep lane selects (description IS NULL), so total minus
  -- described per source is that source's sweep backlog. A null test reads
  -- the tuple's bitmap and never opens the value; the predicate it replaces
  -- counted characters, which detoasted every live description each tick.
  BEGIN
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at)
    SELECT
      'desc_coverage',
      COALESCE(jsonb_agg(jsonb_build_object('source', source, 'total', total, 'described', described)
                         ORDER BY total DESC), '[]'::jsonb),
      now()
    FROM (
      SELECT source,
             count(*) AS total,
             count(*) FILTER (WHERE description IS NOT NULL) AS described
      FROM public.job_board_postings
      WHERE missing_since IS NULL
      GROUP BY source
    ) s
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, computed_at = EXCLUDED.computed_at;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'stats rollup: desc_coverage unavailable (%)', SQLERRM;
  END;
END $$;

COMMENT ON FUNCTION public.refresh_job_board_stats() IS
  'Every-15-min rollup writer for freshness, date_coverage and desc_coverage. '
  'Each INSERT degrades independently — a timeout (QUERY_CANCELED, which WHEN '
  'OTHERS does not catch) or any other failure skips one row and leaves the '
  'previous value standing under its own older computed_at. desc_coverage '
  'since 2026-09-04: described = description IS NOT NULL, the sweep lanes'' '
  'own selection complemented, so total - described is the sweep backlog per '
  'source; a null test never detoasts. The 2026-09-03 character-count form '
  'read every live description each tick and measured a threshold no writer '
  'selects on.';

NOTIFY pgrst, 'reload schema';
