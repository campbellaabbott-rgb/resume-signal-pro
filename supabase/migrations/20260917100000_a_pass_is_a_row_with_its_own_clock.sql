-- A PASS IS A ROW WITH ITS OWN CLOCK.
--
-- The timed Agent Pass (owner decision, memory project_agent_pass) is a
-- third way to hold ONE entitlement: beside the Agent subscription, a
-- signed-in buyer pays once for a timed session with their own agent and a
-- fixed number of applications inside it. This migration is the storage
-- half and nothing else: no function, no number.
--
-- EVERY NUMBER IS COPIED IN AT GRANT, FROM THE RUNTIME THAT CHARGES. The
-- price, the session length, the application count, the quota, the rate and
-- the shelf date all arrive as parameters of agent_pass_grant (next
-- migration) and land on the row. There is deliberately NO column DEFAULT
-- for any of them: a default would be a second spelling of a product number
-- that no guard reads, and a re-stamped migration can outrank a fix
-- (project_lovable_deploys). Because the row carries its own numbers, a
-- later change to the price or the quota never rewrites a pass already
-- sold. The only literal here is applications_used starting at zero, which
-- is a fact about counting, not a product number.
--
-- STATE IS DERIVED, NEVER A STATUS COLUMN TO FLIP.
--   unactivated  activated_at IS NULL AND shelf_expires_at > now() AND closed_at IS NULL
--   live         activated_at IS NOT NULL AND expires_at > now() AND closed_at IS NULL
--   closed       everything else
-- closed_at is set LAZILY by the readers (api_key_check, agent_pass_grant,
-- agent_pass_metrics' callers, agent-pass-status) with one shared statement
-- that closes any pass whose clock or shelf has run out. Nothing flips on a
-- timer; there is no cron to forget.
--
-- ONE OPEN PASS PER USER, ENFORCED BY THE DATABASE. The partial UNIQUE index
-- on (user_id) WHERE closed_at IS NULL makes "refuse a second pass while one
-- is unactivated or live" a fact rather than a claim (the same shape as
-- api_keys_one_live_agent_key_per_user). It is only a real constraint
-- because the grant closes an ended pass FIRST — a purchase after the clock
-- ran out never trips it. The clock starts at the first allowed keyed /mcp/
-- call other than key_status (on read, inside api_key_check), never at
-- purchase: a kick at purchase bought exactly zero seconds because the buyer
-- has no mandate yet.
--
-- BOUND TO user_id, NEVER EMAIL, NEVER A KEY ID. Applications key to
-- agent_mandates.user_id and agent_queue.user_id; an email is a claim and a
-- key rotates. A row keyed by email before an account exists is the shape
-- that produced the anon-upsert hole.
--
-- agent_queue.pass_id and agent_submissions.pass_id stamp WHICH pass paid for
-- a request, at accept time. Downstream gates ask "was this row paid for",
-- never "is the pass live now" — so a request accepted late in the session
-- and sent after the clock ends is still honoured. pass_refunded_at is the
-- idempotency stamp for the refund trigger (a later migration).

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
  -- Named constraints, so the grant can tell a duplicate webhook delivery
  -- (a session or payment intent it has already recorded) from a second
  -- purchase racing the first, by CONSTRAINT_NAME rather than by guessing.
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

-- The owner may read their own passes (the post-purchase page and key_status
-- both show time and applications left). Nobody writes through RLS: every
-- write is a service-role RPC. The REVOKE from PUBLIC and anon is what turns
-- an anonymous SELECT into a permission error rather than an empty page —
-- RLS with no matching policy answers zero rows with a 200, and a probe that
-- reads "empty" cannot tell locked from unpopulated.
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
