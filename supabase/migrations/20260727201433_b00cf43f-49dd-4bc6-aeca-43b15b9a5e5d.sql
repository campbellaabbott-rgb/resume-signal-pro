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
      case
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'entry%'  then 'Entry-level'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'mid%'    then 'Mid-level'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'senior%' then 'Senior'
        when lower(trim(coalesce(metadata->>'experienceLevel', ''))) like 'exec%'   then 'Executive'
        else null
      end as experience_level
    from public.scan_metrics
    where status = 'completed'
      and scan_type <> 'heartbeat'
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