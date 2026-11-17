-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- THE SCAN FLOOR COVERS EVERY BAND (S14X-193).
--
-- /research/ats-score-benchmarks, its Dataset JSON-LD and llms-full say a
-- bucket is published only at n >= 25 scans. get_public_scan_insights
-- (20261101100000) held industries and experience levels to that floor and
-- published every histogram band whatever its size: live on 2026-11-15, n 190
-- with bands of 2, 4, 24 and 8 scans, and pct_80_plus 0.0 from no scan at
-- all, which printed "Only 0% scored 80 or higher". Now a histogram band
-- under 25 scans is held back and the answer counts what it held back
-- (histogram_hidden_n, beside band_floor 25), and pct_80_plus is null unless
-- 25 scans scored 80 or more. Everything else is the live text: the same
-- allowlist, exclusions, vocabulary and figures, SECURITY DEFINER, pinned
-- search_path. Same signature and return type, so CREATE OR REPLACE keeps the
-- oid and the census entry; the grants are restated. Self-verifying, safe to
-- re-run.

SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.get_public_scan_insights()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  with scored as (
    select
      response_score as score,
      scan_type,
      coalesce(metadata->>'usedFallback', '') = 'true' as rule_based,
      nullif(metadata->>'industry', '') as raw_industry,
      metadata->>'experienceLevel' as raw_experience
    from public.scan_metrics
    where status = 'completed'
      and scan_type in ('free', 'free-stream', 'paid')
      and response_score between 1 and 100
      and created_at > now() - interval '180 days'
  ),
  excluded as (
    select
      count(*) filter (where scan_type = 'free-stream') as fallback_scanner,
      count(*) filter (where scan_type in ('free', 'paid') and rule_based) as rule_based_report
    from scored
  ),
  base as (
    select
      score,
      case lower(raw_industry)
        when 'software_engineering' then 'technology'
        else raw_industry
      end as industry,
      case
        when lower(trim(coalesce(raw_experience, ''))) like 'entry%'  then 'Entry-level'
        when lower(trim(coalesce(raw_experience, ''))) like 'mid%'    then 'Mid-level'
        when lower(trim(coalesce(raw_experience, ''))) like 'senior%' then 'Senior'
        when lower(trim(coalesce(raw_experience, ''))) like 'exec%'   then 'Executive'
        else null
      end as experience_level
    from scored
    where scan_type in ('free', 'paid')
      and not rule_based
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
  -- THE 25-SCAN FLOOR COVERS EVERY BAND (20261112195000). The page and the
  -- Dataset markup say a bucket is published only at n >= 25, and the
  -- industries and experience lists held to it while the histogram did not.
  -- A band under the floor is held back and counted in histogram_hidden_n.
  hist_all as (
    select least(floor(score / 10.0) * 10, 90)::int as bucket, count(*) as n
    from base
    group by 1
  ),
  hist as (
    select bucket, n from hist_all where n >= 25
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
    'scorer', 'primary',
    'excluded', (
      select jsonb_build_object('fallback_scanner', fallback_scanner, 'rule_based_report', rule_based_report)
      from excluded
    ),
    'overall', (
      select jsonb_build_object(
        'n', n, 'median', median, 'p25', p25, 'p75', p75,
        -- A share of scans at 80+ is stated only when 25 scans stand behind
        -- it: 'only 0%' from none of 190 is a band under the floor, not a finding.
        'pct_80_plus', case when n > 0 and n_80_plus >= 25 then round(100.0 * n_80_plus / n, 1) end,
        'pct_under_50', case when n > 0 then round(100.0 * n_under_50 / n, 1) end
      ) from overall
    ),
    'histogram', (
      select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n) order by bucket), '[]'::jsonb)
      from hist
    ),
    'histogram_hidden_n', (select coalesce(sum(n), 0)::int from hist_all where n < 25),
    'band_floor', 25,
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
  'The published resume-score benchmark (/research/ats-score-benchmarks, LiveScanStats, the prerender '
  'and its Dataset JSON-LD): completed primary-scanner scans (free, paid) with a score of 1-100 over 180 '
  'days and a report the model wrote. The fallback scanner (free-stream) and the rule-based fallback '
  'report are left out and counted in ''excluded'' (20261101100000, register S13-050); industry labels '
  'are the primary''s vocabulary. Every band (histogram, industries, experience) is published only at '
  'n >= 25; the histogram''s held-back scans are counted in histogram_hidden_n, and pct_80_plus is null '
  'under 25 such scans (20261112195000). The scan_type list is an ALLOWLIST, so our own synthetic tests and the '
  'heartbeat never enter a figure labelled "real users". Aggregates only.';

REVOKE ALL ON FUNCTION public.get_public_scan_insights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_scan_insights() TO anon, authenticated, service_role;

DO $verify$
DECLARE n int; src text; definer boolean; r jsonb;
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
  IF src NOT LIKE '%where scan_type in (''free'', ''paid'')%' OR src NOT LIKE '%and not rule_based%' THEN
    RAISE EXCEPTION 'get_public_scan_insights: the fallback scanner or the rule-based report is still in the benchmark';
  END IF;
  IF src NOT LIKE '%when ''software_engineering'' then ''technology''%' THEN
    RAISE EXCEPTION 'get_public_scan_insights: industry labels are not in the primary''s vocabulary';
  END IF;
  IF src LIKE '%<> ''heartbeat''%' OR src LIKE '%synthetic%' THEN
    RAISE EXCEPTION 'get_public_scan_insights: the benchmark is not on the real-scan allowlist';
  END IF;
  IF NOT definer THEN
    RAISE EXCEPTION 'get_public_scan_insights: not SECURITY DEFINER, so anon reads nothing from scan_metrics';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_public_scan_insights()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_public_scan_insights: anon cannot execute it, so the benchmark page goes blank';
  END IF;
  r := public.get_public_scan_insights();
  IF NOT (r ? 'excluded') OR r -> 'overall' IS NULL THEN
    RAISE EXCEPTION 'get_public_scan_insights: the answer lacks its exclusion counts or its overall figures';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'industries') e WHERE e ->> 'industry' = 'software_engineering') THEN
    RAISE EXCEPTION 'get_public_scan_insights: software_engineering is still published beside technology';
  END IF;
  IF position('where n >= 25' IN src) = 0 OR position('''histogram_hidden_n''' IN src) = 0 THEN
    RAISE EXCEPTION 'get_public_scan_insights: a histogram band under the 25-scan floor is still published';
  END IF;
  IF position('n_80_plus >= 25' IN src) = 0 THEN
    RAISE EXCEPTION 'get_public_scan_insights: a share of scans at 80+ is stated with fewer than 25 behind it';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'histogram') e WHERE (e ->> 'n')::int < 25) THEN
    RAISE EXCEPTION 'get_public_scan_insights: the answer holds a band under the floor';
  END IF;
  IF NOT (r ? 'histogram_hidden_n') THEN
    RAISE EXCEPTION 'get_public_scan_insights: the answer does not count the scans it held back';
  END IF;
  RAISE NOTICE 'score benchmark: overall.n %, left out % fallback-scanner and % rule-based scans',
    r -> 'overall' ->> 'n', r -> 'excluded' ->> 'fallback_scanner', r -> 'excluded' ->> 'rule_based_report';
END
$verify$;

NOTIFY pgrst, 'reload schema';
