-- Detection observability: one row per free scan. No resume content is
-- stored — only classification metadata, so trends in confidence, tiebreaker
-- activation, transition detection, and grounding drops are visible over time.

create table if not exists public.detection_telemetry (
  id uuid primary key default gen_random_uuid(),
  industry text,
  confidence text,
  source text,
  margin_ratio numeric,
  tiebreaker_used boolean default false,
  transition_detected boolean default false,
  grounding_drops integer default 0,
  used_fallback boolean default false,
  created_at timestamptz not null default now()
);

alter table public.detection_telemetry enable row level security;
-- Service-role writes only (edge function); no client policies.

create index if not exists detection_telemetry_created_idx
  on public.detection_telemetry (created_at desc);
create index if not exists detection_telemetry_source_idx
  on public.detection_telemetry (source, created_at desc);
