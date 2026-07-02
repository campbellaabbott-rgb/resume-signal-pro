-- Accounts v2: persistent fix checklist, target score goal, and the
-- application tracker. All user-owned rows under RLS.

-- Fix plan travels with each saved scan; checklist state is user-editable.
alter table public.user_scans
  add column if not exists fix_plan jsonb;

create policy "users update own scans"
  on public.user_scans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-user preferences (target score goal, future settings).
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_score int check (target_score between 1 and 100),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

create policy "users read own profile"
  on public.user_profiles for select using (auth.uid() = user_id);
create policy "users insert own profile"
  on public.user_profiles for insert with check (auth.uid() = user_id);
create policy "users update own profile"
  on public.user_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Application tracker lite: the spreadsheet job seekers keep, in the account.
create table if not exists public.user_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null,
  role text not null default '',
  status text not null default 'applied', -- applied | interviewing | offer | rejected
  scan_score int,
  applied_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.user_applications enable row level security;

create policy "users read own applications"
  on public.user_applications for select using (auth.uid() = user_id);
create policy "users insert own applications"
  on public.user_applications for insert with check (auth.uid() = user_id);
create policy "users update own applications"
  on public.user_applications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own applications"
  on public.user_applications for delete using (auth.uid() = user_id);

create index if not exists user_applications_user_idx
  on public.user_applications (user_id, created_at desc);
