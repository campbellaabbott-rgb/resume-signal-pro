ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS email_opt_in boolean NOT NULL DEFAULT true;
ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS email_last_sent_at timestamptz;

COMMENT ON COLUMN public.agent_mandates.email_opt_in IS
  'Morning shortlist email. Default true (the mandate is an explicit opt-in to the service); unsubscribe link flips it false.';
COMMENT ON COLUMN public.agent_mandates.email_last_sent_at IS
  'Last morning email. Doubles as the "new picks since" cursor so re-runs never double-send.';

CREATE INDEX IF NOT EXISTS idx_agent_mandates_email_due
  ON public.agent_mandates (email_opt_in, email_last_sent_at);