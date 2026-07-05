-- Real score distributions from our own scan corpus. Once an industry has
-- enough completed scans, the report benchmarks against ACTUAL data instead
-- of synthetic estimates — a claim generic AI chat tools structurally cannot
-- make. Below the threshold the report keeps the estimate-based benchmark.

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
    and created_at > now() - interval '180 days'
    and metadata->>'industry' = p_industry;
$$;

grant execute on function public.get_real_score_distribution(text) to service_role;
