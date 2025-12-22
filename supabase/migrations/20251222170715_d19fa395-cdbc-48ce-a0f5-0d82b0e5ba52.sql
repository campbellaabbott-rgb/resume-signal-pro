-- Create table to track payment failures
CREATE TABLE public.payment_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  failure_code TEXT,
  failure_message TEXT,
  customer_email TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payment_failures ENABLE ROW LEVEL SECURITY;

-- Only service role can access (for security)
CREATE POLICY "Service role only" ON public.payment_failures
  FOR ALL USING (false) WITH CHECK (false);

-- Create index for querying by date
CREATE INDEX idx_payment_failures_created_at ON public.payment_failures(created_at DESC);
CREATE INDEX idx_payment_failures_payment_intent ON public.payment_failures(payment_intent_id);