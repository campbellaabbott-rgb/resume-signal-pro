-- A MANDATE CAN NAME ONLY A RÉSUMÉ IN ITS OWN FOLDER.
--
-- WHAT WAS WRONG (debug sweep 2026-10-08, S8-080). apply-broker signs the path
-- in agent_mandates.resume_file_url with the service role and hands the URL to
-- the worker, which attaches the file to the application. The owner policy on
-- agent_mandates (20260721290000) is FOR ALL with no check on that column, so
-- a funded owner could write '<another-user-uuid>/resume.pdf' and send someone
-- else's CV with their own applications. The uploader always writes
-- '<userId>/<file>' (ApplyProfilePanel).
--
-- THE CHANGE. A trigger refuses a NEW or CHANGED resume_file_url whose first
-- segment is not the row's user_id, or that climbs out of it ('.', '..', an
-- empty segment). A row whose path did not change passes, so a legacy value
-- never blocks an owner's other edits; apply-broker and apply-agent refuse such
-- a path themselves (_shared/resume-path.ts), and the count of legacy rows is
-- printed below for the owner.
--
-- Safe to re-run. The trigger function is SECURITY INVOKER and not callable by
-- a client.

CREATE OR REPLACE FUNCTION public.agent_mandates_resume_in_own_folder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  p text := coalesce(NEW.resume_file_url, '');
BEGIN
  IF TG_OP = 'UPDATE' AND p IS NOT DISTINCT FROM coalesce(OLD.resume_file_url, '') THEN
    RETURN NEW;
  END IF;
  IF p = '' THEN
    RETURN NEW;
  END IF;
  IF position('/' IN p) = 0
     OR lower(split_part(p, '/', 1)) <> lower(NEW.user_id::text)
     OR p ~ '(^|/)\.{1,2}(/|$)'
     OR p ~ '//'
     OR p ~ '/$' THEN
    RAISE EXCEPTION 'resume_file_url must name a file in the account''s own folder'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.agent_mandates_resume_in_own_folder() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_mandates_resume_in_own_folder ON public.agent_mandates;
CREATE TRIGGER agent_mandates_resume_in_own_folder
  BEFORE INSERT OR UPDATE OF resume_file_url ON public.agent_mandates
  FOR EACH ROW EXECUTE FUNCTION public.agent_mandates_resume_in_own_folder();

-- Self-check: the trigger is on the table, and the function refuses a foreign
-- path and a climbing path and accepts the account's own, proved on a scratch
-- table so it needs no account in the database.
DO $$
DECLARE
  uid uuid := '00000000-0000-4000-8000-000000000001';
  refused int := 0;
  legacy bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'agent_mandates' AND t.tgname = 'agent_mandates_resume_in_own_folder' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '20261009120000: trigger agent_mandates_resume_in_own_folder is missing';
  END IF;

  CREATE TEMP TABLE _resume_path_probe (user_id uuid, resume_file_url text) ON COMMIT DROP;
  CREATE TRIGGER _resume_path_probe BEFORE INSERT OR UPDATE OF resume_file_url ON _resume_path_probe
    FOR EACH ROW EXECUTE FUNCTION public.agent_mandates_resume_in_own_folder();

  INSERT INTO _resume_path_probe VALUES (uid, uid::text || '/cv.pdf'), (uid, '');
  BEGIN INSERT INTO _resume_path_probe VALUES (uid, '00000000-0000-4000-8000-000000000002/cv.pdf');
  EXCEPTION WHEN invalid_parameter_value THEN refused := refused + 1; END;
  BEGIN INSERT INTO _resume_path_probe VALUES (uid, uid::text || '/../00000000-0000-4000-8000-000000000002/cv.pdf');
  EXCEPTION WHEN invalid_parameter_value THEN refused := refused + 1; END;
  BEGIN INSERT INTO _resume_path_probe VALUES (uid, 'cv.pdf');
  EXCEPTION WHEN invalid_parameter_value THEN refused := refused + 1; END;
  IF refused <> 3 OR (SELECT count(*) FROM _resume_path_probe) <> 2 THEN
    RAISE EXCEPTION '20261009120000: the trigger refused % of 3 bad paths and kept % of 2 good rows',
      refused, (SELECT count(*) FROM _resume_path_probe);
  END IF;
  DROP TABLE _resume_path_probe;

  SELECT count(*) INTO legacy FROM public.agent_mandates
   WHERE coalesce(resume_file_url, '') <> ''
     AND lower(split_part(resume_file_url, '/', 1)) <> lower(user_id::text);
  RAISE NOTICE '20261009120000: % mandate row(s) already name a résumé outside their own folder (left as is; the broker will not sign them)', legacy;
END
$$;
