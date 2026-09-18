-- THE MATCHER READS THE NAMES THE DEPLOY MIRRORED, NEVER THE LIVE ONES.
--
-- The writer for layoff_board_names. The deploy script imports the board
-- catalogue through the TypeScript module (never a grep of its compact
-- encoding) and posts (vendor, company_token, display_name) rows here in
-- chunks, all stamped with one p_run_started_at; the last chunk passes
-- p_prune so tokens that left the catalogue leave the mirror. display_norm
-- is computed HERE with layoff_norm, the same function the filer side uses,
-- so the two sides of every comparison were stripped by one implementation.
--
-- Service-role only: the mirror decides what an exact match can join, and a
-- caller who could write it could point a filing at any board.

SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.layoff_board_names_mirror(
  p_rows           jsonb,
  p_run_started_at timestamptz DEFAULT now(),
  p_prune          boolean DEFAULT false
)
RETURNS TABLE (lb_upserted int, lb_pruned int, lb_total int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_upserted int := 0;
  v_pruned   int := 0;
  v_total    int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'layoff_board_names_mirror expects a JSON array of {vendor, company_token, display_name}';
  END IF;

  INSERT INTO public.layoff_board_names AS b (vendor, company_token, display_name, display_norm, mirrored_at)
  SELECT DISTINCT ON (e.value->>'vendor', e.value->>'company_token')
         e.value->>'vendor',
         e.value->>'company_token',
         e.value->>'display_name',
         public.layoff_norm(e.value->>'display_name'),
         p_run_started_at
  FROM jsonb_array_elements(p_rows) AS e(value)
  WHERE NULLIF(btrim(e.value->>'vendor'), '') IS NOT NULL
    AND NULLIF(btrim(e.value->>'company_token'), '') IS NOT NULL
    AND NULLIF(btrim(e.value->>'display_name'), '') IS NOT NULL
  ON CONFLICT (vendor, company_token) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    display_norm = EXCLUDED.display_norm,
    mirrored_at  = EXCLUDED.mirrored_at;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  IF p_prune THEN
    DELETE FROM public.layoff_board_names b WHERE b.mirrored_at < p_run_started_at;
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  SELECT count(*)::int INTO v_total FROM public.layoff_board_names b;
  RETURN QUERY SELECT v_upserted, v_pruned, v_total;
END;
$$;

COMMENT ON FUNCTION public.layoff_board_names_mirror(jsonb, timestamptz, boolean) IS
  'Upserts the board catalogue''s display names into layoff_board_names, computing display_norm with '
  'layoff_norm so both sides of the matcher share one normaliser. Chunked: every chunk of one deploy '
  'carries the same p_run_started_at, and the last chunk passes p_prune to delete rows the run did '
  'not touch. Called by the deploy script with the imported catalogue; service_role only.';

REVOKE ALL ON FUNCTION public.layoff_board_names_mirror(jsonb, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layoff_board_names_mirror(jsonb, timestamptz, boolean) TO service_role;

-- Overloads, if a staged edit ever left one, are locked the same way.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'layoff_board_names_mirror'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
