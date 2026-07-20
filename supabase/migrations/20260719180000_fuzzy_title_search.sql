-- Typo tolerance. websearch_to_tsquery on a misspelled term ("enginer",
-- "reprensentative") matches nothing, and the ilike fallback ('%enginer%')
-- misses too — so a single typo currently returns an empty board. This is a
-- LAST-RESORT fuzzy match: the edge function calls it only when the normal
-- ranked + recency paths both come back empty. It uses trigram similarity on
-- the title (the job_board_postings_title_trgm_idx GIN index already exists —
-- no new index here), so "enginer" surfaces "engineer" roles. Bounded and
-- honest: capped at p_limit, ordered by closeness, and the UI labels these as
-- "closest matches", never as exact results.
CREATE OR REPLACE FUNCTION public.fuzzy_title_search(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  id text, source text, company_token text, company text, title text,
  location text, remote boolean, department text, category text,
  posted_at timestamptz, apply_url text, salary text, experience_band text,
  min_years integer, last_seen timestamptz, total_rows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
-- pg_trgm similarity threshold: 0.3 catches one/two-char typos and minor
-- variants without pulling in unrelated titles.
AS $$
  WITH m AS (
    SELECT p.*, similarity(p.title, p_q) AS sim
    FROM public.job_board_postings p
    WHERE p.title % p_q
      AND p.effective_posted >= p_fresh_cutoff
    ORDER BY similarity(p.title, p_q) DESC, p.effective_posted DESC
    LIMIT GREATEST(LEAST(p_limit, 60), 1)
  )
  SELECT id, source, company_token, company, title, location, remote,
         department, category, posted_at, apply_url, salary, experience_band,
         min_years::integer, last_seen,
         (SELECT count(*) FROM m)::bigint AS total_rows
  FROM m
  ORDER BY sim DESC, effective_posted DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fuzzy_title_search(text, timestamptz, integer) TO anon, authenticated, service_role;
