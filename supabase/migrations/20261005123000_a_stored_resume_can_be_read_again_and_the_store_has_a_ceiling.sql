-- A STORED RÉSUMÉ CAN BE READ AGAIN, AND THE STORE HAS A CEILING.
--
-- ONE: THE READ THAT DELETED. The surviving get_temp_resume(text)
-- (20251220013949) is DELETE ... RETURNING: the first reader takes the résumé
-- and nobody else ever finds it. A 2025-12-23 migration added a read-only
-- version "so both frontend and webhook can access the same resume data"; the
-- next day's overload clean-up dropped that one and kept the deleting one, and
-- every delivery path since has been written as if the read were harmless.
-- It is not (defect sweep 1.27, register L13-11):
--   * stripe-webhook reads the résumé (deleting it), then generation fails;
--     retry-failed-deliveries and the success page's verify-product-purchase
--     fallback read the same session and get nothing ("Resume data expired"),
--     so a paid delivery that fails once can never be retried automatically;
--   * checkout_resume_refs (20261004150000) cascades on that delete, so the
--     reference the retry needs disappears with it.
-- The function now only reads, as 2025-12-23 intended. Deletion is the
-- temp-resume-retention job's (every 15 minutes, 20261004150000), at the 24
-- hours the site publishes. The session uuid stays the capability: it is
-- generated server-side and only the browser that stored the text learns it.
--
-- TWO: THE STORE ANYONE COULD FILL. store_temp_resume(text,text,text) is
-- callable with the publishable key (the homepage pre-stores every upload so a
-- checkout can be delivered from it) and wrote up to 150,000 characters per
-- call with no limit at all, so one script could fill the database disk. It is
-- now bounded three ways, each refusal answering NULL (what a failed call
-- always returned, so no caller needs a new error path):
--   * per address: 30 rows an hour, on the platform's address
--     (request_client_address: cf-connecting-ip, else the last forwarded hop);
--   * for everyone together: 1,000 rows an hour, the bound a pool that rotates
--     addresses still meets;
--   * live rows: no new row while 5,000 unexpired ones are held. With the
--     24-hour clock that caps the table at about 750 MB in the worst case
--     (every field at its 50,000-character limit); a real résumé is ~6 KB.
-- A person uploads a handful of versions; the homepage, the apply-kit panel
-- and the checkout keep working. Signature, defaults, validation messages and
-- return type are unchanged.

-- ── 1. the reader only reads ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_temp_resume(p_session_id text)
 RETURNS TABLE(resume_text text, linkedin_text text, job_description_text text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    RETURN;
  END IF;
  v_uuid := p_session_id::uuid;

  -- Qualified through the alias: the output columns share these names (42702).
  RETURN QUERY
  SELECT t.resume_text, t.linkedin_text, t.job_description_text
    FROM public.temp_resume_storage t
   WHERE t.session_id = v_uuid
     AND t.expires_at > now();
END;
$$;

-- ── 2. the store is bounded ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS temp_resume_storage_expires_at_idx
  ON public.temp_resume_storage (expires_at);

CREATE OR REPLACE FUNCTION public.store_temp_resume(p_resume text, p_linkedin text DEFAULT NULL::text, p_job_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_live integer;
BEGIN
  -- Malformed input is refused before any budget is spent.
  IF p_resume IS NULL OR length(p_resume) < 50 THEN
    RAISE EXCEPTION 'Invalid resume text';
  END IF;
  IF length(p_resume) > 50000 THEN
    RAISE EXCEPTION 'Resume text too long';
  END IF;
  IF p_linkedin IS NOT NULL AND length(p_linkedin) > 50000 THEN
    RAISE EXCEPTION 'LinkedIn text too long';
  END IF;
  IF p_job_description IS NOT NULL AND length(p_job_description) > 50000 THEN
    RAISE EXCEPTION 'Job description text too long';
  END IF;

  -- The live-row ceiling, read before anything is counted.
  SELECT count(*) INTO v_live
    FROM (SELECT 1 FROM public.temp_resume_storage t WHERE t.expires_at > now() LIMIT 5001) live;
  IF v_live >= 5000 THEN
    RETURN NULL;
  END IF;

  -- The address's hour and everyone's hour. Nothing after this raises: an
  -- exception would roll the count back with the call.
  IF NOT public.client_write_allowed('temp-resume', 30, 1000, 60) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.temp_resume_storage (resume_text, linkedin_text, job_description_text)
  VALUES (p_resume, p_linkedin, p_job_description)
  RETURNING session_id INTO v_id;

  RETURN v_id;
END;
$$;

-- Both stay callable with the publishable key (the homepage, the success page
-- and the apply-kit panel call them); restated by exact signature.
REVOKE ALL ON FUNCTION public.get_temp_resume(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_temp_resume(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_temp_resume(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_temp_resume(text, text, text) TO anon, authenticated, service_role;

-- ── 3. self-verify: the behaviour, on probe rows that are rolled back ───────
DO $check$
DECLARE
  v_id       uuid;
  v_text     text;
  v_n        integer;
  v_def      text;
  v_fail     text;
  v_sentinel constant text := 'temp resume probe: rolled back';
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_temp_resume(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.store_temp_resume(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the publishable key lost the temporary store; the homepage and the success page call it';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_temp_resume(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot read the temporary store; the webhook and the retry sweep call it';
  END IF;
  v_def := pg_get_functiondef('public.get_temp_resume(text)'::regprocedure);
  IF v_def ~* 'DELETE\s+FROM' THEN
    RAISE EXCEPTION 'get_temp_resume still deletes what it reads';
  END IF;
  v_def := pg_get_functiondef('public.store_temp_resume(text,text,text)'::regprocedure);
  IF position('client_write_allowed(' in v_def) = 0 THEN
    RAISE EXCEPTION 'store_temp_resume spends no write budget';
  END IF;

  BEGIN
    -- Stored once, read twice: the second reader finds what the first found.
    INSERT INTO public.temp_resume_storage (resume_text) VALUES ('selfcheck 20261005123000 résumé text')
    RETURNING session_id INTO v_id;
    SELECT r.resume_text INTO v_text FROM public.get_temp_resume(v_id::text) r;
    IF v_text IS DISTINCT FROM 'selfcheck 20261005123000 résumé text' THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the first read did not return the stored text';
    END IF;
    v_text := NULL;
    SELECT r.resume_text INTO v_text FROM public.get_temp_resume(v_id::text) r;
    IF v_text IS DISTINCT FROM 'selfcheck 20261005123000 résumé text' THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the second read found nothing: the reader still consumes';
    END IF;
    SELECT count(*) INTO v_n FROM public.get_temp_resume('not-a-uuid');
    IF v_n <> 0 THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a malformed id returned rows';
    END IF;
    -- Expired rows are invisible to the reader.
    UPDATE public.temp_resume_storage SET expires_at = now() - interval '1 minute' WHERE session_id = v_id;
    SELECT count(*) INTO v_n FROM public.get_temp_resume(v_id::text);
    IF v_n <> 0 THEN
      v_fail := coalesce(v_fail || '; ', '') || 'an expired row was returned';
    END IF;
    RAISE EXCEPTION USING MESSAGE = v_sentinel;
  EXCEPTION WHEN others THEN
    IF SQLERRM <> v_sentinel THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the probe could not run: ' || SQLERRM;
    END IF;
  END;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION 'the temporary store does not behave as this file intends: %', v_fail;
  END IF;
  RAISE NOTICE 'self-verify 20261005123000: the temporary résumé reads more than once and expires by the clock; the store spends a per-address and global budget under a live-row ceiling';
END
$check$;
