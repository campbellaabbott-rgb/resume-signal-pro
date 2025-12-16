-- Create table to track used Stripe sessions (persistent across function restarts)
CREATE TABLE public.used_stripe_sessions (
  session_id TEXT PRIMARY KEY,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT
);

-- Index for cleanup queries
CREATE INDEX idx_used_sessions_timestamp ON public.used_stripe_sessions(used_at);

-- Enable RLS - service role only
ALTER TABLE public.used_stripe_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policy: no direct access (service role bypasses RLS)
CREATE POLICY "Service role only" ON public.used_stripe_sessions
  FOR ALL USING (false) WITH CHECK (false);