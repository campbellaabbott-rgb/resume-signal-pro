-- A LIGHT FORM WITH NO FILLER BEHIND IT.
--
-- job_board_meta k='light_desc_dynamic' holds the tokens the ingest enrolled
-- into light mode. Light mode is only safe where the descriptions can come
-- back: a greenhouse light board is refilled from greenhouse's per-JOB
-- endpoint by backfill-desc. Workable has no such filler -- it is absent from
-- DETAIL_DESC_SOURCES, and its only lane (the desc-sweep BOARD lane) re-fetches
-- through listUrl, which for an enrolled token emits details=false, i.e. the
-- very mode that omits the descriptions it is trying to recover.
--
-- LIGHT_CAPABLE_VENDORS said so, and was consulted at exactly one call site.
-- The two content-volume enrolments in the ingest loop wrote this row by hand
-- with no vendor test, so a workable board could enrol itself and every new
-- posting on it stored description NULL, permanently, unscoreable in fit,
-- invisible to the sampled description tier, excluded from the pay and years
-- filters, and emitting no JSON-LD. 2,925 workable boards were exposed.
--
-- The code fix closes the door (the set itself now refuses a non-light-capable
-- vendor, and the reload sweeps the row). THIS MIGRATION IS THE ONE-TIME
-- CLEANUP, so recovery does not wait for whichever isolate next happens to call
-- loadDynamicLight: the row is corrected here, once, in a statement that runs.
--
-- HOW THE VENDOR IS RESOLVED, AND WHY IT IS NOT A SINGLE VENDOR. The row holds
-- bare tokens with no vendor, and a token is not one board: 139 catalog tokens
-- are carried by two or three vendors at once, and `antenna`, `mcs` and
-- `lockwood` are greenhouse+workable pairs. Since isLight() and listUrl() are
-- keyed by TOKEN, enrolling "the greenhouse one" turns the workable one light
-- as well -- the same destruction, reached through a legitimate enrolment. So
-- the question asked here is not "which vendor is this token" (it has no single
-- answer) but "does this token have ANY postings from a vendor with no filler",
-- read from the postings the boards actually produced. Any yes is a removal.
--
-- A token with NO postings at all resolves to nothing and is KEPT: SQL cannot
-- name its vendors, and the runtime gate -- which reads the catalog, where the
-- same all-entries rule is enforced -- refuses it on the next load anyway.
-- Deleting on an unknown would be guessing; keeping is the conservative half.
--
-- RECOVERY IS AUTOMATIC AND COMPLETE ONCE THE TOKEN LEAVES. listUrl stops
-- emitting the light form, so new postings carry descriptions again in the
-- ordinary list payload; rows already stored NULL are refilled by the
-- desc-sweep BOARD lane, since workable IS in BOARD_DESC_SOURCES. That lane is
-- the one the maintenance-ladder fix in the same deploy un-starves, which is
-- why the two fixes ship together.
--
-- Idempotent: re-running finds nothing left to remove and says so.

DO $$
DECLARE
  v_row     jsonb;
  v_keep    jsonb;
  v_removed jsonb;
BEGIN
  SELECT v INTO v_row FROM public.job_board_meta WHERE k = 'light_desc_dynamic';

  IF v_row IS NULL OR jsonb_typeof(v_row -> 'tokens') <> 'array' THEN
    RAISE NOTICE 'light_desc_dynamic holds no token array; nothing to sweep';
    RETURN;
  END IF;

  SELECT
    coalesce(jsonb_agg(t.tok ORDER BY t.ord) FILTER (WHERE NOT t.has_unfillable), '[]'::jsonb),
    coalesce(jsonb_agg(t.tok ORDER BY t.ord) FILTER (WHERE t.has_unfillable), '[]'::jsonb)
  INTO v_keep, v_removed
  FROM (
    SELECT
      e.tok,
      e.ord,
      -- EXISTS, not "the first posting's source". A token shared by a
      -- greenhouse board and a workable one would answer 'greenhouse' to a
      -- LIMIT 1 and be kept, which is the exact case this migration exists for.
      -- An index probe on (company_token, source), stopped at the first hit,
      -- over at most AUTO_LIGHT_CAP tokens.
      EXISTS (
        SELECT 1 FROM public.job_board_postings p
         WHERE p.company_token = e.tok AND p.source <> 'greenhouse'
      ) AS has_unfillable
    FROM jsonb_array_elements_text(v_row -> 'tokens') WITH ORDINALITY AS e(tok, ord)
  ) t;

  IF jsonb_array_length(v_removed) = 0 THEN
    RAISE NOTICE 'every persisted light token is greenhouse-only or unresolvable here; leaving the row as-is';
    RETURN;
  END IF;

  -- Merge, never replace: updatedAt and anything a later build adds to this row
  -- survive. The removals are RECORDED, not silently dropped -- a board that
  -- spent time in a mode that stored no descriptions has to be nameable
  -- afterwards, or nobody can tell which boards need their coverage re-checked.
  UPDATE public.job_board_meta
     SET v = v_row || jsonb_build_object(
               'tokens',            v_keep,
               'strandedRemovedAt', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'strandedRemovedBy', '20260909001000',
               'strandedRemoved',   v_removed),
         updated_at = now()
   WHERE k = 'light_desc_dynamic';

  RAISE NOTICE 'light_desc_dynamic swept: % token(s) with a non-greenhouse board removed (%)',
    jsonb_array_length(v_removed), v_removed;
END $$;
