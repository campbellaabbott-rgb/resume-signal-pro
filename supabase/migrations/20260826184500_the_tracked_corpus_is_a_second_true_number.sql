-- Publish the TRACKED total beside the searchable one.
--
-- The board has always published one figure: coverage.open, an exact count of
-- rows a visitor can actually page to. That stays the headline and stays first,
-- because it is the number the page's promise is about.
--
-- But it is not the only true number, and the other one is arguably the more
-- interesting: the corpus INCLUDING postings that have closed. On measurement
-- today, 644,440 rows against 550,378 servable — the difference is ~91k
-- postings the employer has withdrawn, still held because closure history is
-- what this product actually owns. Competitors serving a live feed cannot say
-- what closed last week; this table can.
--
-- WHY tracked IS count(*) AND NOT THE FIGURE I CALLED "INFLATED" EARLIER.
-- job_board_meta's `total` carries a documented wart — "includes just-pruned
-- orphans until the next pass recomputes" — so it is neither the servable count
-- nor an honest corpus size, just a number mid-recompute. Publishing THAT would
-- put a third, unowned quantity on the page. count(*) is a real thing with a
-- real name, so it is the one that ships.
--
-- Both counts in ONE statement, because two round trips to count two things
-- about the same table is one round trip too many, and FILTER lets Postgres do
-- a single scan.
--
-- Still a PATCH, never an upsert, for the reason 20260826171900 records: an
-- upsert of `v` drops whatever the pass-end writer owns, and that already cost
-- this schema a lane that never ran.
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
   WHERE k = 'refresh';

  RETURN v_open;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_headline_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_headline_open() TO service_role;
