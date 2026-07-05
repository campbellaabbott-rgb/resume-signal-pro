-- Full-report cache: backend-only, 7-day expiry.
CREATE TABLE IF NOT EXISTS public.scan_report_cache (
  cache_key text PRIMARY KEY,
  report jsonb NOT NULL,
  engine_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scan_report_cache TO service_role;
ALTER TABLE public.scan_report_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS scan_report_cache_created_idx
  ON public.scan_report_cache (created_at);

-- Nightly purge at 04:10 UTC: expired cache entries plus old rate-limit and telemetry rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-cache-and-telemetry-purge') THEN
    PERFORM cron.schedule(
      'scan-cache-and-telemetry-purge',
      '10 4 * * *',
      $job$
      DELETE FROM public.scan_report_cache WHERE created_at < now() - interval '7 days';
      DELETE FROM public.rate_limits WHERE window_start < now() - interval '3 days';
      DELETE FROM public.detection_telemetry WHERE created_at < now() - interval '90 days';
      DELETE FROM public.pro_grants WHERE consumed_at IS NOT NULL AND consumed_at < now() - interval '90 days';
      $job$
    );
  END IF;
END $$;

-- Real score distributions from completed scan corpus.
CREATE OR REPLACE FUNCTION public.get_real_score_distribution(p_industry text)
RETURNS TABLE (n bigint, median numeric, p25 numeric, p75 numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::bigint AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY response_score)::numeric AS median,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY response_score)::numeric AS p25,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY response_score)::numeric AS p75
  FROM public.scan_metrics
  WHERE response_score IS NOT NULL
    AND response_score BETWEEN 1 AND 100
    AND status = 'completed'
    AND created_at > now() - interval '180 days'
    AND metadata->>'industry' = p_industry;
$$;
GRANT EXECUTE ON FUNCTION public.get_real_score_distribution(text) TO service_role;

-- Pro workspace: tie each tracked application to the resume scan/version used.
ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS scan_id uuid REFERENCES public.user_scans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS user_applications_scan_idx
  ON public.user_applications (scan_id);

-- Fix industry correction logging against the live table schema.
CREATE OR REPLACE FUNCTION public.log_industry_correction(
  p_detected text,
  p_corrected text,
  p_source text DEFAULT NULL,
  p_confidence text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_detected IS NULL OR p_corrected IS NULL
     OR length(p_detected) > 50 OR length(p_corrected) > 50
     OR p_detected = p_corrected THEN
    RETURN;
  END IF;

  INSERT INTO public.industry_corrections (original_industry, corrected_industry, detection_source, original_confidence)
  VALUES (lower(trim(p_detected)), lower(trim(p_corrected)), left(p_source, 60), left(p_confidence, 20));
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_industry_correction(text, text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_industry_correction_stats(integer);
CREATE FUNCTION public.get_industry_correction_stats(p_days integer DEFAULT 7)
RETURNS TABLE (detected text, corrected text, corrections bigint, last_seen timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT original_industry AS detected,
         corrected_industry AS corrected,
         count(*) AS corrections,
         max(created_at) AS last_seen
  FROM public.industry_corrections
  WHERE created_at > now() - make_interval(days => p_days)
  GROUP BY original_industry, corrected_industry
  ORDER BY corrections DESC, last_seen DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.get_industry_correction_stats(integer) TO service_role;

-- Global AI-scan concurrency control.
CREATE TABLE IF NOT EXISTS public.scan_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scan_slots TO service_role;
ALTER TABLE public.scan_slots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.acquire_scan_slot(p_max integer, p_ttl_seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(874231);
  DELETE FROM public.scan_slots WHERE started_at < now() - make_interval(secs => p_ttl_seconds);
  IF (SELECT count(*) FROM public.scan_slots) >= p_max THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.scan_slots DEFAULT VALUES RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_scan_slot(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.scan_slots WHERE id = p_id;
$$;
GRANT EXECUTE ON FUNCTION public.acquire_scan_slot(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_scan_slot(uuid) TO service_role;