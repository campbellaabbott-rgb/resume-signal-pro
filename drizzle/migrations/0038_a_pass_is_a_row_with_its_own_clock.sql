CREATE TABLE IF NOT EXISTS public.agent_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL,
  stripe_payment_intent_id text,
  amount_cents integer NOT NULL,
  session_hours integer NOT NULL,
  applications_total integer NOT NULL,
  applications_used integer NOT NULL DEFAULT 0,
  rate_per_min integer NOT NULL,
  daily_quota integer NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  shelf_expires_at timestamptz NOT NULL,
  activated_at timestamptz,
  expires_at timestamptz,
  activated_via text,
  activated_user_agent text,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_passes_stripe_session_id_key UNIQUE (stripe_session_id),
  CONSTRAINT agent_passes_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id),
  CONSTRAINT agent_passes_applications_within_total
    CHECK (applications_used >= 0 AND applications_used <= applications_total),
  CONSTRAINT agent_passes_close_reason_known
    CHECK (close_reason IS NULL OR close_reason IN ('session_ended', 'shelf_expired', 'refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_passes_one_open_pass_per_user
  ON public.agent_passes (user_id)
  WHERE closed_at IS NULL;

ALTER TABLE public.agent_queue
  ADD COLUMN IF NOT EXISTS pass_id uuid REFERENCES public.agent_passes(id);

ALTER TABLE public.agent_submissions
  ADD COLUMN IF NOT EXISTS pass_id uuid REFERENCES public.agent_passes(id),
  ADD COLUMN IF NOT EXISTS pass_refunded_at timestamptz;

CREATE INDEX IF NOT EXISTS agent_queue_pass_idx
  ON public.agent_queue (pass_id) WHERE pass_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_submissions_pass_idx
  ON public.agent_submissions (pass_id) WHERE pass_id IS NOT NULL;

ALTER TABLE public.agent_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_passes_owner_read ON public.agent_passes;
CREATE POLICY agent_passes_owner_read ON public.agent_passes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.agent_passes FROM PUBLIC, anon;
GRANT SELECT ON public.agent_passes TO authenticated;
GRANT ALL ON public.agent_passes TO service_role;

COMMENT ON TABLE public.agent_passes IS
  'One timed Agent Pass per purchase. Numbers are copied in at grant from the charging runtime; state is derived from activated_at/expires_at/shelf_expires_at/closed_at, never a status column. At most one open pass per user (partial unique index).';
COMMENT ON COLUMN public.agent_passes.activated_via IS
  'How the first allowed call arrived: key, or oauth:<client_id>. Written by agent-mcp after api_key_check activates the pass.';
COMMENT ON COLUMN public.agent_passes.close_reason IS
  'Why closed_at was set: session_ended (the clock ran out), shelf_expired (never activated), refunded.';
COMMENT ON COLUMN public.agent_queue.pass_id IS
  'The pass that paid for this request, stamped at accept inside agent_queue_enqueue. NULL for subscription-funded and runner-picked rows.';
COMMENT ON COLUMN public.agent_submissions.pass_refunded_at IS
  'Set once by the refund trigger when a pass-funded application was recorded as never sent; makes the refund idempotent.';