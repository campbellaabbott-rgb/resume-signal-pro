-- Create affiliates table for storing affiliate accounts
CREATE TABLE public.affiliates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  commission_amount INTEGER NOT NULL DEFAULT 500, -- Fixed amount in cents (e.g., $5.00)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'banned')),
  total_earnings INTEGER NOT NULL DEFAULT 0, -- Total earned in cents
  pending_payout INTEGER NOT NULL DEFAULT 0, -- Pending payout in cents
  paid_out INTEGER NOT NULL DEFAULT 0, -- Already paid out in cents
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create referral clicks table for tracking link clicks
CREATE TABLE public.affiliate_clicks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  ip_hash TEXT, -- Hashed IP for deduplication
  user_agent TEXT,
  referrer TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create referral conversions table for tracking successful purchases
CREATE TABLE public.affiliate_conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  product_name TEXT,
  sale_amount INTEGER NOT NULL, -- Sale amount in cents
  commission_amount INTEGER NOT NULL, -- Commission earned in cents
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);

-- Create affiliate sessions table for login sessions
CREATE TABLE public.affiliate_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_sessions ENABLE ROW LEVEL SECURITY;

-- Affiliates can only read their own data
CREATE POLICY "Affiliates can view own data"
ON public.affiliates FOR SELECT
USING (false); -- Access via security definer functions only

-- No direct inserts/updates - use functions
CREATE POLICY "No direct affiliate inserts"
ON public.affiliates FOR INSERT
WITH CHECK (false);

CREATE POLICY "No direct affiliate updates"
ON public.affiliates FOR UPDATE
USING (false);

-- Clicks - service role only
CREATE POLICY "Service role only clicks"
ON public.affiliate_clicks FOR ALL
USING (false) WITH CHECK (false);

-- Conversions - service role only
CREATE POLICY "Service role only conversions"
ON public.affiliate_conversions FOR ALL
USING (false) WITH CHECK (false);

-- Sessions - service role only
CREATE POLICY "Service role only sessions"
ON public.affiliate_sessions FOR ALL
USING (false) WITH CHECK (false);

-- Create indexes for performance
CREATE INDEX idx_affiliate_referral_code ON public.affiliates(referral_code);
CREATE INDEX idx_affiliate_email ON public.affiliates(email);
CREATE INDEX idx_affiliate_clicks_affiliate ON public.affiliate_clicks(affiliate_id);
CREATE INDEX idx_affiliate_conversions_affiliate ON public.affiliate_conversions(affiliate_id);
CREATE INDEX idx_affiliate_sessions_token ON public.affiliate_sessions(session_token);

-- Function to register a new affiliate
CREATE OR REPLACE FUNCTION public.register_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID;
  v_referral_code TEXT;
  v_session_token TEXT;
BEGIN
  -- Validate email
  IF p_email IS NULL OR p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  -- Validate password
  IF p_password IS NULL OR length(p_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;
  
  -- Check if email exists
  IF EXISTS (SELECT 1 FROM affiliates WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;
  
  -- Insert affiliate with hashed password
  INSERT INTO affiliates (email, password_hash)
  VALUES (lower(trim(p_email)), crypt(p_password, gen_salt('bf')))
  RETURNING id, referral_code INTO v_affiliate_id, v_referral_code;
  
  -- Create session
  INSERT INTO affiliate_sessions (affiliate_id)
  VALUES (v_affiliate_id)
  RETURNING session_token INTO v_session_token;
  
  RETURN jsonb_build_object(
    'success', true,
    'affiliate_id', v_affiliate_id,
    'referral_code', v_referral_code,
    'session_token', v_session_token
  );
END;
$$;

-- Function to login affiliate
CREATE OR REPLACE FUNCTION public.login_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate affiliates%ROWTYPE;
  v_session_token TEXT;
BEGIN
  -- Get affiliate
  SELECT * INTO v_affiliate
  FROM affiliates
  WHERE email = lower(trim(p_email));
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or password';
  END IF;
  
  -- Check password
  IF v_affiliate.password_hash != crypt(p_password, v_affiliate.password_hash) THEN
    RAISE EXCEPTION 'Invalid email or password';
  END IF;
  
  -- Check status
  IF v_affiliate.status != 'active' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;
  
  -- Clean up old sessions
  DELETE FROM affiliate_sessions 
  WHERE affiliate_id = v_affiliate.id 
    AND expires_at < now();
  
  -- Create new session
  INSERT INTO affiliate_sessions (affiliate_id)
  VALUES (v_affiliate.id)
  RETURNING session_token INTO v_session_token;
  
  RETURN jsonb_build_object(
    'success', true,
    'affiliate_id', v_affiliate.id,
    'email', v_affiliate.email,
    'referral_code', v_affiliate.referral_code,
    'session_token', v_session_token
  );
END;
$$;

-- Function to get affiliate dashboard data
CREATE OR REPLACE FUNCTION public.get_affiliate_dashboard(
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID;
  v_affiliate affiliates%ROWTYPE;
  v_total_clicks BIGINT;
  v_total_conversions BIGINT;
  v_total_revenue BIGINT;
  v_pending_payout BIGINT;
  v_paid_out BIGINT;
  v_recent_conversions JSONB;
BEGIN
  -- Validate session
  SELECT affiliate_id INTO v_affiliate_id
  FROM affiliate_sessions
  WHERE session_token = p_session_token
    AND expires_at > now();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;
  
  -- Get affiliate info
  SELECT * INTO v_affiliate
  FROM affiliates
  WHERE id = v_affiliate_id;
  
  -- Get click count
  SELECT COUNT(*) INTO v_total_clicks
  FROM affiliate_clicks
  WHERE affiliate_id = v_affiliate_id;
  
  -- Get conversion stats
  SELECT 
    COUNT(*),
    COALESCE(SUM(sale_amount), 0)
  INTO v_total_conversions, v_total_revenue
  FROM affiliate_conversions
  WHERE affiliate_id = v_affiliate_id
    AND status != 'rejected';
  
  -- Get pending payout
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_pending_payout
  FROM affiliate_conversions
  WHERE affiliate_id = v_affiliate_id
    AND status = 'approved';
  
  -- Get paid out
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_paid_out
  FROM affiliate_conversions
  WHERE affiliate_id = v_affiliate_id
    AND status = 'paid';
  
  -- Get recent conversions
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_recent_conversions
  FROM (
    SELECT 
      id,
      product_name,
      sale_amount,
      commission_amount,
      status,
      created_at
    FROM affiliate_conversions
    WHERE affiliate_id = v_affiliate_id
    ORDER BY created_at DESC
    LIMIT 20
  ) c;
  
  RETURN jsonb_build_object(
    'affiliate', jsonb_build_object(
      'id', v_affiliate.id,
      'email', v_affiliate.email,
      'referral_code', v_affiliate.referral_code,
      'commission_amount', v_affiliate.commission_amount,
      'status', v_affiliate.status,
      'created_at', v_affiliate.created_at
    ),
    'stats', jsonb_build_object(
      'total_clicks', v_total_clicks,
      'total_conversions', v_total_conversions,
      'total_revenue', v_total_revenue,
      'pending_payout', v_pending_payout,
      'paid_out', v_paid_out,
      'conversion_rate', CASE WHEN v_total_clicks > 0 
        THEN ROUND((v_total_conversions::NUMERIC / v_total_clicks::NUMERIC) * 100, 2)
        ELSE 0 END
    ),
    'recent_conversions', v_recent_conversions
  );
END;
$$;

-- Function to track affiliate click
CREATE OR REPLACE FUNCTION public.track_affiliate_click(
  p_referral_code TEXT,
  p_ip_hash TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_referrer TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id UUID;
BEGIN
  -- Get affiliate by referral code
  SELECT id INTO v_affiliate_id
  FROM affiliates
  WHERE referral_code = p_referral_code
    AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Insert click
  INSERT INTO affiliate_clicks (affiliate_id, ip_hash, user_agent, referrer)
  VALUES (v_affiliate_id, p_ip_hash, p_user_agent, p_referrer);
  
  RETURN TRUE;
END;
$$;

-- Function to record affiliate conversion (called after successful payment)
CREATE OR REPLACE FUNCTION public.record_affiliate_conversion(
  p_referral_code TEXT,
  p_stripe_session_id TEXT,
  p_product_name TEXT,
  p_sale_amount INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate affiliates%ROWTYPE;
BEGIN
  -- Get affiliate
  SELECT * INTO v_affiliate
  FROM affiliates
  WHERE referral_code = p_referral_code
    AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Check if session already recorded
  IF EXISTS (SELECT 1 FROM affiliate_conversions WHERE stripe_session_id = p_stripe_session_id) THEN
    RETURN FALSE;
  END IF;
  
  -- Insert conversion
  INSERT INTO affiliate_conversions (
    affiliate_id,
    stripe_session_id,
    product_name,
    sale_amount,
    commission_amount,
    status
  ) VALUES (
    v_affiliate.id,
    p_stripe_session_id,
    p_product_name,
    p_sale_amount,
    v_affiliate.commission_amount,
    'pending'
  );
  
  -- Update affiliate totals
  UPDATE affiliates
  SET 
    total_earnings = total_earnings + v_affiliate.commission_amount,
    pending_payout = pending_payout + v_affiliate.commission_amount,
    updated_at = now()
  WHERE id = v_affiliate.id;
  
  RETURN TRUE;
END;
$$;

-- Function to logout
CREATE OR REPLACE FUNCTION public.logout_affiliate(
  p_session_token TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM affiliate_sessions WHERE session_token = p_session_token;
  RETURN FOUND;
END;
$$;

-- Trigger to update updated_at
CREATE TRIGGER update_affiliates_updated_at
  BEFORE UPDATE ON public.affiliates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();