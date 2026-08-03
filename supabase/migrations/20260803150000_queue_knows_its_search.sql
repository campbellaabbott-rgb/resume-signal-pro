-- A queued pick did not record which search found it.
--
-- 20260803130000 introduced agent_searches with a `label`, justified in its own
-- comment as:
--
--   'Shown in the UI and in the queue's reason chips, so a candidate can tell
--    WHICH search produced a pick. Without it a morning queue of eight jobs
--    from three searches is an undifferentiated list.'
--
-- The queue insert records no search reference, and agent_queue has no column
-- for one. So the reason the label exists was not delivered by the change that
-- introduced it — a claim in a migration comment that the code does not back,
-- which is the same drift this codebase keeps finding in user-facing copy.
--
-- ON DELETE SET NULL rather than CASCADE. Deleting a search must not delete the
-- jobs it already queued: those are the candidate's morning, and a pick they
-- were about to approve vanishing because they tidied up a search is a worse
-- outcome than an unattributed row. The label is denormalised for the same
-- reason — after the search is gone, "Product Manager, NYC" is still the true
-- answer to where this pick came from, and a join could no longer say it.
--
-- WHAT THIS CANNOT SAY, and the UI must not imply otherwise. agent_queue
-- dedupes on (user_id, posting_id), so a posting matched by two searches is
-- stored once, attributed to whichever search reached it first. That is the
-- honest reading of the field: the search that FOUND it, not the only search
-- that matches it.

ALTER TABLE public.agent_queue
  ADD COLUMN IF NOT EXISTS search_id bigint
    REFERENCES public.agent_searches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS search_label text NOT NULL DEFAULT '';

-- The queue is read per user, newest first; attribution is a display field, so
-- no index is added for it. Adding one "just in case" is how a table that is
-- written every hour gets slower for a column nobody filters on.

COMMENT ON COLUMN public.agent_queue.search_id IS
  'The saved search that FOUND this posting. NULL once that search is deleted — the pick outlives it deliberately. Not "the only search that matches": the queue dedupes on (user_id, posting_id), so a posting matched by two searches is attributed to whichever reached it first.';
COMMENT ON COLUMN public.agent_queue.search_label IS
  'The search name at the time of queueing, denormalised so a pick can still say where it came from after its search is deleted.';
