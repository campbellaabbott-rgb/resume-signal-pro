-- EMERGENCY: PAUSE ALL INGEST. Deliberate, visible, and reversible.
--
-- The board is in its second saturation spiral of the day. Measured minutes
-- before this file: a limit=3 browse at 27s, then 42s, then 66s — the trend is
-- RISING with the .3 request-stampede source already removed, which means
-- writes are still outrunning the newly tuned autovacuum. The one lever that
-- gives the database a clear runway is the ingest kill switch the rotation
-- already honours: every hop and every entry checks ingest_paused, force does
-- NOT override it ("an operator stopping a struggling database means it"),
-- and status surfaces the flag so a deliberate pause cannot be misread as a
-- broken pipeline.
--
-- WHAT THIS COSTS, said plainly: no new postings are ingested and no boards
-- are re-verified while paused. Freshness ages. That is the right trade for a
-- board that cannot serve a page — readers first, writers second.
--
-- RESUME: apply a follow-up migration setting paused=false (prepared beside
-- this one), or edit the row in the dashboard. The heartbeat's freshness
-- checks will nag if it is forgotten, by design.
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES (
  'ingest_paused',
  jsonb_build_object(
    'paused', true,
    'reason', 'saturation spiral 2026-08-30: browse latency rising 27s->42s->66s; giving autovacuum a clear runway',
    'at', now()::text,
    'resumeHow', 'migration 2026083024* or dashboard: set paused=false'
  ),
  now()
)
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

-- Self-verifying.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.job_board_meta
     WHERE k = 'ingest_paused' AND (v->>'paused')::boolean IS TRUE
  ) THEN
    RAISE EXCEPTION 'ingest_paused flag did not persist';
  END IF;
END $$;
