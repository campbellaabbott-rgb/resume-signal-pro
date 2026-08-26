-- The published board total refreshed once per rotation pass, so it was as
-- stale as the pass was long — and the pass that had just finished started
-- 6.7 HOURS earlier, because it spanned the slow-rotation window.
--
-- The number itself is right and stays right: `coverage.open` is an EXACT
-- count of the rows a visitor can actually page to (missing_since IS NULL,
-- inside the freshness window), chosen after an audit rejected two other
-- candidates for being unverifiable from outside. Only its CADENCE was wrong.
--
-- Measured before building this: that exact count answers in 0.63s against
-- 550,227 rows. It was taken once per pass because it was free THERE — it
-- rides along with the coverage fractions — not because it is expensive. At
-- 0.63s it can run every fifteen minutes for nothing.
--
-- A PATCH, NOT A SECOND WRITER. The obvious implementation is to have the
-- refresher upsert the `refresh` meta row. That is the exact shape this repo
-- has already been burned by: an upsert replaces the whole `v` JSON, and when
-- two sites wrote that row the second silently dropped the first's fields —
-- it zeroed the `rot` counter every hop and a whole lane never ran once
-- (2026-07-25). So this touches ONLY the two keys it owns and cannot clobber
-- companiesFacet, categoriesFacet, failedSources or anything else, whatever
-- the pass-end writer is doing concurrently.
--
-- openAt is separate from refreshedAt on purpose. refreshedAt says when the
-- FACETS were computed and is still honest at pass cadence; openAt says when
-- the COUNT was. Reusing refreshedAt would have made the facets claim a
-- freshness only the count has.
CREATE OR REPLACE FUNCTION public.refresh_headline_open()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $$
DECLARE
  v_open bigint;
BEGIN
  SELECT count(*) INTO v_open
  FROM public.job_board_postings p
  WHERE p.missing_since IS NULL
    AND p.effective_posted >= now() - interval '30 days';

  -- Concatenation rather than jsonb_set: a nested jsonb_set is a no-op when
  -- the parent key is absent, which would have made this silently do nothing
  -- on a meta row that has no coverage object yet.
  UPDATE public.job_board_meta
     SET v = coalesce(v, '{}'::jsonb) || jsonb_build_object(
               'coverage',
               coalesce(v -> 'coverage', '{}'::jsonb)
                 || jsonb_build_object('open', v_open, 'openAt', now())
             ),
         updated_at = now()
   WHERE k = 'refresh';

  RETURN v_open;
END;
$$;

-- Counts every row of the largest table in the schema; maintenance-only, same
-- lockdown as the other definer functions here.
REVOKE ALL ON FUNCTION public.refresh_headline_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_headline_open() TO service_role;
