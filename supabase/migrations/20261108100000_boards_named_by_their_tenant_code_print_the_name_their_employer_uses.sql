-- BOARDS NAMED BY THEIR TENANT CODE PRINT THE NAME THEIR EMPLOYER USES.
--
-- SEO/GEO audit of 2026-11-07, build item B05 (findings F04, NAME-06, SD-02).
-- Indexable pages printed a Workday tenant code as the employer: company
-- pages titled "Nyuhs", "Papajohns", "Signetjewelers"; posting pages whose
-- JobPosting hiringOrganization read "Newbalance", "Airproducts", "Atd";
-- data tables listing "Rivhs" and "Denverhealth". Four named the wrong
-- company outright: "Starfish" is Torch Technologies, "Stars" is Stars
-- Behavioral Health Group, "Aaregional" posts Piedmont Airlines' jobs and
-- "Djeholdings" carries Edelman and Zeno Group. And "Nyuhs" is United Health
-- Services (its postings are in Johnson City, NY), not NYU Langone.
--
-- WHERE EACH NAME CAME FROM. The employer's own words for itself, read gently
-- (GET only, about one request a second per host) on 2026-11-08: the Workday
-- career site's CXS sidebar (/wday/cxs/<tenant>/<site>/sidebar) and one or
-- two of its postings (/wday/cxs/<tenant>/<site>/job/...: the posting's text
-- and its hiringOrganization). The links and the words read sit beside each
-- row in public.company_name_evidence (20261025100000 made it; only the
-- service role reads it). Nothing is guessed: where the words name more than
-- one employer, the row names one career site by its exact token, not the
-- tenant (tcbrands carries TravisMathew and Callaway Golf, surbanajurong
-- seven firms, uvmhealth five hospitals, djeholdings two agencies, ebi four
-- companies of which only Ensign-Bickford Aerospace & Defense was read), and
-- a tenant's other sites keep their stored names.
--
-- FOUR CHOICES THE READS FORCED.
--   - bakertilly is "Baker Tilly US", the sidebar's own "Baker Tilly US, LLP":
--     bamboohr:bakertillycatalyst is already called Baker Tilly, and two
--     boards sharing a name fold into one in the company suggest (S11-134).
--   - signetjewelers~wd1~BlueNile is "Blue Nile", the name workable:blue-nile
--     carries: the Workable account's own url is bluenile.com, one employer
--     (the collision test lists the pair with this evidence).
--   - nyuhs is United Health Services, the posting's "Clinical Sitter at United
--     Health Services (UHS)", never NYU: a guess from the code was wrong.
--   - emqk~ca3~CX_1 takes NO name here. The audit listed it (its company page
--     reads "HealthCareersInSask.ca"), but its requisitions name two
--     employers: the Saskatchewan Health Authority (CorporateDescriptionStr of
--     requisitions 143046 and 141341) and the Saskatchewan Cancer Agency
--     (requisition 142594's "leadership in cancer control for the people of
--     Saskatchewan"). One override would name the second by the first, so the
--     board keeps the site's own name.
--
-- NOT HERE, AND WHERE IT GOES. A bare token (an Ashby, Lever, Personio or
-- ADP board with no "~") cannot take an override: the trigger reads only a
-- key with a "~" or a Workday tenant slug. creatoriq ("CreatorIQ"),
-- harmattan-ai ("Harmattan AI"), personio deag-deutsche-entertainment-ag
-- ("DEAG Deutsche Entertainment AG") and the ADP board printed "VHB Email
-- Signature" ("Villas of Holly Brook") are renamed in job-board's sources.ts
-- with RENAMED_TOKENS at job-board .102; lever americaatwork posts for "a
-- confidential global organization" and needs an agency label there. Until
-- then the bake's name gate withholds the markup of the two named by a web
-- address or a logo caption, and a posting named by its title-cased slug gets
-- no new page (B02).
--
-- WHAT RENAMES THE STORED ROWS. trg_company_name_override names every write
-- from now on. The stored postings, closures, snapshots and closure rollup of
-- these boards are renamed by job-board's name-sync lane, which visits every
-- catalogue token an override names, by exact key or Workday tenant slug
-- (overrideFor in supabase/functions/job-board/name-sync.ts), once per
-- NAME_SYNC_VERSION. The live build (2026-09-09.101) has run version 6 and
-- stamped it, so the lane is idle: this file re-arms it the way
-- 20261030100000 did, by removing job_board_meta name_sync_version and
-- name_sync_progress after the names exist. The next pass-end walks every
-- board from the first token and renames a board's rows only where they
-- differ, a board at a time, up to four 90-second hops a pass (S11-133).
--
-- ORDER: none. No function deploys with it, job-board .101 already serves,
-- and the names are written before the lane is re-armed, in this one file.
--
-- RE-RUNNABLE: ON CONFLICT DO UPDATE on both tables; the re-arm removes what
-- is there, and a re-run after the lane stamped 6 again arms one more walk,
-- which renames nothing. No table is created, so no grant changes; the
-- self-check says again that no client role can read the evidence.
--
-- MEASURE: the job-board status action's passEnd.steps.names reads "name sync
-- v6" with a renamed count after this applied; company-suggest answers
-- "papa" with Papa John's from the pass after the one that renames; the bake's
-- company page for nyuhs~wd12~nyuhscareers1 is titled United Health Services
-- (verify section 98-seo-r2.sh).
--
-- ROLLBACK: none needed. A wrong name is corrected by a later file's
-- ON CONFLICT DO UPDATE, with its evidence.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

-- REFUSE, changing nothing, unless the evidence table and the trigger exist.
DO $$
BEGIN
  IF to_regclass('public.company_name_evidence') IS NULL THEN
    RAISE EXCEPTION '20261108100000 refuses: public.company_name_evidence does not exist, so 20261025100000 is not applied. Apply 20261025100000, unedited, then this file again';
  END IF;
  IF to_regclass('public.job_board_postings') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.job_board_postings')
          AND t.tgname = 'trg_company_name_override' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '20261108100000 refuses: trg_company_name_override is not on job_board_postings, so new writes would not take the names; send this error, do not apply anything else';
  END IF;
END $$;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('aampower', 'Dauch Corporation'),
  ('aaregional~wd503~Search', 'Piedmont Airlines'),
  ('abcfinancial', 'ABC Fitness'),
  ('aes', 'AES'),
  ('airproducts', 'Air Products'),
  ('atd', 'American Tire Distributors'),
  ('bakertilly', 'Baker Tilly US'),
  ('barcelo', 'Barceló Hotel Group'),
  ('baystatehealth', 'Baystate Health'),
  ('borgwarner', 'BorgWarner'),
  ('clearchanneloutdoor', 'Clear Channel Outdoor'),
  ('cngholdingsinc', 'CNG Holdings'),
  ('denverhealth', 'Denver Health'),
  ('djeholdings~wd5~ZenoCareers', 'Zeno Group'),
  ('djeholdings~wd5~edelman-careers-E200', 'Edelman'),
  ('ebi~wd5~ebadcareers', 'Ensign-Bickford Aerospace & Defense Company'),
  ('ensemblehp', 'Ensemble Health Partners'),
  ('globalfoundries', 'GlobalFoundries'),
  ('goldenagri~wd3~SMART_Careers', 'PT SMART Tbk.'),
  ('harbourvest', 'HarbourVest'),
  ('hfecorp', 'Herschend'),
  ('hubinternational', 'HUB International'),
  ('ivyrehab', 'Ivy Health'),
  ('kaweahhealth', 'Kaweah Health'),
  ('newbalance', 'New Balance'),
  ('nyuhs', 'United Health Services'),
  ('papajohns', 'Papa John''s'),
  ('pyebarkerfire', 'Pye-Barker Fire & Safety'),
  ('quirchfoods', 'Quirch Foods'),
  ('rivhs', 'Riverside Health'),
  ('rsmaus', 'RSM Australia'),
  ('rumcsi', 'Richmond University Medical Center'),
  ('signetjewelers', 'Signet Jewelers'),
  ('signetjewelers~wd1~Banter', 'Banter by Piercing Pagoda'),
  ('signetjewelers~wd1~BlueNile', 'Blue Nile'),
  ('ssctech', 'SS&C Technologies'),
  ('starfish', 'Torch Technologies'),
  ('stars', 'Stars Behavioral Health Group'),
  ('surbanajurong~wd3~KTP_Careers', 'KTP Consultant'),
  ('surbanajurong~wd3~RobertBirdGroup_Careers', 'Robert Bird Group'),
  ('surbanajurong~wd3~SAA_Architects_Careers', 'SAA Architects'),
  ('surbanajurong~wd3~SJ_Careers', 'Surbana Jurong'),
  ('surbanajurong~wd3~atelierten_careers', 'Atelier Ten'),
  ('surbanajurong~wd3~bh_careers', 'B+H'),
  ('surbanajurong~wd3~careersatsmec', 'SMEC'),
  ('tcbrands~wd1~TravisMathew-Careers', 'TravisMathew'),
  ('tcbrands~wd1~callaway-careers', 'Callaway Golf'),
  ('trugreen', 'TruGreen'),
  ('uvmhealth~wd1~AHMC', 'Alice Hyde Medical Center'),
  ('uvmhealth~wd1~EXTERNAL', 'University of Vermont Medical Center'),
  ('uvmhealth~wd1~Porter', 'Porter Medical Center'),
  ('uvmhealth~wd1~cvph', 'Champlain Valley Physicians Hospital'),
  ('villeroyboch', 'Villeroy & Boch'),
  ('wfscorp', 'World Fuel Services'),
  ('worldmarket', 'World Market'),
  ('wvumedicine', 'WVU Medicine'),
  ('wvumedicine~wd1~UHA', 'University Health Associates'),
  ('zepinc', 'Zep Inc.'),
  ('zrsmanagement', 'ZRS Management')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on) VALUES
  ('aampower', 'Dauch Corporation', ARRAY['https://aampower.wd1.myworkdayjobs.com/wday/cxs/aampower/AAM-Career-Site/sidebar', 'https://aampower.wd1.myworkdayjobs.com/wday/cxs/aampower/AAM-Career-Site/job/Tochigi-Japan/Software-Resident-Engineer--Nagoya-Toyota-city-_JREQ-222579-7'], 'sidebar: Dauch Corporation is a premier Driveline and Metal Forming supplier serving the global automotive industry', DATE '2026-11-08'),
  ('aaregional~wd503~Search', 'Piedmont Airlines', ARRAY['https://aaregional.wd503.myworkdayjobs.com/wday/cxs/aaregional/Search/sidebar', 'https://aaregional.wd503.myworkdayjobs.com/wday/cxs/aaregional/Search/job/Knoxville-TN/Ramp-Agent--Full-Time-_R1014549'], 'postings'' hiringOrganization: Piedmont Airlines, Inc. (a regional carrier on the tenant aaregional; a tenant slug key would name its other airlines too)', DATE '2026-11-08'),
  ('abcfinancial', 'ABC Fitness', ARRAY['https://abcfinancial.wd5.myworkdayjobs.com/wday/cxs/abcfinancial/ABCFinancialServices/job/Hyderabad-Office-India/Senior-Manager--AI---Data-Quality-Engineering_REQ-1641', 'https://abcfinancial.wd5.myworkdayjobs.com/wday/cxs/abcfinancial/ABCFinancialServices/sidebar'], 'posting: Join ABC Fitness and become part of a culture that''s as ambitious as it is authentic', DATE '2026-11-08'),
  ('aes', 'AES', ARRAY['https://aes.wd1.myworkdayjobs.com/wday/cxs/aes/AES_US/job/US-Dayton-OH/Distribution-Operator_R1064712', 'https://aes.wd1.myworkdayjobs.com/wday/cxs/aes/AES_US/sidebar'], 'posting: Join The AES Corporation, the largest US-based global power company; sidebar: transformed AES into the type of energy company', DATE '2026-11-08'),
  ('airproducts', 'Air Products', ARRAY['https://airproducts.wd5.myworkdayjobs.com/wday/cxs/airproducts/AP0001/job/Glasgow-Scotland/Cryoease-Driver_JR-2026-23000', 'https://airproducts.wd5.myworkdayjobs.com/wday/cxs/airproducts/AP0001/sidebar', 'https://airproducts.wd5.myworkdayjobs.com/wday/cxs/airproducts/AP0001/job/Warsaw-Poland/Osoba-obsugujca-proces-napeniania-gazw-spronych---Warszawa_JR-2026-23124'], 'posting: At Air Products, we reimagine what’s possible', DATE '2026-11-08'),
  ('atd', 'American Tire Distributors', ARRAY['https://atd.wd1.myworkdayjobs.com/wday/cxs/atd/American_Tire_Distributors/sidebar', 'https://atd.wd1.myworkdayjobs.com/wday/cxs/atd/American_Tire_Distributors/job/Houston-TX/Delivery-Driver--non-CDL-_R36655'], 'sidebar: At American Tire Distributors (ATD) our associates are valued', DATE '2026-11-08'),
  ('bakertilly', 'Baker Tilly US', ARRAY['https://bakertilly.wd5.myworkdayjobs.com/wday/cxs/bakertilly/btcareers/sidebar', 'https://bakertilly.wd5.myworkdayjobs.com/wday/cxs/bakertilly/btcareers/job/IND-KA-Bangalore---Cherry-Hills/Associate---Compensation_JR108332'], 'sidebar: Baker Tilly Advisory Group, LP and Baker Tilly US, LLP (Baker Tilly) provide professional services (bamboohr:bakertillycatalyst is already called Baker Tilly)', DATE '2026-11-08'),
  ('barcelo', 'Barceló Hotel Group', ARRAY['https://barcelo.wd3.myworkdayjobs.com/wday/cxs/barcelo/Barcelo_Careers/sidebar', 'https://barcelo.wd3.myworkdayjobs.com/wday/cxs/barcelo/Barcelo_Careers/job/Barcel-Riyadh-Olaya-Riyadh-Saudi-Arabia/Hotel-General-Manager---Barcel-Riyadh-Olaya_JR11072'], 'sidebar: Trabajar en Barceló significa formar parte de un proyecto; posting hiringOrganization: Barceló Hotel Group Gulf FZCO', DATE '2026-11-08'),
  ('baystatehealth', 'Baystate Health', ARRAY['https://baystatehealth.wd12.myworkdayjobs.com/wday/cxs/baystatehealth/External_Careers/sidebar', 'https://baystatehealth.wd12.myworkdayjobs.com/wday/cxs/baystatehealth/External_Careers/job/Springfield-Massachusetts/Patient-Care-Technician-Full-Time-Days_R42782-1'], 'sidebar: Baystate Health is a not-for-profit, integrated healthcare system', DATE '2026-11-08'),
  ('borgwarner', 'BorgWarner', ARRAY['https://borgwarner.wd5.myworkdayjobs.com/wday/cxs/borgwarner/BorgWarner_Careers/sidebar', 'https://borgwarner.wd5.myworkdayjobs.com/wday/cxs/borgwarner/BorgWarner_Careers/job/Viana-do-Castelo-I---Portugal/Manufacturing-Operations-Professional-Internship--m-f-d-_R2026-1081'], 'sidebar: BorgWarner is a global product leader in delivering innovative and sustainable mobility solutions', DATE '2026-11-08'),
  ('clearchanneloutdoor', 'Clear Channel Outdoor', ARRAY['https://clearchanneloutdoor.wd5.myworkdayjobs.com/wday/cxs/clearchanneloutdoor/CCO/sidebar', 'https://clearchanneloutdoor.wd5.myworkdayjobs.com/wday/cxs/clearchanneloutdoor/CCO/job/El-Paso-TX-Sparkman/Account-Executive_Req24116'], 'sidebar: At Clear Channel Outdoor, we''re more than a leader in Out-of-Home advertising', DATE '2026-11-08'),
  ('cngholdingsinc', 'CNG Holdings', ARRAY['https://cngholdingsinc.wd5.myworkdayjobs.com/wday/cxs/cngholdingsinc/CNG/sidebar', 'https://cngholdingsinc.wd5.myworkdayjobs.com/wday/cxs/cngholdingsinc/CNG/job/West-Bend-WI/Assistant-Store-Manager-1219-West-Bend_R0025879'], 'sidebar: CNG Holdings, Inc. serves consumers by providing financial solutions', DATE '2026-11-08'),
  ('denverhealth', 'Denver Health', ARRAY['https://denverhealth.wd1.myworkdayjobs.com/wday/cxs/denverhealth/dhha-main/sidebar', 'https://denverhealth.wd1.myworkdayjobs.com/wday/cxs/denverhealth/dhha-main/job/Main-Campus---Pavilion-A---777-Bannock-Street-Denver-CO-80204/Speech-Therapist-II---NICU-Feeding--PRN-_R19606-1'], 'sidebar: Every role at Denver Health contributes to improving lives', DATE '2026-11-08'),
  ('djeholdings~wd5~ZenoCareers', 'Zeno Group', ARRAY['https://djeholdings.wd5.myworkdayjobs.com/wday/cxs/djeholdings/ZenoCareers/sidebar', 'https://djeholdings.wd5.myworkdayjobs.com/wday/cxs/djeholdings/ZenoCareers/job/Redwood-City-California-USA/Senior-Vice-President--Earned-Media--Technology-Communications-_JR103747-1'], 'posting: Zeno Group is the fiercely independent and global, integrated communications agency (one of two firms on the tenant djeholdings)', DATE '2026-11-08'),
  ('djeholdings~wd5~edelman-careers-E200', 'Edelman', ARRAY['https://djeholdings.wd5.myworkdayjobs.com/wday/cxs/djeholdings/edelman-careers-E200/sidebar', 'https://djeholdings.wd5.myworkdayjobs.com/wday/cxs/djeholdings/edelman-careers-E200/job/Amsterdam-Netherlands/Communications-Intern_JR103489'], 'posting: Edelman is a voice synonymous with trust (one of two firms on the tenant djeholdings)', DATE '2026-11-08'),
  ('ebi~wd5~ebadcareers', 'Ensign-Bickford Aerospace & Defense Company', ARRAY['https://ebi.wd5.myworkdayjobs.com/wday/cxs/ebi/ebadcareers/sidebar', 'https://ebi.wd5.myworkdayjobs.com/wday/cxs/ebi/ebadcareers/job/Simsbury-CT/Integrated-Product-Team-Leader_REQ107346-1'], 'sidebar: Ensign-Bickford Aerospace & Defense Company (EBAD), headquartered in Simsbury, CT (the tenant ebi carries four companies'' sites)', DATE '2026-11-08'),
  ('ensemblehp', 'Ensemble Health Partners', ARRAY['https://ensemblehp.wd5.myworkdayjobs.com/wday/cxs/ensemblehp/EnsembleHealthPartnersCareers/job/Remote---Nationwide/VP-Partnership-Success_R046302', 'https://ensemblehp.wd5.myworkdayjobs.com/wday/cxs/ensemblehp/EnsembleHealthPartnersCareers/sidebar', 'https://ensemblehp.wd5.myworkdayjobs.com/wday/cxs/ensemblehp/EnsembleHealthPartnersCareers/job/Tallahassee-FL/Regional-Practice-Director_R040741'], 'posting: At Ensemble Health Partners, we''re looking for an exceptional executive leader', DATE '2026-11-08'),
  ('globalfoundries', 'GlobalFoundries', ARRAY['https://globalfoundries.wd1.myworkdayjobs.com/wday/cxs/globalfoundries/External/sidebar', 'https://globalfoundries.wd1.myworkdayjobs.com/wday/cxs/globalfoundries/External/job/Penang/Associate-Engineer---Sr-Associate-Engineer--PVD--CVD-ETCH-LITHO--CLN--DIFF-IMPANT-_JR-2602539'], 'sidebar: At GlobalFoundries you will find a vibrant work environment', DATE '2026-11-08'),
  ('goldenagri~wd3~SMART_Careers', 'PT SMART Tbk.', ARRAY['https://goldenagri.wd3.myworkdayjobs.com/wday/cxs/goldenagri/SMART_Careers/job/DKI-Jakarta/Cost---Operations-Controller_R-26001728', 'https://goldenagri.wd3.myworkdayjobs.com/wday/cxs/goldenagri/SMART_Careers/sidebar', 'https://goldenagri.wd3.myworkdayjobs.com/wday/cxs/goldenagri/SMART_Careers/job/Tebo/Kepala-Unit-Pengamanan_R-26001327'], 'posting hiringOrganization: 1000 PT SMART Tbk. (a Golden Agri-Resources company; the tenant goldenagri has other sites)', DATE '2026-11-08'),
  ('harbourvest', 'HarbourVest', ARRAY['https://harbourvest.wd5.myworkdayjobs.com/wday/cxs/harbourvest/HVP/sidebar', 'https://harbourvest.wd5.myworkdayjobs.com/wday/cxs/harbourvest/HVP/job/Boston/Vice-President--Investor-Relations---US-West-Coast_R2610-1'], 'sidebar: HarbourVest is an independent, global private markets firm', DATE '2026-11-08'),
  ('hfecorp', 'Herschend', ARRAY['https://hfecorp.wd503.myworkdayjobs.com/wday/cxs/hfecorp/palace_jobs/job/Adventureland-3200-Adventureland-drive-Altoona--IA-50009-United-States-of-America/Adventureland-Park-2027---Retail-Lead_JR107955', 'https://hfecorp.wd503.myworkdayjobs.com/wday/cxs/hfecorp/palace_jobs/sidebar'], 'posting: Today, Herschend is the largest family-held themed attractions company', DATE '2026-11-08'),
  ('hubinternational', 'HUB International', ARRAY['https://hubinternational.wd1.myworkdayjobs.com/wday/cxs/hubinternational/HUBInternational/sidebar', 'https://hubinternational.wd1.myworkdayjobs.com/wday/cxs/hubinternational/HUBInternational/job/Midlothian-VA/Senior-Account-Manager--Commercial-Insurance---Potential-for-Hybrid-Work_R0037041'], 'sidebar: HUB International is one of North America''s largest insurance brokers', DATE '2026-11-08'),
  ('ivyrehab', 'Ivy Health', ARRAY['https://ivyrehab.wd5.myworkdayjobs.com/wday/cxs/ivyrehab/Ivy_Rehab/sidebar', 'https://ivyrehab.wd5.myworkdayjobs.com/wday/cxs/ivyrehab/Ivy_Rehab/job/Scranton-PA/Physical-Therapist---Open-Your-Own-Clinic-_JR119378'], 'sidebar: Welcome to Ivy Health. Ivy Health is a growing team of orthopedic and pediatric outpatient physical, occupational, speech', DATE '2026-11-08'),
  ('kaweahhealth', 'Kaweah Health', ARRAY['https://kaweahhealth.wd1.myworkdayjobs.com/wday/cxs/kaweahhealth/Careers/sidebar', 'https://kaweahhealth.wd1.myworkdayjobs.com/wday/cxs/kaweahhealth/Careers/job/Visalia-California/Fitness-Instructor-II-2_R26_0000002114'], 'sidebar: Kaweah Health is committed to a culture that delivers personal, professional, and compassionate experiences', DATE '2026-11-08'),
  ('newbalance', 'New Balance', ARRAY['https://newbalance.wd1.myworkdayjobs.com/wday/cxs/newbalance/Careers/job/Suburban-Square-PA-Retail/Retail-Team-Lead--PT-_R41681', 'https://newbalance.wd1.myworkdayjobs.com/wday/cxs/newbalance/Careers/sidebar'], 'posting: Since 1906, New Balance has empowered people through sport and craftsmanship', DATE '2026-11-08'),
  ('nyuhs', 'United Health Services', ARRAY['https://nyuhs.wd12.myworkdayjobs.com/wday/cxs/nyuhs/nyuhscareers1/job/Johnson-City-NY/Clinical-Sitter_R0000013345', 'https://nyuhs.wd12.myworkdayjobs.com/wday/cxs/nyuhs/nyuhscareers1/sidebar'], 'posting: The Clinical Sitter at United Health Services (UHS) makes an immediate impact (hiringOrganization 02 UHS Hospitals; not NYU Langone)', DATE '2026-11-08'),
  ('papajohns', 'Papa John''s', ARRAY['https://papajohns.wd1.myworkdayjobs.com/wday/cxs/papajohns/PapaJohnsCareers/sidebar', 'https://papajohns.wd1.myworkdayjobs.com/wday/cxs/papajohns/PapaJohnsCareers/job/Store-186_GAAtlantaState-St-NW/Shift-Leader_R26_0000001462'], 'sidebar: At Papa John''s, we LOVE pizza', DATE '2026-11-08'),
  ('pyebarkerfire', 'Pye-Barker Fire & Safety', ARRAY['https://pyebarkerfire.wd1.myworkdayjobs.com/wday/cxs/pyebarkerfire/PB_V2/sidebar', 'https://pyebarkerfire.wd1.myworkdayjobs.com/wday/cxs/pyebarkerfire/PB_V2/job/Baton-Rouge-LA/Projects-Sprinkler-Foreman_JR112502'], 'postings'' hiringOrganization: Pye-Barker Fire & Safety, LLC', DATE '2026-11-08'),
  ('quirchfoods', 'Quirch Foods', ARRAY['https://quirchfoods.wd12.myworkdayjobs.com/wday/cxs/quirchfoods/Quirch_Foods/sidebar', 'https://quirchfoods.wd12.myworkdayjobs.com/wday/cxs/quirchfoods/Quirch_Foods/job/Medley-Florida/Warehouse-Selector--Night-Shift-_JR103112'], 'sidebar: We are Quirch Foods. Our Passion is your Joy.', DATE '2026-11-08'),
  ('rivhs', 'Riverside Health', ARRAY['https://rivhs.wd1.myworkdayjobs.com/wday/cxs/rivhs/ProviderRHS/sidebar', 'https://rivhs.wd1.myworkdayjobs.com/wday/cxs/rivhs/ProviderRHS/job/Riverside-Elizabeth-Lakes-Family-Practice---Hampton-Virginia/Family-Medicine-Physician-for-Riverside-Elizabeth-Lakes-Family-Practice---Riverside-Medical-Group---Hampton--Virginia_2026-038857-1'], 'sidebar: Established in 1915, Riverside Health is a non-profit, integrated health network', DATE '2026-11-08'),
  ('rsmaus', 'RSM Australia', ARRAY['https://rsmaus.wd105.myworkdayjobs.com/wday/cxs/rsmaus/RSMCareers/job/Perth/Assistant-Manager-Manager---Business-Advisory_JR100777', 'https://rsmaus.wd105.myworkdayjobs.com/wday/cxs/rsmaus/RSMCareers/sidebar'], 'posting: RSM Australia supports a people-centric and collaborative culture', DATE '2026-11-08'),
  ('rumcsi', 'Richmond University Medical Center', ARRAY['https://rumcsi.wd5.myworkdayjobs.com/wday/cxs/rumcsi/RUMC/sidebar', 'https://rumcsi.wd5.myworkdayjobs.com/wday/cxs/rumcsi/RUMC/job/Richmond-University-Medical-Center-Staten-Island-NY/Mental-Health-Technician_JR102343'], 'sidebar: a long-standing tradition of excellence at Richmond University Medical Center', DATE '2026-11-08'),
  ('signetjewelers', 'Signet Jewelers', ARRAY['https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/SignetCorporateCareers/sidebar', 'https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/SignetCorporateCareers/job/Support-Center---Irving-TX/Remote--CRM-Campaign-Manager---Banter_REQ_84481'], 'sidebar: Signet Jewelers is a people-first company', DATE '2026-11-08'),
  ('signetjewelers~wd1~Banter', 'Banter by Piercing Pagoda', ARRAY['https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/Banter/sidebar', 'https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/Banter/job/Banter-by-Piercing-Pagoda---Eastview---Victor-NY/Assistant-Store-Manager---Banter-by-Piercing-Pagoda---Eastview-Mall_REQ_84479'], 'sidebar: At Banter by Piercing Pagoda, we can help you discover a sense of style', DATE '2026-11-08'),
  ('signetjewelers~wd1~BlueNile', 'Blue Nile', ARRAY['https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/BlueNile/sidebar', 'https://signetjewelers.wd1.myworkdayjobs.com/wday/cxs/signetjewelers/BlueNile/job/R2Net-Manufacturing-New-York-NY/Production--R2M_REQ_84478'], 'sidebar: Blue Nile was founded in 1999 (the same Blue Nile as workable:blue-nile, whose account names bluenile.com)', DATE '2026-11-08'),
  ('ssctech', 'SS&C Technologies', ARRAY['https://ssctech.wd1.myworkdayjobs.com/wday/cxs/ssctech/ssctechnologies/job/Burnley-UK/Customer-Services-Associate_R18841', 'https://ssctech.wd1.myworkdayjobs.com/wday/cxs/ssctech/ssctechnologies/sidebar'], 'posting: approached by SS&C Technologies, Inc. or any of its affiliated companies', DATE '2026-11-08'),
  ('starfish', 'Torch Technologies', ARRAY['https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/sidebar', 'https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/job/Arnold-AFB/Hypersonic-Aeropropulsion-Test-Analyst_R1604'], 'sidebar: Torch Technologies is dedicated to providing superior research, development, and engineering services (hiringOrganization Torch Technologies, Inc.)', DATE '2026-11-08'),
  ('stars', 'Stars Behavioral Health Group', ARRAY['https://stars.wd1.myworkdayjobs.com/wday/cxs/stars/Search/sidebar', 'https://stars.wd1.myworkdayjobs.com/wday/cxs/stars/Search/job/Fresno-CA-USA/Mental-Health-Clinician_JR-12329'], 'sidebar: At Stars Behavioral Health Group, we are seeking passionate professionals', DATE '2026-11-08'),
  ('surbanajurong~wd3~KTP_Careers', 'KTP Consultant', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/KTP_Careers/sidebar'], 'sidebar: KTP Consultant Pte Ltd offers multi-disciplinary engineering services', DATE '2026-11-08'),
  ('surbanajurong~wd3~RobertBirdGroup_Careers', 'Robert Bird Group', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/RobertBirdGroup_Careers/sidebar', 'https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/RobertBirdGroup_Careers/job/London/Senior-Technology-Support-Specialist_JR119468-3'], 'sidebar: Robert Bird Group is a global consulting engineering firm', DATE '2026-11-08'),
  ('surbanajurong~wd3~SAA_Architects_Careers', 'SAA Architects', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/SAA_Architects_Careers/sidebar', 'https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/SAA_Architects_Careers/job/Singapore/Medical-Planner---Healthcare-Architect_JR119404'], 'sidebar: SAA is a leading full-service architecture practice headquartered in Singapore; hiringOrganization SAA Architects Pte Ltd', DATE '2026-11-08'),
  ('surbanajurong~wd3~SJ_Careers', 'Surbana Jurong', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/SJ_Careers/sidebar', 'https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/SJ_Careers/job/Singapore/Air-Conditioning-and-Mechanical-Ventilation-Engineer--ACMV-_JR118362'], 'sidebar: Robert Bird Group, SAA, SMEC and Surbana Jurong, based in more than 120 offices', DATE '2026-11-08'),
  ('surbanajurong~wd3~atelierten_careers', 'Atelier Ten', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/atelierten_careers/sidebar', 'https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/atelierten_careers/job/New-York-City/Energy-Analyst-Environmental-Designer_JR119380'], 'postings'' hiringOrganization: Atelier Ten USA LLC', DATE '2026-11-08'),
  ('surbanajurong~wd3~bh_careers', 'B+H', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/bh_careers/sidebar'], 'sidebar: B+H is a global, award-winning, full-service design firm', DATE '2026-11-08'),
  ('surbanajurong~wd3~careersatsmec', 'SMEC', ARRAY['https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/careersatsmec/sidebar', 'https://surbanajurong.wd3.myworkdayjobs.com/wday/cxs/surbanajurong/careersatsmec/job/Dhaka/Senior-Railway-Operation---Transport-Planning-Expert_JR119719'], 'sidebar: SMEC is a global engineering, management and development consultancy', DATE '2026-11-08'),
  ('tcbrands~wd1~TravisMathew-Careers', 'TravisMathew', ARRAY['https://tcbrands.wd1.myworkdayjobs.com/wday/cxs/tcbrands/TravisMathew-Careers/job/JP-TM---Retail---Wailea-HI/Client-Associate---Wailea-HI_JR2023-16861', 'https://tcbrands.wd1.myworkdayjobs.com/wday/cxs/tcbrands/TravisMathew-Careers/sidebar'], 'posting: TravisMathew is a premium apparel brand (hiringOrganization TravisMathew, LLC)', DATE '2026-11-08'),
  ('tcbrands~wd1~callaway-careers', 'Callaway Golf', ARRAY['https://tcbrands.wd1.myworkdayjobs.com/wday/cxs/tcbrands/callaway-careers/sidebar', 'https://tcbrands.wd1.myworkdayjobs.com/wday/cxs/tcbrands/callaway-careers/job/CG--CGI-Austin-Texas/Customer-Service-Representative--Austin--TX-_JR2023-16862'], 'sidebar: Callaway Golf is the leading manufacturer of premium golf clubs', DATE '2026-11-08'),
  ('trugreen', 'TruGreen', ARRAY['https://trugreen.wd1.myworkdayjobs.com/wday/cxs/trugreen/USExternalCareers/sidebar', 'https://trugreen.wd1.myworkdayjobs.com/wday/cxs/trugreen/USExternalCareers/job/St-Charles-IL-60174/Service-Manager_R37614'], 'sidebar: TruGreen is the nation''s largest and most comprehensive provider of lawn and landscape services', DATE '2026-11-08'),
  ('uvmhealth~wd1~AHMC', 'Alice Hyde Medical Center', ARRAY['https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/AHMC/sidebar', 'https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/AHMC/job/Malone-NY/Clinical-Dietitian_R0084772'], 'sidebar: Alice Hyde Medical Center is part of University of Vermont Health', DATE '2026-11-08'),
  ('uvmhealth~wd1~EXTERNAL', 'University of Vermont Medical Center', ARRAY['https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/EXTERNAL/sidebar', 'https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/EXTERNAL/job/South-Burlington-VT/Dental-Assistant---w-x-ray-endorsement-PT_R0089125'], 'sidebar: The University of Vermont Medical Center is committed to being a national model', DATE '2026-11-08'),
  ('uvmhealth~wd1~Porter', 'Porter Medical Center', ARRAY['https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/Porter/sidebar', 'https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/Porter/job/Middlebury-VT/Registered-Nurse---Emergency-Department_R0089236'], 'sidebar: University of Vermont Health - Porter Medical Center is located in the heart of beautiful Middlebury, Vermont', DATE '2026-11-08'),
  ('uvmhealth~wd1~cvph', 'Champlain Valley Physicians Hospital', ARRAY['https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/cvph/sidebar', 'https://uvmhealth.wd1.myworkdayjobs.com/wday/cxs/uvmhealth/cvph/job/Plattsburgh-NY/Patient-Access-Team-Representative---Orthopedic-Surgeons_R0090817-1'], 'sidebar: University of Vermont Health - Champlain Valley Physicians Hospital boasts 300 inpatient beds', DATE '2026-11-08'),
  ('villeroyboch', 'Villeroy & Boch', ARRAY['https://villeroyboch.wd3.myworkdayjobs.com/wday/cxs/villeroyboch/careers/sidebar', 'https://villeroyboch.wd3.myworkdayjobs.com/wday/cxs/villeroyboch/careers/job/VN_field_service/Project-Sales-Manager--B-W_JR_9740-1'], 'sidebar: Welcome to the global job portal of the Villeroy & Boch Group!', DATE '2026-11-08'),
  ('wfscorp', 'World Fuel Services', ARRAY['https://wfscorp.wd5.myworkdayjobs.com/wday/cxs/wfscorp/wfscareers-uk/sidebar', 'https://wfscorp.wd5.myworkdayjobs.com/wday/cxs/wfscorp/wfscareers-uk/job/LONDON-CANARY-WHARF-UK-Remote/Sr-Category-Manager--Indirect-Procurement---HR--Payroll---Travel_R23029'], 'sidebar: a global leader in the fuel industry, World Fuel Services offers exceptional individuals the opportunity', DATE '2026-11-08'),
  ('worldmarket', 'World Market', ARRAY['https://worldmarket.wd5.myworkdayjobs.com/wday/cxs/worldmarket/cost_plus_world_market_jobs/sidebar', 'https://worldmarket.wd5.myworkdayjobs.com/wday/cxs/worldmarket/cost_plus_world_market_jobs/job/UT-West-Jordan-7037-Plaza-Center-Dr/Stock-Associate_R-0106451'], 'sidebar: World Market is a national specialty retailer founded in San Francisco in 1958', DATE '2026-11-08'),
  ('wvumedicine', 'WVU Medicine', ARRAY['https://wvumedicine.wd1.myworkdayjobs.com/wday/cxs/wvumedicine/UHA/sidebar', 'https://wvumedicine.wd1.myworkdayjobs.com/wday/cxs/wvumedicine/UHA/job/Butler-PA-Region/Neurosurgery-Clinical-Instructor--Butler-Memorial-Hospital_JR26-49526'], 'sidebar: WVU Medicine recently moved to a new Applicant Tracking System', DATE '2026-11-08'),
  ('wvumedicine~wd1~UHA', 'University Health Associates', ARRAY['https://wvumedicine.wd1.myworkdayjobs.com/wday/cxs/wvumedicine/UHA/sidebar', 'https://wvumedicine.wd1.myworkdayjobs.com/wday/cxs/wvumedicine/UHA/job/Butler-PA-Region/Neurosurgery-Clinical-Instructor--Butler-Memorial-Hospital_JR26-49526'], 'sidebar: Thank you for your interest in working with University Health Associates; hiringOrganization UHA University Health Associates', DATE '2026-11-08'),
  ('zepinc', 'Zep Inc.', ARRAY['https://zepinc.wd503.myworkdayjobs.com/wday/cxs/zepinc/zepinccareers/sidebar', 'https://zepinc.wd503.myworkdayjobs.com/wday/cxs/zepinc/zepinccareers/job/Georgia-Distribution-Center/Stand-Up-Reach-Forklift-Operator-_J109835'], 'sidebar: At Zep Inc., we believe in fostering an environment that enables our associates to grow', DATE '2026-11-08'),
  ('zrsmanagement', 'ZRS Management', ARRAY['https://zrsmanagement.wd5.myworkdayjobs.com/wday/cxs/zrsmanagement/ZRS_Careers/sidebar', 'https://zrsmanagement.wd5.myworkdayjobs.com/wday/cxs/zrsmanagement/ZRS_Careers/job/Dallas-TX-75215/Maintenance-Technician---Lease-Up_R-108692'], 'postings'' hiringOrganization: ZRS MANAGEMENT LLC; sidebar: ZRS is seeking skilled professionals', DATE '2026-11-08')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, evidence = EXCLUDED.evidence, quote = EXCLUDED.quote, read_on = EXCLUDED.read_on;

-- RE-ARM THE NAME-SYNC LANE: with no version stamp it runs at the next
-- pass-end, and with no progress row it starts from the first token.
DO $$
DECLARE
  v_gone text;
BEGIN
  SELECT string_agg(format('%s %s', k, v::text), '; ' ORDER BY k) INTO v_gone
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  DELETE FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  RAISE NOTICE '20261108100000: the name-sync lane is re-armed (removed: %); the next pass-end walks every board from the first', coalesce(v_gone, 'nothing, the keys were already gone');
END $$;

-- SELF-CHECK. Raises, and so rolls every statement above back, unless:
--   1. each of the 59 boards has its override and its evidence row, naming
--      the same employer, read on 2026-11-08, with at least one http(s) link
--      and the words read;
--   2. the Saskatchewan site emqk~ca3~CX_1, whose requisitions name two
--      employers, took no override;
--   3. no client role holds a privilege on the evidence, row level security
--      is on, and the service role can read it;
--   4. neither name-sync key is left, so the lane walks again.
DO $$
DECLARE
  v_slugs text[] := ARRAY[
    'aampower', 'aaregional~wd503~Search', 'abcfinancial', 'aes', 'airproducts', 'atd', 'bakertilly', 'barcelo', 'baystatehealth', 'borgwarner', 'clearchanneloutdoor', 'cngholdingsinc', 'denverhealth', 'djeholdings~wd5~ZenoCareers', 'djeholdings~wd5~edelman-careers-E200', 'ebi~wd5~ebadcareers', 'ensemblehp', 'globalfoundries', 'goldenagri~wd3~SMART_Careers', 'harbourvest', 'hfecorp', 'hubinternational', 'ivyrehab', 'kaweahhealth', 'newbalance', 'nyuhs', 'papajohns', 'pyebarkerfire', 'quirchfoods', 'rivhs', 'rsmaus', 'rumcsi', 'signetjewelers', 'signetjewelers~wd1~Banter', 'signetjewelers~wd1~BlueNile', 'ssctech', 'starfish', 'stars', 'surbanajurong~wd3~KTP_Careers', 'surbanajurong~wd3~RobertBirdGroup_Careers', 'surbanajurong~wd3~SAA_Architects_Careers', 'surbanajurong~wd3~SJ_Careers', 'surbanajurong~wd3~atelierten_careers', 'surbanajurong~wd3~bh_careers', 'surbanajurong~wd3~careersatsmec', 'tcbrands~wd1~TravisMathew-Careers', 'tcbrands~wd1~callaway-careers', 'trugreen', 'uvmhealth~wd1~AHMC', 'uvmhealth~wd1~EXTERNAL', 'uvmhealth~wd1~Porter', 'uvmhealth~wd1~cvph', 'villeroyboch', 'wfscorp', 'worldmarket', 'wvumedicine', 'wvumedicine~wd1~UHA', 'zepinc', 'zrsmanagement'
  ];
  v_bad text[];
  v_left text;
BEGIN
  SELECT array_agg(s ORDER BY s) INTO v_bad
    FROM unnest(v_slugs) AS s
   WHERE NOT EXISTS (
     SELECT 1 FROM public.company_name_overrides o
       JOIN public.company_name_evidence e ON e.slug = o.slug
      WHERE o.slug = s
        AND o.display_name = e.display_name
        AND e.read_on = DATE '2026-11-08'
        AND length(e.quote) >= 10
        AND cardinality(e.evidence) >= 1
        AND NOT EXISTS (SELECT 1 FROM unnest(e.evidence) l WHERE l !~ '^https?://[^[:space:]]+$'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261108100000: % of the 59 boards lack the override and evidence this file writes, or differ from it (first: %)', cardinality(v_bad), array_to_string(v_bad[1:3], ', ');
  END IF;
  IF cardinality(v_slugs) <> 59 THEN
    RAISE EXCEPTION 'self-check 20261108100000: the slug list holds % boards, not 59', cardinality(v_slugs);
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_name_overrides WHERE slug = 'emqk~ca3~CX_1') THEN
    RAISE EXCEPTION 'self-check 20261108100000: emqk~ca3~CX_1 took one employer''s name, but its requisitions name the Saskatchewan Health Authority and the Saskatchewan Cancer Agency';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.company_name_evidence'::regclass) THEN
    RAISE EXCEPTION 'self-check 20261108100000: row level security is off on public.company_name_evidence';
  END IF;
  IF has_table_privilege('anon', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check 20261108100000: anon or authenticated can read or write public.company_name_evidence';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.company_name_evidence', 'SELECT') THEN
    RAISE EXCEPTION 'self-check 20261108100000: the service role cannot read public.company_name_evidence';
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_left
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261108100000: job_board_meta still holds %, so job-board''s name-sync lane would not walk these boards', v_left;
  END IF;
  RAISE NOTICE 'self-check 20261108100000: 59 overrides with their evidence; the name-sync lane renames their stored rows at the next pass-end';
END $$;
