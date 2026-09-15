CREATE TABLE IF NOT EXISTS public._mig_probe (k text PRIMARY KEY, v text);
GRANT SELECT ON public._mig_probe TO service_role;

DO $probe$
DECLARE r record; txt text := '';
BEGIN
  SET LOCAL statement_timeout = '240s';
  BEGIN
    PERFORM public.promote_category('rule', 'commis', 'hospitality_retail');
    INSERT INTO public._mig_probe(k,v) VALUES ('promote','NO ERROR - rows moved') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._mig_probe(k,v) VALUES ('promote', SQLSTATE || ': ' || SQLERRM) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  END;
  BEGIN
    PERFORM * FROM public.category_knn(array_fill(0::real, ARRAY[384])::extensions.vector, 1);
    INSERT INTO public._mig_probe(k,v) VALUES ('knn','NO ERROR') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._mig_probe(k,v) VALUES ('knn', SQLSTATE || ': ' || SQLERRM) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  END;
  BEGIN
    FOR r IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_actively_hiring_companies(20)' LOOP
      txt := txt || r."QUERY PLAN" || E'\n';
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    txt := 'EXPLAIN FAILED: ' || SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO public._mig_probe(k,v) VALUES ('explain', txt) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
END $probe$;