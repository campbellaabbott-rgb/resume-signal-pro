-- Add RLS policy for product_deliveries (service role only)
CREATE POLICY "Service role only for product_deliveries"
ON public.product_deliveries
FOR ALL
USING (false)
WITH CHECK (false);