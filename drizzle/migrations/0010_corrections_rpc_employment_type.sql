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
      remote          = CASE WHEN patch.p ? 'remote'          THEN (patch.p->>'remote')::boolean ELSE t.remote        END
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
  'Batched partial patches from the ingest (key presence per column; an unmentioned key leaves the stored value untouched). Columns: title, location, apply_url, country, work_mode, employment_type, salary, remote. ADDING A PATCHED FIELD AT THE EDGE REQUIRES ADDING IT HERE — an unknown key is silently dropped, which shipped employment_type patches into the void for a day.';