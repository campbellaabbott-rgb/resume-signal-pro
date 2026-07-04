-- Resume Booster Pro: $45/month all-access subscription.
-- pro_subscribers is a server-maintained cache of Stripe subscription state
-- (source of truth stays Stripe; the cache makes rate-limit checks and grant
-- issuance fast). pro_grants are one-time, server-issued entitlements that
-- let an active subscriber run any paid product without a Stripe checkout —
-- unforgeable because only service-role code can insert them.

create table if not exists public.pro_subscribers (
  email text primary key,
  stripe_customer_id text,
  status text not null default 'inactive',   -- active | trialing | past_due | canceled | inactive
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pro_subscribers enable row level security;
-- Service-role only: no public policies. Clients learn their status through
-- the check-subscription function (JWT-verified).

create table if not exists public.pro_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  product_id text not null,
  product_type text,
  product_name text,
  credits integer,
  resume_session_id text,
  job_title text,
  job_company text,
  language text,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.pro_grants enable row level security;
-- Service-role only. Grants are single-use: verify-product-purchase marks
-- consumed_at and refuses reuse.

create index if not exists pro_grants_email_idx on public.pro_grants (email, created_at desc);
