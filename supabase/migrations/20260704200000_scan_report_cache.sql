-- Full-report cache: identical resume + context + engine version returns the
-- finished report instantly instead of a 15-110s AI round trip. Serves the
-- rescan crowd and repeat uploads; entries expire after 7 days and are purged
-- nightly. No RLS policies — service-role only.

create table if not exists public.scan_report_cache (
  cache_key text primary key,
  report jsonb not null,
  engine_version text,
  created_at timestamptz not null default now()
);

alter table public.scan_report_cache enable row level security;

create index if not exists scan_report_cache_created_idx
  on public.scan_report_cache (created_at);

-- Nightly purge at 04:10 UTC: expired cache entries plus old rate-limit and
-- telemetry rows, so the hot tables stay small under scale.
select cron.schedule(
  'scan-cache-and-telemetry-purge',
  '10 4 * * *',
  $$
  delete from public.scan_report_cache where created_at < now() - interval '7 days';
  delete from public.rate_limits where window_start < now() - interval '3 days';
  delete from public.detection_telemetry where created_at < now() - interval '90 days';
  delete from public.pro_grants where consumed_at is not null and consumed_at < now() - interval '90 days';
  $$
);
