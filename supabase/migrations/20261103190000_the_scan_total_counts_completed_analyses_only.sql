-- THE SCAN TOTAL COUNTS COMPLETED ANALYSES ONLY (audit 2026-10-31, S13-087).
--
-- get_scan_totals is the figure the homepage bake prints as "the scanner has
-- completed N scans", /trust as "N Resumes Analyzed" and /methodology as "N
-- resumes processed" and "N resumes analyzed". Its last definition
-- (20260709124621) counted every scan_metrics row of type free, free-stream
-- or paid, whatever its status: a 'failed' attempt, and the 'validation_error'
-- row the free scan logs before it goes on to the rule-based report and logs
-- that same scan again as 'completed', so one scan could count twice and a
-- scan that never finished counted once. Live on 2026-10-31 it answered 1,114
-- while the completed, scored rows over 180 days numbered 327.
--
-- It now counts rows whose status is 'completed' on the same allowlist of
-- types: one row per analysis the scanner finished. The countries are counted
-- over the same rows. Same signature and return type, so CREATE OR REPLACE
-- keeps the oid; the grants are restated as the census holds the function
-- today: client-callable (src/hooks/use-scan-totals.ts), aggregates only.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_scan_totals()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  select jsonb_build_object(
    'total_scans', count(*),
    'countries', count(distinct ip_country) filter (where ip_country is not null and ip_country <> 'Unknown')
  )
  from public.scan_metrics
  where scan_type in ('free', 'free-stream', 'paid')
    and status = 'completed';
$$;

COMMENT ON FUNCTION public.get_scan_totals() IS
  'The scanner''s public total: analyses it completed (scan_metrics status completed), '
  'scan_type in (free, free-stream, paid), with the count of countries over the same rows. '
  'Failed attempts and the validation_error rows a scan logs before its completed row are '
  'not counted (20261103190000, S13-087). Aggregates only.';

REVOKE ALL ON FUNCTION public.get_scan_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_totals() TO anon, authenticated, service_role;

DO $$
DECLARE n int; src text; definer boolean;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_scan_totals';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_scan_totals: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc, p.prosecdef INTO src, definer
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_scan_totals';
  IF src NOT LIKE '%status = ''completed''%' THEN
    RAISE EXCEPTION 'get_scan_totals: still counts attempts that did not complete';
  END IF;
  IF src NOT LIKE '%scan_type in (''free'', ''free-stream'', ''paid'')%' THEN
    RAISE EXCEPTION 'get_scan_totals: left the real-scan allowlist';
  END IF;
  IF NOT definer THEN
    RAISE EXCEPTION 'get_scan_totals: not SECURITY DEFINER, so anon reads nothing from scan_metrics';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_scan_totals()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_scan_totals: anon cannot execute it, so the public total goes blank';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
