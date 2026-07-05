-- Fix: production already had a December-era industry_corrections table with
-- columns (original_industry, corrected_industry, ...). The July 4 migration's
-- CREATE TABLE IF NOT EXISTS silently no-opped against it, and the
-- log_industry_correction function inserted into columns that don't exist —
-- so every correction logged from the report since then failed silently.
-- Rewrite both functions against the REAL schema.

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
  if p_detected is null or p_corrected is null
     or length(p_detected) > 50 or length(p_corrected) > 50
     or p_detected = p_corrected then
    return;
  end if;
  insert into public.industry_corrections (original_industry, corrected_industry, detection_source, original_confidence)
  values (lower(trim(p_detected)), lower(trim(p_corrected)), left(p_source, 60), left(p_confidence, 20));
end;
$$;

grant execute on function public.log_industry_correction(text, text, text, text) to anon, authenticated;

create or replace function public.get_industry_correction_stats(p_days integer default 7)
returns table (detected text, corrected text, corrections bigint, last_seen timestamptz)
language sql
security definer
set search_path = public
as $$
  select original_industry as detected,
         corrected_industry as corrected,
         count(*) as corrections,
         max(created_at) as last_seen
  from public.industry_corrections
  where created_at > now() - make_interval(days => p_days)
  group by original_industry, corrected_industry
  order by corrections desc, last_seen desc
  limit 50;
$$;
