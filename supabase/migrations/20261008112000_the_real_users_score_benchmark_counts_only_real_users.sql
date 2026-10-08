-- THE "REAL USERS" SCORE BENCHMARK COUNTS ONLY REAL USERS.
--
-- /research/ats-score-benchmarks says its figures come from "completed scans
-- run by real users", and LiveScanStats, the prerender and its Dataset
-- JSON-LD read them from get_public_scan_insights. 20260706150000 filtered
-- that function to scan_type IN ('free', 'free-stream'); the three
-- redefinitions after it (20260709124621, 20260727170000, 20260727201433)
-- each went back to scan_type <> 'heartbeat', which admits 'synthetic' -- the
-- type our own smoke and load tests write (scripts/load-test-scan.mjs,
-- free-keyword-scan's synthetic flag). Live over 180 days: 23 synthetic, 179
-- free, 178 free-stream completed rows, and overall.n read 379, so at least 22
-- of our own test scans sat in the published sample, about 6% (register
-- L11-04).
--
-- The filter is an ALLOWLIST again, the one get_scan_totals uses: 'free',
-- 'free-stream' and 'paid'. An allowlist and not a longer denylist because a
-- type invented later (the last one was 'synthetic') should stay out of a
-- figure labelled "real users" until somebody decides it belongs. Every other
-- line of the body is the 20260727201433 text. Same signature and return
-- type, so CREATE OR REPLACE keeps the oid; the grants are restated and the
-- function stays what the census says it is today: client-callable,
-- allowlisted (LiveScanStats.tsx), revoked from PUBLIC.

CREATE OR REPLACE FUNCTION public.get_public_scan_insights()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  with base as (
    select
      response_score as score,
      nullif(metadata->>'industry', '') as industry,
      case
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'entry%'  then 'Entry-level'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'mid%'    then 'Mid-level'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'senior%' then 'Senior'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'exec%'   then 'Executive'
        else null
      end as experience_level
    from public.scan_metrics
    where status = 'completed'
      and scan_type in ('free', 'free-stream', 'paid')
      and response_score between 1 and 100
      and created_at > now() - interval '180 days'
  ),
  overall as (
    select
      count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median,
      round(percentile_cont(0.25) within group (order by score)::numeric) as p25,
      round(percentile_cont(0.75) within group (order by score)::numeric) as p75,
      count(*) filter (where score >= 80) as n_80_plus,
      count(*) filter (where score < 50) as n_under_50
    from base
  ),
  hist as (
    select least(floor(score / 10.0) * 10, 90)::int as bucket, count(*) as n
    from base
    group by 1
  ),
  industries as (
    select
      industry,
      count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median,
      round(percentile_cont(0.25) within group (order by score)::numeric) as p25,
      round(percentile_cont(0.75) within group (order by score)::numeric) as p75
    from base
    where industry is not null
    group by industry
    having count(*) >= 25
    order by count(*) desc
    limit 20
  ),
  experience as (
    select
      experience_level,
      count(*) as n,
      round(percentile_cont(0.5) within group (order by score)::numeric) as median
    from base
    where experience_level is not null
    group by experience_level
    having count(*) >= 25
  )
  select jsonb_build_object(
    'as_of', to_char(now(), 'YYYY-MM-DD'),
    'window_days', 180,
    'overall', (
      select jsonb_build_object(
        'n', n, 'median', median, 'p25', p25, 'p75', p75,
        'pct_80_plus', case when n > 0 then round(100.0 * n_80_plus / n, 1) end,
        'pct_under_50', case when n > 0 then round(100.0 * n_under_50 / n, 1) end
      ) from overall
    ),
    'histogram', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n) order by bucket), '[]'::jsonb)
      from hist
    ),
    'industries', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'industry', industry, 'n', n, 'median', median, 'p25', p25, 'p75', p75
      ) order by n desc), '[]'::jsonb)
      from industries
    ),
    'experience', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'level', experience_level, 'n', n, 'median', median
      ) order by n desc), '[]'::jsonb)
      from experience
    )
  );
$$;

COMMENT ON FUNCTION public.get_public_scan_insights() IS
  'The published resume-score benchmark (/research/ats-score-benchmarks, '
  'LiveScanStats, the prerender and its Dataset JSON-LD): completed scans with '
  'a score of 1-100 over 180 days, scan_type in (free, free-stream, paid) -- an '
  'ALLOWLIST, the one get_scan_totals uses, so our own synthetic smoke and load '
  'tests and the heartbeat never enter a figure labelled "real users", and a '
  'type invented later stays out until someone decides it belongs '
  '(20261008112000; three earlier redefinitions had gone back to excluding '
  'only heartbeat). Aggregates only.';

REVOKE ALL ON FUNCTION public.get_public_scan_insights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_scan_insights() TO anon, authenticated, service_role;

DO $$
DECLARE n int; src text; definer boolean;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_public_scan_insights';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_public_scan_insights: expected exactly one definition, found %', n;
  END IF;
  SELECT p.prosrc, p.prosecdef INTO src, definer
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_public_scan_insights';
  IF src NOT LIKE '%scan_type in (''free'', ''free-stream'', ''paid'')%' OR src LIKE '%<> ''heartbeat''%' THEN
    RAISE EXCEPTION 'get_public_scan_insights: the benchmark is not on the real-scan allowlist';
  END IF;
  IF NOT definer THEN
    RAISE EXCEPTION 'get_public_scan_insights: not SECURITY DEFINER, so anon reads nothing from scan_metrics';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_public_scan_insights()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_public_scan_insights: anon cannot execute it, so the benchmark page goes blank';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
