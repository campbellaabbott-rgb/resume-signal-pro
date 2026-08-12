CREATE OR REPLACE FUNCTION public.get_embed_batch(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id text,
  title text,
  company text,
  location text,
  descr text,
  has_desc boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
DECLARE
  lim integer := LEAST(GREATEST(p_limit, 1), 50);
  ids text[];
  hits text[] := '{}';
  misses text[] := '{}';
  probe record;
BEGIN
  SELECT COALESCE(array_agg(x.id), '{}') INTO ids FROM (
    SELECT e.id FROM public.job_board_embeddings e
    WHERE e.embedding IS NULL
    ORDER BY e.updated_at DESC
    LIMIT lim
  ) x;

  IF cardinality(ids) = 0 THEN
    FOR probe IN
      SELECT e.id AS eid, (p.description IS NOT NULL) AS ok
      FROM (
        SELECT eq.id, eq.updated_at
        FROM public.job_board_embeddings eq
        WHERE eq.embedded_desc = false AND eq.embedding IS NOT NULL
        ORDER BY eq.updated_at ASC
        LIMIT 1000
      ) e
      LEFT JOIN public.job_board_postings p ON p.id = e.id
      ORDER BY e.updated_at ASC
    LOOP
      IF probe.ok AND cardinality(hits) < lim THEN
        hits := hits || probe.eid;
      ELSIF NOT COALESCE(probe.ok, false) THEN
        misses := misses || probe.eid;
      END IF;
    END LOOP;
    IF cardinality(misses) > 0 THEN
      UPDATE public.job_board_embeddings
      SET updated_at = now()
      WHERE public.job_board_embeddings.id = ANY(misses);
    END IF;
    ids := hits;
  END IF;

  RETURN QUERY
    SELECT p.id, p.title, p.company, p.location,
           left(coalesce(p.description, ''), 1200) AS descr,
           (p.description IS NOT NULL) AS has_desc
    FROM public.job_board_postings p
    WHERE p.id = ANY(ids);
END;
$$;

COMMENT ON FUNCTION public.get_embed_batch(integer) IS
  'Embedding work queue. Phase 1: never-embedded rows, newest first. Phase 2: title-only rows probed against postings for an arrived description over a BOUNDED 1,000-row slice — hits returned, misses ROTATED to the back of the queue by bumping updated_at. VOLATILE because the rotation writes; its only caller is the embed-sweep maintenance action.';

NOTIFY pgrst, 'reload schema';