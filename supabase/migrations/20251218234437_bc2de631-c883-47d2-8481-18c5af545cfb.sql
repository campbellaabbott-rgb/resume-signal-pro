-- Fix security issue: Remove public SELECT access to user_scan_credits
-- The RPC functions (get_scan_credits, use_scan_credit, add_scan_credits) already provide
-- secure access to this data using SECURITY DEFINER, so direct table SELECT is unnecessary

-- Drop the permissive SELECT policy that exposes all customer emails
DROP POLICY IF EXISTS "Anyone can read credits by email" ON public.user_scan_credits;