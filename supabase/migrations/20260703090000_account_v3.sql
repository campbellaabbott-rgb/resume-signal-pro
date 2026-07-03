-- Accounts v3: named scan versions + personal progress data for the pulse email.

-- Users label scans ("v2 after fixes", "PM-targeted") so score compare becomes
-- "which version of my resume wins".
alter table public.user_scans
  add column if not exists label text;

-- Personal progress for the market-pulse email: recent scores for a subscriber,
-- resolved by email through auth.users. SECURITY DEFINER because the pulse
-- function only holds the subscriber's email, not their user id. Bounded output.
create or replace function public.get_user_score_trend(p_email text)
returns table (ats_score int, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select us.ats_score, us.created_at
  from public.user_scans us
  join auth.users au on au.id = us.user_id
  where lower(au.email) = lower(p_email)
  order by us.created_at desc
  limit 10;
$$;

-- Service-role only: the pulse function calls this; clients have no grant.
revoke execute on function public.get_user_score_trend from anon, authenticated;
