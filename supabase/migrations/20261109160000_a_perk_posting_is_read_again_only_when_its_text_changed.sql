-- A PERK POSTING IS READ AGAIN ONLY WHEN ITS TEXT CHANGED.
--
-- Cost audit 2026-11-08, "Perk sweep". Once a day (the ~20-hour requeue) the
-- perk sweep walks every board, and employer_perk_sweep_take (20261012110000)
-- decides per serving posting whether to read it again. Its last test was
--   e.text_hash <> md5(COALESCE(p.title, '') || E'\n' || COALESCE(p.description, ''))
-- evaluated for EVERY serving posting already read -- about a million rows,
-- each detoasting a description of up to 12 KB, to find the handful whose
-- text moved.
--
-- WHAT CAN MOVE A POSTING'S TEXT, checked on the code on 2026-11-09:
--   * the title -- only through the ingest's corrections path, which logs
--     every title it changes to job_board_field_changes before the change can
--     count (a correction past the per-visit log cap is deferred WITH its
--     patch, so it is never applied unlogged). The single exception is a fold
--     that changes nothing but apostrophes (sameButApostrophes), patched
--     without a log row: the extractor reads ' and the typographic apostrophe
--     alike, so such a fold cannot change what a posting is counted for (the
--     test for this file holds readPosting to that);
--   * the description -- never rewritten once stored: every writer fills only
--     `description IS NULL`. It can ARRIVE after a read made without one;
--   * the whole row -- deleted and inserted again under the same id (a
--     re-admitted posting), with a new last_seen, which the ingest sets at
--     INSERT only.
--
-- SO THE TEST BECOMES, for a row stored with a hash:
--   * a title change logged for this posting after the read, or
--   * a description present now when the stored hash is the hash of the
--     title alone (the read had no description) -- md5 over the TITLE only,
--     and octet_length, which reads the TOAST header, never the text, or
--   * last_seen after the read (the row was inserted again).
-- Both timestamps are compared with a fifteen-minute margin: the ingest
-- stamps a field change at the start of its corrections pass and last_seen at
-- the start of its visit, both a little before the write lands, and a read in
-- between must still count as older than the change. The margin costs at most
-- one extra read of a posting read within fifteen minutes of a change.
-- Every other arm (new posting, older extractor version, an unreadable read
-- whose text has since become readable, a row stored without a hash) is
-- unchanged, and the md5 the take ANSWERS -- computed only for the rows it
-- hands out -- is unchanged, so employer-profiles needs no change.
--
-- AND THE CRON CAN ASK WHETHER THERE IS WORK. employer-perks-sweep POSTs to
-- the function every minute whether or not a board is pending. Two functions
-- let the schedule ask first (the gate itself is 20261109161000):
--   employer_perk_extractor_version()  the extractor version the function
--                                      sweeps with, as SQL. MIRRORS
--                                      EXTRACTOR_VERSION in
--                                      supabase/functions/_shared/perks-extract.ts;
--                                      a test holds the two equal.
--   employer_perk_sweep_due()          true when a board is pending at that
--                                      version, when the daily requeue is due,
--                                      or when no sweep run has been recorded
--                                      for an hour (so the sweep never goes
--                                      silent on a wrong answer here).
--
-- Re-runnable (CREATE OR REPLACE only). Self-verifying below.

CREATE OR REPLACE FUNCTION public.employer_perk_extractor_version()
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 2::smallint
$$;

COMMENT ON FUNCTION public.employer_perk_extractor_version() IS
  'The perk extractor version employer-profiles sweeps with: a copy of EXTRACTOR_VERSION in '
  'supabase/functions/_shared/perks-extract.ts, held equal by a test. Raise both together. '
  'Read by employer_perk_sweep_due(); service_role only.';

REVOKE ALL ON FUNCTION public.employer_perk_extractor_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employer_perk_extractor_version() TO service_role;

CREATE OR REPLACE FUNCTION public.employer_perk_sweep_due()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.employer_perk_sweep_boards q
                  WHERE q.swept_version IS DISTINCT FROM public.employer_perk_extractor_version()
                     OR q.swept_at IS NULL
                     OR q.swept_at < q.queued_at)
      OR NOT EXISTS (SELECT 1 FROM public.employer_perk_sweep_boards q
                      WHERE q.queued_at > now() - interval '20 hours')
      OR NOT EXISTS (SELECT 1 FROM public.employer_profile_runs r
                      WHERE r.kind = 'sweep' AND r.started_at > now() - interval '1 hour')
$$;

COMMENT ON FUNCTION public.employer_perk_sweep_due() IS
  'Whether the every-minute employer-perks-sweep kick has anything to do: a board pending at '
  'employer_perk_extractor_version() (never swept, swept before it was queued again, or swept at '
  'another version -- the take''s own pending rule), the 20-hour requeue due, or no sweep run '
  'recorded in employer_profile_runs for an hour (a heartbeat, so a wrong answer here can delay '
  'the sweep by an hour at most and never stop it). service_role and the scheduler only.';

REVOKE ALL ON FUNCTION public.employer_perk_sweep_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employer_perk_sweep_due() TO service_role;

-- ── the take: the same walk, a cheaper test for a changed posting ──────────
CREATE OR REPLACE FUNCTION public.employer_perk_sweep_take(p_limit integer, p_version smallint, p_budget_ms integer DEFAULT 3000)
RETURNS TABLE (company_token text, posting_id text, source text, country text, agency boolean, title text, body text, text_hash text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => LEAST(GREATEST(COALESCE(p_budget_ms, 3000), 200), 10000) / 1000.0);
  v_left integer := LEAST(GREATEST(COALESCE(p_limit, 0), 0), 2000);
  v_snap date;
  v_got integer;
  b record;
BEGIN
  IF v_left = 0 OR p_version IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employer_perk_sweep_boards q WHERE q.queued_at > now() - interval '20 hours') THEN
    SELECT max(s.snapshot_date) INTO v_snap FROM public.job_board_company_snapshots s;
    IF v_snap IS NOT NULL THEN
      INSERT INTO public.employer_perk_sweep_boards AS q (company_token, open_roles, queued_at)
      SELECT s.company_token, s.open_roles_served, now()
        FROM public.job_board_company_snapshots s
       WHERE s.snapshot_date = v_snap AND COALESCE(s.open_roles_served, 0) > 0
      ON CONFLICT ON CONSTRAINT employer_perk_sweep_boards_pkey DO UPDATE
        SET open_roles = EXCLUDED.open_roles, queued_at = EXCLUDED.queued_at;
      DELETE FROM public.employer_perk_sweep_boards q
       WHERE NOT EXISTS (SELECT 1 FROM public.job_board_company_snapshots s
                          WHERE s.snapshot_date = v_snap AND s.company_token = q.company_token
                            AND COALESCE(s.open_roles_served, 0) > 0);
    END IF;
  END IF;

  FOR b IN
    SELECT q.company_token AS token, q.cursor_id
      FROM public.employer_perk_sweep_boards q
     WHERE q.swept_version IS DISTINCT FROM p_version OR q.swept_at IS NULL OR q.swept_at < q.queued_at
     ORDER BY q.open_roles DESC, q.company_token
     LIMIT 500
  LOOP
    EXIT WHEN v_left <= 0 OR clock_timestamp() > v_deadline;
    RETURN QUERY
      SELECT p.company_token, p.id, p.source, p.country, p.agency, p.title, p.description,
             md5(COALESCE(p.title, '') || E'\n' || COALESCE(p.description, ''))
        FROM public.job_board_postings p
        LEFT JOIN public.employer_perk_postings e ON e.posting_id = p.id
       WHERE p.company_token = b.token
         AND p.missing_since IS NULL
         AND p.effective_posted >= now() - interval '30 days'
         AND p.source <> 'usajobs'
         AND (b.cursor_id IS NULL OR p.id > b.cursor_id)
         AND (e.posting_id IS NULL
              OR e.extractor_version < p_version
              OR (NOT e.readable AND p.description IS NOT NULL AND octet_length(p.description) >= 200)
              -- a row stored without a hash (a sweep that sent none) is never
              -- re-read on it, so such a sweep cannot loop on its own rows
              OR (e.text_hash IS NOT NULL
                  AND (
                    -- inserted again since the read
                    p.last_seen > e.extracted_at - interval '15 minutes'
                    -- read with no description, and one has arrived
                    OR (octet_length(p.description) > 0
                        AND e.text_hash = md5(COALESCE(p.title, '') || E'\n'))
                    -- a title change logged after the read
                    OR EXISTS (SELECT 1 FROM public.job_board_field_changes c
                                WHERE c.posting_id = p.id
                                  AND c.field = 'title'
                                  AND c.observed_at > e.extracted_at - interval '15 minutes'))))
       ORDER BY p.id
       LIMIT v_left;
    GET DIAGNOSTICS v_got = ROW_COUNT;
    IF v_got = 0 THEN
      UPDATE public.employer_perk_sweep_boards q
         SET swept_at = now(), swept_version = p_version, cursor_id = NULL
       WHERE q.company_token = b.token;
    END IF;
    v_left := v_left - v_got;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.employer_perk_sweep_take(integer, smallint, integer) IS
  'The perk sweep''s walk: up to p_limit serving postings, board by board in open-roles order, '
  'that have no read at p_version, whose unreadable read now has readable text, or whose text '
  'changed since the read -- a logged title change, a description that arrived after a read made '
  'without one, or the row inserted again (20261109160000; it compared an md5 over every '
  'description before). Answers the md5 of the text it hands out for employer_perk_store. '
  'Marks a board with nothing pending swept. Refills the queue from the newest company snapshot '
  'when no board was queued in 20 hours. service_role only.';

REVOKE ALL ON FUNCTION public.employer_perk_sweep_take(integer, smallint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employer_perk_sweep_take(integer, smallint, integer) TO service_role;

-- The end state, read back from the catalogue.
DO $verify$
DECLARE
  t   oid := to_regprocedure('public.employer_perk_sweep_take(integer, smallint, integer)');
  d   oid := to_regprocedure('public.employer_perk_sweep_due()');
  v   oid := to_regprocedure('public.employer_perk_extractor_version()');
  src text;
  fn  oid;
BEGIN
  IF t IS NULL OR d IS NULL OR v IS NULL THEN
    RAISE EXCEPTION 'a perk sweep function is missing (take %, due %, version %)', t, d, v;
  END IF;
  SELECT p.prosrc INTO src FROM pg_proc p WHERE p.oid = t;
  IF position('job_board_field_changes' IN src) = 0 OR position('p.last_seen > e.extracted_at' IN src) = 0 THEN
    RAISE EXCEPTION 'employer_perk_sweep_take does not read the change log and the insert stamp';
  END IF;
  IF (length(src) - length(replace(src, 'COALESCE(p.description, '''')', ''))) / length('COALESCE(p.description, '''')') <> 1 THEN
    RAISE EXCEPTION 'employer_perk_sweep_take hashes the description outside the rows it answers';
  END IF;
  IF public.employer_perk_extractor_version() IS DISTINCT FROM 2::smallint THEN
    RAISE EXCEPTION 'employer_perk_extractor_version() is not 2';
  END IF;
  FOREACH fn IN ARRAY ARRAY[t, d, v] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not service-role only', fn::regprocedure;
    END IF;
  END LOOP;
END
$verify$;
