-- A MAIL REMEMBERS THE LANGUAGE IT WAS ASKED IN (audit 2026-10-31, S13-102).
--
-- The market pulse arrived in English whatever the reader's site language.
-- Its confirmation mail answers a request and is written in that request's
-- language, but the monthly pulse is sent later, by the batch, with no
-- request in hand. So the row keeps the language:
--   market_pulse_subscribers.locale  written when the address confirms, on
--     the row the confirmation token names, by send-market-pulse.
-- The function reads and writes the column on its own, separately from
-- every other read and write, so a function deployed before this migration
-- only loses the translation. NULL is English. Only the site's nine
-- languages may be stored.
--
-- A column on an existing service-role table: RLS stays on with no public
-- policy, and nothing new is granted. Safe to re-run.

ALTER TABLE public.market_pulse_subscribers ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'market_pulse_subscribers_locale_known'
       AND conrelid = 'public.market_pulse_subscribers'::regclass
  ) THEN
    ALTER TABLE public.market_pulse_subscribers
      ADD CONSTRAINT market_pulse_subscribers_locale_known
      CHECK (locale IS NULL OR locale IN ('en', 'en-GB', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl'));
  END IF;
END $$;

COMMENT ON COLUMN public.market_pulse_subscribers.locale IS
  'The site language the address confirmed the pulse in (send-market-pulse); NULL is English. S13-102.';

-- SELF-CHECK: the column exists, is text, refuses a language we do not
-- write, and the table is still closed to the public roles.
DO $$
DECLARE
  v_bad text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'market_pulse_subscribers'
       AND column_name = 'locale' AND data_type = 'text'
  ) THEN
    v_bad := v_bad || 'public.market_pulse_subscribers.locale is missing or not text'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.market_pulse_subscribers'::regclass
       AND c.contype = 'c'
       AND c.conname = 'market_pulse_subscribers_locale_known'
       AND pg_get_constraintdef(c.oid) LIKE '%en-GB%'
  ) THEN
    v_bad := v_bad || 'public.market_pulse_subscribers has no locale check'::text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.market_pulse_subscribers'::regclass) THEN
    v_bad := v_bad || 'public.market_pulse_subscribers lost row level security'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'S13-102 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'the market pulse keeps the language its address confirmed in';
END $$;

NOTIFY pgrst, 'reload schema';
