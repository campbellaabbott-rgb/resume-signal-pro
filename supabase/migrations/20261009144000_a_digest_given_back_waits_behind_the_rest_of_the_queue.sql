-- A DIGEST GIVEN BACK WAITS BEHIND THE REST OF THE QUEUE (review of the
-- wave-3 integration, 2026-10-10).
--
-- search_digest_claim_batch and agent_digest_claim_batch (20261004100000)
-- choose due rows by the window stamp alone, oldest first with never-sent
-- rows ahead of everything. A digest that hands a row back restores that
-- stamp, so the row led the very next claim:
--
--   * the saved-search digest: a search the board cannot count (a slow
--     countUnavailable answer, a 500 after a timeout) or whose mail keeps
--     failing was handed back every run and claimed first every run. Thirteen
--     slow ones used the whole 100 s clock, and 400 fast ones the whole run,
--     so no search behind them was ever mailed while the run said ok;
--   * the agent digest: a mandate nobody may mail (a lapsed plan, a pass
--     buyer, opted in by default) or with an empty shortlist was handed back
--     every run; 500 of them at the head of its one 500-row claim meant no
--     mandate behind them was ever claimed.
--
-- Each table gains an attempt stamp (user_job_searches.digest_attempted_at,
-- agent_mandates.email_attempted_at). Each claim orders by it first, never-
-- attempted rows ahead, then by the window stamp as before, and stamps it
-- along with the window stamp. A row a run worked therefore goes behind every
-- row not yet worked, whatever came of it. The digests restore only the
-- window stamp when they give a worked row back (its window is retried, from
-- the back of the queue) and restore both stamps for a row the clock left
-- unstarted (it keeps its place). The claims return the previous attempt
-- stamp beside the previous window stamp for that, and return their rows in
-- the order they chose them: an UPDATE hands its rows back in the order it
-- wrote them, and the digests work rows in the order they receive them.
--
-- The return type grows a column, so each claim is dropped (by name and any
-- overload the catalogue holds) and created again, service-role only as
-- before. An edge function still deployed from before reads the columns it
-- knows and ignores the new one. Apply this BEFORE send-search-digest
-- 2026-10-09.3 and send-agent-digest 2026-10-09.3, which write give-backs at
-- once and rely on this ordering to keep a given-back row from leading the
-- next claim of the same run.
--
-- Safe to re-run.

SET LOCAL statement_timeout = '2min';

ALTER TABLE public.user_job_searches ADD COLUMN IF NOT EXISTS digest_attempted_at timestamptz;
ALTER TABLE public.agent_mandates ADD COLUMN IF NOT EXISTS email_attempted_at timestamptz;

COMMENT ON COLUMN public.user_job_searches.digest_attempted_at IS
  'When a digest run last claimed this search. search_digest_claim_batch orders by it first, so a search a run worked waits behind every search not yet worked.';
COMMENT ON COLUMN public.agent_mandates.email_attempted_at IS
  'When a morning-shortlist run last claimed this mandate. agent_digest_claim_batch orders by it first, so a mandate a run worked waits behind every mandate not yet worked.';

DROP FUNCTION IF EXISTS public.search_digest_claim_batch(integer);
DROP FUNCTION IF EXISTS public.agent_digest_claim_batch(integer);
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('search_digest_claim_batch', 'agent_digest_claim_batch')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.search_digest_claim_batch(p_limit integer)
RETURNS TABLE (
  sd_id uuid,
  sd_user_id uuid,
  sd_name text,
  sd_params jsonb,
  sd_prev_sent_at timestamptz,
  sd_fit_threshold integer,
  sd_cadence text,
  sd_prev_attempted_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH due AS (
    SELECT s.id AS d_id, s.digest_last_sent_at AS d_prev, s.digest_attempted_at AS d_prev_attempted
      FROM public.user_job_searches s
     WHERE s.digest_opt_in = true
       AND (s.digest_last_sent_at IS NULL
            OR s.digest_last_sent_at < now() - CASE WHEN s.digest_cadence = 'daily'
                                                    THEN interval '20 hours' ELSE interval '6 days' END)
     ORDER BY s.digest_attempted_at ASC NULLS FIRST, s.digest_last_sent_at ASC NULLS FIRST, s.id
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 400)
     FOR UPDATE OF s SKIP LOCKED
  )
  , claimed AS (
    UPDATE public.user_job_searches m
       SET digest_last_sent_at = now(),
           digest_attempted_at = now()
      FROM due
     WHERE m.id = due.d_id
    RETURNING m.id, m.user_id, m.name, m.params, due.d_prev, m.fit_threshold, m.digest_cadence, due.d_prev_attempted
  )
  -- In the order they were chosen: the digest works its rows in the order it
  -- receives them, and an UPDATE returns them in whatever order it wrote them.
  SELECT c.id, c.user_id, c.name, c.params, c.d_prev, c.fit_threshold, c.digest_cadence, c.d_prev_attempted
    FROM claimed c
   ORDER BY c.d_prev_attempted ASC NULLS FIRST, c.d_prev ASC NULLS FIRST, c.id;
$$;

CREATE FUNCTION public.agent_digest_claim_batch(p_limit integer)
RETURNS TABLE (
  ad_user_id uuid,
  ad_email text,
  ad_prev_sent_at timestamptz,
  ad_prev_attempted_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  WITH due AS (
    SELECT a.user_id AS d_user, a.email_last_sent_at AS d_prev, a.email_attempted_at AS d_prev_attempted
      FROM public.agent_mandates a
     WHERE a.email_opt_in = true
       AND (a.email_last_sent_at IS NULL OR a.email_last_sent_at < now() - interval '20 hours')
     ORDER BY a.email_attempted_at ASC NULLS FIRST, a.email_last_sent_at ASC NULLS FIRST, a.user_id
     LIMIT least(greatest(coalesce(p_limit, 0), 1), 500)
     FOR UPDATE OF a SKIP LOCKED
  )
  , claimed AS (
    UPDATE public.agent_mandates m
       SET email_last_sent_at = now(),
           email_attempted_at = now()
      FROM due
     WHERE m.user_id = due.d_user
    RETURNING m.user_id, m.email, due.d_prev, due.d_prev_attempted
  )
  SELECT c.user_id, c.email, c.d_prev, c.d_prev_attempted
    FROM claimed c
   ORDER BY c.d_prev_attempted ASC NULLS FIRST, c.d_prev ASC NULLS FIRST, c.user_id;
$$;

COMMENT ON FUNCTION public.search_digest_claim_batch(integer) IS
  'Claims up to p_limit due saved-search digests (never-attempted first, then the longest since attempted, then the oldest window), stamping the window and the attempt in the same statement; returns the previous stamps for a give-back. service_role only.';
COMMENT ON FUNCTION public.agent_digest_claim_batch(integer) IS
  'Claims up to p_limit due morning shortlists (never-attempted first, then the longest since attempted, then the oldest cursor), stamping the cursor and the attempt in the same statement; returns the previous stamps for a give-back. service_role only.';

REVOKE ALL ON FUNCTION public.search_digest_claim_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_digest_claim_batch(integer) TO service_role;
REVOKE ALL ON FUNCTION public.agent_digest_claim_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_digest_claim_batch(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

DO $verify$
DECLARE
  v_search regprocedure := to_regprocedure('public.search_digest_claim_batch(integer)');
  v_agent regprocedure := to_regprocedure('public.agent_digest_claim_batch(integer)');
  v_bad text[] := ARRAY[]::text[];
  v_fn regprocedure;
BEGIN
  IF v_search IS NULL OR v_agent IS NULL THEN
    RAISE EXCEPTION 'a digest claim does not exist after this file';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname IN ('search_digest_claim_batch', 'agent_digest_claim_batch')) <> 2 THEN
    v_bad := v_bad || 'more than one overload of a digest claim survives'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_job_searches' AND column_name = 'digest_attempted_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_mandates' AND column_name = 'email_attempted_at') THEN
    v_bad := v_bad || 'an attempt stamp column is missing'::text;
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[v_search, v_agent] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      v_bad := v_bad || format('%s is not service-role only', v_fn);
    END IF;
  END LOOP;
  IF position('ORDER BY s.digest_attempted_at ASC NULLS FIRST' in pg_get_functiondef(v_search)) = 0 THEN
    v_bad := v_bad || 'the saved-search claim does not put a worked search behind the rest'::text;
  END IF;
  IF position('ORDER BY a.email_attempted_at ASC NULLS FIRST' in pg_get_functiondef(v_agent)) = 0 THEN
    v_bad := v_bad || 'the shortlist claim does not put a worked mandate behind the rest'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_search AND 'sd_prev_attempted_at' = ANY (proargnames))
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_agent AND 'ad_prev_attempted_at' = ANY (proargnames)) THEN
    v_bad := v_bad || 'a claim does not return the previous attempt stamp'::text;
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'digest claim self-check failed: %', array_to_string(v_bad, ' | ');
  END IF;
  RAISE NOTICE 'a digest row a run worked now waits behind every row not yet worked';
END
$verify$;
