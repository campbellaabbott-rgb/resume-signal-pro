-- NO ONE CHECKS THAT AN APPLY LINK RESOLVES.
--
-- The board's only liveness signal is presence in a successful feed fetch,
-- and that signal is structurally blind to host rot: 23,347 servable postings
-- (4.06%) carry an apply_url on a host the EMPLOYER owns rather than the
-- vendor — greenhouse 25.3% of its rows, teamtailor 47.2% — and when such a
-- host lapses (expired cert, dropped DNS), the feed keeps listing the job and
-- the board keeps serving a button that cannot load. That is exactly how 233
-- Recruitee postings sat behind dead vanity domains until 2026-08-23.
--
-- THIS IS DETECTION, NOT ENFORCEMENT, deliberately. The measured verdict-rule
-- traps are severe: Workday is 51.4% of the board and answers HTTP 200 with a
-- ~136-byte redirect stub; iCIMS and Recruitee ship "no longer available"
-- strings inside their i18n bundle on LIVE pages (11 of 11 such flags were
-- false positives); a 403/429 is a CDN, not a death. So the sweep records
-- host health and publishes a dated reachability figure; it never demotes a
-- row. Only DNS, TLS and network failures count as a failing host — an HTTP
-- status of any kind proves the host is alive.
--
-- One RPC (the host census PostgREST cannot express — it needs a GROUP BY
-- over an extracted hostname) and one hourly cron tick. The edge function
-- probes a bounded slice per tick with a cursor, so a full cycle covers all
-- ~1,400 exposed hosts in a few hours without ever approaching the function
-- wall clock.

CREATE OR REPLACE FUNCTION public.get_apply_hosts()
RETURNS TABLE (host text, postings bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  SELECT split_part(split_part(apply_url, '://', 2), '/', 1) AS host,
         count(*)::bigint AS postings
  FROM public.job_board_postings
  WHERE missing_since IS NULL
    AND effective_posted >= now() - interval '30 days'
    AND apply_url LIKE 'https://%'
    -- Vendor-canonical hosts are the vendor's own uptime, not the employer's,
    -- and the vendor APIs are already verified by every feed fetch.
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.recruitee.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.greenhouse.io'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.myworkdayjobs.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.bamboohr.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.teamtailor.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.icims.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.ashbyhq.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.lever.co'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.workable.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.smartrecruiters.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.personio.%'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.breezy.hr'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.pinpointhq.com'
    AND split_part(split_part(apply_url, '://', 2), '/', 1) NOT LIKE '%.oraclecloud.com'
  GROUP BY 1
  HAVING count(*) >= 1
  ORDER BY 2 DESC;
$$;

-- The sweep runs under the function's service client; nothing anon-facing
-- needs a host census, and a host list is reconnaissance surface.
REVOKE EXECUTE ON FUNCTION public.get_apply_hosts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_apply_hosts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_apply_hosts() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-board-host-sweep') THEN
    PERFORM cron.schedule(
      'job-board-host-sweep',
      '7 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"action":"host_sweep"}'::jsonb
      );
      $job$
    );
  END IF;
END $$;
