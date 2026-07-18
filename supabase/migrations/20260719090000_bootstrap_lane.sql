-- New-board bootstrap lane: after a catalog deploy, boards with zero rows
-- used to wait at the tail of the cold rotation (~a full pass) before their
-- first ingest. get_empty_boards lets the refresh find them in one call so
-- they can jump the queue via the existing demand-lane pattern.
-- The company_token btree index also serves the ghost-index open_roles
-- subquery and company drill-downs (only trgm/company-name indexes existed).
CREATE INDEX IF NOT EXISTS job_board_postings_company_token_idx
  ON public.job_board_postings (company_token);

CREATE OR REPLACE FUNCTION public.get_empty_boards(p_tokens text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(t.token), '{}')
  FROM unnest(p_tokens) AS t(token)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.job_board_postings p WHERE p.company_token = t.token
  );
$$;
-- Refresh-internal only: the catalog token list is not a public surface.
REVOKE EXECUTE ON FUNCTION public.get_empty_boards(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_empty_boards(text[]) TO service_role;
