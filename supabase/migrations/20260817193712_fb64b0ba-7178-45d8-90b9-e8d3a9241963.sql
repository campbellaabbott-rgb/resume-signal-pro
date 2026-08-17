-- THE BOARD COULD NOT ANSWER "HOW MANY JOBS DID WE ADD TODAY?"
--
-- Every count on the serving path is capped at 10,000 for a filtered query, so
-- asking the API for postings added in the last day and the last week both
-- returned the literal string 10,000 — the cap, not a measurement. The board
-- therefore had no way to see whether intake was keeping up with the 30-day
-- expiry, which is the single number that says whether it is growing or
-- quietly draining.
--
-- Observed totals over one day sat between 594,826 and 600,413 — flat within
-- noise. Flat is stable, but "flat" and "shrinking slowly" look identical from
-- the outside without this.
--
-- THREE FLOWS, COUNTED SEPARATELY, because they are different events and
-- averaging them hides the one that matters:
--
--   INTAKE     rows first seen in the window. last_seen is set at INSERT only
--              and never rewritten (see index.ts:1221), so it IS first_seen for
--              rows that have never been re-fetched — but that makes it useless
--              for this. first_seen is the real column and is what we count.
--
--   TAKEDOWN   rows the employer removed: absent from a SUCCESSFUL fetch of
--              their own feed, stamped missing_since (two-pass confirmed).
--              This is a real-world event and the most interesting of the three.
--
--   AGE-OUT    rows still live at the vendor but now older than the serving
--              window, so the board stops showing them. Not a takedown — the
--              job may well still be open. Counting these together with
--              takedowns would overstate how much hiring actually stopped.
--
-- Deliberately NOT a materialised rollup. These are three cheap counts against
-- indexed timestamp columns, run on demand by an operator or a monitor, not on
-- every page render — so there is no refresh job to go stale, and no stamp that
-- can claim freshness it does not have. The cost of that choice is that a
-- caller pays for the count; the benefit is that the number is never a lie
-- about when it was computed.
--
-- STABLE, SECURITY INVOKER, and granted to anon deliberately: it publishes only
-- aggregate counts over data the board already serves publicly, and the board's
-- own honesty position is that its numbers are inspectable.

CREATE OR REPLACE FUNCTION public.get_board_flow(p_hours integer DEFAULT 24)
RETURNS TABLE (
  window_hours integer,
  intake bigint,
  takedown bigint,
  aged_out bigint,
  net bigint,
  serving bigint,
  computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  WITH w AS (SELECT GREATEST(1, LEAST(COALESCE(p_hours, 24), 720)) AS h),
  bounds AS (SELECT now() - make_interval(hours => (SELECT h FROM w)) AS since)
  SELECT
    (SELECT h FROM w)::integer AS window_hours,
    (SELECT count(*) FROM public.job_board_postings
       WHERE first_seen >= (SELECT since FROM bounds))::bigint AS intake,
    -- Employer removed it. missing_since is only stamped after a posting fails
    -- to appear in a SUCCESSFUL fetch of its own feed, so a vendor outage does
    -- not register as a takedown.
    (SELECT count(*) FROM public.job_board_postings
       WHERE missing_since >= (SELECT since FROM bounds))::bigint AS takedown,
    -- Crossed the 30-day serving edge during the window. Still live at the
    -- vendor as far as we know; we simply stop showing it.
    (SELECT count(*) FROM public.job_board_postings
       WHERE missing_since IS NULL
         AND effective_posted <  now() - interval '30 days'
         AND effective_posted >= (SELECT since FROM bounds) - interval '30 days'
    )::bigint AS aged_out,
    (
      (SELECT count(*) FROM public.job_board_postings WHERE first_seen >= (SELECT since FROM bounds))
      - (SELECT count(*) FROM public.job_board_postings WHERE missing_since >= (SELECT since FROM bounds))
      - (SELECT count(*) FROM public.job_board_postings
           WHERE missing_since IS NULL
             AND effective_posted <  now() - interval '30 days'
             AND effective_posted >= (SELECT since FROM bounds) - interval '30 days')
    )::bigint AS net,
    -- The denominator, so a net of +400 can be read against the size it moves.
    (SELECT count(*) FROM public.job_board_postings
       WHERE missing_since IS NULL
         AND effective_posted >= now() - interval '30 days')::bigint AS serving,
    now() AS computed_at;
$$;

COMMENT ON FUNCTION public.get_board_flow(integer) IS
  'Intake / takedown / age-out over the last N hours (default 24, max 720), with '
  'the net and the current serving total. Counted live, never from a rollup, so '
  'the number cannot claim a freshness it does not have. Takedown means the '
  'employer removed it (missing_since, two-pass confirmed); age-out means it '
  'crossed the 30-day serving edge and may well still be open.';

GRANT EXECUTE ON FUNCTION public.get_board_flow(integer) TO anon, authenticated;

-- The three counts each filter on a timestamp column. first_seen and
-- missing_since carry no index of their own today; without these the function
-- seq-scans ~600k rows three times and will trip its own 20s timeout as the
-- board grows. Partial on missing_since because ~99% of rows are NULL there.
CREATE INDEX IF NOT EXISTS job_board_postings_first_seen_idx
  ON public.job_board_postings (first_seen);

CREATE INDEX IF NOT EXISTS job_board_postings_missing_since_idx
  ON public.job_board_postings (missing_since)
  WHERE missing_since IS NOT NULL;