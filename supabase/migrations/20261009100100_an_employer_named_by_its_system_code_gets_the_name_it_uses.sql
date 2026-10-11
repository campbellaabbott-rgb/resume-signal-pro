-- AN EMPLOYER NAMED BY ITS SYSTEM CODE GETS THE NAME IT USES.
--
-- SEO & GEO report 2026-10-08, F1 (server half). 292 of the 399 published
-- posting pages and 169 of the 487 company pages named the employer by its
-- vendor tenant code, title-cased: "Ms" (Morgan Stanley), "Pg", "Mdlz", "Db",
-- "Tmobile", "Rmit", "Hcmportal". Google for Jobs and AI answers repeat the
-- hiringOrganization name a page states, and search for the real name does not
-- match it. Measured 2026-10-08 by reading every published page with a crawler
-- user-agent: 209 company pages and 146 posting-page employers carried a name
-- that folds to the token's first segment (many of them real one-word names,
-- "Target", "Pfizer", which stay).
--
-- THE MECHANISM, UNCHANGED. public.company_name_overrides + the BEFORE INSERT
-- OR UPDATE trigger on job_board_postings (20260724194500): an exact full-token
-- key first, then a Workday tenant's first segment. A full-token key is used
-- below wherever a tenant hosts another employer's career site too (easyservice
-- also hosts Roper St. Francis, myview Holt Renfrew, jcrew Madewell, db DWS).
--
-- WHERE EACH NAME CAME FROM. The employer's own words for itself, read on
-- 2026-10-08 from its public Workday career site: the site's sidebar text
-- (GET /wday/cxs/<tenant>/<site>/sidebar), one posting's hiringOrganization
-- (GET /wday/cxs/<tenant>/<site>/job/...), or the tenant path itself. The
-- quoted words ride beside each row. No name here was guessed; a tenant whose
-- words did not name it (christmanco, jda, shm, clydeco, collaborative,
-- gatewaystaff, benchmark) keeps its stored name. The same table is mirrored for renderers by
-- supabase/functions/_shared/employer-names.ts (employerDisplayName), and a
-- test replays the migrations against that map.
--
-- RE-RUNNABLE: ON CONFLICT DO NOTHING (a curated row already there wins), and
-- the five bare-token repairs touch only rows whose name differs. The trigger
-- applies the names to every later write. The company facet
-- (refresh-board-facets, every 15 minutes) and the explore cache pick the names
-- up on their next run.
--
-- THE STORED ROWS ARE RENAMED BY THE JOB BOARD, NOT HERE (S11-133). This file
-- first renamed every stored row itself: about 80,800 postings on 216 boards,
-- their closures through a LIKE over the whole ledger, and the snapshots, in
-- one transaction that held row locks against the ingest and rewrote both
-- generated tsvectors and every index on those rows. Its self-verify then read
-- every posting, and one ingest insert committed under the old trigger in the
-- meantime would have rolled the whole file back. The overrides and the
-- trigger change stay here. The rename is job-board's name-sync lane
-- (NAME_SYNC_VERSION 4): a board at a time, by the trigger's own precedence
-- over this table, postings, closures, snapshots and the closure rollup,
-- resumable across passes. The self-verify reads only what this file writes.
--
-- CLARIO (S11-134). The Workday tenant clarioclinical and recruitee:clario, a
-- mobile-apps company, both call themselves Clario, and get_company_suggest and
-- the clusters merge by name. The tenant takes the legal name its postings
-- state ("hiringOrganization": "eResearch Technology Inc") beside the one its
-- sidebar uses.

-- A BARE TOKEN IS NOT A FULL TOKEN. The exact-key branch (20260724194500) was
-- written for full tokens ("ebqb~us2~CX_1"), but every Workday tenant slug in
-- this table is a bare key too, so a greenhouse/personio/breezy board whose
-- token equals a slug took the Workday tenant's name: on 2026-10-08 the
-- catalogue held five ("cc" Climate Corps shown as Chanel, "ag" Avathon
-- Government as Airbus, "ccf" as Cleveland Clinic, "kbr" Kaufman Borgeest &
-- Ryan as KBR, "fourseasons" Four Seasons Garage Doors as Four Seasons), and
-- this batch's "nc" would have made NorthCoast Asset Management the North
-- Carolina State Government. The exact branch now reads only a token that
-- carries a "~"; a bare key is a Workday slug and nothing else.
CREATE OR REPLACE FUNCTION public.apply_company_name_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ov text;
BEGIN
  IF NEW.company_token LIKE '%~%' THEN
    SELECT display_name INTO ov FROM public.company_name_overrides
     WHERE slug = NEW.company_token;
  END IF;
  IF ov IS NULL AND NEW.company_token LIKE '%~wd%' THEN
    SELECT display_name INTO ov FROM public.company_name_overrides
     WHERE slug = split_part(NEW.company_token, '~', 1);
  END IF;
  IF ov IS NOT NULL THEN NEW.company := ov; END IF;
  RETURN NEW;
END;
$$;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('2020companies', '2020 Companies'), -- sidebar: "2020 Companies is one of the premier outsourced sales and marketing agencies"
  ('3m', '3M'), -- sidebar: "At 3M we apply science"
  ('acciona', 'ACCIONA'), -- hiringOrganization: "ACCIONA CONSTRUCTION USA CORP."; site ACCIONA_Employment_Channel
  ('advanceauto', 'Advance Auto Parts'), -- sidebar: "Advance Auto Parts, Inc. is a leading automotive aftermarket parts provider"
  ('asmglobal', 'ASM Global'), -- hiringOrganization: "ASM Global-AEG Management DL LLC."
  ('avisbudget', 'Avis Budget Group'), -- sidebar: "Avis Budget Group is powered by our people"
  ('basspro', 'Bass Pro Shops'), -- sidebar: "About Bass Pro Shops"
  ('bhs', 'Baptist Health'), -- sidebar: "Baptist Health is a full-spectrum health system"
  ('bilh', 'Beth Israel Lahey Health'), -- sidebar: "At Beth Israel Lahey Health"
  ('bmc', 'Boston Medical Center'), -- sidebar: "Working at Boston Medical Center"
  ('boydgroup', 'The Boyd Group'), -- sidebar: "At The Boyd Group, we put our team members first"
  ('bronsonhg', 'Bronson Healthcare'), -- sidebar: "Bronson Healthcare is a community-owned, not-for-profit health system"
  ('brookshires', 'Brookshire Grocery Company'), -- sidebar: "Brookshire Grocery Company (BGC)"
  ('carters', 'Carter''s'), -- hiringOrganization: "Carter's Retail Inc."
  ('circlehealth', 'Circle Health Group'), -- sidebar: "At Circle Health Group"
  ('circlek', 'Circle K'), -- sidebar: "Our mission at Circle K"
  ('cnx', 'Concentrix'), -- sidebar: "Hi, we're Concentrix"
  ('coxhealth', 'CoxHealth'), -- sidebar: "At CoxHealth"
  ('cw', 'Cushman & Wakefield'), -- sidebar: "About Cushman & Wakefield"
  ('db~wd3~DBWebsite', 'Deutsche Bank'), -- hiringOrganization: "0010 Deutsche Bank Aktiengesellschaft" (DWSWebsite, the DWS site on the same tenant, is left alone)
  ('dxctechnology', 'DXC Technology'), -- sidebar: "DXC Technology (NYSE: DXC)"
  ('easyservice~wd5~MercyHealthCareers', 'Mercy Health'), -- sidebar: "At Mercy Health" (the tenant also hosts Roper St. Francis, so this site only)
  ('fedex', 'FedEx'), -- sidebar: "FedEx Express is the world's largest express-transportation company"
  ('fivebelow', 'Five Below'), -- hiringOrganization: "Five Below Inc"
  ('flir', 'Teledyne FLIR'), -- hiringOrganization: "Teledyne FLIR Defense, LLC"
  ('gfs~wd5~usjobs-gen-gfs', 'Gordon Food Service'), -- sidebar: "Gordon Food Service has delivered uncompromised quality"
  ('hcmportal', 'UPS'), -- sidebar: "UPS is committed to moving our world forward"
  ('heidelbergmaterials', 'Heidelberg Materials'), -- sidebar: "Heidelberg Materials - your springboard"
  ('homedepot', 'The Home Depot'), -- hiringOrganization: "HOME DEPOT MANAGEMENT COMPANY, LLC"; site careerdepot
  ('jbhunt', 'J.B. Hunt'), -- sidebar: "J.B. Hunt is a dominant force in transportation"
  ('jcrew~wd1~JCrewCareers', 'J.Crew'), -- hiringOrganization: "JCrew Stores" (MadewellCareers on the same tenant is left alone)
  ('jdgroupnam~wd1~JDFL_Store_Careers', 'JD Finish Line'), -- sidebar: "At JD Finish Line"
  ('keybank', 'KeyBank'), -- sidebar: "KeyBank is an organization collectively committed"
  ('kiongroup', 'KION Group'), -- sidebar: "KION brands keep the world moving"; site KIONGroup
  ('lcbo', 'LCBO'), -- sidebar: "The LCBO (Liquor Control Board of Ontario)"
  ('lego', 'LEGO Group'), -- sidebar: "the LEGO Group recruitment teams"
  ('leonardocompany', 'Leonardo'), -- sidebar: "this is Leonardo"
  ('lesschwab', 'Les Schwab'), -- sidebar: "Don't see your local Les Schwab store here?"
  ('lkqcorp', 'LKQ'), -- sidebar: "LKQ is at the industry's forefront"
  ('massgeneralbrigham', 'Mass General Brigham'), -- sidebar: "Mass General Brigham is a passionate, welcoming community"
  ('mcgill', 'McGill University'), -- sidebar: "McGill University is internationally recognized"
  ('mckesson', 'McKesson'), -- sidebar: "McKesson is an impact-driven, Fortune 10 company"
  ('mdlz', 'Mondelēz International'), -- sidebar: "At Mondelēz International, our purpose is"
  ('mgmresorts', 'MGM Resorts'), -- sidebar: "At MGM Resorts, we exist to entertain"
  ('mmc~wd1~MMC', 'Marsh'), -- sidebar: "Marsh (NYSE: MRSH) is a global leader in risk"
  ('monumenthealth', 'Monument Health'), -- hiringOrganization: "Monument Health Rapid City Hospital, Inc."
  ('ms', 'Morgan Stanley'), -- sidebar: "At Morgan Stanley, we advise, originate, trade"
  ('mufgub', 'MUFG'), -- sidebar: "At MUFG, our colleagues are our greatest assets"
  ('multicare', 'MultiCare'), -- sidebar: "MultiCare is a not-for-profit health care organization"
  ('mydpr', 'DPR'), -- sidebar: "The DPR family of companies"
  ('myhrabc', 'Cencora'), -- sidebar: "Cencora is a leading global pharmaceutical solutions company"
  ('mymvw', 'Marriott Vacations Worldwide'), -- sidebar: "Marriott Vacations Worldwide (NYSE: VAC) is a leading global vacation company"
  ('myview~wd3~paradox_careers', 'Loblaw Companies'), -- sidebar: "Loblaw Companies Limited, its subsidiaries" (Holt Renfrew and Choice Properties on the same tenant are left alone)
  ('myview~wd3~careers', 'Loblaw Companies'), -- sidebar: "Loblaw Companies Limited, its subsidiaries"
  ('nc', 'North Carolina State Government'), -- sidebar: "North Carolina State Government is one of the state's largest employers"
  ('nshs', 'Endeavor Health'), -- sidebar: "Welcome to Endeavor Health Careers"
  ('ntu', 'Nanyang Technological University'), -- sidebar: "Nanyang Technological University, Singapore (NTU Singapore)"
  ('nxp', 'NXP Semiconductors'), -- sidebar: "NXP Semiconductors N.V. (NASDAQ: NXPI)"
  ('ochsner', 'Ochsner Health'), -- sidebar: "Ochsner Health is the leading not-for-profit healthcare provider in the Gulf South"
  ('okgov', 'Oklahoma State Government'), -- sidebar: "Oklahoma State Government is the largest employer in the state"
  ('pacs', 'PACS'), -- sidebar: "PACS is revolutionizing the delivery"
  ('pg', 'P&G'), -- sidebar: "P&G was founded over 180 years ago"
  ('republic', 'Republic Services'), -- sidebar: "Republic Services is a place where your effort is always appreciated"
  ('rochester', 'University of Rochester'), -- hiringOrganization: "001 University of Rochester"
  ('rrhs', 'Rochester Regional Health'), -- sidebar: "Rochester Regional Health is an integrated health services organization"
  ('rsm', 'RSM'), -- sidebar: "Why work at RSM?"
  ('saintfrancis', 'Saint Francis'), -- sidebar: "Saint Francis is a Catholic, not-for-profit Health system based in Tulsa"
  ('saintlukes', 'Saint Luke''s Health System'), -- sidebar: "Saint Luke's Health System includes 18 hospitals"
  ('sanford', 'Sanford Health'), -- sidebar: "including Sanford Health, Marshfield Clinic"; site SanfordHealth
  ('sci', 'Service Corporation International'), -- sidebar: "SCI refers to Service Corporation International and its affiliates"
  ('sec', 'Samsung Electronics'), -- sidebar: "Samsung Electronics is a global leader in technology"
  ('sees', 'See''s Candies'), -- sidebar: "Welcome to See's Candies"
  ('sentara', 'Sentara Health'), -- sidebar: "Sentara Health is a Virginia and Northeastern North Carolina based not-for-profit"
  ('sharp', 'Sharp HealthCare'), -- sidebar: "Sharp HealthCare is a not-for-profit health care system"
  ('slihrms~wd3~Careers', 'AtkinsRéalis'), -- sidebar: "AtkinsRéalis is a world-class engineering services and nuclear company" (the Linxon site on the same tenant is left alone)
  ('smithfieldfoods', 'Smithfield Foods'), -- sidebar: "Why Work at Smithfield Foods?"
  ('syneoshealth', 'Syneos Health'), -- sidebar: "Discover what our Syneos Health colleagues already know"
  ('tmobile', 'T-Mobile'), -- hiringOrganization: "T-Mobile USA, Inc."; sidebar: "About T-Mobile"
  ('toryburch', 'Tory Burch'), -- sidebar: "Tory Burch is an American luxury brand"
  ('townepark', 'Towne Park'), -- hiringOrganization: "Towne Park, LLC"
  ('tsys', 'Global Payments'), -- sidebar: "Global Payments and Worldpay recently joined forces"; hiringOrganization: "Global Payments UK Ltd"
  ('uasys', 'University of Arkansas System'), -- sidebar: "The University of Arkansas System is a comprehensive, publicly-supported higher education institution"
  ('uottawa', 'University of Ottawa'), -- hiringOrganization: "University of Ottawa"
  ('usc', 'University of Southern California'), -- hiringOrganization: "University of Southern California- HS"
  ('usfoods', 'US Foods'), -- hiringOrganization: "US Foods, Inc."
  ('virtua', 'Virtua Health'), -- site Virtua_Health_External_Career_Site; hiringOrganization: "Virtua West Jersey Health Sys"
  ('whitecap', 'White Cap'), -- sidebar: "White Cap and its affiliates serve as a one-stop shop"
  ('wynd', 'Travel + Leisure Co.'), -- sidebar: "Travel + Leisure Co. is the world's leading membership and leisure travel company"
  ('zeissgroup', 'ZEISS'), -- sidebar: "ZEISS employees work in a place"
  ('son', 'State of Nebraska'), -- site NebraskaStateCareers; sidebar: "careers that make a difference in the lives of Nebraskans"
  ('redhat', 'Red Hat'), -- sidebar: "About Red Hat"
  ('hyperiongrp', 'Howden'), -- sidebar: "Howden began in 1994"
  ('hoganlovells', 'Hogan Lovells Cadwalader'), -- sidebar: "Hogan Lovells Cadwalader brings together more than 3,100 lawyers"
  ('tmhcc', 'Tokio Marine HCC'), -- sidebar: "At Tokio Marine HCC, we pride ourselves"
  ('bdf', 'Banque de France'), -- sidebar: "la Banque de France contribue à la stratégie monétaire"
  ('clarioclinical', 'Clario (eResearch Technology)'), -- sidebar: "Clario is a leading provider of endpoint data solutions"; hiringOrganization: "eResearch Technology Inc"
  ('iko~wd3~Roofmart_Careers', 'Roofmart'), -- sidebar: "Roofmart has been the distributor of choice"
  ('iko~wd3~IKO_Careers', 'IKO'), -- sidebar: "IKO is a leading manufacturer of residential and commercial roofing systems"
  ('promachbuilt', 'ProMach'), -- sidebar: "About ProMach"
  ('pennant~wd1~signaturehcoregoncoast', 'Signature Healthcare at Home'), -- sidebar: "Signature Healthcare at Home provides professional, home-based medical care"
  ('hbpublishing', 'Harvard Business Publishing'), -- sidebar: "About Harvard Business Publishing"
  ('nwis', 'Nightwing'), -- sidebar: "About Nightwing"
  ('fultonhogan', 'Fulton Hogan'), -- site Fultonhogan; tenant fultonhogan
  ('mercyagedcare', 'Mercy Health Australia'), -- sidebar: "Mercy Health Australia is renowned"
  ('rmit', 'RMIT University'), -- posting text: "RMIT University is seeking" (SEO report 2026-10-08); hiringOrganization: "RMIT Online Pty Ltd"
  ('intelcomgroup', 'Intelcom'), -- sidebar: "Intelcom is our name in Québec while in the rest of Canada and internationally, we're Dragonfly"
  ('ia', 'iA Financial Group'), -- sidebar: "At iA Financial Group"
  ('hhs', 'HHS'), -- sidebar: "HHS is a private, family-owned business"
  ('aoncology', 'American Oncology Network'), -- sidebar: "American Oncology Network AON is an alliance of physicians"
  ('ubc', 'University of British Columbia'), -- sidebar: "The University of British Columbia is a global centre for research and teaching"
  ('verabradley', 'Vera Bradley'), -- sidebar: "Vera Bradley began as an instinct"
  ('tvc', 'Vancouver Clinic'), -- sidebar: "Vancouver Clinic is the largest multi-specialty clinic in Southwest Washington"
  ('trustmark~wd1~healthfitnesscareers', 'HealthFitness'), -- sidebar: "Explore Careers at HealthFitness"
  ('davidlloyd', 'David Lloyd Leisure'), -- sidebar: "David Lloyd Leisure is the leading premium health and wellness group"
  ('fph~wd3~FPIP_Career', 'First Philippine Industrial Park'), -- sidebar: "First Philippine Industrial Park, Inc. (FPIP)"
  ('gcaa~wd3~GCAA_Careers', 'Glencore'), -- sidebar: "Advancing careers. Advancing everyday life. Glencore"
  ('health~wd105~External', 'Ministry of Health (New Zealand)'), -- sidebar: "The Ministry of Health is steward of the New Zealand health system"
  ('hkex', 'HKEX'), -- sidebar: "Hong Kong Exchanges and Clearing Limited (HKEX)"
  ('nandosanz', 'Nando''s'), -- site NandosANZ; sidebar: "our Nandocas (how we say staff)"
  ('pacificsmiles', 'Pacific Smiles Group'), -- sidebar: "At Pacific Smiles Group"
  ('simedarby', 'Sime'), -- sidebar: "Sime is a trusted partner to more than 60 leading automotive and industrial equipment brands"
  ('husqvarnagroup', 'Husqvarna Group'), -- sidebar: "Welcome to Husqvarna Group's Career Page"
  ('grpr', 'Parques Reunidos'), -- sidebar: "Parques Reunidos is creating great opportunities"
  ('ci~wd3~CI_FINANCIAL_EXTERNAL_CAREER-SITE', 'CI Financial'), -- sidebar: "CI Financial is an independent company"
  ('canadiantirecorporation', 'Canadian Tire Corporation'), -- tenant canadiantirecorporation
  ('biibhr', 'Biogen'), -- sidebar: "Why Biogen?"
  ('cbcrc', 'CBC/Radio-Canada'), -- sidebar: "CBC/Radio-Canada Talent Acquisition team"
  ('altusgroup', 'Altus Group'), -- site AltusGroup; sidebar: "How Altus empowers you"
  ('accelentertainment~wd12~AccelEntertainment_Careers', 'Accel Entertainment'), -- sidebar: "Accel Entertainment, Inc. (NYSE: ACEL)" (ToucanGamingCareers on the same tenant is left alone)
  ('xavier', 'Xavier University'), -- sidebar: "At Xavier University"
  ('nclh', 'Norwegian Cruise Line Holdings'), -- sidebar: "Welcome to Norwegian Cruise Line Holdings!"
  ('columbiabank', 'Columbia Bank'), -- sidebar: "About Columbia Bank"
  ('webtravelgroup', 'Web Travel Group'), -- sidebar: "Web Travel Group is a global B2B organisation"
  ('slrconsulting', 'SLR Consulting'), -- sidebar: "When you join SLR"; tenant slrconsulting
  ('knightfrank', 'Knight Frank'), -- sidebar: "Knight Frank is one of the world's leading independent real estate consultancies"
  ('carharttwip', 'Carhartt WIP'), -- sidebar: "Carhartt WIP is part of the WIP Trading AG"
  ('optrust', 'OPTrust'), -- sidebar: "OPTrust invests and manages one of Canada's largest pension funds"
  ('saskenergy', 'SaskEnergy'), -- site SaskEnergy; sidebar: "We are Saskatchewan's natural gas distribution company"
  ('newbelgium', 'New Belgium'), -- sidebar: "At New Belgium, we're committed"
  ('healthcarerealty', 'Healthcare Realty'), -- sidebar: "Welcome to Healthcare Realty's Career site"
  ('sjindustries', 'SJI'), -- sidebar: "SJI, an energy infrastructure holding company"
  ('arkbluecross', 'Arkansas Blue Cross'), -- sidebar: "Arkansas Blue Cross is consistently ranked as one of the best places to work"
  ('pgatour', 'PGA TOUR'), -- sidebar: "there's much more to the PGA TOUR than meets the eye"
  ('uvmhealth~wd1~EXTERNAL_UVMHN', 'University of Vermont Health'), -- sidebar: "University of Vermont Health is committed to being a national model"
  ('ptcbio', 'PTC Therapeutics'), -- sidebar: "PTC Therapeutics is a global biopharmaceutical company"
  ('gtefinancial', 'GTE Financial'), -- site GTE_Financial_Career
  ('fanshawec', 'Fanshawe College'), -- site fanshawecareers; tenant fanshawec
  ('orix~wd5~External_ORIX', 'ORIX'), -- sidebar: "ORIX is a high-energy, rapidly growing company"
  ('xpel', 'XPEL'), -- sidebar: "Since the day XPEL was founded"
  ('winlandfoods', 'Winland Foods'), -- sidebar: "At Winland Foods, we're passionate"
  ('vandrunenfarms', 'Van Drunen Farms'), -- tenant vandrunenfarms; site VDFCareers
  ('unf', 'University of North Florida'), -- sidebar: "At the University of North Florida"
  ('uakron', 'The University of Akron'), -- sidebar: "The University of Akron empowers our people"
  ('tuftsmedicine', 'Tufts Medicine'), -- sidebar: "Tufts Medicine is a leading integrated health system"
  ('arcticwolf', 'Arctic Wolf'), -- sidebar: "At Arctic Wolf, we recognize"
  ('applyboard', 'ApplyBoard'), -- sidebar: "ApplyBoard"
  ('asx', 'ASX'), -- sidebar: "ASX is an integrated exchange"
  ('bernergroup', 'Berner Group'), -- site Careers_Berner_Group; sidebar: "BERNER pushing the limits"
  ('bloomenergy', 'Bloom Energy'), -- sidebar: "fraudulently allege to be from Bloom Energy"
  ('brooksauto', 'Brooks Automation'), -- sidebar: "Brooks Automation has been a leading automation provider"
  ('corelab', 'Core Laboratories'), -- sidebar: "About Core Laboratories"
  ('firstquantum', 'First Quantum Minerals'), -- sidebar: "First Quantum Minerals Ltd. is a global mining company"
  ('hammondcare', 'HammondCare'), -- sidebar: "About HammondCare"
  ('harman', 'HARMAN'), -- sidebar: "HARMAN (harman.com) designs and engineers connected products"
  ('juliusbaer', 'Julius Baer'), -- sidebar: "Julius Baer is the leading Swiss wealth management group"
  ('lombardodier', 'Lombard Odier'), -- sidebar: "Lombard Odier's purpose is to preserve and grow our clients' assets"
  ('lseg', 'LSEG'), -- sidebar: "About Us: LSEG (Lo[ndon Stock Exchange Group])"
  ('pernodricard', 'Pernod Ricard'), -- sidebar: "Pernod Ricard is a worldwide leader in the spirits and champagne industry"
  ('rbnz', 'Reserve Bank of New Zealand'), -- sidebar: "Join the Reserve Bank - Te Pūtea Matua team"; site RBNZ
  ('reagroup', 'REA Group'), -- tenant reagroup; sidebar: "our leading brand is Australia's biggest property resource, realestate.com.au"
  ('mecca', 'MECCA'), -- sidebar: "Follow @LIFEATMECCA"
  ('pitneybowes', 'Pitney Bowes'), -- sidebar: "Pitney Bowes (NYSE:PBI) is a technology-driven company"
  ('gfs~wd5~jgrive-sud', 'JG Rive-Sud'), -- sidebar: "JG Rive-Sud F[ruits & Légumes]"
  ('birch~wd1~FusionCareers', 'Fusion Connect'), -- sidebar: "Fusion Connect is a leading technology service provider"
  ('unitedchurchhomes~wd1~semcareers', 'SEM Haven'), -- sidebar: "SEM Haven is a non-profit ministry"
  ('rsli', 'Reliance Matrix'), -- sidebar: "Reliance Matrix delivers employee benefits"
  ('capitalauto', 'Capital Automotive Group'), -- sidebar: "It is the people at Capital Automotive Group who make us who we are"
  ('churchs', 'Church''s Texas Chicken'), -- sidebar: "Church's Texas Chicken is a highly recognized brand name"
  ('pacificlife~wd1~PacificLifeReCareers', 'Pacific Life Re') -- sidebar: "At Pacific Life Re, our vision is"
ON CONFLICT (slug) DO NOTHING;

SET LOCAL statement_timeout = '15min';

-- The five bare-token boards get their own catalogue names back (the refresh
-- never rewrites a stored row's company, so they would keep the wrong one).
WITH b(source, company_token, name) AS (VALUES
    ('greenhouse', 'cc', 'Climate Corps'), -- was renamed 'Chanel'
    ('greenhouse', 'ag', 'Avathon Government'), -- was renamed 'Airbus'
    ('personio', 'ccf', 'Ccf'), -- was renamed 'Cleveland Clinic'
    ('breezy', 'kbr', 'Kaufman Borgeest & Ryan'), -- was renamed 'KBR'
    ('greenhouse', 'fourseasons', 'Four Seasons Garage Doors') -- was renamed 'Four Seasons'
)
UPDATE public.job_board_postings p SET company = b.name
  FROM b WHERE p.source = b.source AND p.company_token = b.company_token AND p.company IS DISTINCT FROM b.name;
WITH b(source, company_token, name) AS (VALUES
    ('greenhouse', 'cc', 'Climate Corps'), -- was renamed 'Chanel'
    ('greenhouse', 'ag', 'Avathon Government'), -- was renamed 'Airbus'
    ('personio', 'ccf', 'Ccf'), -- was renamed 'Cleveland Clinic'
    ('breezy', 'kbr', 'Kaufman Borgeest & Ryan'), -- was renamed 'KBR'
    ('greenhouse', 'fourseasons', 'Four Seasons Garage Doors') -- was renamed 'Four Seasons'
)
UPDATE public.job_board_closures c SET company = b.name
  FROM b WHERE c.source = b.source AND c.company_token = b.company_token AND c.company IS DISTINCT FROM b.name;
WITH b(source, company_token, name) AS (VALUES
    ('greenhouse', 'cc', 'Climate Corps'), -- was renamed 'Chanel'
    ('greenhouse', 'ag', 'Avathon Government'), -- was renamed 'Airbus'
    ('personio', 'ccf', 'Ccf'), -- was renamed 'Cleveland Clinic'
    ('breezy', 'kbr', 'Kaufman Borgeest & Ryan'), -- was renamed 'KBR'
    ('greenhouse', 'fourseasons', 'Four Seasons Garage Doors') -- was renamed 'Four Seasons'
)
UPDATE public.job_board_company_snapshots s SET company = b.name
  FROM b WHERE s.company_token = b.company_token AND s.company IS DISTINCT FROM b.name;

-- The closure rollup's months for those five boards, which the rollup made
-- final under the wrong name (S11-135). Absent where the rollup does not exist.
DO $$
BEGIN
  IF to_regclass('public.job_board_closure_rollup') IS NOT NULL THEN
    UPDATE public.job_board_closure_rollup r SET company = b.name
      FROM (VALUES
        ('cc', 'Climate Corps'), ('ag', 'Avathon Government'), ('ccf', 'Ccf'),
        ('kbr', 'Kaufman Borgeest & Ryan'), ('fourseasons', 'Four Seasons Garage Doors')
      ) AS b(company_token, name)
     WHERE r.company_token = b.company_token AND r.company IS DISTINCT FROM b.name;
  END IF;
END $$;

DO $$
DECLARE
  v_missing text[];
  v_bare    bigint;
BEGIN
  SELECT array_agg(k) INTO v_missing
    FROM unnest(ARRAY[
      '2020companies', '3m', 'acciona', 'advanceauto', 'asmglobal', 'avisbudget',
      'basspro', 'bhs', 'bilh', 'bmc', 'boydgroup', 'bronsonhg',
      'brookshires', 'carters', 'circlehealth', 'circlek', 'cnx', 'coxhealth',
      'cw', 'db~wd3~DBWebsite', 'dxctechnology', 'easyservice~wd5~MercyHealthCareers', 'fedex', 'fivebelow',
      'flir', 'gfs~wd5~usjobs-gen-gfs', 'hcmportal', 'heidelbergmaterials', 'homedepot', 'jbhunt',
      'jcrew~wd1~JCrewCareers', 'jdgroupnam~wd1~JDFL_Store_Careers', 'keybank', 'kiongroup', 'lcbo', 'lego',
      'leonardocompany', 'lesschwab', 'lkqcorp', 'massgeneralbrigham', 'mcgill', 'mckesson',
      'mdlz', 'mgmresorts', 'mmc~wd1~MMC', 'monumenthealth', 'ms', 'mufgub',
      'multicare', 'mydpr', 'myhrabc', 'mymvw', 'myview~wd3~paradox_careers', 'myview~wd3~careers',
      'nc', 'nshs', 'ntu', 'nxp', 'ochsner', 'okgov',
      'pacs', 'pg', 'republic', 'rochester', 'rrhs', 'rsm',
      'saintfrancis', 'saintlukes', 'sanford', 'sci', 'sec', 'sees',
      'sentara', 'sharp', 'slihrms~wd3~Careers', 'smithfieldfoods', 'syneoshealth', 'tmobile',
      'toryburch', 'townepark', 'tsys', 'uasys', 'uottawa', 'usc',
      'usfoods', 'virtua', 'whitecap', 'wynd', 'zeissgroup', 'son',
      'redhat', 'hyperiongrp', 'hoganlovells', 'tmhcc', 'bdf', 'clarioclinical',
      'iko~wd3~Roofmart_Careers', 'iko~wd3~IKO_Careers', 'promachbuilt', 'pennant~wd1~signaturehcoregoncoast', 'hbpublishing', 'nwis',
      'fultonhogan', 'mercyagedcare', 'rmit', 'intelcomgroup', 'ia', 'hhs',
      'aoncology', 'ubc', 'verabradley', 'tvc', 'trustmark~wd1~healthfitnesscareers', 'davidlloyd',
      'fph~wd3~FPIP_Career', 'gcaa~wd3~GCAA_Careers', 'health~wd105~External', 'hkex', 'nandosanz', 'pacificsmiles',
      'simedarby', 'husqvarnagroup', 'grpr', 'ci~wd3~CI_FINANCIAL_EXTERNAL_CAREER-SITE', 'canadiantirecorporation', 'biibhr',
      'cbcrc', 'altusgroup', 'accelentertainment~wd12~AccelEntertainment_Careers', 'xavier', 'nclh', 'columbiabank',
      'webtravelgroup', 'slrconsulting', 'knightfrank', 'carharttwip', 'optrust', 'saskenergy',
      'newbelgium', 'healthcarerealty', 'sjindustries', 'arkbluecross', 'pgatour', 'uvmhealth~wd1~EXTERNAL_UVMHN',
      'ptcbio', 'gtefinancial', 'fanshawec', 'orix~wd5~External_ORIX', 'xpel', 'winlandfoods',
      'vandrunenfarms', 'unf', 'uakron', 'tuftsmedicine', 'arcticwolf', 'applyboard',
      'asx', 'bernergroup', 'bloomenergy', 'brooksauto', 'corelab', 'firstquantum',
      'hammondcare', 'harman', 'juliusbaer', 'lombardodier', 'lseg', 'pernodricard',
      'rbnz', 'reagroup', 'mecca', 'pitneybowes', 'gfs~wd5~jgrive-sud', 'birch~wd1~FusionCareers',
      'unitedchurchhomes~wd1~semcareers', 'rsli', 'capitalauto', 'churchs', 'pacificlife~wd1~PacificLifeReCareers'
    ]::text[]) AS k
   WHERE NOT EXISTS (SELECT 1 FROM public.company_name_overrides o WHERE o.slug = k);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'self-verify 20261009100100: % override(s) missing: %', array_length(v_missing, 1), v_missing;
  END IF;

  IF position('%~%' IN pg_get_functiondef('public.apply_company_name_override()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'self-verify 20261009100100: apply_company_name_override still matches a bare token as a full one';
  END IF;

  -- No bare-token board still carries a Workday tenant's name it was given.
  SELECT count(*) INTO v_bare
    FROM public.job_board_postings p
    JOIN (VALUES
      ('greenhouse', 'cc', 'Climate Corps'), -- was renamed 'Chanel'
      ('greenhouse', 'ag', 'Avathon Government'), -- was renamed 'Airbus'
      ('personio', 'ccf', 'Ccf'), -- was renamed 'Cleveland Clinic'
      ('breezy', 'kbr', 'Kaufman Borgeest & Ryan'), -- was renamed 'KBR'
      ('greenhouse', 'fourseasons', 'Four Seasons Garage Doors') -- was renamed 'Four Seasons'
    ) AS b(source, company_token, name) ON p.source = b.source AND p.company_token = b.company_token
   WHERE p.company IS DISTINCT FROM b.name;
  IF v_bare > 0 THEN
    RAISE EXCEPTION 'self-verify 20261009100100: % posting(s) on a bare-token board still carry a Workday tenant''s name', v_bare;
  END IF;
  RAISE NOTICE 'self-verify 20261009100100: % employer name(s) added; bare tokens no longer match a tenant slug; the stored rows are renamed by job-board''s name-sync lane (NAME_SYNC_VERSION 4)', 179;
END $$;
