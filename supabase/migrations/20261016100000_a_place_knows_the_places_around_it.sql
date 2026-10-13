-- A PLACE KNOWS THE PLACES AROUND IT (résumé matching, phase 0).
--
-- Today's "For you" searched with no place at all: 85.5% of the top-20 rows it
-- showed on the match bench were jobs the reader could not take from where
-- they live (2026-10-12, 11 résumés with exact pools). The accuracy prototype
-- fixed that with a commute ring per city, written by hand for 23 cities. This
-- table replaces the hand-written ring: every place of 5,000 people or more
-- with its coordinates and its own first-level region, from GeoNames
-- cities5000 and admin1CodesASCII (CC BY 4.0; attribution is shown in the
-- match drawer footer). metro_ring (20261016101000) reads it.
--
-- `region` is the short code the board's locations use where one exists (a US
-- state, a Canadian province, an Australian state); elsewhere it is the
-- first-level region's name. `region_name` is always the name ("Ohio",
-- "Ontario", "England"), so "Houston, Texas" and "Houston, TX" both check.
--
-- THE ROWS ARRIVE SEPARATELY. scripts/match/build-geo-seed.mjs turns the two
-- GeoNames files into idempotent chunks under 1 MB, stamped
-- 20261016100100 onward (INSERT ... ON CONFLICT (geonameid) DO UPDATE). Until
-- they apply, metro_ring answers nothing and resume-match searches the
-- reader's own city and says so. Judge "applied" by behaviour, not by this
-- file: verify section 97d asks for the Columbus, OH ring and expects
-- Westerville in it and Columbus, GA out of it.
--
-- WHO MAY READ IT: the service role, which resume-match uses. RLS is on with no
-- policy and Supabase's default ALL for anon and authenticated is revoked by
-- name (a GRANT never takes a default away; 20261008131500).
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS public.geo_places (
  geonameid integer PRIMARY KEY,
  name text NOT NULL,
  ascii_name text NOT NULL,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  admin1_code text,
  region text,
  region_name text,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  population integer NOT NULL DEFAULT 0,
  source_version text NOT NULL DEFAULT 'geonames-cities5000'
);

CREATE INDEX IF NOT EXISTS geo_places_country_name_idx ON public.geo_places (country, lower(name));
CREATE INDEX IF NOT EXISTS geo_places_country_ascii_idx ON public.geo_places (country, lower(ascii_name));
CREATE INDEX IF NOT EXISTS geo_places_lat_lon_idx ON public.geo_places (lat, lon);

ALTER TABLE public.geo_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_places FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.geo_places TO service_role;

DO $$
DECLARE
  r text;
  p text;
BEGIN
  IF to_regclass('public.geo_places') IS NULL THEN
    RAISE EXCEPTION 'geo_places was not created';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.geo_places'::regclass) THEN
    RAISE EXCEPTION 'geo_places has row level security off';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.geo_places', p) THEN
        RAISE EXCEPTION 'geo_places: % still holds %', r, p;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.geo_places', 'SELECT') THEN
    RAISE EXCEPTION 'geo_places: service_role cannot read it, and resume-match reads as service_role';
  END IF;
END $$;
