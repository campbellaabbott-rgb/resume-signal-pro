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
-- callable with the publishable key (the homepage pre-stores every scanned
-- résumé so a checkout can be delivered from it) and wrote up to 150,000
-- characters per call with no limit at all, so one script could fill the
-- database disk. It is now bounded, each refusal answering NULL (what a
-- failed call always returned, so no caller needs a new error path).
--
-- THE BOUNDS ARE KEYED ON THE WRITER FIRST, so that no one writer can refuse
-- everybody else's checkout. An earlier draft of this file spent one shared
-- 1,000-an-hour budget and refused everyone at 5,000 live rows: about 34
-- rotating addresses filled the hour, and five hours of that filled the
-- table, refusing every buyer's checkout for the 24 hours the rows live
-- (review of claude/w1-scan-ai, 2026-10-05). Now, on the platform's address
-- (request_client_address: cf-connecting-ip, else the last forwarded hop) and
-- its network (an IPv4 /24, an IPv6 /48, as job-board .87 derives it):
--   * per address: 30 rows an hour;
--   * per network: 120 rows an hour, and no more than 150 unexpired rows
--     (1.9% of the soft ceiling below) -- the network is stored on the row as
--     an md5, never the address;
--   * for everyone together, only as a last resort: at 8,000 unexpired rows a
--     wider network (IPv4 /16, IPv6 /32) may still store while it holds
--     fewer than 5 of them, so a visitor from anywhere the filler did not
--     come from can still buy; at 10,000 nothing is stored. Filling past
--     8,000 takes 54 distinct /24s held full for a day; using up the room
--     between the two takes 400 more distinct /16s or /32s. With the 24-hour
--     clock 10,000 rows cap the table near 1.5 GB in the worst case (every
--     field at its 50,000-character limit); a real résumé is ~6 KB.
-- A person uploads a handful of versions; the homepage, the apply-kit panel
-- and the checkout keep working. Signature, defaults, validation messages and
-- return type are unchanged.
--
-- DEPENDS ON THE CENSUS (20261004110000): request_client_address() and
-- client_write_allowed(text,integer,integer,integer). PL/pgSQL resolves a
-- call only when it runs, so without them this file would apply cleanly and
-- every store would then fail with 42883. The first block below refuses to
-- apply without them, and the closing check calls store_temp_resume itself.

-- ── 0. the census this file builds on is present ────────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('public.request_client_address()') IS NULL
     OR to_regprocedure('public.client_write_allowed(text,integer,integer,integer)') IS NULL
     OR to_regclass('public.client_write_budget') IS NULL THEN
    RAISE EXCEPTION 'apply 20261004110000 (the census: request_client_address, client_write_allowed, client_write_budget) before 20261005123000; store_temp_resume would fail on every call without them';
  END IF;
END
$needs$;

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

-- The writer's network and wider network, each as an md5 of the CIDR text.
ALTER TABLE public.temp_resume_storage ADD COLUMN IF NOT EXISTS writer_net text;
ALTER TABLE public.temp_resume_storage ADD COLUMN IF NOT EXISTS writer_wide text;
CREATE INDEX IF NOT EXISTS temp_resume_storage_writer_net_idx
  ON public.temp_resume_storage (writer_net, expires_at);
CREATE INDEX IF NOT EXISTS temp_resume_storage_writer_wide_idx
  ON public.temp_resume_storage (writer_wide, expires_at);

-- TWO OVERLOADS, ONE OPEN. Production still carries store_temp_resume(text,text)
-- from 20251216022357; 20261004110000 closed it to client roles (every caller
-- passes all three named arguments) and its census counts it as closed, so it
-- stays. With both overloads defaulting their trailing arguments a SHORT call
-- matches either -- the first apply of this file stopped on exactly that
-- ("function public.store_temp_resume(text) is not unique", 2026-10-05) -- so
-- every call this file makes names all three arguments.

CREATE OR REPLACE FUNCTION public.store_temp_resume(p_resume text, p_linkedin text DEFAULT NULL::text, p_job_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  c_addr_hour constant integer := 30;     -- rows an hour from one address
  c_net_hour  constant integer := 120;    -- rows an hour from one network
  c_net_live  constant integer := 150;    -- unexpired rows from one network
  c_soft_live constant integer := 8000;   -- past this, only a wider network with room
  c_wide_room constant integer := 5;      -- ...holding fewer than this many
  c_hard_live constant integer := 10000;  -- past this, nothing
  v_id   uuid;
  v_inet inet;
  v_net  text;
  v_wide text;
  v_live integer;
  v_n    integer;
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

  -- The writer's networks. Text that is not an address, or no address at all
  -- (a direct SQL session), is the shared 'no-network' bucket, never an error.
  BEGIN
    v_inet := host(public.request_client_address()::inet)::inet;
    IF family(v_inet) = 4 THEN
      v_net  := md5(network(set_masklen(v_inet, 24))::text);
      v_wide := md5(network(set_masklen(v_inet, 16))::text);
    ELSIF family(v_inet) = 6 THEN
      v_net  := md5(network(set_masklen(v_inet, 48))::text);
      v_wide := md5(network(set_masklen(v_inet, 32))::text);
    END IF;
  EXCEPTION WHEN others THEN
    v_net := NULL;
    v_wide := NULL;
  END;
  v_net  := coalesce(v_net, 'no-network');
  v_wide := coalesce(v_wide, 'no-network');

  -- The live rows, read before anything is counted.
  SELECT count(*) INTO v_live
    FROM (SELECT 1 FROM public.temp_resume_storage t WHERE t.expires_at > now() LIMIT c_hard_live) live;
  IF v_live >= c_hard_live THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_n
    FROM (SELECT 1 FROM public.temp_resume_storage t
           WHERE t.writer_net = v_net AND t.expires_at > now() LIMIT c_net_live) mine;
  IF v_n >= c_net_live THEN
    RETURN NULL;
  END IF;
  IF v_live >= c_soft_live THEN
    SELECT count(*) INTO v_n
      FROM (SELECT 1 FROM public.temp_resume_storage t
             WHERE t.writer_wide = v_wide AND t.expires_at > now() LIMIT c_wide_room) wide;
    IF v_n >= c_wide_room THEN
      RETURN NULL;
    END IF;
  END IF;

  -- The address's hour, then the network's hour (the second budget's '*'
  -- bucket is the whole network). No hourly ceiling is shared by everyone:
  -- the live-row bounds above are the last resort. Nothing after this
  -- raises: an exception would roll the counts back with the call.
  IF NOT public.client_write_allowed('temp-resume', c_addr_hour, 1000000, 60) THEN
    RETURN NULL;
  END IF;
  IF NOT public.client_write_allowed('temp-resume-net:' || v_net, c_net_hour, c_net_hour, 60) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.temp_resume_storage (resume_text, linkedin_text, job_description_text, writer_net, writer_wide)
  VALUES (p_resume, p_linkedin, p_job_description, v_net, v_wide)
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
  v_id2      uuid;
  v_text     text;
  v_n        integer;
  v_def      text;
  v_fail     text;
  v_sentinel constant text := 'temp resume probe: rolled back';
  v_probe    constant text := 'selfcheck 20261005123000 résumé text, long enough to be stored by the real function';
BEGIN
  -- The three-argument store is the one the clients call; any other overload
  -- (production's leftover two-argument one) must stay closed to them, or it
  -- would be a way around every budget below.
  SELECT count(*)::integer INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'store_temp_resume'
     AND p.oid IS DISTINCT FROM to_regprocedure('public.store_temp_resume(text,text,text)')::oid
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF to_regprocedure('public.store_temp_resume(text,text,text)') IS NULL OR v_n <> 0 THEN
    RAISE EXCEPTION 'want the three-argument store_temp_resume, and every other overload closed to client roles; % other overload(s) are client-callable', v_n;
  END IF;
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

  BEGIN
    -- Stored once, read twice: the second reader finds what the first found.
    INSERT INTO public.temp_resume_storage (resume_text) VALUES (v_probe)
    RETURNING session_id INTO v_id;
    SELECT r.resume_text INTO v_text FROM public.get_temp_resume(v_id::text) r;
    IF v_text IS DISTINCT FROM v_probe THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the first read did not return the stored text';
    END IF;
    v_text := NULL;
    SELECT r.resume_text INTO v_text FROM public.get_temp_resume(v_id::text) r;
    IF v_text IS DISTINCT FROM v_probe THEN
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

    -- THE STORE ITSELF, called as the browser calls it: the platform's
    -- address arrives in request.headers (set for this sub-block only).
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"192.0.2.1"}', true);
    v_id := public.store_temp_resume(v_probe, NULL, 'a job description');
    IF v_id IS NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'store_temp_resume refused a first store from a fresh address';
    ELSIF (SELECT t.writer_net FROM public.temp_resume_storage t WHERE t.session_id = v_id) IS DISTINCT FROM md5('192.0.2.0/24') THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the stored row does not name its writer''s /24';
    ELSE
      SELECT r.job_description_text INTO v_text FROM public.get_temp_resume(v_id::text) r;
      IF v_text IS DISTINCT FROM 'a job description' THEN
        v_fail := coalesce(v_fail || '; ', '') || 'a stored row could not be read back';
      END IF;
    END IF;

    -- One network holding its 150 live rows is refused, from any of its
    -- addresses; a visitor from another network is not.
    INSERT INTO public.temp_resume_storage (resume_text, writer_net, writer_wide)
    SELECT 'selfcheck filler', md5('192.0.2.0/24'), md5('192.0.0.0/16') FROM generate_series(1, 150);
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"192.0.2.77"}', true);
    IF public.store_temp_resume(v_probe, NULL, NULL) IS NOT NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'a network past its 150 live rows could still store';
    END IF;
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"198.51.100.1"}', true);
    IF public.store_temp_resume(v_probe, NULL, NULL) IS NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'one full network refused a visitor from another network';
    END IF;

    -- Past 8,000 live rows (whatever production holds now, topped up), a
    -- wider network with room still stores; one holding 5 does not.
    SELECT count(*) INTO v_n FROM public.temp_resume_storage t WHERE t.expires_at > now();
    INSERT INTO public.temp_resume_storage (resume_text, writer_net, writer_wide)
    SELECT 'selfcheck filler', md5('filler'), md5('filler') FROM generate_series(1, greatest(8000 - v_n, 0));
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"203.0.113.9"}', true);
    v_id2 := public.store_temp_resume(v_probe, NULL, NULL);
    IF v_id2 IS NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'past the soft ceiling, a visitor from a fresh network was refused';
    END IF;
    INSERT INTO public.temp_resume_storage (resume_text, writer_net, writer_wide)
    SELECT 'selfcheck filler', md5('filler'), md5('203.0.0.0/16') FROM generate_series(1, 5);
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"203.0.200.1"}', true);
    IF public.store_temp_resume(v_probe, NULL, NULL) IS NOT NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'past the soft ceiling, a wide network already holding 5 rows could still store';
    END IF;

    -- At 10,000 live rows, nothing.
    SELECT count(*) INTO v_n FROM public.temp_resume_storage t WHERE t.expires_at > now();
    INSERT INTO public.temp_resume_storage (resume_text, writer_net, writer_wide)
    SELECT 'selfcheck filler', md5('filler'), md5('filler') FROM generate_series(1, greatest(10000 - v_n, 0));
    PERFORM set_config('request.headers', '{"cf-connecting-ip":"100.64.7.7"}', true);
    IF public.store_temp_resume(v_probe, NULL, NULL) IS NOT NULL THEN
      v_fail := coalesce(v_fail || '; ', '') || 'the hard ceiling of 10,000 live rows let a row in';
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
  RAISE NOTICE 'self-verify 20261005123000: the temporary résumé reads more than once and expires by the clock; store_temp_resume stores, refuses a full network without refusing another, and holds the soft and hard live-row ceilings';
END
$check$;
