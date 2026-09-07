-- A TIMEOUT THAT DELETES A SECTION AND LEAVES NO MARK IS AN OUTAGE NOBODY SEES.
--
-- get_actively_hiring_companies returns 57014 today. The page does not show an
-- error, because refresh_explore_cache catches it -- and then, alone among its
-- eight collections, throws the previous answer away:
--
--     WHEN QUERY_CANCELED THEN
--     hiring_rows := '[]'::jsonb; hiring_n := 0;
--
-- No `stale := stale || 'hiring'`, no COALESCE onto the previous payload. The
-- other five handlers were given both in 20260812210000; this one was missed.
-- The consequences compound in exactly the wrong direction:
--
--   * `hiring` becomes [], so /explore's flagship section renders nothing --
--     and until the change that lands beside this one, not even a heading.
--   * `hiring_n` becomes 0, so NULLIF strips the key, so the denominator
--     sentence under the section disappears with it.
--   * `stale_parts` never names 'hiring', so the page's own staleness banner --
--     which reads that array and has no other source -- cannot report the one
--     collection that failed. The reader is shown "Measured <time>, refreshed
--     hourly" over a section that was not measured at all.
--
-- So the single most likely failure of the most prominent answer on the page is
-- also its most invisible one. Every other collection degrades to LAST GOOD
-- DATA, LABELLED STALE. This one degrades to silence.
--
-- WHY IT MATTERS MORE NOW, NOT LESS. 20260907010000 rewrites
-- get_actively_hiring_companies to rank on the cumulative-incidence fill rate,
-- which means it now calls get_company_fill_curve inside its own statement.
-- That call is bounded there, but the whole point of bounding it was that this
-- handler is where a miss lands -- and a miss that lands here today is erased.
-- Deploy this one first if the two are separated: a page that can say "the
-- hiring answer could not be recomputed" is strictly safer than a page that
-- deletes the answer and says nothing.
--
-- WHAT IS AND IS NOT CHANGED. The function is re-issued VERBATIM from
-- 20260812230000 apart from the six lines in the hiring EXCEPTION block. Every
-- other collection, the totals assembly, the payload keys, the two grants and
-- the 15-minute budget are byte-identical, because ~12 guards across
-- explore-claims.test.ts and instrument-recovery.test.ts pin literal spellings
-- in this body and a re-typed copy is how those go quietly false.
--
-- The `::text` cast on the append is not style. `stale || 'hiring'` is
-- `anyarray || anyunknown`, which cannot resolve, and it would raise INSIDE the
-- EXCEPTION block -- turning a recoverable collection failure into a failure of
-- the entire refresh, i.e. every collection stale instead of one.
--
-- hiring_n is restored from the previous payload rather than zeroed. Zero is
-- not "unknown": NULLIF(hiring_n, 0) strips the key, the page renders its
-- denominator only when the key exists, and the sentence explaining what the
-- twelve cards are a slice OF would vanish while the cards themselves were
-- served from the previous run.

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  payload jsonb;
  stale text[] := '{}';
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
  hiring_rows jsonb := '[]'::jsonb;
  hiring_n int := 0;
  repost_rows jsonb := '[]'::jsonb;
  repost_pool_n int := 0;
  repost_idx jsonb := '{}'::jsonb;
  denom jsonb := '{}'::jsonb;
  totals jsonb;
  trending_v jsonb;
  newest_v jsonb;
  entry_v jsonb;
  salary_v jsonb;
  segments_v jsonb;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_cache';

  BEGIN
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO hiring_rows, hiring_n
    FROM (SELECT to_jsonb(h) AS j, row_number() OVER () AS rn
          FROM public.get_actively_hiring_companies(2000) h) r;
  EXCEPTION
    -- CARRY FORWARD AND SAY SO. The two lines this handler was missing, in the
    -- spelling the other five use. `::text` on the append is load-bearing:
    -- `stale || 'hiring'` is `anyarray || anyunknown` and the handler would die
    -- inside its own EXCEPTION block, which is the worst place in this function
    -- to raise. hiring_n comes back out of the previous payload rather than
    -- being zeroed, because NULLIF(hiring_n, 0) strips the key and the page
    -- renders its denominator sentence only when the key is present -- so a
    -- zero here deletes the sentence that explains the twelve cards being
    -- served from the last good run.
    WHEN QUERY_CANCELED THEN
    stale := stale || 'hiring'::text;
    hiring_rows := COALESCE(prev -> 'hiring', '[]'::jsonb);
    hiring_n := COALESCE((prev #>> '{totals,hiring_n}')::int, 0);
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'hiring'::text;
    hiring_rows := COALESCE(prev -> 'hiring', '[]'::jsonb);
    hiring_n := COALESCE((prev #>> '{totals,hiring_n}')::int, 0);
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO repost_rows, repost_pool_n
    FROM (SELECT to_jsonb(c) AS j, row_number() OVER () AS rn
          FROM public.get_repost_churn_companies(9000) c) r;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
  END;

  BEGIN
    repost_idx := COALESCE(public.get_repost_index(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
  END;

  BEGIN
    denom := COALESCE(public.get_explore_denominators(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
  END;

  -- THE FIVE THAT WERE NEVER WRAPPED. Any one of them dying under load —
  -- get_salary_benchmarks at its 20s budget was enough today — killed the
  -- whole refresh and the hour's write. Each now degrades to the previous
  -- row's value and is named in stale_parts, exactly like stats_cache.
  BEGIN
    trending_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'trending'::text;
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'trending'::text;
    trending_v := COALESCE(prev -> 'trending', '[]'::jsonb);
  END;
  BEGIN
    newest_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'newest'::text;
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'newest'::text;
    newest_v := COALESCE(prev -> 'newest', '[]'::jsonb);
  END;
  BEGIN
    entry_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
  END;
  BEGIN
    salary_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
  END;
  BEGIN
    segments_v := (SELECT coalesce(public.get_size_segments(), '{}'::jsonb));
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'segments'::text;
    segments_v := COALESCE(prev -> 'segments', '{}'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'segments'::text;
    segments_v := COALESCE(prev -> 'segments', '{}'::jsonb);
  END;

  totals := (denom - 'fields') || jsonb_strip_nulls(jsonb_build_object(
    'hiring_n',        NULLIF(hiring_n, 0),
    'repost_pool_n',   NULLIF(repost_pool_n, 0),
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0)
  ));

  payload := jsonb_build_object(
    'trending', trending_v,
    'newest',   newest_v,
    'entry',    entry_v,
    'hiring',   hiring_rows,
    'reposters', repost_rows,
    'salary',   salary_v,
    'segments', segments_v,
    'transparent', transparent,
    'transparent_status', transparent_status,
    'repost_index', repost_idx,
    'fields', COALESCE(denom -> 'fields', '{}'::jsonb),
    'totals', totals,
    'stale_parts', to_jsonb(stale),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

NOTIFY pgrst, 'reload schema';
