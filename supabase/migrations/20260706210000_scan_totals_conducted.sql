-- Hero counter counts scans CONDUCTED (any outcome), not just completed —
-- matching how the Lovable dashboard reports total scans (count of all
-- logged attempts). Still real user scan types only: synthetic test scans
-- and heartbeat probes stay out, per the published-stats policy.

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
  where scan_type in ('free', 'free-stream', 'paid');
$$;

revoke all on function public.get_scan_totals() from public;
grant execute on function public.get_scan_totals() to anon, authenticated, service_role;
