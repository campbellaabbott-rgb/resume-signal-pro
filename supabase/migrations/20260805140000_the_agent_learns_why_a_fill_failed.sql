-- 19 OF 60 FILLS REFUSED, AND NOTHING COULD SAY WHICH NINETEEN.
--
-- agent_confirmation_gaps fixed exactly this shape for the half-second AFTER a
-- submit: every phrase in CONFIRMED_RE was a guess, the evidence that would
-- replace the guess was landing in a jsonb column nobody aggregated, so the
-- failure mode was "every send to a vendor parks for review and the sentence
-- that would fix it is read by no one".
--
-- The half BEFORE the submit has the identical defect and a larger cost. The
-- worker refuses a fill for seventeen distinct reasons and files all of them as
-- `{kind: "worker", detail: "<sentence>"}` — one kind for every cause. A field
-- map that has drifted, a label pattern that never matched, an employer
-- question nobody has seen before, and a closed posting are indistinguishable
-- in the database. worker/src/questions/match.ts is written from harvested
-- labels and says so; the only thing that turns those patterns from a guess
-- into a measurement is knowing which labels actually beat them.
--
-- The worker now classifies at the point of failure (worker/src/refusal.ts):
-- a `stage` from a closed list, and `wording` that is either the EMPLOYER'S
-- question label or OUR OWN field keys. This groups them.
--
-- WHY THIS IS SAFE TO EXPOSE, and why the safety is not in this file.
-- agent_confirmation_gaps parses its wording out of a free-text sentence and
-- relies on the URL sitting before the marker it captures from. That works, and
-- it is a weaker guarantee than it looks. Here the decision about what may be
-- published is made in the worker, against an ALLOW-LIST: an unrecognised
-- refusal, and every `driver error: …`, emits no wording at all — arbitrary
-- exception text can contain the apply URL or the staged résumé's filename,
-- which on most CVs is the candidate's own name.
--
-- So this function reads `wording` and NEVER falls back to `detail`. A packet
-- written by an older worker has no wording, and it must contribute a count and
-- nothing else. Falling back would silently republish the very free text the
-- allow-list exists to withhold, on exactly the rows least likely to be noticed.

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
           -- A row from a worker that predates the classifier has no stage. It
           -- is counted as `unstamped` rather than dropped: a refusal nobody
           -- can categorise is itself the thing to know about, and dropping it
           -- would make an out-of-date worker look like a quiet one.
           COALESCE(NULLIF(btrim(b->>'stage'), ''), 'unstamped')       AS stage,
           COALESCE(NULLIF(btrim(b->>'source'), ''), 'unknown')        AS source,
           -- NEVER `COALESCE(wording, detail)`. See the header: detail is the
           -- free-text sentence the worker deliberately declined to publish.
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
   -- Ordered by how often it happens, because the point of this function is to
   -- decide what to fix next, and the answer is whatever is costing the most
   -- applications rather than whatever happened most recently.
   ORDER BY count(*) DESC, max(updated_at) DESC
   LIMIT 50;
$$;

-- Same grant as agent_confirmation_gaps, for the same reason: the heartbeat is
-- where this becomes visible and the heartbeat is read without a session. Safe
-- because the projection carries a closed-list stage, a public ATS vendor name,
-- and text the worker has already established may be published.
REVOKE ALL ON FUNCTION public.agent_fill_gaps(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_fill_gaps(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.agent_fill_gaps(integer) IS
  'Why form fills refused, grouped by stage, vendor and the form''s own wording. '
  'The evidence that turns guessed field maps and label patterns into measured '
  'ones. Reads only the worker-stamped `wording` and never the free-text detail — '
  'no user, no posting, no URL — so it is safe to read without a session.';
