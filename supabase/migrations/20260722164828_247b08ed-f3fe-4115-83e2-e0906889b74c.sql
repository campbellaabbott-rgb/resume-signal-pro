-- Board activity strip: "N taken down today" — the counterpart to the hero's
-- posted-today count. Cheap indexed count over the closure log (closed_at
-- index exists); non-superseded only, so re-listings don't inflate it. The
-- strip's other two numbers already exist (posted-today from the list
-- response, median re-check age from get_freshness_stats).

CREATE OR REPLACE FUNCTION public.get_takedowns_today()
RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT count(*)::int FROM public.job_board_closures
  WHERE closed_at >= date_trunc('day', now()) AND NOT superseded;
$$;
GRANT EXECUTE ON FUNCTION public.get_takedowns_today() TO anon, authenticated;