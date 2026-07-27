-- The tracker has been telling users a closure date it invented.
--
-- Account.tsx asked the board "does this id still exist?", and for anything
-- missing stamped posting_closed_at = new Date() — the moment the user
-- happened to open the page — then rendered "This posting closed by <date>".
-- Someone returning after three weeks was told the posting closed the day they
-- came back. Meanwhile job_board_closures has held the REAL closed_at for that
-- exact posting_id the whole time, and user_applications.job_id is the same
-- `source:token:externalId` text as job_board_closures.posting_id. The join
-- had simply never been run.
--
-- This is the one thing this platform can say that no other job site can: not
-- "similar roles close in ~N days" but "THE posting you applied to came down
-- on this date, N days after you applied, and it has/has not reappeared."
-- Saying it requires having owned the fetch on the day it was up AND the day
-- it vanished. A takedown leaves no artifact — it cannot be scraped, bought,
-- or backfilled later.
--
-- Reads only public board tables; the caller supplies its own ids, so this
-- exposes nothing user-specific and needs no user context.
CREATE OR REPLACE FUNCTION public.get_application_lifecycle(p_job_ids text[])
RETURNS TABLE (
  job_id text,
  outcome text,              -- came_down | came_down_relisted | still_standing | not_observed
  closed_at timestamptz,
  days_standing numeric,     -- days the posting stood, or has stood so far
  relisted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH ids AS (
    -- Bounded: a tracker page asks about its own rows, not the corpus.
    SELECT DISTINCT unnest(p_job_ids[1:500]) AS jid
  ),
  cl AS (
    -- Most recent closure per posting; a posting can legitimately close twice.
    SELECT DISTINCT ON (c.posting_id)
      c.posting_id, c.closed_at, c.posted_at, c.first_seen, c.company_token, c.title
    FROM public.job_board_closures c
    WHERE c.posting_id = ANY(p_job_ids[1:500])
    ORDER BY c.posting_id, c.closed_at DESC
  ),
  liv AS (
    SELECT p.id, p.posted_at, p.first_seen
    FROM public.job_board_postings p
    WHERE p.id = ANY(p_job_ids[1:500])
  )
  SELECT
    ids.jid AS job_id,
    CASE
      -- Same id live again after a recorded closure: the req itself came back.
      WHEN liv.id IS NOT NULL AND cl.posting_id IS NOT NULL THEN 'came_down_relisted'
      WHEN liv.id IS NOT NULL THEN 'still_standing'
      WHEN cl.posting_id IS NOT NULL THEN
        CASE WHEN EXISTS (
          -- Or the SAME ROLE went back up under a new id at the same employer.
          SELECT 1 FROM public.job_board_postings p2
          WHERE p2.company_token = cl.company_token
            AND lower(p2.title) = lower(cl.title)
            AND COALESCE(p2.posted_at, p2.first_seen) >= cl.closed_at
        ) THEN 'came_down_relisted' ELSE 'came_down' END
      -- Gone from the board with no closure on record. We do NOT know it
      -- closed: it may sit on a windowed/capped feed we never saw the end of,
      -- or it may have gone before this log existed. Saying nothing is the
      -- only honest answer, and the UI must say why rather than guess a date.
      ELSE 'not_observed'
    END AS outcome,
    cl.closed_at,
    CASE
      WHEN cl.posting_id IS NOT NULL AND COALESCE(cl.posted_at, cl.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (cl.closed_at - COALESCE(cl.posted_at, cl.first_seen))) / 86400.0)::numeric, 1)
      WHEN liv.id IS NOT NULL AND COALESCE(liv.posted_at, liv.first_seen) IS NOT NULL
        THEN round((EXTRACT(epoch FROM (now() - COALESCE(liv.posted_at, liv.first_seen))) / 86400.0)::numeric, 1)
      ELSE NULL
    END AS days_standing,
    (cl.posting_id IS NOT NULL AND liv.id IS NOT NULL) AS relisted
  FROM ids
  LEFT JOIN cl  ON cl.posting_id = ids.jid
  LEFT JOIN liv ON liv.id = ids.jid;
$$;

GRANT EXECUTE ON FUNCTION public.get_application_lifecycle(text[]) TO anon, authenticated, service_role;
