-- Add retry tracking columns to product_deliveries
ALTER TABLE public.product_deliveries
ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS next_retry_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_retry_error text;

-- Create index for finding deliveries that need retry
CREATE INDEX IF NOT EXISTS idx_product_deliveries_retry 
ON public.product_deliveries (next_retry_at) 
WHERE status IN ('payment_received', 'generation_failed', 'email_failed') 
AND retry_count < max_retries;

-- Create function to get failed deliveries needing retry
CREATE OR REPLACE FUNCTION public.get_failed_deliveries_for_retry(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  stripe_session_id text,
  product_type text,
  product_name text,
  customer_email text,
  status text,
  retry_count integer,
  metadata jsonb
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pd.id,
    pd.stripe_session_id,
    pd.product_type,
    pd.product_name,
    pd.customer_email,
    pd.status,
    pd.retry_count,
    pd.metadata
  FROM product_deliveries pd
  WHERE pd.status IN ('payment_received', 'generation_failed', 'email_failed')
    AND pd.retry_count < pd.max_retries
    AND (pd.next_retry_at IS NULL OR pd.next_retry_at <= now())
  ORDER BY pd.created_at ASC
  LIMIT p_limit;
END;
$$;

-- Create function to update delivery status with retry tracking
CREATE OR REPLACE FUNCTION public.update_delivery_retry(
  p_id uuid,
  p_status text,
  p_error text DEFAULT NULL,
  p_increment_retry boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_count integer;
  v_next_retry interval;
BEGIN
  -- Get current retry count
  SELECT retry_count INTO v_retry_count FROM product_deliveries WHERE id = p_id;
  
  IF v_retry_count IS NULL THEN
    RETURN false;
  END IF;
  
  -- Calculate next retry with exponential backoff (5min, 15min, 45min)
  IF p_increment_retry THEN
    v_retry_count := v_retry_count + 1;
    v_next_retry := (5 * power(3, v_retry_count - 1)) * interval '1 minute';
  END IF;
  
  UPDATE product_deliveries
  SET 
    status = p_status,
    last_retry_error = COALESCE(p_error, last_retry_error),
    retry_count = CASE WHEN p_increment_retry THEN v_retry_count ELSE retry_count END,
    next_retry_at = CASE 
      WHEN p_increment_retry AND p_status IN ('generation_failed', 'email_failed') 
      THEN now() + v_next_retry 
      ELSE NULL 
    END
  WHERE id = p_id;
  
  RETURN true;
END;
$$;