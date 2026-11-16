-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the bug round A integration).
--
-- A SHORTLIST NOTICE IS LOGGED AS SENT ONLY WHEN THE EMPLOYER SAYS IT WENT
-- OUT (bug round 2026-11-08, S14X-163).
--
-- The page's one "Copy + log as sent" button inserted a shortlist_notices
-- row stamped now() whenever the text was copied, so the log an employer
-- would show a regulator (NYC LL144 asks for the notice ten business days
-- before the tool is used) recorded copies, not sends. The page now asks
-- the date the notice went out and who it went to. This keeps both honest:
--   logged_at   when the row was written, from the server's clock (a
--               BEFORE INSERT trigger sets it whatever the client sends);
--               existing rows take their sent_at, the only date they have;
--   recipients  the candidate references the employer names, at most 2,000
--               characters;
--   sent_at     the employer's stated send date, refused when it is after
--               the logging day (a notice is logged once it has gone out).
-- The live page works before and after this file: it reads select('*'),
-- uses logged_at ?? sent_at, and retries an insert refused for a missing
-- column without the recipient list. The old page's inserts (no sent_at,
-- no recipients) still land.
--
-- Grants: the table keeps exactly what 20260704160023 gave the signed-in
-- owner (SELECT and INSERT, under the owner policies); anon and PUBLIC hold
-- nothing, and no client role can UPDATE, DELETE or TRUNCATE the log.
-- Safe to re-run. Ends with a self-check that raises if any of it is missing.

ALTER TABLE public.shortlist_notices ADD COLUMN IF NOT EXISTS logged_at timestamptz;
UPDATE public.shortlist_notices SET logged_at = sent_at WHERE logged_at IS NULL;
ALTER TABLE public.shortlist_notices ALTER COLUMN logged_at SET DEFAULT now();
ALTER TABLE public.shortlist_notices ALTER COLUMN logged_at SET NOT NULL;

ALTER TABLE public.shortlist_notices ADD COLUMN IF NOT EXISTS recipients text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shortlist_notices_recipients_length' AND conrelid = 'public.shortlist_notices'::regclass
  ) THEN
    ALTER TABLE public.shortlist_notices
      ADD CONSTRAINT shortlist_notices_recipients_length CHECK (recipients IS NULL OR char_length(recipients) <= 2000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.shortlist_notices_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- The server's clock, never the client's.
  NEW.logged_at := now();
  IF NEW.sent_at IS NULL THEN
    NEW.sent_at := now();
  END IF;
  IF NEW.sent_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'a notice is logged once it has gone out: its send date % is after today', NEW.sent_at::date
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.shortlist_notices_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shortlist_notices_stamp ON public.shortlist_notices;
CREATE TRIGGER shortlist_notices_stamp
  BEFORE INSERT ON public.shortlist_notices
  FOR EACH ROW EXECUTE FUNCTION public.shortlist_notices_stamp();

REVOKE ALL ON public.shortlist_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.shortlist_notices TO authenticated;
GRANT ALL ON public.shortlist_notices TO service_role;

DO $$
DECLARE
  t constant regclass := 'public.shortlist_notices'::regclass;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shortlist_notices' AND column_name = 'logged_at' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'self-check: shortlist_notices.logged_at is missing or nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shortlist_notices' AND column_name = 'recipients') THEN
    RAISE EXCEPTION 'self-check: shortlist_notices.recipients is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shortlist_notices_recipients_length' AND conrelid = t) THEN
    RAISE EXCEPTION 'self-check: the recipients length check is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shortlist_notices_stamp' AND tgrelid = t AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'self-check: the shortlist_notices_stamp trigger is missing or disabled';
  END IF;
  IF has_table_privilege('anon', t, 'SELECT') OR has_table_privilege('anon', t, 'INSERT') OR has_table_privilege('anon', t, 'UPDATE')
     OR has_table_privilege('anon', t, 'DELETE') OR has_table_privilege('anon', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'self-check: anon still holds a privilege on shortlist_notices';
  END IF;
  IF has_table_privilege('authenticated', t, 'UPDATE') OR has_table_privilege('authenticated', t, 'DELETE') OR has_table_privilege('authenticated', t, 'TRUNCATE') THEN
    RAISE EXCEPTION 'self-check: a signed-in client can still rewrite or remove the notice log';
  END IF;
  IF NOT (has_table_privilege('authenticated', t, 'SELECT') AND has_table_privilege('authenticated', t, 'INSERT')) THEN
    RAISE EXCEPTION 'self-check: the signed-in owner can no longer read or log notices';
  END IF;
  IF has_function_privilege('anon', 'public.shortlist_notices_stamp()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.shortlist_notices_stamp()', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can call shortlist_notices_stamp()';
  END IF;
END $$;
