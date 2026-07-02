-- Free accounts: cloud scan history tied to auth.users. Credits
-- (user_scan_credits) and purchases (purchased_content) already key by
-- email — accounts link to them through the authenticated email, so no
-- schema change is needed there.

create table if not exists public.user_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ats_score int not null,
  projected_score int,
  industry text,
  verdict text,
  red_flag_count int,
  created_at timestamptz not null default now()
);

alter table public.user_scans enable row level security;

-- Users read and write only their own scan history.
create policy "users read own scans"
  on public.user_scans for select
  using (auth.uid() = user_id);

create policy "users insert own scans"
  on public.user_scans for insert
  with check (auth.uid() = user_id);

create policy "users delete own scans"
  on public.user_scans for delete
  using (auth.uid() = user_id);

create index if not exists user_scans_user_created_idx
  on public.user_scans (user_id, created_at desc);
