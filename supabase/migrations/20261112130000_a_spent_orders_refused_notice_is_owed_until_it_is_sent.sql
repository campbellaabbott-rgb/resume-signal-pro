-- A SPENT ORDER'S REFUSED NOTICE IS OWED UNTIL IT IS SENT (RC-S13-110,
-- bug round 2026-11-12, lane full-analysis).
--
-- WHAT WAS WRONG. When the retry sweep (retry-failed-deliveries) spends a
-- paid order, it mails the owner once ("ran out of retries") and, for an
-- order no retry can cure, the buyer once (what is missing). When the mail
-- provider refused either mail, the sweep gave the mail door back "so the
-- next run tries again" (CP-027), but no next run ever looked: the alarm is
-- sent only by the run that spends the row, and get_failed_deliveries_for_retry
-- (20261011143000) selects only rows with tries left. A refused alarm about a
-- paid order nobody received was lost for good.
--
-- NOW the sweep writes what it still owes on the order itself:
-- notice_owed is 'owner', 'buyer' or 'both' while a refused notice is owed,
-- and NULL otherwise. Each run first reads a few orders that owe one (the
-- service role, whatever their tries), sends the owed notice through the same
-- door, and clears the marker once it is sent. The function writes the marker
-- in a write of its own and reads it with a fallback, so it keeps working
-- before this column exists.
--
-- AND NOT FOREVER. Three more columns, written in the same write:
--   notice_tries     how many times the buyer's owed notice was tried;
--   notice_tried_at  when an owed notice was last tried: each run reads the
--                    orders tried longest ago first, so five orders whose
--                    buyer can never be mailed cannot keep a sixth's alarm
--                    unread;
--   notice_given_up  why the buyer's notice was given up (the mail service
--                    refused the address outright, or refused it on six
--                    runs); the owner is told once, by a mail of its own,
--                    that the buyer was not asked.
--
-- product_deliveries keeps its row level security: the column is read and
-- written by the service role only, like the rest of the row. A column on a
-- small table; the check is added once. Safe to re-run.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS notice_owed text;
ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS notice_tries integer NOT NULL DEFAULT 0;
ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS notice_tried_at timestamptz;
ALTER TABLE public.product_deliveries ADD COLUMN IF NOT EXISTS notice_given_up text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.product_deliveries'::regclass
       AND conname = 'product_deliveries_notice_owed_check'
  ) THEN
    ALTER TABLE public.product_deliveries
      ADD CONSTRAINT product_deliveries_notice_owed_check
      CHECK (notice_owed IS NULL OR notice_owed IN ('owner', 'buyer', 'both'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.product_deliveries.notice_owed IS
  'A notice the retry sweep owes for a spent order because the mail provider refused it: owner (the spent-order alarm), '
  'buyer (what is missing), or both; NULL when nothing is owed. Each sweep run resends it and clears it. RC-S13-110, 20261112130000.';
COMMENT ON COLUMN public.product_deliveries.notice_tries IS
  'How many times the retry sweep tried the buyer''s owed notice for this spent order. RC-S13-110, 20261112130000.';
COMMENT ON COLUMN public.product_deliveries.notice_tried_at IS
  'When the retry sweep last tried an owed notice for this order; the sweep reads the oldest first. RC-S13-110, 20261112130000.';
COMMENT ON COLUMN public.product_deliveries.notice_given_up IS
  'Why the retry sweep stopped owing the buyer''s notice (refused outright, or on six runs); the owner is told once. RC-S13-110, 20261112130000.';

-- Self-verifying: the columns are here with their types, the check is in
-- force and validated, and it names exactly the three values the sweep writes.
DO $$
DECLARE
  v_type text;
  v_def text;
  v_valid boolean;
  v_col record;
BEGIN
  FOR v_col IN SELECT * FROM (VALUES ('notice_tries', 'integer'), ('notice_tried_at', 'timestamp with time zone'), ('notice_given_up', 'text')) AS c(name, want) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
      FROM pg_attribute a
     WHERE a.attrelid = 'public.product_deliveries'::regclass
       AND a.attname = v_col.name
       AND NOT a.attisdropped;
    IF v_type IS DISTINCT FROM v_col.want THEN
      RAISE EXCEPTION 'self-check: product_deliveries.% is missing or not % (found %)', v_col.name, v_col.want, coalesce(v_type, 'nothing');
    END IF;
  END LOOP;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.product_deliveries'::regclass
     AND a.attname = 'notice_owed'
     AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'self-check: product_deliveries.notice_owed is missing or not text (found %)', coalesce(v_type, 'nothing');
  END IF;

  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO v_def, v_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.product_deliveries'::regclass
     AND c.conname = 'product_deliveries_notice_owed_check';
  IF v_def IS NULL OR NOT v_valid THEN
    RAISE EXCEPTION 'self-check: the notice_owed check is missing or not validated';
  END IF;
  IF v_def !~ '''owner''' OR v_def !~ '''buyer''' OR v_def !~ '''both''' THEN
    RAISE EXCEPTION 'self-check: the notice_owed check does not name owner, buyer and both: %', v_def;
  END IF;

  IF EXISTS (SELECT 1 FROM public.product_deliveries WHERE notice_owed IS NOT NULL AND notice_owed NOT IN ('owner', 'buyer', 'both')) THEN
    RAISE EXCEPTION 'self-check: a product_deliveries row owes a notice the sweep cannot send';
  END IF;
END;
$$;
