-- All-time scan totals for the homepage hero: how many resumes we've
-- actually scanned, from how many countries. Aggregates only — two numbers,
-- nothing traceable to an individual scan. Same allowlist discipline as
-- get_public_scan_insights: real user scan types only, so heartbeat probes,
-- load tests and smoke tests never inflate the counter.

create or replace function public.get_scan_totals()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_scans', count(*),
    'countries', count(distinct ip_country) filter (
      where ip_country is not null and ip_country <> 'Unknown'
    )
  )
  from public.scan_metrics
  where status = 'completed'
    and scan_type in ('free', 'free-stream', 'paid');
$$;

revoke all on function public.get_scan_totals() from public;
grant execute on function public.get_scan_totals() to anon, authenticated, service_role;
