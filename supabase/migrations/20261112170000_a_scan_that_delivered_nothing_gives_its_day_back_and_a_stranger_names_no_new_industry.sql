-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- A SCAN THAT DELIVERED NOTHING GIVES ITS DAY BACK, AND A STRANGER NAMES NO
-- NEW INDUSTRY (bug round 2026-11-12, lane free-scan-engine).
--
-- 1. give_back_scan_day (S14X-043). The free scan counts the day's slot
--    (check_rate_limit, 7 a day, 15 signed in) before the model writes the
--    report, and nothing ever gave it back: a 5xx, a "Service busy", a
--    rule-based report from a model that did not answer, each cost one of the
--    seven, and the page's backup scan counted the day again under the same
--    name, so one failed scan cost two. The scanners now call this on every
--    exit that delivered no full report. It takes one back from the row the
--    day was counted on, never below zero and only inside the day's window,
--    and only for the free scan's own name. The service role alone runs it:
--    a stranger who could call it would have an unlimited day.
--
-- 2. is_scan_industry and both log_industry_correction overloads (S14X-046).
--    The correction log is open to the publishable key, and it took any label
--    of fifty characters or fewer: "zz-not-an-industry" was stored, the
--    primary scanner loaded thirty days of rows unfiltered and introduced the
--    label as an industry, and the backup scanner put it in its prompt as a
--    "known misclassification pattern". A label is now one the scanner or the
--    correction menu knows (the detector's industries, src/config/scan-
--    industries.ts, and the menu's values, supabase/functions/_shared/
--    correction-menu-industries.ts, compared in lower case because the
--    four-argument call stores lower case), and the two labels differ; a
--    call that fails either returns before client_write_allowed, so it writes
--    nothing, the address's budget included.
--
-- 3. get_industry_correction_stats leaves out the rows it should never have
--    counted: unknown labels, original = corrected, and detection_source
--    'user_confirmed' (a confirmation, not a correction).
--
-- 4. get_scan_totals (S14X-145) leaves out reports replayed from the cache:
--    the backup scanner logs a cache replay as a completed scan, so one
--    analysis counted once per replay. Its answer names what it counts in a
--    "basis" key. Same signature and return type (jsonb); the substrings the
--    20261103190000 self-check reads are kept.
--
-- 5. get_scan_health_status (RC-OI-04) counts a report the model failed to
--    write apart from a success. The primary logs it as status 'completed'
--    with error_code 'MODEL_FALLBACK'; the health reader counted it as a
--    success, so a scanner whose every report was rule-based read green. A
--    column, model_fallback_last_hour, is APPENDED (so readers that take the
--    columns they know are unchanged), success leaves those rows out, and an
--    issue line names them. A changed return type needs DROP and CREATE; the
--    grants are restated as 20261011200000 left them (anon reads it on
--    purpose: the ScanMetrics page and post-publish-smoke carry only the
--    publishable key, and it returns aggregates).
--
-- log_scan_metric is not redefined: the scanner passes p_error_code, which it
-- already takes. Safe to re-run: CREATE OR REPLACE, DROP IF EXISTS, then
-- REVOKE and GRANT by name. The DO block at the end checks the catalogue and
-- runs each function inside a block it rolls back.

SET LOCAL statement_timeout = '2min';

-- 1. The day's slot, given back ------------------------------------------------

CREATE OR REPLACE FUNCTION public.give_back_scan_day(p_ip text, p_function text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_ip IS NULL OR length(p_ip) > 45 OR p_function IS DISTINCT FROM 'free-keyword-scan' THEN
    RETURN false;
  END IF;
  UPDATE public.rate_limits
     SET request_count = request_count - 1
   WHERE ip_address = p_ip
     AND function_name = p_function
     AND request_count > 0
     AND window_start >= now() - interval '1440 minutes';
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.give_back_scan_day(text, text) IS
  'One of the free scan''s daily slots back (decrement by 1, floor 0, inside the 1440-minute window), '
  'for a scan that delivered no full report. free-keyword-scan only; service role only (20261112170000, S14X-043).';

REVOKE ALL ON FUNCTION public.give_back_scan_day(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.give_back_scan_day(text, text) TO service_role;

-- 2. The labels a correction may name ---------------------------------------

CREATE OR REPLACE FUNCTION public.is_scan_industry(p_label text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(coalesce(p_label, ''))) = ANY (ARRAY[
    'academia', 'administrative', 'agriculture', 'architecture', 'aviation', 'beauty', 'biotech',
    'business_development', 'businessintelligence', 'channel_sales', 'childcare', 'clergy',
    'clinicalresearch', 'cloudsecurity', 'construction_management', 'consulting',
    'contentstrategy', 'creative', 'culinary', 'customer_success', 'customerservice',
    'customersuccess', 'cybersecurity', 'data_engineering', 'data_science', 'dataengineering',
    'dataprivacy', 'datascience', 'dental', 'design', 'devrel', 'ecommerce', 'education', 'energy',
    'engineering', 'entertainment', 'environmental', 'event_planning', 'eventmanagement',
    'finance', 'fitness', 'gaming', 'general', 'government', 'growthmarketing', 'healthcare',
    'hospitality', 'hr', 'humanresources', 'inside_sales', 'insurance', 'investmentbanking',
    'janitorial', 'landscaping', 'law_enforcement', 'legal', 'library', 'logistics',
    'machine_learning', 'manufacturing', 'maritime', 'marketing', 'media', 'mining',
    'mlengineering', 'nonprofit', 'operations', 'pharmacy', 'platformengineering',
    'product_management', 'productanalytics', 'productdesign', 'projectmanagement',
    'quantitativefinance', 'real_estate', 'realestate', 'retail', 'revenueoperations', 'sales',
    'sales_engineering', 'sales_operations', 'securityengineering', 'skilled_trades',
    'social_work', 'solutionsarchitecture', 'sports_management', 'sportsmanagement', 'sre',
    'strategic_accounts', 'supplychainanalytics', 'technicalprogrammanagement', 'technicalwriting',
    'technology', 'telecom', 'translation', 'uxresearch', 'veterinary'
  ]::text[]);
$$;

COMMENT ON FUNCTION public.is_scan_industry(text) IS
  'True for an industry the scanner (src/config/scan-industries.ts) or the correction menu '
  '(_shared/correction-menu-industries.ts) can name, in lower case (20261112170000, S14X-046).';

REVOKE ALL ON FUNCTION public.is_scan_industry(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_scan_industry(text) TO service_role;

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
  -- Known labels that differ, before the budget is spent (S14X-046).
  IF NOT public.is_scan_industry(p_detected) OR NOT public.is_scan_industry(p_corrected)
     OR lower(btrim(p_detected)) = lower(btrim(p_corrected)) THEN
    RETURN;
  END IF;
  IF NOT public.client_write_allowed('industry-correction', 20, 300, 60) THEN
    RETURN;
  END IF;
  INSERT INTO public.industry_corrections (original_industry, corrected_industry, detection_source, original_confidence)
  VALUES (lower(trim(p_detected)), lower(trim(p_corrected)), left(p_source, 60), left(p_confidence, 20));
END;
$$;

REVOKE ALL ON FUNCTION public.log_industry_correction(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_industry_correction(text, text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_industry_correction(
  p_original_industry TEXT,
  p_corrected_industry TEXT,
  p_original_confidence TEXT DEFAULT NULL,
  p_detection_source TEXT DEFAULT NULL,
  p_resume_text_length INTEGER DEFAULT NULL,
  p_server_signals TEXT[] DEFAULT NULL,
  p_ai_suggested_industry TEXT DEFAULT NULL,
  p_visitor_id TEXT DEFAULT NULL,
  p_ip_country TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_original_industry IS NULL OR p_corrected_industry IS NULL
     OR length(p_original_industry) > 50 OR length(p_corrected_industry) > 50 THEN
    RETURN NULL;
  END IF;
  -- Known labels that differ, before the budget is spent (S14X-046).
  IF NOT public.is_scan_industry(p_original_industry) OR NOT public.is_scan_industry(p_corrected_industry)
     OR lower(btrim(p_original_industry)) = lower(btrim(p_corrected_industry)) THEN
    RETURN NULL;
  END IF;
  IF NOT public.client_write_allowed('industry-correction', 20, 300, 60) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.industry_corrections (
    original_industry,
    corrected_industry,
    original_confidence,
    detection_source,
    resume_text_length,
    server_signals,
    ai_suggested_industry,
    visitor_id,
    ip_country
  ) VALUES (
    p_original_industry,
    p_corrected_industry,
    left(p_original_confidence, 20),
    left(p_detection_source, 60),
    CASE WHEN p_resume_text_length BETWEEN 0 AND 1000000 THEN p_resume_text_length END,
    ARRAY(SELECT left(s, 60) FROM unnest(p_server_signals[1:20]) AS s),
    left(p_ai_suggested_industry, 50),
    left(p_visitor_id, 64),
    left(p_ip_country, 8)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_industry_correction(text, text, text, text, integer, text[], text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_industry_correction(text, text, text, text, integer, text[], text, text, text) TO anon, authenticated, service_role;

-- 3. The digest's pairs -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_industry_correction_stats(p_days integer DEFAULT 7)
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
    AND public.is_scan_industry(original_industry)
    AND public.is_scan_industry(corrected_industry)
    AND lower(btrim(original_industry)) <> lower(btrim(corrected_industry))
    AND detection_source IS DISTINCT FROM 'user_confirmed'
  GROUP BY original_industry, corrected_industry
  ORDER BY corrections DESC, last_seen DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_industry_correction_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_industry_correction_stats(integer) TO anon, authenticated, service_role;

-- 4. The public total, without cache replays --------------------------------

CREATE OR REPLACE FUNCTION public.get_scan_totals()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select jsonb_build_object(
    'total_scans', count(*),
    'countries', count(distinct ip_country) filter (where ip_country is not null and ip_country <> 'Unknown'),
    'basis', 'analyses the scanner completed (scan_metrics status completed, scan_type free, free-stream or paid), reports replayed from the cache not counted'
  )
  from public.scan_metrics
  where scan_type in ('free', 'free-stream', 'paid')
    and status = 'completed'
    and not coalesce(cache_hit, false);
$$;

COMMENT ON FUNCTION public.get_scan_totals() IS
  'The scanner''s public total: analyses it completed (scan_metrics status completed), '
  'scan_type in (free, free-stream, paid), cache replays not counted, with the count of countries over the same rows '
  'and a basis naming what is counted (20261112170000, S14X-145; 20261103190000, S13-087). Aggregates only.';

REVOKE ALL ON FUNCTION public.get_scan_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_totals() TO anon, authenticated, service_role;

-- 5. The health reader, with model fallbacks apart ---------------------------

DROP FUNCTION IF EXISTS public.get_scan_health_status();

CREATE FUNCTION public.get_scan_health_status()
RETURNS TABLE (
  status TEXT,
  last_successful_scan TIMESTAMP WITH TIME ZONE,
  scans_last_hour BIGINT,
  success_rate_last_hour NUMERIC,
  avg_latency_last_hour NUMERIC,
  last_heartbeat_status TEXT,
  last_heartbeat_time TIMESTAMP WITH TIME ZONE,
  issues TEXT[],
  model_fallback_last_hour BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_issues TEXT[] := '{}';
  v_success_rate NUMERIC;
  v_avg_latency NUMERIC;
  v_scans_count BIGINT;
  v_completed BIGINT;
  v_fallbacks BIGINT;
  v_last_success TIMESTAMP WITH TIME ZONE;
  v_heartbeat_status TEXT;
  v_heartbeat_time TIMESTAMP WITH TIME ZONE;
  v_heartbeat_age INTEGER;
  v_overall_status TEXT := 'healthy';
BEGIN
  -- Visitors' scans only: the heartbeat's own probe and our scripts'
  -- synthetic scans are not anyone's résumé. A completed row the model did
  -- not write (error_code MODEL_FALLBACK) is not a success.
  SELECT count(*),
         count(*) FILTER (WHERE sm.status = 'completed' AND sm.error_code IS DISTINCT FROM 'MODEL_FALLBACK'),
         count(*) FILTER (WHERE sm.status = 'completed' AND sm.error_code = 'MODEL_FALLBACK'),
         round((count(*) FILTER (WHERE sm.status = 'completed' AND sm.error_code IS DISTINCT FROM 'MODEL_FALLBACK'))::numeric / NULLIF(count(*), 0) * 100, 2),
         round(avg(sm.duration_ms)::numeric, 0)
    INTO v_scans_count, v_completed, v_fallbacks, v_success_rate, v_avg_latency
    FROM public.scan_metrics sm
   WHERE sm.created_at > now() - interval '1 hour'
     AND sm.scan_type IN ('free', 'free-stream', 'paid');

  SELECT sm.created_at INTO v_last_success
    FROM public.scan_metrics sm
   WHERE sm.status = 'completed'
     AND sm.error_code IS DISTINCT FROM 'MODEL_FALLBACK'
     AND sm.scan_type IN ('free', 'free-stream', 'paid')
   ORDER BY sm.created_at DESC
   LIMIT 1;

  SELECT hr.status, hr.created_at INTO v_heartbeat_status, v_heartbeat_time
    FROM public.heartbeat_results hr
   WHERE hr.function_name = 'free-keyword-scan'
   ORDER BY hr.created_at DESC
   LIMIT 1;

  IF v_success_rate IS NOT NULL AND v_success_rate < 90 THEN
    v_issues := array_append(v_issues, 'Visitor scan success below 90%: ' || v_success_rate || '% of ' || v_scans_count);
    v_overall_status := 'degraded';
  END IF;

  IF v_success_rate IS NOT NULL AND v_success_rate < 50 THEN
    v_overall_status := 'critical';
  END IF;

  IF v_scans_count > 0 AND v_completed = 0 THEN
    v_issues := array_append(v_issues, 'Every visitor scan in the last hour failed (' || v_scans_count || ')');
    v_overall_status := 'critical';
  END IF;

  IF COALESCE(v_fallbacks, 0) > 0 THEN
    v_issues := array_append(v_issues, 'Model fallback: ' || v_fallbacks || ' of ' || v_scans_count || ' visitor scans in the last hour were rule-based reports the model did not write');
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  IF v_avg_latency IS NOT NULL AND v_avg_latency > 30000 THEN
    v_issues := array_append(v_issues, 'High visitor scan latency: ' || v_avg_latency || 'ms');
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  IF v_heartbeat_status IS NOT NULL AND v_heartbeat_status <> 'healthy' THEN
    v_issues := array_append(v_issues, 'Last heartbeat: ' || v_heartbeat_status);
    IF v_overall_status = 'healthy' THEN v_overall_status := 'degraded'; END IF;
  END IF;

  -- The dead-man: the heartbeat runs every ten minutes, so 30 is three missed runs.
  v_heartbeat_age := CASE WHEN v_heartbeat_time IS NULL THEN NULL
                          ELSE floor(extract(epoch FROM (now() - v_heartbeat_time)) / 60)::integer END;
  IF v_heartbeat_time IS NULL THEN
    v_issues := array_append(v_issues, 'Heartbeat has never run');
    v_overall_status := 'critical';
  ELSIF v_heartbeat_age > 30 THEN
    v_issues := array_append(v_issues, 'Heartbeat has not run for ' || v_heartbeat_age || ' min');
    v_overall_status := 'critical';
  END IF;

  RETURN QUERY SELECT
    v_overall_status,
    v_last_success,
    COALESCE(v_scans_count, 0),
    COALESCE(v_success_rate, 0),
    COALESCE(v_avg_latency, 0),
    v_heartbeat_status,
    v_heartbeat_time,
    v_issues,
    COALESCE(v_fallbacks, 0);
END;
$$;

COMMENT ON FUNCTION public.get_scan_health_status() IS
  'Visitor scans (free, free-stream, paid) over the last hour, the newest successful one, the last heartbeat and its age: '
  'a heartbeat older than 30 minutes is critical (the dead-man check-alerts reads). A completed row with error_code '
  'MODEL_FALLBACK is counted in model_fallback_last_hour, not as a success (20261112170000, RC-OI-04). Aggregates only; '
  'anon-callable for the ScanMetrics page and post-publish-smoke (20261011200000).';

REVOKE ALL ON FUNCTION public.get_scan_health_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_health_status() TO anon, authenticated, service_role;

-- Self-verifying: the catalogue first, then each function inside a block
-- that is rolled back, so nothing it writes stays.
DO $verify$
DECLARE
  v_give regprocedure := to_regprocedure('public.give_back_scan_day(text, text)');
  v_known regprocedure := to_regprocedure('public.is_scan_industry(text)');
  v_log4 regprocedure := to_regprocedure('public.log_industry_correction(text, text, text, text)');
  v_log9 regprocedure := to_regprocedure('public.log_industry_correction(text, text, text, text, integer, text[], text, text, text)');
  v_stats regprocedure := to_regprocedure('public.get_industry_correction_stats(integer)');
  v_totals regprocedure := to_regprocedure('public.get_scan_totals()');
  v_health regprocedure := to_regprocedure('public.get_scan_health_status()');
  v_src text;
  v_counts int[];
  v_corr_before bigint;
  v_corr_after bigint;
  v_totals_before bigint;
  v_totals_after bigint;
  v_fb_before bigint;
  v_fb_after bigint;
  v_stats_unknown int;
  v_pair_before bigint;
  v_pair_after bigint;
BEGIN
  IF v_give IS NULL OR v_known IS NULL OR v_log4 IS NULL OR v_log9 IS NULL OR v_stats IS NULL OR v_totals IS NULL OR v_health IS NULL THEN
    RAISE EXCEPTION 'free-scan-engine: a function this file defines is missing';
  END IF;
  IF has_function_privilege('anon', v_give, 'EXECUTE') OR has_function_privilege('authenticated', v_give, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_give, 'EXECUTE') THEN
    RAISE EXCEPTION 'give_back_scan_day is not service-role only';
  END IF;
  IF has_function_privilege('anon', v_known, 'EXECUTE') OR has_function_privilege('authenticated', v_known, 'EXECUTE') THEN
    RAISE EXCEPTION 'is_scan_industry is open to a client role';
  END IF;
  IF NOT has_function_privilege('anon', v_log4, 'EXECUTE') OR NOT has_function_privilege('anon', v_log9, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_stats, 'EXECUTE') OR NOT has_function_privilege('anon', v_totals, 'EXECUTE')
     OR NOT has_function_privilege('anon', v_health, 'EXECUTE') THEN
    RAISE EXCEPTION 'free-scan-engine: a reader or writer the page calls lost its grant';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_totals::oid;
  IF v_src NOT LIKE '%status = ''completed''%' OR v_src NOT LIKE '%scan_type in (''free'', ''free-stream'', ''paid'')%'
     OR v_src NOT LIKE '%cache_hit%' OR v_src NOT LIKE '%''basis''%' THEN
    RAISE EXCEPTION 'get_scan_totals: not the definition this file wrote';
  END IF;
  IF NOT public.is_scan_industry('technology') OR NOT public.is_scan_industry('humanResources')
     OR public.is_scan_industry('zz-not-an-industry') OR public.is_scan_industry(NULL) THEN
    RAISE EXCEPTION 'is_scan_industry: wrong answer for a known or an unknown label';
  END IF;

  BEGIN
    -- The day: two counted, given back twice, then never below zero; another
    -- function's row and a row past its window are left alone.
    INSERT INTO public.rate_limits (ip_address, function_name, request_count, window_start) VALUES
      ('fse-verify-1', 'free-keyword-scan', 2, now()),
      ('fse-verify-1', 'another-function', 2, now()),
      ('fse-verify-2', 'free-keyword-scan', 2, now() - interval '25 hours');
    PERFORM public.give_back_scan_day('fse-verify-1', 'free-keyword-scan');
    PERFORM public.give_back_scan_day('fse-verify-1', 'free-keyword-scan');
    PERFORM public.give_back_scan_day('fse-verify-1', 'free-keyword-scan');
    PERFORM public.give_back_scan_day('fse-verify-1', 'another-function');
    PERFORM public.give_back_scan_day('fse-verify-2', 'free-keyword-scan');
    SELECT ARRAY[
      (SELECT request_count FROM public.rate_limits WHERE ip_address = 'fse-verify-1' AND function_name = 'free-keyword-scan'),
      (SELECT request_count FROM public.rate_limits WHERE ip_address = 'fse-verify-1' AND function_name = 'another-function'),
      (SELECT request_count FROM public.rate_limits WHERE ip_address = 'fse-verify-2' AND function_name = 'free-keyword-scan')
    ] INTO v_counts;

    -- The corrections: an unknown label and an unchanged one write nothing.
    SELECT count(*) INTO v_corr_before FROM public.industry_corrections;
    -- By parameter name, as PostgREST calls them: with two arguments the two
    -- overloads are otherwise ambiguous.
    PERFORM public.log_industry_correction(p_detected => 'technology', p_corrected => 'zz-not-an-industry');
    PERFORM public.log_industry_correction(p_detected => 'technology', p_corrected => 'Technology');
    PERFORM public.log_industry_correction(p_original_industry => 'technology', p_corrected_industry => 'zz-not-an-industry');
    PERFORM public.log_industry_correction(p_original_industry => 'technology', p_corrected_industry => 'technology');
    SELECT count(*) INTO v_corr_after FROM public.industry_corrections;
    -- The digest: rows planted with an unknown label, an unchanged one and a
    -- confirmation are not counted (the confirmed pair is compared with its
    -- own count before the plant, so real rows of that pair cannot fail it).
    SELECT coalesce(sum(s.corrections), 0) INTO v_pair_before FROM public.get_industry_correction_stats(1) s
     WHERE s.detected = 'janitorial' AND s.corrected = 'clergy';
    INSERT INTO public.industry_corrections (original_industry, corrected_industry, detection_source)
    VALUES ('technology', 'zz-not-an-industry', 'fse-verify'), ('technology', 'technology', 'fse-verify'), ('janitorial', 'clergy', 'user_confirmed');
    SELECT count(*) INTO v_stats_unknown FROM public.get_industry_correction_stats(1) s
     WHERE NOT public.is_scan_industry(s.detected) OR NOT public.is_scan_industry(s.corrected)
        OR lower(btrim(s.detected)) = lower(btrim(s.corrected));
    SELECT coalesce(sum(s.corrections), 0) INTO v_pair_after FROM public.get_industry_correction_stats(1) s
     WHERE s.detected = 'janitorial' AND s.corrected = 'clergy';

    -- The total: a cache replay is not counted.
    SELECT (public.get_scan_totals() ->> 'total_scans')::bigint INTO v_totals_before;
    INSERT INTO public.scan_metrics (scan_type, status, duration_ms, cache_hit) VALUES ('free-stream', 'completed', 900, true);
    SELECT (public.get_scan_totals() ->> 'total_scans')::bigint INTO v_totals_after;

    -- The health reader: a model fallback is counted apart.
    SELECT model_fallback_last_hour INTO v_fb_before FROM public.get_scan_health_status();
    INSERT INTO public.scan_metrics (scan_type, status, duration_ms, error_code) VALUES ('free', 'completed', 900, 'MODEL_FALLBACK');
    SELECT model_fallback_last_hour INTO v_fb_after FROM public.get_scan_health_status();

    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'fse-verify-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'fse-verify-rollback' THEN RAISE; END IF;
  END;

  IF v_counts IS DISTINCT FROM ARRAY[0, 2, 2] THEN
    RAISE EXCEPTION 'give_back_scan_day: wrong counts %, want {0,2,2}', v_counts;
  END IF;
  IF v_corr_after IS DISTINCT FROM v_corr_before THEN
    RAISE EXCEPTION 'log_industry_correction stored an unknown or unchanged label (% -> %)', v_corr_before, v_corr_after;
  END IF;
  IF v_stats_unknown <> 0 OR v_pair_after IS DISTINCT FROM v_pair_before THEN
    RAISE EXCEPTION 'get_industry_correction_stats still counts an unknown, unchanged or confirmed pair';
  END IF;
  IF v_totals_after IS DISTINCT FROM v_totals_before THEN
    RAISE EXCEPTION 'get_scan_totals counted a cache replay (% -> %)', v_totals_before, v_totals_after;
  END IF;
  IF v_fb_after IS DISTINCT FROM v_fb_before + 1 THEN
    RAISE EXCEPTION 'get_scan_health_status did not count a model fallback (% -> %)', v_fb_before, v_fb_after;
  END IF;
  RAISE NOTICE 'free-scan-engine: the day is given back, unknown labels write nothing, cache replays and model fallbacks are counted apart';
END
$verify$;

NOTIFY pgrst, 'reload schema';
