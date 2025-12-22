-- Create function to get funnel stats by cohort
CREATE OR REPLACE FUNCTION public.get_funnel_cohort_stats(
  p_cohort_dimension text DEFAULT 'trafficSource',
  p_days_back integer DEFAULT 7
)
RETURNS TABLE(
  cohort_value text,
  landing_view bigint,
  upload_started bigint,
  upload_completed bigint,
  scan_started bigint,
  scan_completed bigint,
  results_viewed bigint,
  product_clicked bigint,
  checkout_started bigint,
  purchase_completed bigint,
  upload_rate numeric,
  scan_rate numeric,
  view_rate numeric,
  checkout_rate numeric,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH funnel_events AS (
    SELECT 
      variant as stage,
      COALESCE(
        metadata->>p_cohort_dimension,
        'unknown'
      ) as cohort,
      visitor_id
    FROM ab_test_events
    WHERE test_name = 'conversion_funnel'
      AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
  ),
  stage_counts AS (
    SELECT 
      cohort,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'landing_view') as landing_view,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'upload_started') as upload_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'upload_completed') as upload_completed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'scan_started') as scan_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'scan_completed') as scan_completed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'results_viewed') as results_viewed,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'product_clicked') as product_clicked,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'checkout_started') as checkout_started,
      COUNT(DISTINCT visitor_id) FILTER (WHERE stage = 'purchase_completed') as purchase_completed
    FROM funnel_events
    GROUP BY cohort
  )
  SELECT 
    sc.cohort as cohort_value,
    sc.landing_view,
    sc.upload_started,
    sc.upload_completed,
    sc.scan_started,
    sc.scan_completed,
    sc.results_viewed,
    sc.product_clicked,
    sc.checkout_started,
    sc.purchase_completed,
    -- Calculate rates
    CASE WHEN sc.landing_view > 0 
      THEN ROUND((sc.upload_started::NUMERIC / sc.landing_view::NUMERIC) * 100, 2)
      ELSE 0 END as upload_rate,
    CASE WHEN sc.upload_completed > 0 
      THEN ROUND((sc.scan_completed::NUMERIC / sc.upload_completed::NUMERIC) * 100, 2)
      ELSE 0 END as scan_rate,
    CASE WHEN sc.scan_completed > 0 
      THEN ROUND((sc.results_viewed::NUMERIC / sc.scan_completed::NUMERIC) * 100, 2)
      ELSE 0 END as view_rate,
    CASE WHEN sc.product_clicked > 0 
      THEN ROUND((sc.checkout_started::NUMERIC / sc.product_clicked::NUMERIC) * 100, 2)
      ELSE 0 END as checkout_rate,
    CASE WHEN sc.landing_view > 0 
      THEN ROUND((sc.purchase_completed::NUMERIC / sc.landing_view::NUMERIC) * 100, 2)
      ELSE 0 END as conversion_rate
  FROM stage_counts sc
  WHERE sc.landing_view > 0
  ORDER BY sc.landing_view DESC;
END;
$$;

-- Create function to compare cohorts
CREATE OR REPLACE FUNCTION public.compare_cohorts(
  p_cohort_a text,
  p_cohort_b text,
  p_dimension text DEFAULT 'trafficSource',
  p_days_back integer DEFAULT 7
)
RETURNS TABLE(
  metric text,
  cohort_a_value numeric,
  cohort_b_value numeric,
  difference numeric,
  lift_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_a_landing BIGINT;
  v_a_conversion BIGINT;
  v_b_landing BIGINT;
  v_b_conversion BIGINT;
  v_a_rate NUMERIC;
  v_b_rate NUMERIC;
BEGIN
  -- Get cohort A stats
  SELECT 
    COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'landing_view'),
    COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'purchase_completed')
  INTO v_a_landing, v_a_conversion
  FROM ab_test_events
  WHERE test_name = 'conversion_funnel'
    AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
    AND metadata->>p_dimension = p_cohort_a;
  
  -- Get cohort B stats
  SELECT 
    COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'landing_view'),
    COUNT(DISTINCT visitor_id) FILTER (WHERE variant = 'purchase_completed')
  INTO v_b_landing, v_b_conversion
  FROM ab_test_events
  WHERE test_name = 'conversion_funnel'
    AND created_at > NOW() - (p_days_back || ' days')::INTERVAL
    AND metadata->>p_dimension = p_cohort_b;
  
  v_a_rate := CASE WHEN v_a_landing > 0 THEN (v_a_conversion::NUMERIC / v_a_landing::NUMERIC) * 100 ELSE 0 END;
  v_b_rate := CASE WHEN v_b_landing > 0 THEN (v_b_conversion::NUMERIC / v_b_landing::NUMERIC) * 100 ELSE 0 END;
  
  RETURN QUERY
  SELECT 'visitors'::text, v_a_landing::numeric, v_b_landing::numeric, 
         (v_a_landing - v_b_landing)::numeric,
         CASE WHEN v_b_landing > 0 THEN ROUND(((v_a_landing - v_b_landing)::NUMERIC / v_b_landing::NUMERIC) * 100, 2) ELSE 0 END
  UNION ALL
  SELECT 'conversions'::text, v_a_conversion::numeric, v_b_conversion::numeric,
         (v_a_conversion - v_b_conversion)::numeric,
         CASE WHEN v_b_conversion > 0 THEN ROUND(((v_a_conversion - v_b_conversion)::NUMERIC / v_b_conversion::NUMERIC) * 100, 2) ELSE 0 END
  UNION ALL
  SELECT 'conversion_rate'::text, ROUND(v_a_rate, 2), ROUND(v_b_rate, 2),
         ROUND(v_a_rate - v_b_rate, 2),
         CASE WHEN v_b_rate > 0 THEN ROUND(((v_a_rate - v_b_rate) / v_b_rate) * 100, 2) ELSE 0 END;
END;
$$;