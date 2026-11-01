-- THE SCORE BENCHMARK IS ONE SCORER'S, IN ONE VOCABULARY (register S13-050).
--
-- get_public_scan_insights feeds /research/ats-score-benchmarks, the
-- homepage's "How real resumes actually score", LiveScanStats and the
-- prerender's Dataset JSON-LD. 20261008112000 counted every completed
-- 'free', 'free-stream' and 'paid' scan and grouped industries by the raw
-- metadata->>'industry'. Two scorers sat in one sample:
--
--   * 'free-stream' is the FALLBACK scanner, a different scorer with its own
--     industry vocabulary. It keeps 'software_engineering' as an industry of
--     its own, where the primary scanner reads the same field as
--     'technology'. Live on 2026-10-17 the benchmark printed Technology
--     (n=103, median 55) beside Software Engineering (n=35, median 91): one
--     field twice, 36 points apart, and every Software Engineering row was
--     the fallback's.
--   * a primary scan that served the rule-based fallback report
--     (metadata.usedFallback = true) carries a score no model wrote.
--
-- Both are now left out of every published figure (overall, histogram,
-- industries, experience), and the response says how many were left out and
-- why ('excluded'), so the page can disclose it. The allowlist stays an
-- allowlist ('free', 'free-stream', 'paid' are read, so the exclusions can be
-- counted; a type invented later stays out). An industry label is read in the
-- primary's vocabulary: 'software_engineering' is 'technology', as the
-- primary's alias table has it. Every other line is the 20261008112000 text.
-- Same signature and return type, so CREATE OR REPLACE keeps the oid; the
-- grants are restated, and the function stays what the census says it is:
-- client-callable, allowlisted (LiveScanStats.tsx), revoked from PUBLIC.
--
-- Self-verifying, safe to re-run.

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
    'scorer', 'primary',
    'excluded', (
      select jsonb_build_object('fallback_scanner', fallback_scanner, 'rule_based_report', rule_based_report)
      from excluded
    ),
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
  'The published resume-score benchmark (/research/ats-score-benchmarks, LiveScanStats, the prerender '
  'and its Dataset JSON-LD): completed primary-scanner scans (free, paid) with a score of 1-100 over 180 '
  'days and a report the model wrote. The fallback scanner (free-stream) and the rule-based fallback '
  'report are left out and counted in ''excluded'' (20261101100000, register S13-050); industry labels '
  'are the primary''s vocabulary. The scan_type list is an ALLOWLIST, so our own synthetic tests and the '
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
  RAISE NOTICE 'score benchmark: overall.n %, left out % fallback-scanner and % rule-based scans',
    r -> 'overall' ->> 'n', r -> 'excluded' ->> 'fallback_scanner', r -> 'excluded' ->> 'rule_based_report';
END
$verify$;

NOTIFY pgrst, 'reload schema';
