-- Bug sweep: (1) get_date_coverage was returning 500 — it lacked the
-- statement_timeout guard the other stats functions have, so its full-table
-- GROUP BY over 557k rows hit the anon role's short cap and cancelled
-- (57014). The Ghost Job Index date-provenance table silently showed nothing.
-- (2) The public data-page aggregates are slow — measured live:
-- get_hiring_trends ~10.9s, get_entry_level_stats ~11.9s, ghost_stats ~4.9s,
-- trending_categories ~3.9s — the same per-visit full-scan waste the Explore
-- cache just fixed. Cache them all in one meta row, hourly, read fast.

-- (1) Immediate fix: give get_date_coverage the same timeout guard so it
-- returns instead of 500 (even before the cache populates / on fallback).
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

-- (2) Stats cache for the slow public-page aggregates. Runs under cron (no
-- anon timeout), stores one JSON row; pages read it in <0.5s with a live
-- fallback. No CREATE INDEX; nothing on the board serving path.
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

-- Refresh hourly (minute 12). No synchronous populate: the combined compute
-- is ~35s (too long for one migration statement), and the pages fall back to
-- the live RPCs — which now all return (date_coverage no longer 500s) — until
-- the first cron run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-stats-cache') THEN
    PERFORM cron.schedule('refresh-stats-cache', '12 * * * *', 'SELECT public.refresh_stats_cache();');
  END IF;
END $$;
