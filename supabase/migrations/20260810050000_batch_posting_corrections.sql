-- THE CORRECTIONS PASS IS THE ONE UNBATCHED WRITE IN AN OTHERWISE BATCHED INGEST.
--
-- Every other write in the refresh ladder moves in chunks of 200-250: inserts,
-- missing_since stamps, closure logs, prunes. The corrections pass — the one
-- that keeps a title an employer edited, a location they fixed, an apply_url
-- they moved — chunks its work into 200s and then issues ONE UPDATE round trip
-- PER ROW inside each chunk, sequentially awaited (index.ts:1231-1238).
--
-- On a churny giant that is hundreds of sequential round trips per board per
-- pass, every pass, forever. It is invisible because nothing fails: the pass
-- just takes longer, which spends the freshness budget that decides how fast
-- the whole catalog rotates.
--
-- WHY A PLAIN BULK UPDATE CANNOT DO THIS. The patches are PARTIAL and differ
-- per row: one posting changed only its title, the next only its salary. A
-- single `UPDATE ... SET title = x.title, salary = x.salary` would write NULL
-- into every column the patch did not mention — silently erasing an employer's
-- real salary because a different row's title moved. Postgres has no
-- "update only the keys present" for a set-based update, so the CASE below
-- tests key PRESENCE (`?`) column by column and leaves the stored value
-- otherwise untouched. That is the whole reason this is an RPC and not a
-- one-line PostgREST call.
--
-- SCOPE IS DELIBERATELY THE SEVEN VENDOR-AUTHORITATIVE COLUMNS and nothing
-- else. posted_at belongs to the dating sweep, category to the categoriser,
-- description and experience_band to their own fills — an ingest-time write
-- must never touch them, and a function that CAN write them would eventually
-- be asked to. The safety rule from the corrections pass survives intact here:
-- the caller only ever puts a key in the patch when the vendor stated a value
-- this pass, so vendor silence still cannot erase enrichment.
CREATE OR REPLACE FUNCTION public.apply_posting_corrections(p_patches jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
-- Generous but bounded: one chunk of 200 partial updates is milliseconds of
-- work; a minute means something is pathologically wrong and the pass should
-- learn that rather than hang the slice.
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
      title     = CASE WHEN patch.p ? 'title'     THEN patch.p->>'title'     ELSE t.title     END,
      location  = CASE WHEN patch.p ? 'location'  THEN patch.p->>'location'  ELSE t.location  END,
      apply_url = CASE WHEN patch.p ? 'apply_url' THEN patch.p->>'apply_url' ELSE t.apply_url END,
      country   = CASE WHEN patch.p ? 'country'   THEN patch.p->>'country'   ELSE t.country   END,
      work_mode = CASE WHEN patch.p ? 'work_mode' THEN patch.p->>'work_mode' ELSE t.work_mode END,
      salary    = CASE WHEN patch.p ? 'salary'    THEN patch.p->>'salary'    ELSE t.salary    END,
      remote    = CASE WHEN patch.p ? 'remote'    THEN (patch.p->>'remote')::boolean ELSE t.remote END
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
  'Applies a batch of PARTIAL posting corrections in one statement. Each '
  'element is {id, ...changed columns}; a column absent from an element is '
  'left untouched, which is why this cannot be a plain bulk UPDATE. Scoped to '
  'the seven vendor-authoritative columns — posted_at, category, description '
  'and experience_band belong to their own sweeps and are unreachable here.';
