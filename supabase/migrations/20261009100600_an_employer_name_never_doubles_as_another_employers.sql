-- AN EMPLOYER NAME NEVER DOUBLES AS ANOTHER EMPLOYER'S (S11-134).
--
-- get_company_suggest groups by display name and the board's clusters fold by
-- it, so two employers under one name read as one company: one typeahead row
-- with both boards' counts, one card mixing both employers' postings. Wave 3's
-- 'Clario' for the Workday tenant clarioclinical collided with recruitee:clario
-- (a mobile-apps company); 20261009100100 now names the tenant by its legal
-- name too. The test that now pins every override against every other board's
-- catalogue name (src/test/an-employer-name-never-doubles-as-another-employers.test.ts)
-- found two more, both written in July:
--
--   flextronics  'Flex'             greenhouse:flex is Flex, a rent-payments
--                                   company. The tenant's SEC filer name is
--                                   FLEX LTD. (company_financials, 20260722234500).
--   spectrumhealth 'Spectrum Health' bamboohr:spectrumhealth is Spectrum Health,
--                                   a clinical provider in Ireland (Dublin, Cork,
--                                   Limerick postings). The Workday tenant's site
--                                   is CorewellHealthCareers and its postings'
--                                   hiringOrganization is "Corewell Health
--                                   Corporate", read 2026-10-11.
--
-- The stored rows are renamed by job-board's name-sync lane (NAME_SYNC_VERSION 4
-- reads this table), not here; the trigger names every later write.
--
-- Safe to re-run: each UPDATE sets a fixed value by slug. The block below
-- checks the result.

UPDATE public.company_name_overrides SET display_name = 'Flex Ltd.' WHERE slug = 'flextronics';
UPDATE public.company_name_overrides SET display_name = 'Corewell Health' WHERE slug = 'spectrumhealth';

DO $$
DECLARE
  v_bad text[];
BEGIN
  SELECT array_agg(o.slug || '=' || o.display_name) INTO v_bad
    FROM public.company_name_overrides o
    JOIN (VALUES ('flextronics', 'Flex Ltd.'), ('spectrumhealth', 'Corewell Health')) AS w(slug, name)
      ON w.slug = o.slug
   WHERE o.display_name IS DISTINCT FROM w.name;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261009100600: override(s) still carry another employer''s name: %', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_name_overrides WHERE display_name IN ('Flex', 'Spectrum Health', 'Clario')) THEN
    RAISE EXCEPTION 'self-check 20261009100600: an override still names a tenant Flex, Spectrum Health or Clario, which other employers on the board are called';
  END IF;
END $$;
