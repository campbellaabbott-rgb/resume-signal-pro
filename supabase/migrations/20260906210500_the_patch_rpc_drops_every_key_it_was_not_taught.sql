-- THE FIFTH APPEARANCE OF THE DEFECT ITS OWN HEADER NAMES.
--
-- 20260828140000 fixed apply_posting_corrections after employment_type patches
-- were silently discarded for a day, and its COMMENT ends: "ADDING A PATCHED
-- FIELD AT THE EDGE REQUIRES ADDING IT HERE — an unknown key is silently
-- dropped." The RPC is a hand-listed UPDATE of eight columns; jsonb keys it
-- does not name are not rejected, they simply never happen, and the edge
-- function's `{ error }` check sees success.
--
-- The corrections path at job-board/index.ts now puts FIVE more keys into that
-- patch object:
--
--   region_code         the US state / CA province, and the ONLY route by
--                       which the ~989k already-stored rows ever acquire one
--   salary_min_annual   \  the structured re-parse that fires when the pay
--   salary_max_annual    \ TEXT is corrected — the fix for rows that served
--   salary_period        / and filtered on a stale number the v7 re-sweep
--   salary_currency     /  could not see (it only targets currency IS NULL)
--
-- agency is NOT one of them: 20260831120000 already taught this RPC that key
-- and named it in the function COMMENT, so the agency backfill has been
-- landing since. It is restated below only because CREATE OR REPLACE rewrites
-- the whole body, and dropping a column here would silently un-teach it —
-- which is the same defect as never teaching it, arriving from the other side.
--
-- Without this migration the region_code backfill writes nothing for a year,
-- the salary re-parse writes nothing at all, and the field-change log records
-- a salary edit whose structured columns still disagree with it. Every one of
-- those failures is invisible from the edge.
--
-- salary_period rides a CHECK constraint on the target column. 20260906210400
-- widens it to the vocabulary the parser actually emits ('day' included)
-- BEFORE this migration teaches the RPC to write it; without that ordering the
-- first day-rate correction fails a whole 200-row batch with 23514.
--
-- Same key-presence contract as the existing eight: an unmentioned key leaves
-- the stored value untouched, so the edge's stated-only rule (vendor silence
-- must never erase enrichment) is preserved unchanged.
--
-- NUMERIC AND BOOLEAN CASTS GO THROUGH jsonb ->> AND THEN A CAST, and a JSON
-- null therefore casts to SQL NULL rather than erroring — which is required:
-- the re-parse deliberately writes null into all four structured columns when
-- the corrected pay text no longer parses, and clearing them is the correct
-- outcome, not a failure.

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
  'Batched partial patches from the ingest (key presence per column; an unmentioned key leaves the stored value untouched). Columns: title, location, apply_url, country, region_code, work_mode, employment_type, salary, salary_min_annual, salary_max_annual, salary_period, salary_currency, remote, agency. ADDING A PATCHED FIELD AT THE EDGE REQUIRES ADDING IT HERE — an unknown key is silently dropped, which shipped employment_type patches into the void for a day and then did the same to region_code and the four structured salary columns (agency was taught here by 20260831120000 and has been landing since). agency and the two numeric salary columns are cast behind a value guard, not a bare cast: a malformed value would raise 22P02 for the whole 200-row batch and the edge would then abandon that board''s corrections entirely. salary_period must stay inside the CHECK on job_board_postings.salary_period, widened by 20260906210400 to the vocabulary the parser emits.';
