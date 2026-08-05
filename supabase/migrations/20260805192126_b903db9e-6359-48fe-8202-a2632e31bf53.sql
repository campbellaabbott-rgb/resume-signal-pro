CREATE OR REPLACE FUNCTION public.agent_fill_gaps(p_days integer DEFAULT 30)
RETURNS TABLE(
  stage text,
  source text,
  wording text,
  occurrences bigint,
  last_seen timestamptz
)
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
  fills AS (
    SELECT updated_at,
           COALESCE(NULLIF(btrim(b->>'stage'), ''), 'unstamped')       AS stage,
           COALESCE(NULLIF(btrim(b->>'source'), ''), 'unknown')        AS source,
           left(COALESCE(b->>'wording', ''), 200)                      AS wording
      FROM blk
     WHERE b->>'kind' = 'worker'
  )
  SELECT stage,
         source,
         wording,
         count(*)        AS occurrences,
         max(updated_at) AS last_seen
    FROM fills
   GROUP BY stage, source, wording
   ORDER BY count(*) DESC, max(updated_at) DESC
   LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.agent_fill_gaps(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_fill_gaps(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_fill_gaps(integer) IS
  'Why form fills refused, grouped by stage, vendor and the form''s own wording. Reads only the worker-stamped wording and never the free-text detail.';

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS max_age_days integer,
  ADD COLUMN IF NOT EXISTS include_uncategorised boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_searches
  ADD COLUMN IF NOT EXISTS max_age_days integer,
  ADD COLUMN IF NOT EXISTS include_uncategorised boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_mandates
  DROP CONSTRAINT IF EXISTS agent_mandates_max_age_days_range;
ALTER TABLE public.agent_mandates
  ADD CONSTRAINT agent_mandates_max_age_days_range
  CHECK (max_age_days IS NULL OR (max_age_days >= 1 AND max_age_days <= 30));

ALTER TABLE public.agent_searches
  DROP CONSTRAINT IF EXISTS agent_searches_max_age_days_range;
ALTER TABLE public.agent_searches
  ADD CONSTRAINT agent_searches_max_age_days_range
  CHECK (max_age_days IS NULL OR (max_age_days >= 1 AND max_age_days <= 30));

COMMENT ON COLUMN public.agent_mandates.max_age_days IS
  'Only queue postings the employer STATED were posted within this many days. Mirrors the board maxAgeDays. NULL = no constraint.';
COMMENT ON COLUMN public.agent_mandates.include_uncategorised IS
  'Also search the other bucket. Off by default.';