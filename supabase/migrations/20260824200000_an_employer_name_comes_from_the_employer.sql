-- "VERIFIED DIRECT FROM HOLLANDAMERICAGROUP" UNDERCUT THE CLAIM IT SAT ON.
--
-- 148 of 1,433 served employers (10.3%) rendered as a single run-together
-- word — Levistraussandco, Essentiahealth, Americanredcross, Cookchildrens.
-- The name was derived by title-casing the ATS token during census discovery
-- and the employer's real display name was never captured. On a board whose
-- differentiator is "straight from the company's own hiring system", the
-- employer's name being visibly mangled undercuts the exact sentence it is
-- printed beneath.
--
-- EVERY NAME BELOW CAME FROM THE VENDOR, NOT FROM A SPLITTER. This is the
-- part that matters: many run-together names are CORRECT — Wonderschool,
-- Candidhealth and Technergetics are real one-word brands, and 2,397 registry
-- entries match the same shape. A heuristic that guessed where the words
-- divide would have corrupted real names to fix cosmetic ones. So each of
-- these 24 was read from the employer's own hosted board — Ashby's
-- organization.name, Lever's JSON-LD hiringOrganization.name, or the
-- Workday tenant's og:title with a generic "Careers"/"Careers at" wrapper
-- removed — and two candidates were confirmed already correct and left alone.
--
-- Covers 4,379 servable postings. The registry carries the same
-- names from this commit, so re-ingest agrees with the correction instead of
-- undoing it. Idempotent.

UPDATE public.job_board_postings AS p
SET company = v.name
FROM (VALUES
  ('workday', 'levistraussandco~wd5~External', 'Levi Strauss & Co.'),
  ('workday', 'tidalwaveautospa~wd1~TWAS', 'Tidal Wave Auto Spa'),
  ('workday', 'essentiahealth~wd1~Essentia_Health', 'Essentia Health'),
  ('workday', 'atriumhospitality~wd5~AtriumHospitality', 'Atrium Hospitality'),
  ('workday', 'americanredcross~wd1~American_Red_Cross_Careers', 'American Red Cross'),
  ('workday', 'cookchildrens~wd1~Cook_Childrens_Careers', 'Cook Children''s'),
  ('workday', 'medimarketgroup~wd103~MMG', 'Medi-Market'),
  ('workday', 'salvationarmyca~wd3~tsacb', 'The Salvation Army in Canada and Bermuda'),
  ('ashby', 'allarahealth', 'Allara'),
  ('workday', 'serviceexperts~wd108~SE', 'Service Experts'),
  ('workday', 'masseyservices~wd5~masseyservices', 'Massey Services'),
  ('bamboohr', 'armstrongfluidtechnology', 'Armstrong Fluid Technology'),
  ('pinpoint', 'mountainwarehouse', 'Mountain Group'),
  ('ashby', 'alpacahealth', 'Alpaca Health'),
  ('workday', 'youthvillages~wd1~youthvillagescareers', 'Youth Villages'),
  ('workday', 'kantonsspitalbaden~wd3~ksb-careers', 'Kantonsspital Baden'),
  ('lever', 'roshalimaging', 'Roshal Health'),
  ('workday', 'varsitybrands~wd503~ExternalCareerSite', 'Varsity Brands'),
  ('workday', 'alwayscompassionate~wd1~ACHomeCare', 'Always Compassionate'),
  ('workday', 'daytonchildrens~wd1~dayton_childrens_career_site', 'Dayton Children''s'),
  ('workday', 'landmarkproperties~wd12~Landmark_Careers', 'Landmark Properties'),
  ('workday', 'freseniusglobal~wd3~fk_careers', 'Fresenius Kabi'),
  ('workday', 'johnsonelectric~wd3~Career_JE', 'Johnson Electric'),
  ('bamboohr', 'fesslerbowman', 'Fessler & Bowman Inc')
) AS v(source, token, name)
WHERE p.source = v.source
  AND p.company_token = v.token
  AND p.company IS DISTINCT FROM v.name;
