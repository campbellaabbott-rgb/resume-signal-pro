ALTER FUNCTION public.get_hiring_trends() SECURITY DEFINER;
ALTER FUNCTION public.get_trending_categories() SECURITY DEFINER;
ALTER FUNCTION public.get_takedowns_today() SECURITY DEFINER;
ALTER FUNCTION public.get_ghost_job_index_stats() SECURITY DEFINER;
ALTER FUNCTION public.get_hiring_trends() SET search_path = public;
ALTER FUNCTION public.get_trending_categories() SET search_path = public;
ALTER FUNCTION public.get_takedowns_today() SET search_path = public;
ALTER FUNCTION public.get_ghost_job_index_stats() SET search_path = public;