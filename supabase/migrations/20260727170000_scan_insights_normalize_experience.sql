-- /research/ats-score-benchmarks published contradictory numbers about the
-- same population, in the same viewport.
--
-- Verified live 2026-07-27 from get_public_scan_insights():
--   Entry-level  n=199 median=78     entry   n=124 median=68
--   Senior       n=80  median=92     senior  n=48  median=55
--   Mid-level    n=53  median=90     mid     n=49  median=45
--
-- Two writers stamp metadata->>'experienceLevel' with different casing —
-- free-keyword-scan writes the detector's display label ("Entry-level"), and
-- the personalization path writes its own enum ("entry", see
-- src/hooks/use-personalization.ts). The RPC grouped the RAW string, so each
-- real level became two cards, and a reader saw "Senior: 92" next to
-- "senior: 55" and had no way to know which to believe. Neither was wrong;
-- the grouping was.
--
-- Fixed here rather than by backfilling scan_metrics: normalising at read
-- time repairs every historical row at once, cannot corrupt the raw record,
-- and keeps working if a third writer appears with yet another casing.
--
-- Note the n >= 25 gate is applied AFTER the merge, so it now gates on the
-- real bucket size instead of on an arbitrary half of it. That is also why
-- the merge cannot smuggle in a thin bucket: 'mid' (49) + 'Mid-level' (53)
-- was already over the floor separately, and anything genuinely rare still
-- fails the floor after merging.
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
      -- Canonical label. Prefix-matched so "entry", "Entry-level" and
      -- "entry_level" all land in one bucket; anything unrecognised is
      -- dropped rather than shown under a name we invented for it.
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
