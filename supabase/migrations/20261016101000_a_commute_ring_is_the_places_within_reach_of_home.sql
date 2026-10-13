-- A COMMUTE RING IS THE PLACES WITHIN REACH OF HOME (résumé matching, phase 0).
--
-- metro_ring(city, region, country, km, max) answers the most populous places
-- within `km` of the reader's city (the city itself first), each with its OWN
-- region and country, so a ring that crosses a state or national border names
-- each place with the region it is in: Columbus, OH reaches Westerville and
-- never Columbus, GA (resume-match then checks each returned posting's state
-- against the place it matched; in the retrieval sample 11 of 41 "Columbus"
-- rows were in another state).
--
-- The centre is the most populous place of that name in that country, in the
-- named region when one is given (a code, the region's name, or the GeoNames
-- admin1 code). No centre, no rows: resume-match then searches the city alone
-- and says the commute area is not available.
--
-- km is held to 1..200 and max to 1..50. Distances are great-circle
-- (haversine, R = 6371 km) after a bounding-box prefilter on (lat, lon).
--
-- SECURITY INVOKER, LANGUAGE sql, STABLE: it reads geo_places as its caller,
-- and only the service role (resume-match) may call it. A GRANT restricts
-- nothing on its own (definer-exposure history), so the function is revoked
-- from PUBLIC, anon and authenticated by name and the DO block below raises
-- if either client role can still execute it.
--
-- Depends on 20261016100000. Safe to run twice.

CREATE OR REPLACE FUNCTION public.metro_ring(
  p_city text,
  p_region text,
  p_country text,
  p_km integer DEFAULT 40,
  p_max integer DEFAULT 20
)
RETURNS TABLE (name text, region text, region_name text, country text, km real, population integer, center boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH k AS (
    SELECT least(greatest(coalesce(p_km, 40), 1), 200)::double precision AS km,
           least(greatest(coalesce(p_max, 20), 1), 50) AS mx
  ), c AS (
    SELECT g.geonameid, g.lat, g.lon
    FROM public.geo_places g
    WHERE g.country = upper(btrim(coalesce(p_country, '')))
      AND (lower(g.name) = lower(btrim(coalesce(p_city, ''))) OR lower(g.ascii_name) = lower(btrim(coalesce(p_city, ''))))
      AND (
        p_region IS NULL OR btrim(p_region) = ''
        OR upper(g.region) = upper(btrim(p_region))
        OR lower(g.region_name) = lower(btrim(p_region))
        OR upper(g.admin1_code) = upper(btrim(p_region))
      )
    ORDER BY g.population DESC, g.geonameid
    LIMIT 1
  ), d AS (
    SELECT g.name, g.region, g.region_name, g.country, g.population, g.geonameid = c.geonameid AS center,
      2 * 6371 * asin(least(1, sqrt(
        power(sin(radians(g.lat - c.lat) / 2), 2)
        + cos(radians(c.lat)) * cos(radians(g.lat)) * power(sin(radians(g.lon - c.lon) / 2), 2)
      ))) AS dist
    FROM c, k, public.geo_places g
    WHERE g.lat BETWEEN c.lat - k.km / 111.0 AND c.lat + k.km / 111.0
      AND g.lon BETWEEN c.lon - k.km / (111.0 * greatest(cos(radians(c.lat)), 0.05))
                    AND c.lon + k.km / (111.0 * greatest(cos(radians(c.lat)), 0.05))
  )
  SELECT d.name, d.region, d.region_name, d.country, d.dist::real, d.population, d.center
  FROM d, k
  WHERE d.dist <= k.km
  ORDER BY d.center DESC, d.population DESC, d.name
  LIMIT (SELECT mx FROM k)
$$;

REVOKE ALL ON FUNCTION public.metro_ring(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metro_ring(text, text, text, integer, integer) TO service_role;

DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace
  WHERE ns.nspname = 'public' AND pr.proname = 'metro_ring';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'metro_ring has % signatures; a named-argument call would be ambiguous', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.metro_ring(text, text, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.metro_ring(text, text, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'metro_ring is executable by a client role';
  END IF;
  -- Runs, so a malformed body fails here and not on the first reader.
  SELECT count(*) INTO v_n FROM public.metro_ring('Zqxjvkw', NULL, 'US');
END $$;
