ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS missing_since timestamptz;

CREATE OR REPLACE FUNCTION public.get_date_coverage()
RETURNS TABLE (source text, total bigint, dated bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT source, count(*) AS total, count(posted_at) AS dated
  FROM public.job_board_postings
  GROUP BY source
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_date_coverage() TO anon, authenticated;

ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS country text;
CREATE INDEX IF NOT EXISTS job_board_postings_country_idx
  ON public.job_board_postings (country) WHERE country IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_country_facet()
RETURNS TABLE (country text, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT country, count(*) AS n
  FROM public.job_board_postings
  WHERE country IS NOT NULL
  GROUP BY country
  ORDER BY count(*) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_country_facet() TO anon, authenticated;