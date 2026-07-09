
-- Re-apply the four missing RPCs + the versions/outcomes migration.
-- All idempotent (CREATE OR REPLACE / IF NOT EXISTS).

-- 1) get_industry_score_benchmark
CREATE OR REPLACE FUNCTION public.get_industry_score_benchmark(
  p_industry TEXT,
  p_score INTEGER,
  p_days_back INTEGER DEFAULT 90,
  p_min_sample_size INTEGER DEFAULT 25
)
RETURNS TABLE (industry_avg NUMERIC, percentile NUMERIC, sample_size BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sample_size BIGINT; v_avg NUMERIC; v_below_or_equal BIGINT;
BEGIN
  SELECT COUNT(*), AVG(response_score) INTO v_sample_size, v_avg
  FROM scan_metrics
  WHERE status = 'completed' AND scan_type = 'free' AND response_score IS NOT NULL
    AND metadata->>'industry' = p_industry
    AND created_at > now() - (p_days_back || ' days')::INTERVAL;
  IF v_sample_size IS NULL OR v_sample_size < p_min_sample_size THEN
    RETURN QUERY SELECT NULL::NUMERIC, NULL::NUMERIC, COALESCE(v_sample_size, 0);
    RETURN;
  END IF;
  SELECT COUNT(*) INTO v_below_or_equal
  FROM scan_metrics
  WHERE status = 'completed' AND scan_type = 'free' AND response_score IS NOT NULL
    AND response_score <= p_score AND metadata->>'industry' = p_industry
    AND created_at > now() - (p_days_back || ' days')::INTERVAL;
  RETURN QUERY SELECT v_avg, ROUND((v_below_or_equal::NUMERIC / v_sample_size::NUMERIC) * 100, 0), v_sample_size;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_scan_metrics_industry_lookup
  ON public.scan_metrics ((metadata->>'industry'))
  WHERE status = 'completed' AND scan_type = 'free';

-- 2) get_public_scan_insights
CREATE OR REPLACE FUNCTION public.get_public_scan_insights()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  with base as (
    select response_score as score,
           nullif(metadata->>'industry', '') as industry,
           nullif(metadata->>'experienceLevel', '') as experience_level
    from public.scan_metrics
    where status = 'completed' and scan_type <> 'heartbeat'
      and response_score between 1 and 100
      and created_at > now() - interval '180 days'
  ),
  overall as (
    select count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median,
      round(percentile_cont(0.25) within group (order by score)::numeric) as p25,
      round(percentile_cont(0.75) within group (order by score)::numeric) as p75,
      count(*) filter (where score >= 80) as n_80_plus,
      count(*) filter (where score < 50) as n_under_50
    from base
  ),
  hist as (
    select least(floor(score / 10.0) * 10, 90)::int as bucket, count(*) as n
    from base group by 1
  ),
  industries as (
    select industry, count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median,
      round(percentile_cont(0.25) within group (order by score)::numeric) as p25,
      round(percentile_cont(0.75) within group (order by score)::numeric) as p75
    from base where industry is not null
    group by industry having count(*) >= 25
    order by count(*) desc limit 20
  ),
  experience as (
    select experience_level, count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median
    from base where experience_level is not null
    group by experience_level having count(*) >= 25
  )
  select jsonb_build_object(
    'as_of', to_char(now(), 'YYYY-MM-DD'), 'window_days', 180,
    'overall', (select jsonb_build_object('n',n,'median',median,'p25',p25,'p75',p75,
       'pct_80_plus', case when n>0 then round(100.0*n_80_plus/n,1) end,
       'pct_under_50', case when n>0 then round(100.0*n_under_50/n,1) end) from overall),
    'histogram', (select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'n',n) order by bucket),'[]'::jsonb) from hist),
    'industries', (select coalesce(jsonb_agg(jsonb_build_object('industry',industry,'n',n,'median',median,'p25',p25,'p75',p75) order by n desc),'[]'::jsonb) from industries),
    'experience', (select coalesce(jsonb_agg(jsonb_build_object('level',experience_level,'n',n,'median',median) order by n desc),'[]'::jsonb) from experience)
  );
$$;
REVOKE ALL ON FUNCTION public.get_public_scan_insights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_scan_insights() TO anon, authenticated, service_role;

-- 3) get_scan_totals (final version — counts conducted)
CREATE OR REPLACE FUNCTION public.get_scan_totals()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select jsonb_build_object(
    'total_scans', count(*),
    'countries', count(distinct ip_country) filter (where ip_country is not null and ip_country <> 'Unknown')
  )
  from public.scan_metrics
  where scan_type in ('free', 'free-stream', 'paid');
$$;
REVOKE ALL ON FUNCTION public.get_scan_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_scan_totals() TO anon, authenticated, service_role;

-- 4) versions + outcomes
ALTER TABLE public.user_scans
  ADD COLUMN IF NOT EXISTS resume_text text,
  ADD COLUMN IF NOT EXISTS report_id text;

ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS job_posting text,
  ADD COLUMN IF NOT EXISTS fit_pct int,
  ADD COLUMN IF NOT EXISTS fit_missing jsonb;

CREATE TABLE IF NOT EXISTS public.scan_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('interview', 'no_response', 'rejected')),
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, ip_hash)
);
GRANT ALL ON public.scan_outcomes TO service_role;
ALTER TABLE public.scan_outcomes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_scan_outcome(
  p_report_id text, p_outcome text, p_ip text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_allowed boolean;
BEGIN
  IF p_report_id IS NULL OR length(p_report_id) < 6 OR length(p_report_id) > 64 THEN
    RETURN false;
  END IF;
  SELECT public.check_rate_limit('scan-outcome', coalesce(p_ip, 'unknown'), 5, 1440) INTO v_allowed;
  IF v_allowed IS DISTINCT FROM true THEN RETURN false; END IF;
  INSERT INTO public.scan_outcomes (report_id, outcome, ip_hash)
  VALUES (upper(p_report_id), p_outcome, md5(coalesce(p_ip, 'unknown')))
  ON CONFLICT (report_id, ip_hash)
  DO UPDATE SET outcome = excluded.outcome, created_at = now();
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_scan_outcome(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_scan_outcome(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_email_delayed(
  queue_name TEXT, payload JSONB, delay_seconds INT
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload, delay_seconds);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload, delay_seconds);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email_delayed(TEXT, JSONB, INT) TO service_role;

-- Reload PostgREST schema cache so the new RPCs are immediately callable
NOTIFY pgrst, 'reload schema';
