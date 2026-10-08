-- A SAVED SEARCH REMEMBERS THE POSTINGS IT ALREADY MAILED (wave 2 email-ops,
-- register L10-02).
--
-- send-search-digest windowed every saved search on the EMPLOYER's stated date
-- (postedAfter = the last send, bound to posted_at). A Workday posting dated
-- three days ago and first read by us today was outside every later window,
-- and a posting with no stated date could never satisfy the predicate, so a
-- watch on an employer whose feed carries no dates could never fire.
--
-- The digest now asks the board for newSince: posted_at OR first_seen after the
-- last send (job-board .91). A discovery window can surface a posting a second
-- time -- an employer re-dating a posting under the same id (Ashby does), or a
-- first_seen reset -- so each search remembers what it mailed, for 30 days,
-- and the digest drops those before it counts or lists.
--
-- search_digest_sent: service role only (RLS on, no policy, revoked from the
-- client roles by name). search_digest_record_sent: SECURITY INVOKER, called by
-- send-search-digest with the service key after a send succeeds; it records
-- the ids and prunes this search's rows older than 30 days in one statement.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.search_digest_sent (
  search_id uuid NOT NULL REFERENCES public.user_job_searches(id) ON DELETE CASCADE,
  posting_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, posting_id)
);
CREATE INDEX IF NOT EXISTS search_digest_sent_sent_at_idx ON public.search_digest_sent (sent_at);

ALTER TABLE public.search_digest_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.search_digest_sent FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_digest_sent TO service_role;

CREATE OR REPLACE FUNCTION public.search_digest_record_sent(p_search_id uuid, p_posting_ids text[])
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pruned AS (
    DELETE FROM public.search_digest_sent
     WHERE search_id = p_search_id AND sent_at < now() - interval '30 days'
    RETURNING 1
  ), ins AS (
    INSERT INTO public.search_digest_sent (search_id, posting_id)
    SELECT DISTINCT p_search_id, x
      FROM unnest((coalesce(p_posting_ids, ARRAY[]::text[]))[1:200]) AS x
     WHERE x IS NOT NULL AND length(x) BETWEEN 1 AND 300
    ON CONFLICT (search_id, posting_id) DO UPDATE SET sent_at = excluded.sent_at
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins)::integer;
$$;

COMMENT ON FUNCTION public.search_digest_record_sent(uuid, text[]) IS
  'send-search-digest records the postings a sent digest counted, so a re-dated or re-discovered posting is not mailed twice; prunes the search''s rows older than 30 days. Service role only.';

REVOKE ALL ON FUNCTION public.search_digest_record_sent(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_digest_record_sent(uuid, text[]) TO service_role;

DO $$
BEGIN
  IF to_regclass('public.search_digest_sent') IS NULL THEN
    RAISE EXCEPTION 'self-check: search_digest_sent was not created';
  END IF;
  IF to_regprocedure('public.search_digest_record_sent(uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'self-check: search_digest_record_sent(uuid, text[]) was not created';
  END IF;
  IF has_table_privilege('anon', 'public.search_digest_sent', 'SELECT')
     OR has_table_privilege('authenticated', 'public.search_digest_sent', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: a client role can read search_digest_sent';
  END IF;
  IF has_function_privilege('anon', 'public.search_digest_record_sent(uuid,text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.search_digest_record_sent(uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: a client role can run search_digest_record_sent';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.search_digest_record_sent(uuid,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role cannot run search_digest_record_sent';
  END IF;
END $$;
