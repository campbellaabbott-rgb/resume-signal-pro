-- RESUME INGEST. Apply this ONLY once browse latency is back under ~1s and the
-- operator has said so — it is stored with a .hold suffix precisely so a bulk
-- "apply all migrations" cannot resume the ingest by accident. Rename to .sql
-- to arm it.
UPDATE public.job_board_meta
   SET v = jsonb_set(jsonb_set(v, '{paused}', 'false'), '{resumedAt}', to_jsonb(now()::text)),
       updated_at = now()
 WHERE k = 'ingest_paused';
