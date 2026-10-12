-- AN EMPLOYER'S APPLICATION FORM IS READ ONCE A DAY, NOT ONCE A QUESTION.
--
-- WHAT THIS IS FOR. Wave 4's apply_myself tool (agent-mcp) hands a person's
-- own AI the employer's real application form, read from the hiring system's
-- public form endpoint (Greenhouse and Recruitee APIs, Ashby's public GraphQL,
-- Breezy's and Pinpoint's server-rendered apply pages), so the AI can ask the
-- person every factual question and draft only the open-ended ones. A person
-- applying asks about the same posting several times in one conversation, and
-- several people ask about a popular posting in one day; without a cache each
-- of those is a request to the employer's hiring system.
--
-- So the reader in _shared/application-form.ts reads through this table: a
-- row younger than 24 hours is the answer, an older or missing one is read
-- from the vendor and written back. A form the vendor answered as absent
-- (ok = false) is cached the same way, so a posting with no public form is
-- not re-asked every call; a transient failure (a timeout, a 5xx) is never
-- written, and the next call tries again.
--
-- WHAT IS STORED. The posting id, its vendor, whether a form was read, the
-- form as parsed (question labels, types, options, required flags, document
-- slots) and when it was read. Employer-published text only: nothing about
-- who asked, and no answer of anyone's.
--
-- WHO MAY TOUCH IT. The service role only: RLS on with no policy, revoked
-- from PUBLIC, anon and authenticated by name (Supabase grants every new
-- public table to the client roles, and a GRANT never takes that away), and
-- the writer is a SECURITY DEFINER function revoked the same way. The writer
-- prunes rows older than seven days on roughly one call in a hundred, so the
-- table is bounded by a week of distinct postings asked about.
--
-- Safe to re-run: IF NOT EXISTS, CREATE OR REPLACE, grants restated; the
-- self-check writes one row under its own id and removes it.

CREATE TABLE IF NOT EXISTS public.application_form_cache (
  posting_id text PRIMARY KEY,
  vendor text NOT NULL,
  ok boolean NOT NULL,
  form jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.application_form_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_form_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.application_form_cache TO service_role;

CREATE INDEX IF NOT EXISTS application_form_cache_read_at_idx ON public.application_form_cache (read_at);

COMMENT ON TABLE public.application_form_cache IS
  'Employer application forms as read from the hiring system''s public form endpoint, one row per posting, believed for 24 hours by _shared/application-form.ts. ok = false is a form the vendor answered as absent. Employer text only; no asker, no answers. Service-role only; pruned at seven days by application_form_cache_put.';

CREATE OR REPLACE FUNCTION public.application_form_cache_put(p_posting_id text, p_vendor text, p_ok boolean, p_form jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_posting_id IS NULL OR btrim(p_posting_id) = '' OR p_vendor IS NULL OR p_ok IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.application_form_cache AS c (posting_id, vendor, ok, form, read_at)
  VALUES (left(p_posting_id, 300), left(p_vendor, 40), p_ok, coalesce(p_form, '{}'::jsonb), now())
  ON CONFLICT (posting_id) DO UPDATE
    SET vendor = excluded.vendor, ok = excluded.ok, form = excluded.form, read_at = excluded.read_at;
  IF random() < 0.01 THEN
    DELETE FROM public.application_form_cache c WHERE c.read_at < now() - interval '7 days';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.application_form_cache_put(text, text, boolean, jsonb) IS
  'Writes one posting''s application form read into application_form_cache (replacing an older read) and, on about one call in a hundred, removes reads older than seven days. Service-role only.';

REVOKE ALL ON FUNCTION public.application_form_cache_put(text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.application_form_cache_put(text, text, boolean, jsonb) TO service_role;

DO $$
DECLARE
  v_role text;
  v_sig text := 'public.application_form_cache_put(text, text, boolean, jsonb)';
BEGIN
  IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can run %', v_sig;
  END IF;
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: the service role cannot run %', v_sig;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.application_form_cache', 'SELECT')
       OR has_table_privilege(v_role, 'public.application_form_cache', 'INSERT')
       OR has_table_privilege(v_role, 'public.application_form_cache', 'UPDATE')
       OR has_table_privilege(v_role, 'public.application_form_cache', 'DELETE') THEN
      RAISE EXCEPTION 'self-check: % holds a privilege on application_form_cache', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'application_form_cache') THEN
    RAISE EXCEPTION 'self-check: application_form_cache must have no policy';
  END IF;

  PERFORM public.application_form_cache_put('zz:selfcheck:20261011100000', 'greenhouse', true, '{"questions":[]}'::jsonb);
  PERFORM public.application_form_cache_put('zz:selfcheck:20261011100000', 'greenhouse', false, '{}'::jsonb);
  IF (SELECT count(*) FROM public.application_form_cache c WHERE c.posting_id = 'zz:selfcheck:20261011100000' AND c.ok = false) <> 1 THEN
    RAISE EXCEPTION 'self-check: a second read did not replace the first';
  END IF;
  DELETE FROM public.application_form_cache c WHERE c.posting_id = 'zz:selfcheck:20261011100000';
END
$$;
