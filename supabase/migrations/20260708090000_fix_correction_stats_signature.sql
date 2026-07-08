-- Fix the corrections-digest RPC for real this time.
--
-- Postmortem of the 2026-07-07 "NaN corrections / undefined→undefined"
-- digest email: CREATE OR REPLACE FUNCTION cannot rename an input parameter,
-- so if the database holds an older get_industry_correction_stats with a
-- differently-named parameter (p_days_back), every later "or replace"
-- migration that spelled the parameter p_days FAILED against it — silently,
-- from the app's perspective — and the digest kept matching the stale
-- function with stale output column names.
--
-- The only safe path is DROP by argument type (parameter names don't
-- participate in the signature for DROP) and recreate cleanly.

DROP FUNCTION IF EXISTS public.get_industry_correction_stats(integer);

CREATE FUNCTION public.get_industry_correction_stats(p_days integer DEFAULT 7)
RETURNS TABLE (detected text, corrected text, corrections bigint, last_seen timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT original_industry AS detected,
         corrected_industry AS corrected,
         count(*) AS corrections,
         max(created_at) AS last_seen
  FROM public.industry_corrections
  WHERE created_at > now() - make_interval(days => p_days)
  GROUP BY original_industry, corrected_industry
  ORDER BY corrections DESC, last_seen DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_industry_correction_stats(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_industry_correction_stats(integer) TO service_role;
