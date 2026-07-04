-- Shortlist: employer-side resume screening with a compliance-first schema.
-- Legal frame (see COMPLIANCE.md): the employer carries liability under NYC
-- LL144 / IL HB 3773 / CA FEHA ADS / EU AI Act, so this schema IS the
-- customer's compliance evidence trail. The tool recommends and ranks only —
-- decisions are always human, and every decision/override is logged
-- append-only.

-- ── Roles (one hiring role = one screening workspace) ───────────────────────
create table if not exists public.shortlist_roles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  jd_text text not null,
  jd_version int not null default 1,
  -- Jurisdiction routing drives notice workflows + retention (NYC/IL/CA/EU/OTHER)
  jurisdiction text not null default 'OTHER'
    check (jurisdiction in ('NYC','IL','CA','EU','OTHER')),
  created_at timestamptz not null default now()
);

alter table public.shortlist_roles enable row level security;
create policy "owners read own roles" on public.shortlist_roles for select using (auth.uid() = owner_id);
create policy "owners insert own roles" on public.shortlist_roles for insert with check (auth.uid() = owner_id);
create policy "owners update own roles" on public.shortlist_roles for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Candidate evaluations (the audit log core) ──────────────────────────────
-- Append-only within the retention window: owners may INSERT and SELECT, and
-- may UPDATE ONLY the human-decision fields (status), never the AI outputs.
-- No delete policy — retention default is 4 years (CA FEHA recordkeeping).
create table if not exists public.shortlist_candidates (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.shortlist_roles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text,
  -- The REDACTED text that was actually scored (proxy variables stripped) +
  -- an audit of which exclusions fired. Raw resume text is NOT stored by
  -- default (data minimization); the file stays with the employer.
  redacted_text text,
  exclusions_applied jsonb,          -- [{feature, count}] proxy redaction audit
  parsed_fields jsonb,               -- structured, job-related fields only
  score int,
  flags jsonb,                       -- red flags surfaced (job-related only)
  signals jsonb,                     -- "signals considered" explanation
  interview_questions jsonb,
  level_read text,
  model_version text,                -- model/prompt version for reproducibility
  jd_version int not null default 1,
  status text not null default 'pending'
    check (status in ('pending','advanced','rejected')),
  candidate_jurisdiction text default 'OTHER',
  created_at timestamptz not null default now()
);

alter table public.shortlist_candidates enable row level security;
create policy "owners read own candidates" on public.shortlist_candidates for select using (auth.uid() = owner_id);
create policy "owners insert own candidates" on public.shortlist_candidates for insert with check (auth.uid() = owner_id);
-- Status is the only human-mutable field; enforced in the app layer and by the
-- decisions log below being the source of truth for changes.
create policy "owners update own candidates" on public.shortlist_candidates for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists shortlist_candidates_role_idx on public.shortlist_candidates (role_id, score desc);

-- ── Human decisions & overrides (strictly append-only) ──────────────────────
-- Every advancement, rejection, and score override: who, when, old → new, why.
-- INSERT + SELECT only. No update/delete policies exist — rows are immutable.
create table if not exists public.shortlist_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.shortlist_candidates(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_email text,
  action text not null check (action in ('advance','reject','override_score','note','notice_sent','alt_review_requested')),
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.shortlist_decisions enable row level security;
create policy "owners read own decisions" on public.shortlist_decisions for select using (auth.uid() = owner_id);
create policy "owners insert own decisions" on public.shortlist_decisions for insert with check (auth.uid() = owner_id);
-- Deliberately NO update or delete policies: append-only by construction.

create index if not exists shortlist_decisions_candidate_idx on public.shortlist_decisions (candidate_id, created_at);

-- ── Demographics (bias-audit math ONLY — never joined into scoring) ─────────
-- Optional, candidate-self-reported or employer-recorded, stored apart from
-- evaluations. The scoring pipeline has no read path to this table; it exists
-- solely for aggregate selection-rate / impact-ratio computation (NYC LL144).
create table if not exists public.shortlist_demographics (
  candidate_id uuid primary key references public.shortlist_candidates(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sex text,               -- self-identified; free text bucketed at audit time
  race_ethnicity text,    -- self-identified
  created_at timestamptz not null default now()
);

alter table public.shortlist_demographics enable row level security;
create policy "owners read own demographics" on public.shortlist_demographics for select using (auth.uid() = owner_id);
create policy "owners insert own demographics" on public.shortlist_demographics for insert with check (auth.uid() = owner_id);
create policy "owners update own demographics" on public.shortlist_demographics for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Candidate notices (NYC 10-business-day, IL AI-use, EU disclosure) ───────
create table if not exists public.shortlist_notices (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.shortlist_roles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  jurisdiction text not null,
  notice_type text not null,        -- 'nyc_advance' | 'il_ai_use' | 'eu_disclosure'
  content text not null,            -- the exact notice text generated
  sent_at timestamptz not null default now()
);

alter table public.shortlist_notices enable row level security;
create policy "owners read own notices" on public.shortlist_notices for select using (auth.uid() = owner_id);
create policy "owners insert own notices" on public.shortlist_notices for insert with check (auth.uid() = owner_id);
-- Append-only: no update/delete.
