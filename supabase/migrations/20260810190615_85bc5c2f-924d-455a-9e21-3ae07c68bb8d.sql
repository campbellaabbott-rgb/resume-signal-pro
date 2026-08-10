CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  transparent jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    SET LOCAL statement_timeout = '90s';
    SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
      INTO transparent
      FROM public.get_transparent_employers(12) x;
  EXCEPTION WHEN OTHERS THEN
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

DO $$
BEGIN
  SET LOCAL statement_timeout = '4min';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'explore cache seed deferred to cron: %', SQLERRM;
END $$;