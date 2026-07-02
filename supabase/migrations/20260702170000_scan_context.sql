-- Per-scan context: seniority correction learning + remembered user context.

-- Experience-level corrections previously vanished; industry corrections
-- already train the engine. Same pattern: anonymous-friendly writes through a
-- SECURITY DEFINER function, no direct table access.
create table if not exists public.seniority_corrections (
  id uuid primary key default gen_random_uuid(),
  detected_level text not null,
  corrected_level text not null,
  detected_years text,
  industry text,
  resume_text_length int,
  visitor_id text,
  created_at timestamptz not null default now()
);

alter table public.seniority_corrections enable row level security;
-- No public policies — writes go through the function below, reads are service-role.

create or replace function public.log_seniority_correction(
  p_detected_level text,
  p_corrected_level text,
  p_detected_years text default null,
  p_industry text default null,
  p_resume_text_length int default null,
  p_visitor_id text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Bound inputs: only known levels, capped text sizes
  if p_detected_level not in ('entry','mid','senior','executive')
     or p_corrected_level not in ('entry','mid','senior','executive') then
    return false;
  end if;
  insert into public.seniority_corrections
    (detected_level, corrected_level, detected_years, industry, resume_text_length, visitor_id)
  values
    (p_detected_level, p_corrected_level, left(p_detected_years, 40), left(p_industry, 60), p_resume_text_length, left(p_visitor_id, 80));
  return true;
end;
$$;

grant execute on function public.log_seniority_correction to anon, authenticated;

-- Remembered context for signed-in users: prefills the next scan.
alter table public.user_profiles
  add column if not exists situation text,
  add column if not exists target_role text,
  add column if not exists confirmed_industry text,
  add column if not exists confirmed_experience text;
