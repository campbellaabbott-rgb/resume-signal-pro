SET statement_timeout = '600000';

UPDATE public.job_board_postings
SET location = btrim(regexp_replace(
      location,
      '\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,}(\s*\|\s*-?[0-9]{1,3}\.[0-9]{3,})?\s*$',
      ''
    ))
WHERE source = 'greenhouse'
  AND location ~ '\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*(\|\s*-?[0-9]{1,3}\.[0-9]{3,}\s*)?$';

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