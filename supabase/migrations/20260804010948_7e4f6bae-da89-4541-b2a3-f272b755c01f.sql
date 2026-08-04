CREATE OR REPLACE FUNCTION public.check_global_rate_limit(
  p_ip text,
  p_max_requests integer DEFAULT 100,
  p_window_minutes integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_count INT;
  v_window_cutoff TIMESTAMPTZ;
  v_budgeted TEXT[] := ARRAY[
    'parse-pdf',
    'parse-docx',
    'free-keyword-scan',
    'scrape-linkedin',
    'create-checkout'
  ];
BEGIN
  IF p_max_requests < 1 OR p_max_requests > 1000 THEN
    RAISE EXCEPTION 'Invalid rate limit value';
  END IF;
  IF p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid time window value';
  END IF;
  IF p_ip IS NULL OR length(p_ip) > 45 THEN
    RAISE EXCEPTION 'Invalid IP address';
  END IF;

  v_window_cutoff := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  SELECT COALESCE(SUM(request_count), 0) INTO v_total_count
  FROM public.rate_limits
  WHERE ip_address = p_ip
    AND window_start >= v_window_cutoff
    AND function_name = ANY(v_budgeted);

  IF v_total_count >= p_max_requests THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$function$;

COMMENT ON FUNCTION public.check_global_rate_limit(text, integer, integer) IS
  'Cross-function request budget per IP. Counts ONLY the functions that enforce it '
  '(parse-pdf, parse-docx, free-keyword-scan, scrape-linkedin, create-checkout), so no '
  'surface can spend a budget it is not charged for. Before 2026-08-03 it summed every '
  'row for the IP, letting job-board traffic exhaust resume upload and checkout.';

REVOKE ALL ON FUNCTION public.check_global_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_global_rate_limit(text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.rate_budget_state(
  p_ip text,
  p_function text DEFAULT NULL,
  p_window_minutes integer DEFAULT 60
)
RETURNS TABLE (budget_used integer, function_used integer, oldest_window timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_cutoff TIMESTAMPTZ;
  v_budgeted TEXT[] := ARRAY[
    'parse-pdf', 'parse-docx', 'free-keyword-scan', 'scrape-linkedin', 'create-checkout'
  ];
BEGIN
  IF p_ip IS NULL OR length(p_ip) > 45 THEN
    RAISE EXCEPTION 'Invalid IP address';
  END IF;
  IF p_window_minutes < 1 OR p_window_minutes > 1440 THEN
    RAISE EXCEPTION 'Invalid time window value';
  END IF;

  v_window_cutoff := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  RETURN QUERY
  SELECT
    COALESCE(SUM(r.request_count) FILTER (WHERE r.function_name = ANY(v_budgeted)), 0)::int,
    COALESCE(SUM(r.request_count) FILTER (WHERE r.function_name = p_function), 0)::int,
    MIN(r.window_start) FILTER (WHERE r.function_name = ANY(v_budgeted))
  FROM public.rate_limits r
  WHERE r.ip_address = p_ip
    AND r.window_start >= v_window_cutoff;
END;
$function$;

COMMENT ON FUNCTION public.rate_budget_state(text, text, integer) IS
  'Diagnostic read for 429 responses: how much of the cross-function budget and of one '
  'function''s own ceiling an IP has spent.';

REVOKE ALL ON FUNCTION public.rate_budget_state(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_budget_state(text, text, integer) TO service_role;