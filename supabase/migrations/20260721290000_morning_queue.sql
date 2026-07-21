-- Morning Queue: the platform's first standing-mandate agent. A user states
-- their search intent ONCE (query/filters/salary floor + a resume snapshot);
-- a nightly runner scans the last day's genuinely-new postings, scores them
-- against the resume, triages with the company intelligence this platform
-- uniquely owns (genuine fills boost, churn-dominated companies skipped), and
-- queues the top picks with machine-readable REASONS — the user wakes up to a
-- reviewed shortlist, one tap from the apply co-pilot. The human always sends;
-- the agent never submits anywhere (no unattended external submission, ever).
--
-- Reasons are stored structured ({k:'fit',pct}|{k:'fills',n}|{k:'fresh',days}
-- |{k:'salary'}) and localized client-side, so agent output is honest data,
-- not baked English. New small tables only — plain CREATE INDEX is safe here
-- (the no-plain-index rule applies to job_board_postings).

CREATE TABLE IF NOT EXISTS public.agent_mandates (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',            -- entitlement join key (subscriptions are email-keyed)
  active boolean NOT NULL DEFAULT false,
  q text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  remote_only boolean NOT NULL DEFAULT false,
  salary_min integer,                        -- annual floor; matches only postings that STATE pay (never estimated)
  daily_count integer NOT NULL DEFAULT 5 CHECK (daily_count BETWEEN 1 AND 10),
  resume_text text NOT NULL DEFAULT '',
  last_run_at timestamptz,
  last_run_summary jsonb,                    -- {scanned, picked, skipped_churn, skipped_lowfit}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_mandates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_mandates_owner" ON public.agent_mandates;
CREATE POLICY "agent_mandates_owner" ON public.agent_mandates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Queue items snapshot the posting essentials: the live table hard-deletes on
-- prune, and a morning pick must stay reviewable even if the role closed.
CREATE TABLE IF NOT EXISTS public.agent_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  posting_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  company_token text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  apply_url text NOT NULL DEFAULT '',
  salary text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  posted_at timestamptz,
  fit_pct integer,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','approved','dismissed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (user_id, posting_id)
);
CREATE INDEX IF NOT EXISTS agent_queue_user_status_idx
  ON public.agent_queue (user_id, status, created_at DESC);
ALTER TABLE public.agent_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_queue_owner_read" ON public.agent_queue;
CREATE POLICY "agent_queue_owner_read" ON public.agent_queue
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_queue_owner_decide" ON public.agent_queue;
CREATE POLICY "agent_queue_owner_decide" ON public.agent_queue
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- inserts are runner-only (service role bypasses RLS; no anon/auth insert policy)

-- Apply Agent subscription cache (mirrors pro_subscribers: Stripe is the
-- source of truth, this is the service-role cache the nightly runner trusts).
CREATE TABLE IF NOT EXISTS public.agent_subscribers (
  email text PRIMARY KEY,
  stripe_customer_id text,
  status text NOT NULL DEFAULT 'inactive',
  current_period_end timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_subscribers ENABLE ROW LEVEL SECURITY;
-- service-role only: no public policies.

-- Nightly run at 06:10 UTC (before US mornings), same net.http_post pattern
-- as the other function crons. Queue hygiene at 06:40: unactioned picks
-- expire after 48h; everything decided/expired prunes after 14 days.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-runner-nightly') THEN
      PERFORM cron.schedule('agent-runner-nightly', '10 6 * * *',
        $job$
        SELECT net.http_post(
          url := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-runner',
          headers := '{"Content-Type": "application/json"}'::jsonb,
          body := '{}'::jsonb
        );
        $job$);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-queue-retention') THEN
      PERFORM cron.schedule('agent-queue-retention', '40 6 * * *',
        $job$
        UPDATE public.agent_queue SET status = 'expired', decided_at = now()
         WHERE status = 'ready' AND created_at < now() - interval '48 hours';
        DELETE FROM public.agent_queue WHERE created_at < now() - interval '14 days';
        $job$);
    END IF;
  END IF;
END $$;
