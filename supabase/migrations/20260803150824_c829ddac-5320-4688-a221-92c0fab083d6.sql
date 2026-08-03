ALTER TABLE public.agent_queue
  ADD COLUMN IF NOT EXISTS search_id bigint
    REFERENCES public.agent_searches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS search_label text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.agent_queue.search_id IS
  'The saved search that FOUND this posting. NULL once that search is deleted — the pick outlives it deliberately. Not "the only search that matches": the queue dedupes on (user_id, posting_id), so a posting matched by two searches is attributed to whichever reached it first.';
COMMENT ON COLUMN public.agent_queue.search_label IS
  'The search name at the time of queueing, denormalised so a pick can still say where it came from after its search is deleted.';