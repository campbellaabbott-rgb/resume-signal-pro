-- Global AI-scan concurrency control. The AI gateway is the platform's only
-- real bottleneck under load: beyond its per-key capacity, calls queue into
-- retry chains and users see multi-minute scans or timeouts. These functions
-- give free-keyword-scan a global in-flight counter so overflow scans can be
-- load-shed to the instant rule-based report instead.
--
-- Design: one row per in-flight scan; stale rows (crashed isolates) expire by
-- TTL, so the counter self-heals. An advisory transaction lock serializes
-- acquisition — cheap at these rates, prevents count-then-insert races.

create table if not exists public.scan_slots (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now()
);

alter table public.scan_slots enable row level security;
-- Service-role only via the security-definer functions below.

create or replace function public.acquire_scan_slot(p_max integer, p_ttl_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(874231);
  delete from public.scan_slots where started_at < now() - make_interval(secs => p_ttl_seconds);
  if (select count(*) from public.scan_slots) >= p_max then
    return null;
  end if;
  insert into public.scan_slots default values returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.release_scan_slot(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.scan_slots where id = p_id;
$$;

grant execute on function public.acquire_scan_slot(integer, integer) to service_role;
grant execute on function public.release_scan_slot(uuid) to service_role;
