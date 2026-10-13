-- A POSTING'S REQUIREMENTS ARE READ ONCE AND KEPT A MONTH (résumé matching, phase 0).
--
-- resume-match reads the top 40 candidates' descriptions and extracts what
-- each posting asks for (_shared/posting-requirements.ts): the required and
-- preferred lines, the stated minimum, the licence and where it must be held,
-- sponsorship, citizenship, an active clearance, degree, language, shift and
-- driving, each with a quote of about 160 characters, plus the posting's
-- recognised terms (the dictionary walk behind keyword overlap). Extraction
-- costs about 0.11 ms a posting; the term walk about 16 ms locally and far
-- more at the edge, which is why a call walks at most 6 uncached postings.
-- This table keeps both, keyed by posting and extractor version, so the next
-- reader of the same posting pays nothing.
--
-- LAZY, NEVER EAGER: rows are written only for postings a match read. There is
-- no backfill over the corpus while the 20 vs 27 GB disk question is open.
-- About 1-2 KB a row.
--
-- WHAT IT HOLDS: posting text facts only. Never a résumé, a profile, an
-- address or anything about who asked (src/test/match-privacy.test.ts runs
-- resume-match with canary profile values and asserts none reaches an insert).
--
-- PURGED DAILY: a row older than 30 days, or whose posting is no longer served
-- (gone, or missing_since set), is deleted. The cron COMMAND sets its own
-- statement_timeout, because a function's SET never bounds a statement pg_cron
-- already started (20261003220000).
--
-- Service role only: RLS on with no policy, Supabase's default ALL for anon and
-- authenticated revoked by name, and a DO block that raises if either still
-- holds a privilege. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.job_posting_requirements (
  posting_id text NOT NULL,
  extractor_version text NOT NULL,
  requirements jsonb NOT NULL,
  posting_terms text[],
  description_chars integer NOT NULL DEFAULT 0,
  read_at timestamptz NOT NULL DEFAULT now(),
  terms_at timestamptz,
  PRIMARY KEY (posting_id, extractor_version)
);
CREATE INDEX IF NOT EXISTS job_posting_requirements_read_at_idx ON public.job_posting_requirements (read_at);

ALTER TABLE public.job_posting_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_posting_requirements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_posting_requirements TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent -- job_posting_requirements is not purged on a schedule here';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-job-posting-requirements') THEN
    PERFORM cron.unschedule('purge-job-posting-requirements');
  END IF;
  PERFORM cron.schedule('purge-job-posting-requirements', '41 4 * * *',
    'SET statement_timeout = ''120s''; DELETE FROM public.job_posting_requirements r WHERE r.read_at < now() - interval ''30 days'' OR NOT EXISTS (SELECT 1 FROM public.job_board_postings p WHERE p.id = r.posting_id AND p.missing_since IS NULL);');
END $$;

DO $$
DECLARE
  r text;
  p text;
  v_cmd text;
BEGIN
  IF to_regclass('public.job_posting_requirements') IS NULL THEN
    RAISE EXCEPTION 'job_posting_requirements was not created';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.job_posting_requirements'::regclass) THEN
    RAISE EXCEPTION 'job_posting_requirements has row level security off';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.job_posting_requirements', p) THEN
        RAISE EXCEPTION 'job_posting_requirements: % still holds %', r, p;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.job_posting_requirements', p) THEN
      RAISE EXCEPTION 'job_posting_requirements: service_role lacks %, and resume-match writes the cache as service_role', p;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'purge-job-posting-requirements';
    IF v_cmd IS NULL OR v_cmd NOT LIKE 'SET statement_timeout = %; DELETE FROM public.job_posting_requirements %' THEN
      RAISE EXCEPTION 'purge-job-posting-requirements: the command must set its own statement_timeout before the delete, found: %', v_cmd;
    END IF;
  END IF;
END $$;
