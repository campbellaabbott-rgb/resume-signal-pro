-- Create table for permanent storage of purchased content
CREATE TABLE IF NOT EXISTS public.purchased_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  customer_email TEXT NOT NULL,
  product_type TEXT NOT NULL,
  product_name TEXT,
  generated_content JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '365 days')
);

-- Create index for email lookups
CREATE INDEX idx_purchased_content_email ON public.purchased_content(customer_email);
CREATE INDEX idx_purchased_content_session ON public.purchased_content(stripe_session_id);

-- Enable RLS
ALTER TABLE public.purchased_content ENABLE ROW LEVEL SECURITY;

-- Only service role can insert/update
CREATE POLICY "Service role can manage purchased content"
ON public.purchased_content
FOR ALL
USING (true)
WITH CHECK (true);

-- Create function to save purchased content
CREATE OR REPLACE FUNCTION public.save_purchased_content(
  p_stripe_session_id TEXT,
  p_customer_email TEXT,
  p_product_type TEXT,
  p_product_name TEXT,
  p_generated_content JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO purchased_content (stripe_session_id, customer_email, product_type, product_name, generated_content)
  VALUES (p_stripe_session_id, p_customer_email, p_product_type, p_product_name, p_generated_content)
  ON CONFLICT (stripe_session_id) DO UPDATE SET
    generated_content = EXCLUDED.generated_content
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Create function to get purchased content by email
CREATE OR REPLACE FUNCTION public.get_purchased_content_by_email(p_email TEXT)
RETURNS TABLE(
  id UUID,
  stripe_session_id TEXT,
  product_type TEXT,
  product_name TEXT,
  generated_content JSONB,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.id,
    pc.stripe_session_id,
    pc.product_type,
    pc.product_name,
    pc.generated_content,
    pc.created_at
  FROM purchased_content pc
  WHERE LOWER(pc.customer_email) = LOWER(p_email)
    AND (pc.expires_at IS NULL OR pc.expires_at > now())
  ORDER BY pc.created_at DESC;
END;
$$;

-- Create function to get purchased content by session ID
CREATE OR REPLACE FUNCTION public.get_purchased_content_by_session(p_session_id TEXT)
RETURNS TABLE(
  id UUID,
  customer_email TEXT,
  product_type TEXT,
  product_name TEXT,
  generated_content JSONB,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pc.id,
    pc.customer_email,
    pc.product_type,
    pc.product_name,
    pc.generated_content,
    pc.created_at
  FROM purchased_content pc
  WHERE pc.stripe_session_id = p_session_id
    AND (pc.expires_at IS NULL OR pc.expires_at > now());
END;
$$;