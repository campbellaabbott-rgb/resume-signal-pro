-- Remove overly permissive public read policy on user_scan_credits
-- The frontend already uses the secure get_scan_credits RPC function
DROP POLICY IF EXISTS "Anyone can read credits by email" ON public.user_scan_credits;