-- A SECTION THAT HAS NEVER RENDERED, COSTING 26 SECONDS OF DATABASE TIME PER PAGE VIEW.
--
-- Measured 2026-08-10, as anon, against production:
--
--   get_transparent_employers(12)  ->  500, 57014, at 27.8s and 27.2s
--   (control: calling it with a bogus argument returns PGRST202 naming the
--    real signature, so the function exists and 57014 is genuine execution
--    failure rather than absence)
--
-- Explore fires that RPC live on every page load, inside the cache-hit branch,
-- and gates the "Transparent about pay" section on a non-empty array. The query
-- has never once returned, so the section has never once appeared — while the
-- prerendered HTML crawlers receive still names it as one of five collections
-- the page offers. Every visitor pays ~26s of a Postgres worker for a section
-- they will not see.
--
-- This is the same defect class the Ghost Job Index kept producing: the panel
-- fails closed and silently, so "broken" and "nothing to show" look identical.
--
-- THE FIX IS THE ONE THIS PROJECT HAS ALREADY MADE THREE TIMES THIS WEEK: move
-- the aggregate off the request path. refresh_explore_cache already computes
-- six collections on the hourly cron; transparent becomes the seventh. On the
-- cron it has a generous budget and nobody waiting, and Explore reads it from
-- the same single cached row it already reads — one fewer network call per page
-- view, not one more.
--
-- WRAPPED so a slow member cannot blank the rest. The cache is all-or-nothing
-- today: one failing collection would abort the whole INSERT and freeze every
-- section at its previous value with nothing saying so. transparent is the
-- known-slow one, so it gets its own exception boundary and degrades to an
-- empty array — the same "absence is not a measured zero" rule the UI applies,
-- pushed down to where the value is produced.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- Generous, because this runs on a timer with nobody waiting on it. The
-- request path is exactly what we are moving the work off.
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  transparent jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    -- 90s: comfortably past the 27s the request path could not afford, and far
    -- short of the whole refresh budget.
    SET LOCAL statement_timeout = '90s';
    SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      INTO transparent
      FROM public.get_transparent_employers(12) x;
  EXCEPTION WHEN OTHERS THEN
    -- Stays '[]' — the section hides, exactly as it does today, rather than
    -- taking the other six collections down with it.
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;

  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'reposters',(SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_repost_churn_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'segments', (SELECT coalesce(public.get_size_segments(), '{}'::jsonb)),
    'transparent', transparent,
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- Fill it once so the section can appear on the next page view rather than at
-- the next cron tick. Best effort: the cron is the backstop and a migration
-- must not fail over a stat recompute.
DO $$
BEGIN
  SET LOCAL statement_timeout = '4min';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'explore cache seed deferred to cron: %', SQLERRM;
END $$;
