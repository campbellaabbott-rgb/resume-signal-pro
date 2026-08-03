-- THE GLOBAL RATE BUDGET WAS FED BY 36 FUNCTIONS AND SPENT BY 6.
--
-- MEASURED 2026-08-03 from one IP inside a single minute:
--   job-board       -> 200   (writes a rate_limits row, does NOT enforce the budget)
--   parse-pdf       -> 429
--   parse-docx      -> 429   (its own 20/hr bucket was untouched, so this is the GLOBAL gate)
--   create-checkout -> 429
--
-- check_global_rate_limit sums request_count over EVERY row for an IP. Rows are
-- written by any function calling check_rate_limit -- 36 of them, including
-- job-board-fit (120/day), nl-search and application-fit. But only six functions
-- enforce the 100/hr ceiling, and those six are the front door: parse-pdf,
-- parse-docx, analyze-resume, free-keyword-scan, scrape-linkedin, create-checkout.
--
-- So browsing the job board spent a budget that only résumé upload, the free
-- scanner and CHECKOUT were charged for. A candidate could use the product
-- normally for an hour and then find they could not upload a CV or pay, while
-- the board that exhausted their budget kept answering perfectly. The reported
-- symptom was "a lot of PDF parse failures"; no byte of those PDFs ever reached
-- the parser.
--
-- THE FIX IS SCOPE, NOT CEILING. Raising 100 would only move the cliff. A budget
-- should count exactly what it gates, so the accounting is closed: you are
-- charged for the calls that can refuse you, and for nothing else. Every
-- excluded function keeps its own per-function limit, so abuse stays bounded --
-- what changes is that one surface can no longer starve another.
--
-- The signature and return type are unchanged on purpose: the six callers deploy
-- independently of this migration, so both orderings must be safe.

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
  -- The functions that ENFORCE this budget, and therefore the only ones that may
  -- fill it. Adding a function to the enforcing set without adding it here (or
  -- vice versa) reopens exactly the bug this migration closes, so
  -- src/test/rate-budget-scope.test.ts pins the two lists against each other.
  v_budgeted TEXT[] := ARRAY[
    'parse-pdf',
    'parse-docx',
    'free-keyword-scan',
    'scrape-linkedin',
    'create-checkout'
    -- analyze-resume enforces the budget but writes no row of its own; it is
    -- gated by the spend of the upload that precedes it, which is the intent.
  ];
BEGIN
  -- Validate input bounds (defense-in-depth)
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
  'row for the IP, letting job-board traffic exhaust résumé upload and checkout.';

REVOKE ALL ON FUNCTION public.check_global_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_global_rate_limit(text, integer, integer) TO service_role;

-- OBSERVABILITY: the two limits returned byte-identical text, so a 429 could not
-- be attributed to the global budget or the per-function ceiling without reading
-- logs that RLS makes unreadable. This is read-only and service-role only; it
-- lets the six callers say which limit fired, and how long the caller must wait.
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
  'function''s own ceiling an IP has spent. Exists because the two limits were previously '
  'indistinguishable in the response body.';

REVOKE ALL ON FUNCTION public.rate_budget_state(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_budget_state(text, text, integer) TO service_role;
