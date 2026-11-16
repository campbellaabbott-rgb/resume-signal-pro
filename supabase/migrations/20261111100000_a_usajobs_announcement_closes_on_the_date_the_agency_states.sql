-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the board .102 integration).
--
-- A USAJOBS ANNOUNCEMENT CLOSES ON THE DATE THE AGENCY STATES.
--
-- Board .102, XR-1. Every USAJOBS announcement states the day applications
-- close (ApplicationCloseDate). The board read the announcement and dropped
-- that date, so a closed announcement stayed served until the feed stopped
-- listing it, and usajobs closed_90d read 0. job-board .102 keeps the date on
-- the row and, in the pass-end sweep step, closes a stored announcement once
-- its date has passed, through the same path a feed removal takes: a closure
-- row and an exit row with exit_reason 'removed' (which the exit CHECK
-- already allows), the exit marked with how we knew.
--
-- TWO COLUMNS, catalog-only:
--   job_board_postings.closes_at  timestamptz  the close date the employer
--                                              states; NULL where none is stated
--   job_board_exits.exit_basis    text         'stated_close' on an exit the
--                                              stated date closed; NULL otherwise
-- No default, no index and no CHECK, so neither ALTER rewrites or scans a row.
-- Both ALTERs run in ONE block, the exit table first and the posting table
-- last, each waiting at most two seconds for its lock. A timeout on either
-- rolls the block back, which releases both locks before the one-second wait,
-- and the block is tried up to ten times. So the posting table's lock is held
-- only from its grant to the end of the transaction, never across a wait for
-- the exit table's, and the ALTER never queues behind a long reader of either.
--
-- AND THE CORRECTIONS RPC LEARNS TWO KEYS. apply_posting_corrections is
-- restated after the ALTERs with closes_at and department, the two keys .102's
-- diff loop patches that no definition had taught it; the reason is at the
-- function. It takes no lock on either table.
--
-- ORDER: before fn:job-board. A .102 that runs first still stores its rows:
-- an insert that names a missing closes_at is retried without it, and the
-- close step reads nothing until the column exists; its closes_at and
-- department patches reach the old RPC, which ignores them, until this runs.
--
-- Re-runnable: IF NOT EXISTS on the columns and CREATE OR REPLACE on the
-- function; the checks below only read the catalog.

DO $$
DECLARE
  tries int := 0;
BEGIN
  LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'job_board_exits' AND column_name = 'exit_basis')
          AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'job_board_postings' AND column_name = 'closes_at');
    tries := tries + 1;
    BEGIN
      SET LOCAL lock_timeout = '2s';
      ALTER TABLE public.job_board_exits ADD COLUMN IF NOT EXISTS exit_basis text;
      ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS closes_at timestamptz;
    EXCEPTION WHEN lock_not_available THEN
      IF tries >= 10 THEN
        RAISE EXCEPTION 'could not take the locks on job_board_exits and job_board_postings in ten two-second tries; nothing was changed, apply again';
      END IF;
      RAISE NOTICE 'job_board_exits or job_board_postings is busy (try %), both locks released, waiting a second', tries;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  SET LOCAL lock_timeout TO DEFAULT;
END $$;

COMMENT ON COLUMN public.job_board_postings.closes_at IS
  'The date applications close, as the employer states it (USAJOBS ApplicationCloseDate); NULL where none is stated. '
  'job-board .102 closes a stored row once it has passed (20261111100000).';
COMMENT ON COLUMN public.job_board_exits.exit_basis IS
  '''stated_close'' when the employer''s stated close date closed the posting, not a read of the feed; NULL otherwise (20261111100000).';

-- Self-check: both columns exist with those types.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'job_board_postings' AND column_name = 'closes_at')
     IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '20261111100000: job_board_postings.closes_at is missing or not timestamptz';
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'job_board_exits' AND column_name = 'exit_basis')
     IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '20261111100000: job_board_exits.exit_basis is missing or not text';
  END IF;
END $$;

-- THE CORRECTIONS RPC LEARNS closes_at AND department.
--
-- job-board .102's diff loop patches two keys apply_posting_corrections was
-- never taught: closes_at (XR-1: an announcement the agency extended moves its
-- date, and a row stored before .102 gains one when a read reaches it) and
-- department (S14X-216: a department stored entity-encoded heals). The RPC is
-- a hand-listed UPDATE: a key it does not name is ignored, and the call still
-- counts the row as matched, so the edge reads success while nothing lands.
-- Without this an extended announcement closes on its old date and comes back
-- as a new row with its first-seen date reset, the rows stored before .102
-- never gain a date, entity departments never heal, and every visit re-sends
-- the same patches as UPDATEs that change nothing.
--
-- The fourteen columns of 20260906210500 are restated verbatim (CREATE OR
-- REPLACE rewrites the whole body, and a column left out is un-taught), with
-- the same signature, language, SECURITY DEFINER, search_path, timeout and
-- return. Both new keys are corrections of our own reading of the feed, so the
-- edge writes no field-change log line for either.

CREATE OR REPLACE FUNCTION public.apply_posting_corrections(p_patches jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
DECLARE
  n integer;
BEGIN
  IF p_patches IS NULL OR jsonb_typeof(p_patches) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH patch AS (
    SELECT e.value AS p
    FROM jsonb_array_elements(p_patches) AS e(value)
    WHERE jsonb_typeof(e.value) = 'object'
      AND e.value ? 'id'
      AND COALESCE(e.value->>'id', '') <> ''
  ),
  upd AS (
    UPDATE public.job_board_postings t SET
      title             = CASE WHEN patch.p ? 'title'             THEN patch.p->>'title'                        ELSE t.title             END,
      location          = CASE WHEN patch.p ? 'location'          THEN patch.p->>'location'                     ELSE t.location          END,
      apply_url         = CASE WHEN patch.p ? 'apply_url'         THEN patch.p->>'apply_url'                    ELSE t.apply_url         END,
      country           = CASE WHEN patch.p ? 'country'           THEN patch.p->>'country'                      ELSE t.country           END,
      region_code       = CASE WHEN patch.p ? 'region_code'       THEN patch.p->>'region_code'                  ELSE t.region_code       END,
      work_mode         = CASE WHEN patch.p ? 'work_mode'         THEN patch.p->>'work_mode'                    ELSE t.work_mode         END,
      employment_type   = CASE WHEN patch.p ? 'employment_type'   THEN patch.p->>'employment_type'              ELSE t.employment_type   END,
      salary            = CASE WHEN patch.p ? 'salary'            THEN patch.p->>'salary'                       ELSE t.salary            END,
      -- Same defence as agency, for the same reason: '::numeric' on a
      -- non-numeric JSON value THROWS 22P02 and fails the whole 200-row batch.
      -- jsonb_typeof rather than a regex, so an explicit JSON null still
      -- CLEARS the column — the re-parse writes null on purpose when corrected
      -- pay text no longer parses, and swallowing that would leave a stale
      -- number in place, which is the bug this migration exists to end.
      salary_min_annual = CASE WHEN patch.p ? 'salary_min_annual'
                               THEN CASE jsonb_typeof(patch.p->'salary_min_annual')
                                      WHEN 'number' THEN (patch.p->>'salary_min_annual')::numeric
                                      WHEN 'null'   THEN NULL
                                      ELSE t.salary_min_annual END
                               ELSE t.salary_min_annual END,
      salary_max_annual = CASE WHEN patch.p ? 'salary_max_annual'
                               THEN CASE jsonb_typeof(patch.p->'salary_max_annual')
                                      WHEN 'number' THEN (patch.p->>'salary_max_annual')::numeric
                                      WHEN 'null'   THEN NULL
                                      ELSE t.salary_max_annual END
                               ELSE t.salary_max_annual END,
      salary_period     = CASE WHEN patch.p ? 'salary_period'     THEN patch.p->>'salary_period'                ELSE t.salary_period     END,
      salary_currency   = CASE WHEN patch.p ? 'salary_currency'   THEN patch.p->>'salary_currency'              ELSE t.salary_currency   END,
      remote            = CASE WHEN patch.p ? 'remote'            THEN (patch.p->>'remote')::boolean            ELSE t.remote            END,
      -- 20261111100000. department: key presence as text, like title. The edge
      -- sends it only to heal an entity-encoded value it stored ('R&amp;D' read
      -- again as 'R&D', S14X-216), a correction of our own reading.
      department        = CASE WHEN patch.p ? 'department'        THEN patch.p->>'department'                   ELSE t.department        END,
      -- 20261111100000. closes_at: the date the agency states (XR-1). A JSON
      -- string in ISO-8601 shape casts; JSON null clears; any other value keeps
      -- the stored date. A bare '::timestamptz' would raise on a malformed
      -- string and fail the 200-row batch (the agency precedent below), and
      -- would accept Postgres's own words ('now', 'today', 'infinity') as a
      -- date nobody stated. The edge sends toISOString() output only.
      closes_at         = CASE WHEN patch.p ? 'closes_at'
                               THEN CASE jsonb_typeof(patch.p->'closes_at')
                                      WHEN 'string' THEN CASE WHEN patch.p->>'closes_at' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
                                                         THEN (patch.p->>'closes_at')::timestamptz
                                                         ELSE t.closes_at END
                                      WHEN 'null'   THEN NULL
                                      ELSE t.closes_at END
                               ELSE t.closes_at END,
      -- GUARDED CAST, CARRIED FORWARD VERBATIM FROM 20260831120000, and the
      -- reason is in that file: '::boolean' on a malformed string THROWS
      -- (22P02) before COALESCE can ever see it, so one bad value fails a
      -- batch of 200 unrelated corrections and the edge then breaks out of
      -- that board's correction loop entirely. COALESCE does not defend
      -- against the hazard the guard was written for; only the whitelist does.
      agency            = CASE WHEN patch.p ? 'agency' AND lower(patch.p->>'agency') IN ('true','false','t','f','1','0')
                               THEN (patch.p->>'agency')::boolean ELSE t.agency END
    FROM patch
    WHERE t.id = patch.p->>'id'
    RETURNING 1
  )
  SELECT count(*)::int INTO n FROM upd;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_posting_corrections(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_posting_corrections(jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_posting_corrections(jsonb) IS
  'Batched partial patches from the ingest (key presence per column; an unmentioned key leaves the stored value untouched). Columns: title, location, apply_url, country, region_code, work_mode, employment_type, salary, salary_min_annual, salary_max_annual, salary_period, salary_currency, remote, agency, department, closes_at. ADDING A PATCHED FIELD AT THE EDGE REQUIRES ADDING IT HERE: an unknown key is silently dropped, which shipped employment_type patches into the void for a day, then region_code and the four structured salary columns, then closes_at and department (taught by 20261111100000). agency, the two numeric salary columns and closes_at are cast behind a value guard, not a bare cast: a malformed value would raise for the whole 200-row batch and the edge would then abandon that board''s corrections entirely. salary_period must stay inside the CHECK on job_board_postings.salary_period, widened by 20260906210400 to the vocabulary the parser emits.';

-- Self-check: the definition that stands has a key-presence arm for all
-- sixteen keys, comments aside, and no client role can execute it.
DO $$
DECLARE
  def text := regexp_replace(pg_get_functiondef('public.apply_posting_corrections(jsonb)'::regprocedure), '-{2}[^\n]*', '', 'g');
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['title', 'location', 'apply_url', 'country', 'region_code', 'work_mode', 'employment_type', 'salary',
                           'salary_min_annual', 'salary_max_annual', 'salary_period', 'salary_currency', 'remote', 'agency',
                           'department', 'closes_at'] LOOP
    IF position(format('patch.p ? %L', k) IN def) = 0 THEN
      RAISE EXCEPTION '20261111100000: apply_posting_corrections has no key-presence arm for %', k;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.apply_posting_corrections(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_posting_corrections(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261111100000: a client role can execute apply_posting_corrections';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_posting_corrections(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261111100000: service_role cannot execute apply_posting_corrections';
  END IF;
END $$;
