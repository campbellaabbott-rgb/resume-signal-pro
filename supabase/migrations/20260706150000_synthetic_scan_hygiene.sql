-- Synthetic-scan hygiene: keep our own test traffic out of the published
-- score statistics, and make the scan_metrics RPC exposure deliberate.
--
-- Problem: scripts/post-publish-smoke.mjs and scripts/load-test-scan.mjs POST
-- real resumes to free-keyword-scan, which logged them as scan_type='free' —
-- indistinguishable from real users in get_public_scan_insights and
-- get_real_score_distribution. The heartbeat sentinel's e2e probe had the
-- same problem. Going forward the scripts send synthetic:true (logged as
-- 'synthetic') and heartbeat probes are logged as 'heartbeat'; this migration
-- fixes the historical rows and filters both stats functions to real scan
-- types only.

-- ---------------------------------------------------------------------------
-- 1) Retroactive tagging of known synthetic rows (both scripts and the
--    heartbeat cron shipped 2026-07-05). Identified by the exact/derivable
--    input lengths of their fixed test resumes — real resumes are far longer
--    than these 242–299-char snippets, so collisions are implausible:
--      242      = post-publish-smoke.mjs fixed corpus ("smoke-fixed-corpus")
--      284–299  = load-test-scan.mjs generator output range (all roles,
--                 index 0–99, any timestamp digits)
--      686      = scan-heartbeat TEST_RESUME e2e probe
update public.scan_metrics
set scan_type = 'synthetic'
where scan_type = 'free'
  and created_at >= '2026-07-05'
  and (input_length = 242 or input_length between 284 and 299);

update public.scan_metrics
set scan_type = 'heartbeat'
where scan_type = 'free'
  and created_at >= '2026-07-05'
  and input_length = 686;

-- ---------------------------------------------------------------------------
-- 2) get_real_score_distribution: only real scans feed the in-report
--    benchmark. (Previously any scan_type counted, including synthetic.)
create or replace function public.get_real_score_distribution(p_industry text)
returns table (n bigint, median numeric, p25 numeric, p75 numeric)
language sql
security definer
set search_path = public
as $$
  select
    count(*)::bigint as n,
    percentile_cont(0.5) within group (order by response_score)::numeric as median,
    percentile_cont(0.25) within group (order by response_score)::numeric as p25,
    percentile_cont(0.75) within group (order by response_score)::numeric as p75
  from public.scan_metrics
  where response_score is not null
    and response_score between 1 and 100
    and status = 'completed'
    and scan_type in ('free', 'free-stream')
    and created_at > now() - interval '180 days'
    and metadata->>'industry' = p_industry;
$$;

-- ---------------------------------------------------------------------------
-- 3) get_public_scan_insights: allowlist real scan types instead of
--    denylisting 'heartbeat', so 'synthetic' (and any future internal type)
--    is excluded by default.
create or replace function public.get_public_scan_insights()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      response_score as score,
      nullif(metadata->>'industry', '') as industry,
      nullif(metadata->>'experienceLevel', '') as experience_level
    from public.scan_metrics
    where status = 'completed'
      and scan_type in ('free', 'free-stream')
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

revoke all on function public.get_public_scan_insights() from public;
grant execute on function public.get_public_scan_insights() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Function grants: Postgres grants EXECUTE to PUBLIC by default, so every
--    scan_metrics RPC has been anon-callable since creation. Make the
--    exposure deliberate.
--
-- Stay anon-callable (aggregate-only output, and real anon consumers exist:
-- the ScanMetrics/HealthCheck dashboards and scripts/scan-trends.mjs):
--   get_scan_success_rate, get_scan_metrics_hourly, get_scan_geo_stats,
--   get_scan_health_status, get_real_score_distribution,
--   get_public_scan_insights (granted above).
revoke all on function public.get_scan_success_rate(integer, text) from public;
grant execute on function public.get_scan_success_rate(integer, text) to anon, authenticated, service_role;

revoke all on function public.get_scan_metrics_hourly(integer) from public;
grant execute on function public.get_scan_metrics_hourly(integer) to anon, authenticated, service_role;

revoke all on function public.get_scan_geo_stats(integer) from public;
grant execute on function public.get_scan_geo_stats(integer) to anon, authenticated, service_role;

revoke all on function public.get_scan_health_status() from public;
grant execute on function public.get_scan_health_status() to anon, authenticated, service_role;

revoke all on function public.get_real_score_distribution(text) from public;
grant execute on function public.get_real_score_distribution(text) to anon, authenticated, service_role;

-- Service-role only: these WRITE to the metrics tables. With PUBLIC EXECUTE
-- anyone holding the anon key could insert fabricated scores straight into
-- the corpus behind the published stats. Only edge functions (service role)
-- call them.
revoke all on function public.log_scan_metric(text, text, integer, boolean, text, text, text, text, text, integer, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.log_scan_metric(text, text, integer, boolean, text, text, text, text, text, integer, boolean, integer, jsonb) to service_role;

revoke all on function public.log_heartbeat_result(text, text, integer, boolean, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.log_heartbeat_result(text, text, integer, boolean, text, jsonb, jsonb) to service_role;
