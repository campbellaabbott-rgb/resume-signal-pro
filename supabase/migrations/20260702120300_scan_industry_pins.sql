-- Deterministic industry pinning: the same resume must get the same industry
-- on every scan. High-confidence detections are pinned by resume hash and
-- reused on rescans, so the AI-override step can never flip the answer
-- between runs. Service-role access only (written/read by the
-- free-keyword-scan edge function).

create table if not exists public.scan_industry_pins (
  resume_hash text primary key,
  industry text not null,
  confidence text not null default 'high',
  source text not null default 'detection', -- detection | user_confirmed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scan_industry_pins enable row level security;

-- No public policies: only the service role (edge functions) touches this table.

-- Pins older than 90 days are stale (keyword tables evolve); allow cleanup jobs
-- to find them cheaply.
create index if not exists scan_industry_pins_created_at_idx
  on public.scan_industry_pins (created_at);
