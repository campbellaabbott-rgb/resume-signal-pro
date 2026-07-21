CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  GROUP BY source
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_stats_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'ghost_stats',          (SELECT row_to_json(x) FROM public.get_ghost_job_index_stats() x LIMIT 1),
    'date_coverage',        (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_date_coverage() x),
    'entry_stats',          (SELECT row_to_json(x) FROM public.get_entry_level_stats() x LIMIT 1),
    'entry_companies',      (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(25) x),
    'hiring_trends',        (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_hiring_trends() x),
    'trending_categories',  (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_categories() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('stats_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_stats_cache()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT v FROM public.job_board_meta WHERE k = 'stats_cache'; $$;
GRANT EXECUTE ON FUNCTION public.get_stats_cache() TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.schedule('refresh-stats-cache', '12 * * * *', 'SELECT public.refresh_stats_cache();');
  END IF;
END $$;