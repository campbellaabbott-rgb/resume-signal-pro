CREATE OR REPLACE FUNCTION public.refresh_transparency_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3min'
AS $$
DECLARE
  payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'pay',       public.get_pay_transparency(),
    'coverage',  public.get_transparency_coverage(),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('transparency_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_transparency_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_transparency_cache() TO service_role;

CREATE OR REPLACE FUNCTION public.get_transparency_cache()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT v FROM public.job_board_meta WHERE k = 'transparency_cache';
$$;

GRANT EXECUTE ON FUNCTION public.get_transparency_cache() TO anon, authenticated;

COMMENT ON FUNCTION public.get_transparency_cache() IS
  'Hourly-computed Pay Transparency Index payload: {pay, coverage, computed_at}. The page reads this PK lookup; the aggregates behind it run only under cron. Never aggregate on the request path.';

REVOKE ALL ON FUNCTION public.get_pay_transparency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pay_transparency() TO service_role;
REVOKE ALL ON FUNCTION public.get_transparency_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_transparency_coverage() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'transparency-cache-hourly';
SELECT cron.schedule('transparency-cache-hourly', '37 * * * *', 'SELECT public.refresh_transparency_cache()');

SELECT public.refresh_transparency_cache();

NOTIFY pgrst, 'reload schema';