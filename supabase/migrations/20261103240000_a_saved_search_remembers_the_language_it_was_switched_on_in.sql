-- A SAVED SEARCH REMEMBERS THE LANGUAGE IT WAS SWITCHED ON IN (audit
-- 2026-10-31, S13-102; the held-mail round, 2026-11-03).
--
-- The saved-search digest arrived in English whatever the reader's site
-- language, and nothing stored a language it could read: the mail is sent by
-- the scheduler, with no request of the reader's in hand. So the search keeps
-- it:
--   user_job_searches.locale  filled by a trigger from the browser's own
--     Accept-Language when the owner's client writes the row, refreshed when
--     the digest is switched on. send-search-digest reads it on its own, apart
--     from its claim, so a function deployed before this migration, or this
--     migration before that function, only stays English. NULL is English.
--
-- Why a trigger and not the page: it needs no frontend change, so it cannot be
-- published ahead of this column and refused for naming a column that is not
-- there yet. A client that does send a language wins: the trigger only fills a
-- NULL, and yields to a value the same write changed. An existing row stays
-- NULL until its owner's client next writes it.
--
-- The parse takes the first six preferences of the header, each up to its
-- quality value, exactly en-GB or else the lowercased base tag, the rule
-- checkoutLanguageOf applies to the same nine languages: not a new heuristic.
-- A save must never fail for this, so anything unreadable leaves the row as it
-- was. The service role's writes carry no language of a reader (Deno's fetch
-- sends a star), and the digest's own stamps are not in the trigger's columns.
--
-- A column on an existing table: its row level security and grants do not
-- change. The trigger function is not definer, needs no EXECUTE to fire, and is
-- closed to the client roles. Safe to re-run.

ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_job_searches_locale_known'
       AND conrelid = 'public.user_job_searches'::regclass
  ) THEN
    ALTER TABLE public.user_job_searches
      ADD CONSTRAINT user_job_searches_locale_known
      CHECK (locale IS NULL OR locale IN ('en', 'en-GB', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_job_searches.locale IS
  'The site language the digest is written in, from the owner''s browser when the client last filled it (user_job_search_locale_from_request); NULL is English. S13-102.';

CREATE OR REPLACE FUNCTION public.user_job_search_locale_from_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_part text;
  v_tag text;
  v_base text;
  v_found text;
BEGIN
  IF NOT (
    NEW.locale IS NULL
    OR (TG_OP = 'UPDATE' AND NEW.digest_opt_in AND NOT OLD.digest_opt_in AND NEW.locale IS NOT DISTINCT FROM OLD.locale)
  ) THEN
    RETURN NEW;
  END IF;
  BEGIN
    FOREACH v_part IN ARRAY (string_to_array(coalesce(NULLIF(current_setting('request.headers', true), '')::json ->> 'accept-language', ''), ','))[1:6]
    LOOP
      v_tag := trim(split_part(v_part, ';', 1));
      IF v_tag = 'en-GB' THEN
        v_found := v_tag;
      ELSE
        v_base := lower(split_part(replace(v_tag, '_', '-'), '-', 1));
        IF v_base IN ('en', 'de', 'es', 'fr', 'hi', 'nl', 'pt', 'tl') THEN
          v_found := v_base;
        END IF;
      END IF;
      EXIT WHEN v_found IS NOT NULL;
    END LOOP;
    IF v_found IS NOT NULL THEN
      NEW.locale := v_found;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_found := NULL;
  END;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.user_job_search_locale_from_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_job_search_locale_from_request ON public.user_job_searches;
CREATE TRIGGER user_job_search_locale_from_request
  BEFORE INSERT OR UPDATE OF digest_opt_in, digest_cadence, fit_threshold, last_seen_at, params, name
  ON public.user_job_searches
  FOR EACH ROW EXECUTE FUNCTION public.user_job_search_locale_from_request();

-- SELF-CHECK: the column, its check, the table's row level security, the
-- trigger, the closed function, and the behaviour on a throwaway table carrying
-- the same trigger (the real table is not written).
DO $$
DECLARE
  v_bad text[] := ARRAY[]::text[];
  v_prior text := current_setting('request.headers', true);
  v_got text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_job_searches'
       AND column_name = 'locale' AND data_type = 'text'
  ) THEN
    v_bad := v_bad || 'public.user_job_searches.locale is missing or not text'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.user_job_searches'::regclass
       AND c.contype = 'c'
       AND c.conname = 'user_job_searches_locale_known'
       AND pg_get_constraintdef(c.oid) LIKE '%en-GB%'
  ) THEN
    v_bad := v_bad || 'public.user_job_searches has no locale check'::text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.user_job_searches'::regclass) THEN
    v_bad := v_bad || 'public.user_job_searches lost row level security'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.user_job_searches'::regclass
       AND t.tgname = 'user_job_search_locale_from_request'
       AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  ) THEN
    v_bad := v_bad || 'the locale trigger is missing or disabled'::text;
  END IF;
  IF has_function_privilege('anon', 'public.user_job_search_locale_from_request()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.user_job_search_locale_from_request()', 'EXECUTE') THEN
    v_bad := v_bad || 'the locale trigger function is open to a client role'::text;
  END IF;

  CREATE TEMP TABLE _user_job_search_locale_probe (id int PRIMARY KEY, locale text, digest_opt_in boolean NOT NULL DEFAULT false) ON COMMIT DROP;
  CREATE TRIGGER probe BEFORE INSERT OR UPDATE ON _user_job_search_locale_probe
    FOR EACH ROW EXECUTE FUNCTION public.user_job_search_locale_from_request();

  PERFORM set_config('request.headers', '{"accept-language":"fr-CA,fr;q=0.9,en;q=0.8"}', true);
  INSERT INTO _user_job_search_locale_probe (id) VALUES (1) RETURNING locale INTO v_got;
  IF v_got IS DISTINCT FROM 'fr' THEN v_bad := v_bad || ('a French browser stored ' || coalesce(v_got, 'nothing')); END IF;

  PERFORM set_config('request.headers', '{"accept-language":"en-GB,en;q=0.9"}', true);
  INSERT INTO _user_job_search_locale_probe (id) VALUES (2) RETURNING locale INTO v_got;
  IF v_got IS DISTINCT FROM 'en-GB' THEN v_bad := v_bad || ('a British browser stored ' || coalesce(v_got, 'nothing')); END IF;

  PERFORM set_config('request.headers', '{"accept-language":"ja,de;q=0.5"}', true);
  INSERT INTO _user_job_search_locale_probe (id) VALUES (3) RETURNING locale INTO v_got;
  IF v_got IS DISTINCT FROM 'de' THEN v_bad := v_bad || ('a preference we carry was passed over: ' || coalesce(v_got, 'nothing')); END IF;

  PERFORM set_config('request.headers', '{"accept-language":"*"}', true);
  INSERT INTO _user_job_search_locale_probe (id) VALUES (4) RETURNING locale INTO v_got;
  IF v_got IS NOT NULL THEN v_bad := v_bad || ('a star stored ' || v_got); END IF;

  PERFORM set_config('request.headers', '{not json', true);
  INSERT INTO _user_job_search_locale_probe (id) VALUES (5) RETURNING locale INTO v_got;
  IF v_got IS NOT NULL THEN v_bad := v_bad || ('an unreadable header stored ' || v_got); END IF;

  PERFORM set_config('request.headers', '{"accept-language":"fr"}', true);
  INSERT INTO _user_job_search_locale_probe (id, locale) VALUES (6, 'nl') RETURNING locale INTO v_got;
  IF v_got IS DISTINCT FROM 'nl' THEN v_bad := v_bad || ('a language the client sent was overwritten by ' || coalesce(v_got, 'nothing')); END IF;

  PERFORM set_config('request.headers', '{"accept-language":"es"}', true);
  UPDATE _user_job_search_locale_probe SET digest_opt_in = true WHERE id = 6 RETURNING locale INTO v_got;
  IF v_got IS DISTINCT FROM 'es' THEN v_bad := v_bad || ('switching the digest on kept ' || coalesce(v_got, 'nothing')); END IF;

  PERFORM set_config('request.headers', coalesce(v_prior, ''), true);
  DROP TABLE _user_job_search_locale_probe;

  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'S13-102 self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'a saved search keeps the language its owner''s browser asked in';
END $$;

NOTIFY pgrst, 'reload schema';
