-- Industry-correction feedback loop: every time a user overrides the detected
-- industry in the report's confirmation strip, log the detected→corrected pair.
-- Recurring pairs are the engine's blind spots — a weekly digest surfaces them
-- so they become disambiguation rules and golden-test fixtures.

create table if not exists public.industry_corrections (
  id uuid primary key default gen_random_uuid(),
  detected text not null,
  corrected text not null,
  detection_source text,
  detection_confidence text,
  created_at timestamptz not null default now()
);

alter table public.industry_corrections enable row level security;
-- Writes go through the security-definer function below; no direct client access.

create index if not exists industry_corrections_pair_idx
  on public.industry_corrections (detected, corrected, created_at desc);

create or replace function public.log_industry_correction(
  p_detected text,
  p_corrected text,
  p_source text default null,
  p_confidence text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard against junk: both slugs required, must differ, keep them short.
  if p_detected is null or p_corrected is null
     or length(p_detected) > 50 or length(p_corrected) > 50
     or p_detected = p_corrected then
    return;
  end if;
  insert into public.industry_corrections (detected, corrected, detection_source, detection_confidence)
  values (lower(trim(p_detected)), lower(trim(p_corrected)), left(p_source, 60), left(p_confidence, 20));
end;
$$;

grant execute on function public.log_industry_correction(text, text, text, text) to anon, authenticated;

-- Aggregated view for the weekly digest (service-role reads only).
create or replace function public.get_industry_correction_stats(p_days integer default 7)
returns table (detected text, corrected text, corrections bigint, last_seen timestamptz)
language sql
security definer
set search_path = public
as $$
  select detected, corrected, count(*) as corrections, max(created_at) as last_seen
  from public.industry_corrections
  where created_at > now() - make_interval(days => p_days)
  group by detected, corrected
  order by corrections desc, last_seen desc
  limit 50;
$$;

-- Weekly digest: Mondays 09:15 UTC, mirrors the signup-notification pattern.
select cron.schedule(
  'industry-corrections-digest',
  '15 9 * * 1',
  $$
  select net.http_post(
    url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/industry-corrections-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
