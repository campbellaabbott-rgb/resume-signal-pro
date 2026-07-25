-- Agent morning email: the last hop from "a page you must remember to visit"
-- to "a service that shows up".
--
-- agent-runner already scores overnight and fills agent_queue; nothing told the
-- candidate. Two columns are all the state the sender needs:
--   email_opt_in      — on by default, because the morning shortlist IS the paid
--                       product the user configured a mandate for. Every send
--                       carries a one-click HMAC unsubscribe that flips this,
--                       and global suppressed_emails is honoured on top.
--   email_last_sent_at— send-window floor AND the "what's new since" cursor, so
--                       a re-run or a second cron fire can't double-send, and
--                       the email only ever lists picks the user hasn't been
--                       told about yet.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS email_opt_in boolean NOT NULL DEFAULT true;
ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS email_last_sent_at timestamptz;

COMMENT ON COLUMN public.agent_mandates.email_opt_in IS
  'Morning shortlist email. Default true (the mandate is an explicit opt-in to the service); unsubscribe link flips it false.';
COMMENT ON COLUMN public.agent_mandates.email_last_sent_at IS
  'Last morning email. Doubles as the "new picks since" cursor so re-runs never double-send.';

-- The sender scans mandates by opt-in + last-sent; keep that cheap.
CREATE INDEX IF NOT EXISTS idx_agent_mandates_email_due
  ON public.agent_mandates (email_opt_in, email_last_sent_at);
