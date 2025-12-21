-- Fix affiliate auth functions to include extensions schema in search_path (pgcrypto lives in extensions)

CREATE OR REPLACE FUNCTION public.register_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

CREATE OR REPLACE FUNCTION public.login_affiliate(
  p_email TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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