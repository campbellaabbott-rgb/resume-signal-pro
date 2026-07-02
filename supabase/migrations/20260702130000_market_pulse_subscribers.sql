-- Market pulse alerts: opt-in subscribers who get a periodic email with the
-- keyword trends for their industry and a rescan nudge. Service-role access
-- only (written by send-scan-report, read by send-market-pulse).

create table if not exists public.market_pulse_subscribers (
  email text primary key,
  industry text not null default 'general',
  last_score int,
  subscribed_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unsubscribed_at timestamptz
);

alter table public.market_pulse_subscribers enable row level security;

-- No public policies: only edge functions (service role) touch this table.

create index if not exists market_pulse_subscribers_active_idx
  on public.market_pulse_subscribers (industry)
  where unsubscribed_at is null;
