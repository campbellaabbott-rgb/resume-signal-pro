-- Update the record_affiliate_conversion function to use 20% commission
CREATE OR REPLACE FUNCTION public.record_affiliate_conversion(
  p_referral_code text,
  p_stripe_session_id text,
  p_sale_amount integer,
  p_product_name text,
  p_commission_override integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id uuid;
  v_commission integer;
BEGIN
  -- Find the affiliate by referral code
  SELECT id INTO v_affiliate_id
  FROM affiliates
  WHERE referral_code = p_referral_code AND status = 'active';
  
  IF v_affiliate_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Calculate commission: use override if provided, otherwise 20% of sale amount
  IF p_commission_override IS NOT NULL THEN
    v_commission := p_commission_override;
  ELSE
    -- 20% commission (sale_amount is in cents, so this gives 20% in cents)
    v_commission := ROUND(p_sale_amount * 0.20);
  END IF;
  
  -- Insert the conversion record
  INSERT INTO affiliate_conversions (
    affiliate_id,
    stripe_session_id,
    sale_amount,
    commission_amount,
    product_name,
    status
  ) VALUES (
    v_affiliate_id,
    p_stripe_session_id,
    p_sale_amount,
    v_commission,
    p_product_name,
    'pending'
  );
  
  -- Update affiliate totals
  UPDATE affiliates
  SET 
    total_earnings = total_earnings + v_commission,
    pending_payout = pending_payout + v_commission,
    updated_at = now()
  WHERE id = v_affiliate_id;
  
  RETURN true;
END;
$$;

-- Also update the default commission_amount in affiliates table to reflect 20% concept
-- (This is just the default display value, actual commission is calculated per sale)
COMMENT ON COLUMN affiliates.commission_amount IS 'Legacy field - actual commission is now 20% of each sale';