-- THE HOMEPAGE SAID "200 COMPANIES", AND HALF OF THE CAUSE LIVES HERE.
--
-- Serving reads the slim refresh_head row now (accepted the moment a pass
-- writes it with a numeric companiesCount). But refresh_headline_open() — the
-- between-passes patcher that keeps the headline's open/tracked counts fresh,
-- built precisely because "the headline was a whole pass behind" — updates
-- ONLY k='refresh', the fat row serving no longer prefers. Two consequences
-- the moment the head row qualified:
--
--   * trackedTotal vanished from every list response (it reads
--     coverage.tracked, which only the fat row ever received), so the
--     homepage lost its second true number;
--   * the head row's coverage.open goes a whole pass stale between passes —
--     the exact defect the patcher was created to end, reintroduced by the
--     serving path moving out from under it.
--
-- The patcher now patches BOTH rows. Same statement, same counts, one WHERE
-- k IN — the two rows cannot drift apart on the numbers this function owns.
-- (The other half of the fix is in the edge function: two response sites
-- derived companiesCount from the head row's deliberately-truncated 200-entry
-- facet, and the head row's coverage now carries tracked at write time.)
CREATE OR REPLACE FUNCTION public.refresh_headline_open()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
DECLARE
  v_open bigint;
  v_tracked bigint;
BEGIN
  SELECT
    count(*) FILTER (
      WHERE p.missing_since IS NULL
        AND p.effective_posted >= now() - interval '30 days'
    ),
    count(*)
  INTO v_open, v_tracked
  FROM public.job_board_postings p;

  UPDATE public.job_board_meta
     SET v = coalesce(v, '{}'::jsonb) || jsonb_build_object(
               'coverage',
               coalesce(v -> 'coverage', '{}'::jsonb)
                 || jsonb_build_object('open', v_open, 'tracked', v_tracked, 'openAt', now())
             ),
         updated_at = now()
   WHERE k IN ('refresh', 'refresh_head');

  RETURN v_open;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_headline_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_headline_open() TO service_role;

COMMENT ON FUNCTION public.refresh_headline_open() IS
  'Between-passes headline freshness: recounts open (servable) and tracked (whole corpus) and patches them into the coverage of BOTH meta rows the board can serve from (refresh and refresh_head). Patching only the fat row while serving preferred the slim one is how the homepage lost trackedTotal.';
