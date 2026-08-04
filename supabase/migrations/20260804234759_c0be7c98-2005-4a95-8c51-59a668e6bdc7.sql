CREATE OR REPLACE FUNCTION public.agent_confirmation_gaps(p_days integer DEFAULT 30)
RETURNS TABLE(wording text, occurrences bigint, last_seen timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH blk AS (
    SELECT s.updated_at,
           jsonb_array_elements(COALESCE(s.blockers, '[]'::jsonb)) AS b
      FROM public.agent_submissions s
     WHERE s.updated_at >= now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
  ),
  said AS (
    SELECT updated_at,
           left(COALESCE(substring(b->>'detail' from 'page said: "(.*)'), ''), 200) AS wording
      FROM blk
     WHERE b->>'kind' = 'uncertain-submit'
  )
  SELECT wording,
         count(*)          AS occurrences,
         max(updated_at)   AS last_seen
    FROM said
   WHERE length(btrim(wording)) > 0
   GROUP BY wording
   ORDER BY count(*) DESC, max(updated_at) DESC
   LIMIT 25;
$$;

REVOKE ALL ON FUNCTION public.agent_confirmation_gaps(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_confirmation_gaps(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_confirmation_gaps(integer) IS
  'What confirmation pages actually said when the worker could not recognise them. Returns page wording only — no user, no posting, no URL.';