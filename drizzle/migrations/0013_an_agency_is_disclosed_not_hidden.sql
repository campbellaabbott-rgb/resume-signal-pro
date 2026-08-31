-- AGENCY DISCLOSURE — the 2026-08-31 charter change's storage half.
--
-- The charter widened to carry staffing agencies (the mill convictions were
-- RELEASED: Collabera, CTG, Symicor and the rest merge like any employer
-- now), and the product answer is transparency, not exclusion: every posting
-- from an agency board carries a stated flag, the cards wear a badge, and an
-- OPT-IN filter lets a reader hide them. The flag rides the CATALOG entry
-- (sources.ts `agency`), stamped onto rows at ingest — never inferred per
-- posting, because a board is an agency on all of its postings or none.
--
-- boolean NOT NULL DEFAULT false, not the work-mode trinary. Work mode is
-- trinary because "not stated" is a real third state the vendor controls;
-- here the catalog is OURS, every board has a verdict (tagged or not), and a
-- NULL would just be false wearing a question mark. The default also means
-- every existing row is immediately servable under the new filter with no
-- backfill wave: tagged boards' rows pick the true value up from the
-- corrections path as rotation re-visits them (~a rotation), and from insert
-- for everything new.
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS agency boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_board_postings.agency IS
  'The employer''s catalog entry is flagged as a staffing/recruiting agency (2026-08-31 charter: disclosed, not excluded). Stamped at ingest from sources.ts; corrections re-stamp existing rows as rotation revisits their board. Serves a card badge and the opt-in excludeAgencies filter.';

-- NO INDEX, deliberately. The only predicate any surface binds is
-- agency = false (the opt-in "hide staffing agencies" narrowing), and that
-- matches the overwhelming majority of rows — the planner would never prefer
-- an agency index over the date/filter indexes the query is already ordered
-- by, so the filter costs a cheap residual test on rows other indexes
-- selected. A partial index over the true rows would serve only an
-- agencies-ONLY filter, which no surface offers; building it now would be an
-- index the write path pays for on every UPDATE of a 12-index hot table and
-- the read path never uses. The day an agencies-only view exists, add the
-- partial index in ITS migration, where the predicate it serves is visible.

-- THE CORRECTIONS RPC MUST LEARN THE COLUMN THE SAME DAY THE EDGE DOES.
-- apply_posting_corrections hand-lists its columns and silently drops any
-- key it was not taught — employment_type patches shipped into the void for
-- a day that way (20260828140000). Same CASE-on-key-presence contract as
-- every existing column: a patch that does not mention agency leaves the
-- stored value untouched.
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
      title           = CASE WHEN patch.p ? 'title'           THEN patch.p->>'title'           ELSE t.title           END,
      location        = CASE WHEN patch.p ? 'location'        THEN patch.p->>'location'        ELSE t.location        END,
      apply_url       = CASE WHEN patch.p ? 'apply_url'       THEN patch.p->>'apply_url'       ELSE t.apply_url       END,
      country         = CASE WHEN patch.p ? 'country'         THEN patch.p->>'country'         ELSE t.country         END,
      work_mode       = CASE WHEN patch.p ? 'work_mode'       THEN patch.p->>'work_mode'       ELSE t.work_mode       END,
      employment_type = CASE WHEN patch.p ? 'employment_type' THEN patch.p->>'employment_type' ELSE t.employment_type END,
      salary          = CASE WHEN patch.p ? 'salary'          THEN patch.p->>'salary'          ELSE t.salary          END,
      remote          = CASE WHEN patch.p ? 'remote'          THEN (patch.p->>'remote')::boolean ELSE t.remote        END,
      -- Guarded cast, not COALESCE: '::boolean' on a malformed string THROWS
      -- (22P02) before COALESCE ever sees it, and one bad value would fail a
      -- batch of 200 unrelated corrections. Whitelist the spellings postgres
      -- accepts; anything else degrades to "leave it".
      agency          = CASE WHEN patch.p ? 'agency' AND lower(patch.p->>'agency') IN ('true','false','t','f','1','0')
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
  'Batched partial patches from the ingest (key presence per column; an unmentioned key leaves the stored value untouched). Columns: title, location, apply_url, country, work_mode, employment_type, salary, remote, agency. ADDING A PATCHED FIELD AT THE EDGE REQUIRES ADDING IT HERE — an unknown key is silently dropped, which shipped employment_type patches into the void for a day.';