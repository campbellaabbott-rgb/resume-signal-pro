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
--   * the title -- through the ingest's corrections path. It patches the
--     title first and logs the change to job_board_field_changes afterwards,
--     in the background, where a failed write only warns; and some changes
--     are never logged at all (a fold that changes nothing but apostrophes,
--     sameButApostrophes, among them). So the log is not a full record, and
--     the read itself now says which title it saw (below);
--   * the description -- never rewritten once stored: every writer fills only
--     `description IS NULL`. It can ARRIVE after a read made without one;
--   * the whole row -- deleted and inserted again under the same id (a
--     re-admitted posting), with a new last_seen, which the ingest sets at
--     INSERT only.
--
-- WHAT THE READ KEEPS. Two columns on employer_perk_postings, filled by a
-- BEFORE trigger whenever a read is stored with a hash, from the posting as
-- it stands, and only when its text still hashes to what the sweep read:
--   read_title_md5        md5 of the title read, every apostrophe-like
--                         character folded to ' (the extractor reads them
--                         alike, so such a fold cannot change a count: the
--                         test for this file holds readPosting to that);
--                         'moved' when the text no longer hashes to the read,
--                         so the next walk reads it again;
--   read_had_description  whether that read had a description.
-- Both are NULL on a row stored before this file. Adding them rewrites no
-- row (no default), and the trigger hashes only the rows a sweep stores,
-- which the take already hashed when it answered them.
--
-- SO THE TEST BECOMES, for a row stored with a hash:
--   * a title whose folded md5 is not the one the read kept -- md5 over the
--     TITLE only; or, on a row that kept none, a title change logged for this
--     posting after the read;
--   * a read made without a description, and one present now -- octet_length,
--     which reads the TOAST header, never the text; on a row that kept no
--     flag, the stored hash being the hash of the current title alone;
--   * last_seen after the read (the row was inserted again).
-- The timestamps are compared with a fifteen-minute margin: the ingest stamps
-- a field change at the start of its corrections pass and last_seen at the
-- start of its visit, both a little before the write lands, and a read in
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
-- Re-runnable (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, and the trigger
-- created only where it is missing). Self-verifying below.

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

-- ── what a stored read saw ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employer_perk_postings_note_read()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body  text;
BEGIN
  NEW.read_title_md5 := NULL;
  NEW.read_had_description := NULL;
  IF NEW.text_hash IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.title, p.description INTO v_title, v_body
    FROM public.job_board_postings p WHERE p.id = NEW.posting_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF md5(COALESCE(v_title, '') || E'\n' || COALESCE(v_body, '')) = NEW.text_hash THEN
    NEW.read_title_md5 := md5(translate(COALESCE(v_title, ''), U&'\2018\2019\201B\02BC\FF07', repeat(chr(39), 5)));
    NEW.read_had_description := COALESCE(v_body, '') <> '';
  ELSE
    -- The posting's text moved between the take and this store: the read is
    -- of text it no longer carries, so the next walk reads it again.
    NEW.read_title_md5 := 'moved';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.employer_perk_postings_note_read() IS
  'BEFORE INSERT OR UPDATE OF text_hash on employer_perk_postings (20261109160000): keeps the md5 of '
  'the title the read saw (apostrophes folded) and whether it had a description, from the posting '
  'as it stands when its text still hashes to text_hash, or marks the read moved. Read by '
  'employer_perk_sweep_take.';

REVOKE ALL ON FUNCTION public.employer_perk_postings_note_read() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  tries integer := 0;
BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = 'public.employer_perk_postings'::regclass
                         AND a.attname = 'read_had_description' AND NOT a.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid = 'public.employer_perk_postings'::regclass
                         AND t.tgname = 'employer_perk_postings_note_read' AND NOT t.tgisinternal);
    tries := tries + 1;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      ALTER TABLE public.employer_perk_postings
        ADD COLUMN IF NOT EXISTS read_title_md5 text,
        ADD COLUMN IF NOT EXISTS read_had_description boolean;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                      WHERE t.tgrelid = 'public.employer_perk_postings'::regclass
                        AND t.tgname = 'employer_perk_postings_note_read' AND NOT t.tgisinternal) THEN
        CREATE TRIGGER employer_perk_postings_note_read
          BEFORE INSERT OR UPDATE OF text_hash ON public.employer_perk_postings
          FOR EACH ROW EXECUTE FUNCTION public.employer_perk_postings_note_read();
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      IF tries >= 5 THEN
        RAISE EXCEPTION 'could not take the lock on employer_perk_postings in five two-second tries; nothing was changed, apply again';
      END IF;
      RAISE NOTICE 'employer_perk_postings is busy (try %), waiting a second', tries;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  SET LOCAL lock_timeout TO DEFAULT;
END $$;

COMMENT ON COLUMN public.employer_perk_postings.read_title_md5 IS
  'md5 of the title this read saw, every apostrophe-like character folded to an ASCII apostrophe; '
  '''moved'' when the posting''s text no longer hashed to text_hash at the store; NULL on a read stored '
  'before 20261109160000 or without a hash. employer_perk_sweep_take reads the posting again when its '
  'folded title hashes otherwise.';
COMMENT ON COLUMN public.employer_perk_postings.read_had_description IS
  'Whether this read had a description (NULL as read_title_md5 is). employer_perk_sweep_take reads a '
  'posting again once a description arrives after a read made without one.';

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
                    -- read with no description, and one has arrived (a row
                    -- stored before 20261109160000: its hash is the current
                    -- title's alone)
                    OR (octet_length(p.description) > 0
                        AND (e.read_had_description = false
                             OR (e.read_had_description IS NULL
                                 AND e.text_hash = md5(COALESCE(p.title, '') || E'\n'))))
                    -- not the title the read saw, apostrophes folded
                    OR (e.read_title_md5 IS NOT NULL
                        AND e.read_title_md5 <> md5(translate(COALESCE(p.title, ''), U&'\2018\2019\201B\02BC\FF07', repeat(chr(39), 5))))
                    -- a row that kept no title: a title change logged after the read
                    OR (e.read_title_md5 IS NULL
                        AND EXISTS (SELECT 1 FROM public.job_board_field_changes c
                                     WHERE c.posting_id = p.id
                                       AND c.field = 'title'
                                       AND c.observed_at > e.extracted_at - interval '15 minutes')))))
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
  'changed since the read -- a title other than the one the read kept (or, on a row that kept '
  'none, a logged title change), a description that arrived after a read made without one, or '
  'the row inserted again (20261109160000; it compared an md5 over every description before). Answers the md5 of the text it hands out for employer_perk_store. '
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
  IF position('e.read_title_md5 <> md5(' IN src) = 0 OR position('e.read_had_description = false' IN src) = 0 THEN
    RAISE EXCEPTION 'employer_perk_sweep_take does not read the title and the description the read kept';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'public.employer_perk_postings'::regclass
         AND a.attname IN ('read_title_md5', 'read_had_description') AND NOT a.attisdropped) <> 2 THEN
    RAISE EXCEPTION 'employer_perk_postings lacks read_title_md5 or read_had_description';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.employer_perk_postings'::regclass
                    AND t.tgname = 'employer_perk_postings_note_read'
                    AND t.tgenabled <> 'D' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'employer_perk_postings_note_read is missing or disabled';
  END IF;
  IF has_function_privilege('anon', 'public.employer_perk_postings_note_read()'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.employer_perk_postings_note_read()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'employer_perk_postings_note_read() is callable by a client role';
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
