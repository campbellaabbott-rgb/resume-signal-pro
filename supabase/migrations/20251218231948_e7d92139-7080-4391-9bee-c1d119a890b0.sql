-- Create update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create table to track user scan credits by email
CREATE TABLE public.user_scan_credits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  total_credits_purchased INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.user_scan_credits ENABLE ROW LEVEL SECURITY;

-- Public read access (users check their own credits by email)
CREATE POLICY "Anyone can read credits by email"
ON public.user_scan_credits
FOR SELECT
USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage credits"
ON public.user_scan_credits
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_user_scan_credits_email ON public.user_scan_credits(email);

-- Trigger to update updated_at
CREATE TRIGGER update_user_scan_credits_updated_at
BEFORE UPDATE ON public.user_scan_credits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RPC function to add credits after purchase
CREATE OR REPLACE FUNCTION public.add_scan_credits(p_email TEXT, p_credits INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased)
  VALUES (lower(trim(p_email)), p_credits, p_credits)
  ON CONFLICT (email) DO UPDATE
  SET 
    credits_remaining = user_scan_credits.credits_remaining + p_credits,
    total_credits_purchased = user_scan_credits.total_credits_purchased + p_credits,
    updated_at = now();
  RETURN true;
END;
$$;

-- RPC function to use a credit (returns true if credit was used, false if none available)
CREATE OR REPLACE FUNCTION public.use_scan_credit(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  SELECT credits_remaining INTO v_credits
  FROM public.user_scan_credits
  WHERE email = lower(trim(p_email));
  
  IF v_credits IS NULL OR v_credits <= 0 THEN
    RETURN false;
  END IF;
  
  UPDATE public.user_scan_credits
  SET credits_remaining = credits_remaining - 1, updated_at = now()
  WHERE email = lower(trim(p_email)) AND credits_remaining > 0;
  
  RETURN true;
END;
$$;

-- RPC function to get credits for email
CREATE OR REPLACE FUNCTION public.get_scan_credits(p_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  SELECT credits_remaining INTO v_credits
  FROM public.user_scan_credits
  WHERE email = lower(trim(p_email));
  
  RETURN COALESCE(v_credits, 0);
END;
$$;