-- Update record_affiliate_conversion to accept optional commission override
CREATE OR REPLACE FUNCTION public.record_affiliate_conversion(
  p_referral_code TEXT,
  p_stripe_session_id TEXT,
  p_product_name TEXT,
  p_sale_amount INTEGER,
  p_commission_override INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate affiliates%ROWTYPE;
  v_commission INTEGER;
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
  
  -- Use override if provided, otherwise use affiliate's default commission
  v_commission := COALESCE(p_commission_override, v_affiliate.commission_amount);
  
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
    v_commission,
    'pending'
  );
  
  -- Update affiliate totals
  UPDATE affiliates
  SET 
    total_earnings = total_earnings + v_commission,
    pending_payout = pending_payout + v_commission,
    updated_at = now()
  WHERE id = v_affiliate.id;
  
  RETURN TRUE;
END;
$$;