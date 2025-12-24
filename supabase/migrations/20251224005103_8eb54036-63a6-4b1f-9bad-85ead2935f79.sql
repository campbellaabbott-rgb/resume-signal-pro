-- Fix email_logs: Block public access, only service role should access
DROP POLICY IF EXISTS "Service role can manage email_logs" ON public.email_logs;

CREATE POLICY "Block all public access to email_logs"
ON public.email_logs
FOR ALL
USING (false)
WITH CHECK (false);

-- Fix purchased_content: Block public access, only service role should access
DROP POLICY IF EXISTS "Service role can manage purchased content" ON public.purchased_content;

CREATE POLICY "Block all public access to purchased_content"
ON public.purchased_content
FOR ALL
USING (false)
WITH CHECK (false);