-- A BOARD NAMED BY ITS LOGO OR A SITE LABEL TAKES THE NAME ITS EMPLOYER USES.
--
-- Owner decision of 2026-10-25 on the SEO round's name gate (D7,
-- docs/company-profiles/name-gate-dry-run.md, table 1): the pages the gate
-- refused for their name stay indexed, and are made trusted by fixing the
-- name, never by loosening the gate. Three of the six were refused for it:
--   - recruiting~REG1001RWHM~3f9058a6-..., stored "Axia Logo Horizontal", the
--     alt text of the board's logo, which the UKG census took for the name;
--   - icfcjb~ocs~CX_1, stored "Aerospace", the SiteName of the tenant's only
--     active Oracle site (its inactive sites carry the SEO name Honeywell);
--   - eexs~us2~CX_3001, stored "All", the census's "All Jobs" with "Jobs" cut.
-- The same census paths wrote many more names the gate lets through: UKG
-- boards printing a brand or logo label ("Westminster Brand 051816", "US -
-- LLC Recruiting", "2024 New Logo"), Oracle sites printing an audience label
-- ("Student", "Staff and Faculty", "Global") and ADP boards printing a logo
-- file name ("BTB2.png", "C3 CMYK").
--
-- WHERE EACH NAME CAME FROM. The employer's own words for itself, read on
-- 2026-10-25, gently (one request a second per host): the UKG board's
-- embedded jobBoard name and its footer, a posting's own text, the Oracle
-- tenant's site list and a requisition's text, an ADP requisition's text, or
-- the employer's own careers page linking the board. Every row below has its
-- links and the words read in public.company_name_evidence, created here, a
-- table only the service role reads. It is a table of its own because the
-- mirror test replays company_name_overrides as exactly (slug, display_name).
-- Nothing is guessed: a board whose words did not name its employer keeps
-- its stored name (UKG: KemperSports' Streamsong board, SCF, CHR, Matrix,
-- CRMC, Lowry, LAFA; ADP: three boards whose text was not read or disagrees
-- with the logo). A bare token (a greenhouse, lever or ashby board, an ADP
-- client id with no career-center id) cannot take an override at all and is
-- left to a catalogue rename. Two Oracle boards are not one
-- employer and get no row: erhk~us2~CX_1001 ("Default") pools R+L Carriers
-- with Golden Ocala, and fa-enmi-saasfaprod1~ocs~CX_1 is Portsmouth City
-- Council's schools portal carrying several employers.
--
-- ONE STATED UNCERTAINTY. eexs~us2~CX_3001 is LCS's tenant-wide "All Jobs"
-- site, linked from lcsliving.com as "Work for LCS"; most of its postings are
-- at senior living communities LCS manages, and the feed states no legal
-- employer for them. LCS is the employer that publishes the board, so the
-- board (its company page, its facet chip) is named LCS, but LCS is not
-- named as the hirer of its postings: requisition 41168's own text says
-- "Friendship Village is seeking", with LegalEmployer null. The two LCS sites
-- (CX_3001 and CX_11009) are PUBLISHER_ONLY_BOARDS in
-- supabase/functions/_shared/employer-names.ts: a posting there names no
-- hirer, gets no posting page and carries no JobPosting (trust/pages review,
-- 2026-10-25).
--
-- WHAT RENAMES THE STORED ROWS. Not this file (S11-133: a rename in one
-- transaction holds row locks against ingest and rewrites both generated
-- tsvectors). The trigger names every write after this file, and job-board's
-- name-sync lane renames the stored postings, closures, snapshots and closure
-- rollup a board at a time when its version moves, which job-board
-- 2026-09-09.95 does (4 to 5). So this file is applied BEFORE job-board
-- deploys (docs/deploy-ledger.json migrationOrder): applied after it, the lane
-- finishes version 5 before these rows exist. The bake and the app read
-- supabase/functions/_shared/employer-names.ts, which mirrors this table, so
-- the pages print the names at the next frontend publish whatever the stored
-- rows say.
--
-- RE-RUNNABLE: ON CONFLICT DO UPDATE on both tables, IF NOT EXISTS on the new
-- one. The self-check reads only what this file writes.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

CREATE TABLE IF NOT EXISTS public.company_name_evidence (
  slug         text PRIMARY KEY,
  display_name text NOT NULL,
  evidence     text[] NOT NULL,
  quote        text NOT NULL,
  read_on      date NOT NULL,
  CONSTRAINT company_name_evidence_names_a_link CHECK (cardinality(evidence) >= 1)
);

ALTER TABLE public.company_name_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_name_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.company_name_evidence TO service_role;

COMMENT ON TABLE public.company_name_evidence IS
  'Why a company_name_overrides row names its employer: the links read and the '
  'employer''s own words, one row per override slug, from 20261025100000 on. '
  'NOT client-readable: no client policy and no anon or authenticated grant.';

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('149c7964-ca14-4211-b982-ef50dfb8b504~9200868940886_2', 'Community Care Cooperative'),
  ('214ae4ed-5f0a-4657-b50a-6e318870a1f6~9200797842407_3', 'HLW'),
  ('70cd76e3-8c19-42a4-8d01-5d91b9c3222e~9201469061155_2', 'Bricktown Brewery'),
  ('8a680274-0b2e-46cf-b2cc-49bd2ef0c20f~9201289910657_2', 'Parallels'),
  ('9f16667e-93e9-453a-b7cc-2bfeb3eda460~19000101_000003', 'Circular Action Alliance'),
  ('eea42ed6-3dcf-47f3-b99b-29a304948b2b~9200441095595_2', 'PURE HomeRiver'),
  ('eexs~us2~CX_11009', 'LCS'),
  ('eexs~us2~CX_3001', 'LCS'),
  ('ehwy~us2~CX', 'Ithaca College'),
  ('ehwy~us2~CX_1', 'Ithaca College'),
  ('ekpl~us6~CX_1', 'Glaukos'),
  ('emdz~us2~CX_1', 'Rice University'),
  ('fa-exer-saasfaprod1~ocs~CX_1', 'Butler University'),
  ('fa-exer-saasfaprod1~ocs~CX_1001', 'Butler University'),
  ('icfcjb~ocs~CX_1', 'Honeywell Aerospace'),
  ('recruiting2~AME1033ABHOW~8819f2ba-041d-48c2-9cfe-c854415f43d2', 'HumanGood'),
  ('recruiting2~AME1104ANBT~9474d2f8-2ad2-46f8-bbe3-f435f50628bd', 'American National Bank of Texas'),
  ('recruiting2~ARC1033ARCHS~ec1bad7b-421b-4c92-bf84-dae0f2173612', 'ARCHER Systems'),
  ('recruiting2~ART1010AICH~d263cd2b-c4ef-4e10-8876-a2896406a573', 'Art Institute of Chicago'),
  ('recruiting2~ASI1002AAMF~9e5e0e8e-237d-4ca6-91c0-a4f1fdd16163', 'Asian Art Museum'),
  ('recruiting2~AUS1003AUIN~611d5a38-76c4-4f66-a55f-2bc012d98024', 'Austin Industries'),
  ('recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703', 'Austin Industries'),
  ('recruiting2~AUS1003AUIN~b8542df4-bc14-47ac-9e01-2eb2423bd205', 'Austin Industries'),
  ('recruiting2~CAL1001CALA~46b96419-fba6-4dd0-a5fa-715bdfcf845b', 'Calamos Investments'),
  ('recruiting2~CKE1000CKER~8d7aeff6-90f7-47bf-9f70-771c5260877f', 'CKE'),
  ('recruiting2~CON1051CONPC~4c5261a3-56a0-4867-9d86-1673f2d804c2', 'Continental Properties'),
  ('recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d', 'Convergint'),
  ('recruiting2~GOL1019GDWC~07a2cf6e-052c-4ffa-b81d-99900254b1f5', 'Goldenwest Credit Union'),
  ('recruiting2~HUS1001HUSCH~b6637591-8c8d-49b8-b093-5524b203b157', 'Husch Blackwell'),
  ('recruiting2~KEM1000~4ca2399d-585f-4556-b3a0-94af57ab68ea', 'KemperSports'),
  ('recruiting2~LUB1000LUBT~287e5d40-e2cb-41a7-8c5d-756dc9c5a838', 'Ascentek'),
  ('recruiting2~LUB1000LUBT~2dc69741-bb0f-433d-96a9-d7731bfa452a', 'Ascentek'),
  ('recruiting2~MCF1000~d8a61458-fc16-88c5-cdbe-b242fca9113e', 'McFarland Clinic'),
  ('recruiting2~MID1025MIDF~de6dc764-d7e7-4ebc-99c5-bb453e31e24b', 'MidFirst Bank'),
  ('recruiting2~MUN1001MCHK~acccd54e-ac6e-44a1-a6d4-8a1f25cceea3', 'Munchkin'),
  ('recruiting2~PAP1001~7297d137-c573-4bf4-8ab4-09ad7dac6ec8', 'Papé'),
  ('recruiting2~RES1015RPLLC~dc0817a6-b35b-4938-ae2a-d5d14087e134', 'RESA Power'),
  ('recruiting2~SAP1000SPID~5e557a61-9707-4f47-8f76-9c11b2bfbf9e', 'Smart City Networks'),
  ('recruiting2~STA1013~94aec289-5757-a8f0-d3bb-77f9cd846172', 'Minnesota Star Tribune'),
  ('recruiting2~SUN1000SUNCO~5882c1c5-18e3-8740-5e61-37d8f7574d64', 'Sun Country Airlines'),
  ('recruiting~AHF1000AHFP~eb870e08-1b72-44d8-a4c4-d8b21f6f9297', 'AHF Products'),
  ('recruiting~AME1068~34b788f5-e07e-3fb3-8e73-08c36602a07b', 'AFSC'),
  ('recruiting~AME1101AMRI~f0aaafcc-5031-43d3-b658-e19a8bac98ee', 'American Commercial Barge Line'),
  ('recruiting~AMG1002AMGC~f40ecd9c-1926-422b-82bf-5d5df3c0ad54', 'AM General'),
  ('recruiting~ANA1003ALOG~a4de26ba-aa2d-4502-9d0f-577ea07dc7ca', 'Analogic'),
  ('recruiting~BYR1000BYRNE~d5855859-9eae-dd60-5965-11eeffbec7a1', 'Byrne Electrical Specialists'),
  ('recruiting~COM1052~2e5d0965-0540-a0b3-7480-d7e4ddca0af6', 'CommuniCare Health Centers'),
  ('recruiting~ENV1004ERLL~01ddc4d3-605b-44e6-9b43-4abf0d1399b1', 'Envision Radiology'),
  ('recruiting~EOS1000EOSI~1170f284-cf46-4ff7-b32f-76e224e7a2d4', 'EOS Hospitality'),
  ('recruiting~EPR1000EPSUS~10653576-f6a1-4d69-8a9c-a0a96124abda', 'CAI Software'),
  ('recruiting~EUL1000EULEN~7f63c405-6579-4eb2-954a-482585dd4149', 'Grupo Eulen USA'),
  ('recruiting~FAR1008FNBC~2ed885d0-15e6-4548-ac9c-d5c9607e02d7', 'Farmers National Banc Corp.'),
  ('recruiting~GEN1025~37481dc2-ddb2-1941-a0f9-befbbf45ab11', 'Genesee & Wyoming'),
  ('recruiting~GRA1010GRAY~8d18afb5-245e-4c7e-a198-6a682201a90e', 'GrayRobinson'),
  ('recruiting~GUA1000GACM~14ab0bd3-29ec-43fc-ba76-27a9beaf97f5', 'Guardian Alarm'),
  ('recruiting~HIL1004~783ada32-210a-ecf9-eab4-00a5ed980db3', 'Hilltop Community Resources'),
  ('recruiting~IFL1000IFLY~1cbe2e6c-5bff-312c-9bbb-ac39038cb6bb', 'iFLY'),
  ('recruiting~JAC1008JACAM2~78f93132-0f92-4d96-92fd-6bc9a0e91b52', 'JACAM Catalyst'),
  ('recruiting~KIL1000~68c62bcb-20f8-3231-d728-9190572df832', 'Kilpatrick Townsend & Stockton'),
  ('recruiting~LUM1000NWL~c00e73a9-0a5f-4082-8257-fcddd1029261', 'Nemacolin'),
  ('recruiting~MAR1033MBL~4c3007c3-6354-41de-a13f-d95be60d91e9', 'MBL'),
  ('recruiting~MEL1004MHTC~fbc00c76-0292-40eb-b052-02b511393eac', 'Melwood'),
  ('recruiting~MER1020MERZ~84f5dbc2-c467-5a9e-3a37-6174c98926eb', 'Merz North America'),
  ('recruiting~MER1020MERZ~a6b53edd-7e9e-4bfb-bd93-0f6a6f0f275d', 'Merz Aesthetics'),
  ('recruiting~MES1002MESSD~888390fa-f9e8-4b6f-9977-7e3a214369f0', 'Meso Scale Diagnostics'),
  ('recruiting~MES1005MESR~dbd63926-d756-486f-a254-b2a6ede1d26e', 'Messer'),
  ('recruiting~MES1005MESR~fa3fc0aa-75f1-4eac-9152-b4e8b8cbe849', 'Messer'),
  ('recruiting~MIC1003MEI~e3674ed3-2699-442b-aa28-c0b8436281b9', 'Micro Center'),
  ('recruiting~MIC1008MICPT~9f087488-7494-c18e-5713-c97b9f3d8219', 'MicroPort'),
  ('recruiting~MID1029MISO~362b6b1d-f1c3-46f5-9554-4aa90e2bda64', 'MISO'),
  ('recruiting~MIM1000MMEDX~1d9bee39-4128-4512-aa23-005f0e124469', 'MIMEDX'),
  ('recruiting~MOD1003MWA~8990acfc-04f3-d65f-0565-a772e1a0157b', 'Modern Woodmen of America'),
  ('recruiting~ORA1000OLCC~17560d62-b19a-4c09-9909-fe2b9c713df3', 'Holiday Inn Club Vacations'),
  ('recruiting~PAR1026PARS~b9883763-2d52-4511-a00a-57166395312c', 'Paradies Lagardère'),
  ('recruiting~PEN1019PMOI~9c2e3b43-1929-4405-b387-470097c98b4a', 'Penn-Mar Human Services'),
  ('recruiting~PGW1000PAUT~f1df8566-65d8-4efe-8046-4e96e46eeadf', 'PGW Auto Glass'),
  ('recruiting~POL1006~c0e3f015-388f-2bf6-e3ac-af081fcad685', 'PM Hotel Group'),
  ('recruiting~QSA1000QSAC~d1dee834-9977-44db-8afd-d97fd6e60e44', 'QSAC'),
  ('recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522', 'Axia Women''s Health'),
  ('recruiting~SAV1002STCF~7d92e82b-af74-464d-859b-c5b8cba6e92e', 'Save the Children'),
  ('recruiting~SEA1007SEACO~7851737e-66c7-908f-77e9-6d69f4eb0ead', 'Seacoast Bank'),
  ('recruiting~SER1005SEIU~e131b2ae-a5ce-4fb1-a93c-84c36a485721', 'SEIU'),
  ('recruiting~WEI1003~0e982683-539b-1a76-d39a-221637b5ef2e', 'Weiler'),
  ('recruiting~WEL1008WLLT~30969ce4-3b7e-40a6-b86c-34d3616fe0ed', 'Welltower'),
  ('recruiting~WES1010~9ca96e8c-accb-8dab-a29c-32c8da6f8d67', 'Westminster Communities of Florida'),
  ('recruiting~WES1010~dc686796-57ca-4fa7-a2d7-68f4e5612bd8', 'Westminster Communities of Florida'),
  ('recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46', 'Banner Engineering'),
  ('recruiting~map1002mapmg~9c5b2d47-fac0-4e56-9f06-b9cc2013276d', 'Mid-Atlantic Permanente Medical Group')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on) VALUES
  ('149c7964-ca14-4211-b982-ef50dfb8b504~9200868940886_2', 'Community Care Cooperative', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=149c7964-ca14-4211-b982-ef50dfb8b504&ccId=9200868940886_2&lang=en_US&locale=en_US'], 'posting: "Community Care Cooperative (C3) is a 501(c)(3)"', DATE '2026-10-25'),
  ('214ae4ed-5f0a-4657-b50a-6e318870a1f6~9200797842407_3', 'HLW', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=214ae4ed-5f0a-4657-b50a-6e318870a1f6&ccId=9200797842407_3&lang=en_US&locale=en_US'], 'posting: "HLW is built on the belief that exceptional design begins with exceptional people"', DATE '2026-10-25'),
  ('70cd76e3-8c19-42a4-8d01-5d91b9c3222e~9201469061155_2', 'Bricktown Brewery', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=70cd76e3-8c19-42a4-8d01-5d91b9c3222e&ccId=9201469061155_2&lang=en_US&locale=en_US'], 'posting: "Join the Bricktown Brewery team"', DATE '2026-10-25'),
  ('8a680274-0b2e-46cf-b2cc-49bd2ef0c20f~9201289910657_2', 'Parallels', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=8a680274-0b2e-46cf-b2cc-49bd2ef0c20f&ccId=9201289910657_2&lang=en_US&locale=en_US'], 'posting: "Parallels has an immediate vacancy for this role"', DATE '2026-10-25'),
  ('9f16667e-93e9-453a-b7cc-2bfeb3eda460~19000101_000003', 'Circular Action Alliance', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=9f16667e-93e9-453a-b7cc-2bfeb3eda460&ccId=19000101_000003&lang=en_US&locale=en_US'], 'posting: "Circular Action Alliance is an equal ..." and "CAA''s Financial Controller"', DATE '2026-10-25'),
  ('eea42ed6-3dcf-47f3-b99b-29a304948b2b~9200441095595_2', 'PURE HomeRiver', ARRAY['https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?cid=eea42ed6-3dcf-47f3-b99b-29a304948b2b&ccId=9200441095595_2&lang=en_US&locale=en_US'], 'posting: "PURE HomeRiver is looking for an Assistant Property Manager"', DATE '2026-10-25'),
  ('eexs~us2~CX_11009', 'LCS', ARRAY['https://www.lcsliving.com/about-us/careers/', 'https://eexs.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=200'], 'employer site "Senior Living Careers | LCS" links sites/allcommunityjobs, this site (SiteName "All Community Jobs"), as "Community Positions" at communities "managed by LCS Community Operations"', DATE '2026-10-25'),
  ('eexs~us2~CX_3001', 'LCS', ARRAY['https://www.lcsliving.com/about-us/careers/', 'https://eexs.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=200', 'https://eexs.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%2241168%22%2CsiteNumber%3DCX_3001'], 'employer site "Senior Living Careers | LCS" links sites/AllJobs, this site (SiteName "All Jobs"), as "All Open Positions": "Work for LCS". Most of its postings are at senior living communities LCS manages, and the feed states no legal employer: requisition 41168 reads "Friendship Village is seeking", LegalEmployer null. LCS names the board, never a posting''s hirer', DATE '2026-10-25'),
  ('ehwy~us2~CX', 'Ithaca College', ARRAY['https://ehwy.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%223645%22%2CsiteNumber%3DCX'], 'posting: "Ithaca College''s student employment program"', DATE '2026-10-25'),
  ('ehwy~us2~CX_1', 'Ithaca College', ARRAY['https://ehwy.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%223895%22%2CsiteNumber%3DCX_1'], 'posting: "At Ithaca College, a comprehensive residential campus community"', DATE '2026-10-25'),
  ('ekpl~us6~CX_1', 'Glaukos', ARRAY['https://ekpl.fa.us6.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%222446%22%2CsiteNumber%3DCX_1', 'https://www.glaukos.com/careers/'], 'posting: "Founded in 1998, Glaukos Corporation is an ophthalmic pharmaceutical and medical technology company"', DATE '2026-10-25'),
  ('emdz~us2~CX_1', 'Rice University', ARRAY['https://emdz.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%226330%22%2CsiteNumber%3DCX_1'], 'posting: "Rice University is committed to ensuring Equal Employment Opportunity"', DATE '2026-10-25'),
  ('fa-exer-saasfaprod1~ocs~CX_1', 'Butler University', ARRAY['https://fa-exer-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%222245%22%2CsiteNumber%3DCX_1'], 'posting: "Butler University is an equal opportunity employer"', DATE '2026-10-25'),
  ('fa-exer-saasfaprod1~ocs~CX_1001', 'Butler University', ARRAY['https://fa-exer-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%222243%22%2CsiteNumber%3DCX_1001'], 'posting: "Butler University is a private, nationally recognized comprehensive university"', DATE '2026-10-25'),
  ('icfcjb~ocs~CX_1', 'Honeywell Aerospace', ARRAY['https://www.honeywellaerospace.com/us/en/company/careers', 'https://icfcjb.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&limit=200', 'https://icfcjb.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%2299123249%22%2CsiteNumber%3DCX_1'], 'employer site "Honeywell Aerospace careers" links sites/Aerospace on this tenant; the feed''s sites carry SeoOrganizationName "Honeywell"; posting: "As a Honeywell Aerospace employee"', DATE '2026-10-25'),
  ('recruiting2~AME1033ABHOW~8819f2ba-041d-48c2-9cfe-c854415f43d2', 'HumanGood', ARRAY['https://recruiting2.ultipro.com/AME1033ABHOW/JobBoard/8819f2ba-041d-48c2-9cfe-c854415f43d2/', 'https://recruiting2.ultipro.com/AME1033ABHOW/JobBoard/8819f2ba-041d-48c2-9cfe-c854415f43d2/OpportunityDetail?opportunityId=2bf3c9c2-f0ce-419c-909f-d49e1aa8087d', 'https://www.humangood.org/humangood-careers'], 'footer "© 2021 HumanGood. Equal opportunity employer"; posting: "at The Terraces of Phoenix , a premier HumanGood Life Plan Community, where your skills and dedica"', DATE '2026-10-25'),
  ('recruiting2~AME1104ANBT~9474d2f8-2ad2-46f8-bbe3-f435f50628bd', 'American National Bank of Texas', ARRAY['https://recruiting2.ultipro.com/AME1104ANBT/JobBoard/9474d2f8-2ad2-46f8-bbe3-f435f50628bd/', 'https://www.anbtx.com/careers/'], 'employer site "Careers | American National Bank of Texas" links this board', DATE '2026-10-25'),
  ('recruiting2~ARC1033ARCHS~ec1bad7b-421b-4c92-bf84-dae0f2173612', 'ARCHER Systems', ARRAY['https://recruiting2.ultipro.com/ARC1033ARCHS/JobBoard/ec1bad7b-421b-4c92-bf84-dae0f2173612/', 'https://recruiting2.ultipro.com/ARC1033ARCHS/JobBoard/ec1bad7b-421b-4c92-bf84-dae0f2173612/OpportunityDetail?opportunityId=a25c12ab-a589-4b45-b5f5-76cab9df3571', 'https://www.archersystems.com/'], 'jobBoard.Name "ARCHER Systems, LLC"; footer "ARCHER Systems, LLC"; posting: "-term disability coverage. ABOUT ARCHER ARCHER Systems is a leading technology-enabled legal services co"', DATE '2026-10-25'),
  ('recruiting2~ART1010AICH~d263cd2b-c4ef-4e10-8876-a2896406a573', 'Art Institute of Chicago', ARRAY['https://recruiting2.ultipro.com/ART1010AICH/JobBoard/d263cd2b-c4ef-4e10-8876-a2896406a573/', 'https://recruiting2.ultipro.com/ART1010AICH/JobBoard/d263cd2b-c4ef-4e10-8876-a2896406a573/OpportunityDetail?opportunityId=b604491d-af8c-49e0-8eac-b0c92a2219eb'], 'jobBoard.Name "Art Institute of Chicago Opportunities"; posting: "more than 150 years, the School of the Art Institute of Chicago (SAIC) has been a leader in educating the world''s"', DATE '2026-10-25'),
  ('recruiting2~ASI1002AAMF~9e5e0e8e-237d-4ca6-91c0-a4f1fdd16163', 'Asian Art Museum', ARRAY['https://recruiting2.ultipro.com/ASI1002AAMF/JobBoard/9e5e0e8e-237d-4ca6-91c0-a4f1fdd16163/', 'https://recruiting2.ultipro.com/ASI1002AAMF/JobBoard/9e5e0e8e-237d-4ca6-91c0-a4f1fdd16163/OpportunityDetail?opportunityId=a4cd4e3e-10dc-489a-a3db-ef1a3fa357d8'], 'jobBoard.Name "Asian Art Museum Opportunities"; posting: "e maintaining quality. Compensation The Asian Art Museum is committed to practicing salary transparency. T"', DATE '2026-10-25'),
  ('recruiting2~AUS1003AUIN~611d5a38-76c4-4f66-a55f-2bc012d98024', 'Austin Industries', ARRAY['https://recruiting2.ultipro.com/AUS1003AUIN/JobBoard/611d5a38-76c4-4f66-a55f-2bc012d98024/', 'https://www.austin-ind.com/careers/careers-at-austin'], 'employer site links this board: "Austin Industries is 100 percent employee-owned"', DATE '2026-10-25'),
  ('recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703', 'Austin Industries', ARRAY['https://recruiting2.ultipro.com/AUS1003AUIN/JobBoard/76c6c58c-a4d3-4a7c-b7a4-8640fc76a703/', 'https://www.austin-ind.com/careers/careers-at-austin'], 'the same UKG tenant (AUS1003AUIN) as the two boards Austin Industries links; its posting names Austin Bridge & Road, an Austin Industries company', DATE '2026-10-25'),
  ('recruiting2~AUS1003AUIN~b8542df4-bc14-47ac-9e01-2eb2423bd205', 'Austin Industries', ARRAY['https://recruiting2.ultipro.com/AUS1003AUIN/JobBoard/b8542df4-bc14-47ac-9e01-2eb2423bd205/', 'https://www.austin-ind.com/careers/careers-at-austin'], 'employer site links this board: "Austin Industries is 100 percent employee-owned"', DATE '2026-10-25'),
  ('recruiting2~CAL1001CALA~46b96419-fba6-4dd0-a5fa-715bdfcf845b', 'Calamos Investments', ARRAY['https://recruiting2.ultipro.com/CAL1001CALA/JobBoard/46b96419-fba6-4dd0-a5fa-715bdfcf845b/', 'http://www.calamos.com'], 'footer "Calamos Investments"', DATE '2026-10-25'),
  ('recruiting2~CKE1000CKER~8d7aeff6-90f7-47bf-9f70-771c5260877f', 'CKE', ARRAY['https://recruiting2.ultipro.com/CKE1000CKER/JobBoard/8d7aeff6-90f7-47bf-9f70-771c5260877f/', 'https://recruiting2.ultipro.com/CKE1000CKER/JobBoard/8d7aeff6-90f7-47bf-9f70-771c5260877f/OpportunityDetail?opportunityId=0b1b2512-a66c-4acc-ad1e-86e06c562d4d'], 'jobBoard.Name "CKE Job Board"; posting: "ission, and Promise while role modeling CKE s Core Values. The RGM ensures compliance w"', DATE '2026-10-25'),
  ('recruiting2~CON1051CONPC~4c5261a3-56a0-4867-9d86-1673f2d804c2', 'Continental Properties', ARRAY['https://recruiting2.ultipro.com/CON1051CONPC/JobBoard/4c5261a3-56a0-4867-9d86-1673f2d804c2/', 'https://recruiting2.ultipro.com/CON1051CONPC/JobBoard/4c5261a3-56a0-4867-9d86-1673f2d804c2/OpportunityDetail?opportunityId=fffaa70c-7f43-4e5e-87aa-6de8b0aff5f4', 'https://www.cproperties.com/you-belong-here'], 'posting: "Continental Properties is looking for a motivated and empowered Service"', DATE '2026-10-25'),
  ('recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d', 'Convergint', ARRAY['https://recruiting2.ultipro.com/CON1074CVTG/JobBoard/1831b61a-1945-44fa-afd8-624795c9b30d/', 'https://recruiting2.ultipro.com/CON1074CVTG/JobBoard/1831b61a-1945-44fa-afd8-624795c9b30d/OpportunityDetail?opportunityId=5a451b2e-d55a-4174-abf5-41e0a940642f', 'https://www.convergint.com/culture/convergint-culture/'], 'jobBoard.Name "Convergint Career Opportunities"; footer "convergint.com/culture"; posting: "Convergint is looking for a full-time, enthusiastic, results"', DATE '2026-10-25'),
  ('recruiting2~GOL1019GDWC~07a2cf6e-052c-4ffa-b81d-99900254b1f5', 'Goldenwest Credit Union', ARRAY['https://recruiting2.ultipro.com/GOL1019GDWC/JobBoard/07a2cf6e-052c-4ffa-b81d-99900254b1f5/', 'https://recruiting2.ultipro.com/GOL1019GDWC/JobBoard/07a2cf6e-052c-4ffa-b81d-99900254b1f5/OpportunityDetail?opportunityId=0bfd3c87-d2fa-41f1-88d4-d17a2b8e193c'], 'posting: "WHO WE ARE Goldenwest Credit Union is a premier non-profit financial cooperative pro"', DATE '2026-10-25'),
  ('recruiting2~HUS1001HUSCH~b6637591-8c8d-49b8-b093-5524b203b157', 'Husch Blackwell', ARRAY['https://recruiting2.ultipro.com/HUS1001HUSCH/JobBoard/b6637591-8c8d-49b8-b093-5524b203b157/', 'https://recruiting2.ultipro.com/HUS1001HUSCH/JobBoard/b6637591-8c8d-49b8-b093-5524b203b157/OpportunityDetail?opportunityId=97e7fce1-a8e9-4eca-929f-1d1c48853f21', 'https://www.huschblackwell.com/careers'], 'jobBoard.Name "Careers at Husch Blackwell"; footer "Husch Blackwell is an equal opportunity employer"; posting: "Husch Blackwell LLP is a full-service litigation and business law"', DATE '2026-10-25'),
  ('recruiting2~KEM1000~4ca2399d-585f-4556-b3a0-94af57ab68ea', 'KemperSports', ARRAY['https://recruiting2.ultipro.com/KEM1000/JobBoard/4ca2399d-585f-4556-b3a0-94af57ab68ea/'], 'jobBoard.Name "KemperSports Opportunities"', DATE '2026-10-25'),
  ('recruiting2~LUB1000LUBT~287e5d40-e2cb-41a7-8c5d-756dc9c5a838', 'Ascentek', ARRAY['https://recruiting2.ultipro.com/LUB1000LUBT/JobBoard/287e5d40-e2cb-41a7-8c5d-756dc9c5a838/', 'https://recruiting2.ultipro.com/LUB1000LUBT/JobBoard/287e5d40-e2cb-41a7-8c5d-756dc9c5a838/OpportunityDetail?opportunityId=930873d1-a5dd-4a72-b15f-9ee1d323749a', 'https://www.ascentek.com/our-story/'], 'jobBoard.Name "Ascentek | Lube-Tech"; posting: "r, our customers, and our communities , Ascentek provides an environment where you can love what y"', DATE '2026-10-25'),
  ('recruiting2~LUB1000LUBT~2dc69741-bb0f-433d-96a9-d7731bfa452a', 'Ascentek', ARRAY['https://recruiting2.ultipro.com/LUB1000LUBT/JobBoard/2dc69741-bb0f-433d-96a9-d7731bfa452a/', 'https://recruiting2.ultipro.com/LUB1000LUBT/JobBoard/2dc69741-bb0f-433d-96a9-d7731bfa452a/OpportunityDetail?opportunityId=930873d1-a5dd-4a72-b15f-9ee1d323749a', 'https://www.ascentek.com/our-story/'], 'posting: "r, our customers, and our communities , Ascentek provides an environment where you can love what y"', DATE '2026-10-25'),
  ('recruiting2~MCF1000~d8a61458-fc16-88c5-cdbe-b242fca9113e', 'McFarland Clinic', ARRAY['https://recruiting2.ultipro.com/MCF1000/JobBoard/d8a61458-fc16-88c5-cdbe-b242fca9113e/', 'https://recruiting2.ultipro.com/MCF1000/JobBoard/d8a61458-fc16-88c5-cdbe-b242fca9113e/OpportunityDetail?opportunityId=e933fc24-1bb0-442b-9d09-3af7601a2669', 'http://www.mcfarlandclinic.com/careers'], 'footer "McFarland Clinic Careers Homepage"; posting: "McFarland Clinic has an opening for an energetic an Ophthalmic Ass"', DATE '2026-10-25'),
  ('recruiting2~MID1025MIDF~de6dc764-d7e7-4ebc-99c5-bb453e31e24b', 'MidFirst Bank', ARRAY['https://recruiting2.ultipro.com/MID1025MIDF/JobBoard/de6dc764-d7e7-4ebc-99c5-bb453e31e24b/', 'https://recruiting2.ultipro.com/MID1025MIDF/JobBoard/de6dc764-d7e7-4ebc-99c5-bb453e31e24b/OpportunityDetail?opportunityId=68d9637e-54cc-420a-aa56-6ec061917b0f', 'https://www.midfirst.com/career-center'], 'posting: "ometimes weighing as much as 25 pounds. MidFirst Banking Center Hours of Operations: Monday - Friday fr"', DATE '2026-10-25'),
  ('recruiting2~MUN1001MCHK~acccd54e-ac6e-44a1-a6d4-8a1f25cceea3', 'Munchkin', ARRAY['https://recruiting2.ultipro.com/MUN1001MCHK/JobBoard/acccd54e-ac6e-44a1-a6d4-8a1f25cceea3/', 'https://recruiting2.ultipro.com/MUN1001MCHK/JobBoard/acccd54e-ac6e-44a1-a6d4-8a1f25cceea3/OpportunityDetail?opportunityId=f3d7dbcb-69e9-4392-8b53-86dbaa979a3c'], 'posting: "Who We Are Munchkin is one of the most innovative and fast-growing co"', DATE '2026-10-25'),
  ('recruiting2~PAP1001~7297d137-c573-4bf4-8ab4-09ad7dac6ec8', 'Papé', ARRAY['https://recruiting2.ultipro.com/PAP1001/JobBoard/7297d137-c573-4bf4-8ab4-09ad7dac6ec8/', 'https://recruiting2.ultipro.com/PAP1001/JobBoard/7297d137-c573-4bf4-8ab4-09ad7dac6ec8/OpportunityDetail?opportunityId=37607c2d-0d36-43a8-b1aa-7d8418909865', 'https://www.pape.com/careers'], 'jobBoard.Name "Papé Jobs"; footer "https://www.pape.com/careers"; posting: "PAPE'' KENWORTH ANDERSON, CA JOURNEYMAN TRUCK T"', DATE '2026-10-25'),
  ('recruiting2~RES1015RPLLC~dc0817a6-b35b-4938-ae2a-d5d14087e134', 'RESA Power', ARRAY['https://recruiting2.ultipro.com/RES1015RPLLC/JobBoard/dc0817a6-b35b-4938-ae2a-d5d14087e134/', 'https://recruiting2.ultipro.com/RES1015RPLLC/JobBoard/dc0817a6-b35b-4938-ae2a-d5d14087e134/OpportunityDetail?opportunityId=79fba0e1-8cbe-4f8e-847d-eb8a0d98cf27', 'http://www.resapower.com'], 'posting: "mplete on-site job reports. Who we are! RESA Power is a dynamic, people first organization that prid"', DATE '2026-10-25'),
  ('recruiting2~SAP1000SPID~5e557a61-9707-4f47-8f76-9c11b2bfbf9e', 'Smart City Networks', ARRAY['https://recruiting2.ultipro.com/SAP1000SPID/JobBoard/5e557a61-9707-4f47-8f76-9c11b2bfbf9e/', 'https://recruiting2.ultipro.com/SAP1000SPID/JobBoard/5e557a61-9707-4f47-8f76-9c11b2bfbf9e/OpportunityDetail?opportunityId=7fcc47dd-9883-4dc9-b00f-e47882772cca', 'https://smartcitynetworks.com/'], 'jobBoard.Name "Smart City Networks Career Opportunities"; posting: "cess for new employees, employment with Smart City Networks will be contingent upon successful completion of"', DATE '2026-10-25'),
  ('recruiting2~STA1013~94aec289-5757-a8f0-d3bb-77f9cd846172', 'Minnesota Star Tribune', ARRAY['https://recruiting2.ultipro.com/STA1013/JobBoard/94aec289-5757-a8f0-d3bb-77f9cd846172/', 'https://recruiting2.ultipro.com/STA1013/JobBoard/94aec289-5757-a8f0-d3bb-77f9cd846172/OpportunityDetail?opportunityId=a4727699-dc3b-4719-b108-be0fb624c4a1', 'http://www.startribunecompany.com/learn-about-us/'], 'posting: "The Minnesota Star Tribune is an innovative modern media organization buildi"', DATE '2026-10-25'),
  ('recruiting2~SUN1000SUNCO~5882c1c5-18e3-8740-5e61-37d8f7574d64', 'Sun Country Airlines', ARRAY['https://recruiting2.ultipro.com/SUN1000SUNCO/JobBoard/5882c1c5-18e3-8740-5e61-37d8f7574d64/', 'https://recruiting2.ultipro.com/SUN1000SUNCO/JobBoard/5882c1c5-18e3-8740-5e61-37d8f7574d64/OpportunityDetail?opportunityId=99551a4c-016e-487f-85bd-46d67f48316f', 'https://ir.suncountry.com/about'], 'posting: "About Sun Country Airlines We''re not your average airline. We''re agile, resi"', DATE '2026-10-25'),
  ('recruiting~AHF1000AHFP~eb870e08-1b72-44d8-a4c4-d8b21f6f9297', 'AHF Products', ARRAY['https://recruiting.ultipro.com/AHF1000AHFP/JobBoard/eb870e08-1b72-44d8-a4c4-d8b21f6f9297/', 'https://recruiting.ultipro.com/AHF1000AHFP/JobBoard/eb870e08-1b72-44d8-a4c4-d8b21f6f9297/OpportunityDetail?opportunityId=e0eac7f3-d616-4dd6-9fc6-2c2e30aa4641', 'https://www.ahfproducts.com/en-us/careers.html'], 'posting: "ENEFITS: Medical, Dental, Vision, 401K AHF Products has a job opportunity for a Branch Manager to be"', DATE '2026-10-25'),
  ('recruiting~AME1068~34b788f5-e07e-3fb3-8e73-08c36602a07b', 'AFSC', ARRAY['https://recruiting.ultipro.com/AME1068/JobBoard/34b788f5-e07e-3fb3-8e73-08c36602a07b/', 'https://recruiting.ultipro.com/AME1068/JobBoard/34b788f5-e07e-3fb3-8e73-08c36602a07b/OpportunityDetail?opportunityId=85ad063c-2b1a-4929-af63-ee86447f928c', 'https://www.afsc.org/job-center'], 'footer "https://www.afsc.org/job-center"; posting: "Questions. GENERAL SUMMARY OF POSITION AFSC''s Atlanta Economic Justice Program is hiring a Co"', DATE '2026-10-25'),
  ('recruiting~AME1101AMRI~f0aaafcc-5031-43d3-b658-e19a8bac98ee', 'American Commercial Barge Line', ARRAY['https://recruiting.ultipro.com/AME1101AMRI/JobBoard/f0aaafcc-5031-43d3-b658-e19a8bac98ee/', 'https://recruiting.ultipro.com/AME1101AMRI/JobBoard/f0aaafcc-5031-43d3-b658-e19a8bac98ee/OpportunityDetail?opportunityId=ad56f787-7d21-4a66-a527-b72deb95f624', 'http://bargeacbl.com/'], 'posting: "Job Title: Marine Mechanic Company: American Commercial Barge Line Location: Harahan or Port Allen, LA Job Type: Ful"', DATE '2026-10-25'),
  ('recruiting~AMG1002AMGC~f40ecd9c-1926-422b-82bf-5d5df3c0ad54', 'AM General', ARRAY['https://recruiting.ultipro.com/AMG1002AMGC/JobBoard/f40ecd9c-1926-422b-82bf-5d5df3c0ad54/', 'https://recruiting.ultipro.com/AMG1002AMGC/JobBoard/f40ecd9c-1926-422b-82bf-5d5df3c0ad54/OpportunityDetail?opportunityId=afd76557-095d-4cfd-beb9-fc4ae2cad965', 'https://www.amgeneral.com/who-we-are/'], 'jobBoard.Name "AM General Job Board"; posting: "aterials $19.63 New Hire Quality $19.63 AM General is hiring Production Employees to support our HMW"', DATE '2026-10-25'),
  ('recruiting~ANA1003ALOG~a4de26ba-aa2d-4502-9d0f-577ea07dc7ca', 'Analogic', ARRAY['https://recruiting.ultipro.com/ANA1003ALOG/JobBoard/a4de26ba-aa2d-4502-9d0f-577ea07dc7ca/'], 'jobBoard.Name "Analogic Jobs"', DATE '2026-10-25'),
  ('recruiting~BYR1000BYRNE~d5855859-9eae-dd60-5965-11eeffbec7a1', 'Byrne Electrical Specialists', ARRAY['https://recruiting.ultipro.com/BYR1000BYRNE/JobBoard/d5855859-9eae-dd60-5965-11eeffbec7a1/', 'https://recruiting.ultipro.com/BYR1000BYRNE/JobBoard/d5855859-9eae-dd60-5965-11eeffbec7a1/OpportunityDetail?opportunityId=bffe5038-f4b1-4401-adc3-c570684207c7'], 'posting: "ng, typing and lifting up to 77 pounds. BYRNE ELECTRICAL SPECIALISTS is an equal opportunity employer."', DATE '2026-10-25'),
  ('recruiting~COM1052~2e5d0965-0540-a0b3-7480-d7e4ddca0af6', 'CommuniCare Health Centers', ARRAY['https://recruiting.ultipro.com/COM1052/JobBoard/2e5d0965-0540-a0b3-7480-d7e4ddca0af6/', 'http://communicaresa.org', 'http://communicaresa.org/'], 'jobBoard.Name "CommuniCare Health Center Jobs"; the footer site communicaresa.org calls itself "CommuniCare Health Centers"', DATE '2026-10-25'),
  ('recruiting~ENV1004ERLL~01ddc4d3-605b-44e6-9b43-4abf0d1399b1', 'Envision Radiology', ARRAY['https://recruiting.ultipro.com/ENV1004ERLL/JobBoard/01ddc4d3-605b-44e6-9b43-4abf0d1399b1/', 'https://recruiting.ultipro.com/ENV1004ERLL/JobBoard/01ddc4d3-605b-44e6-9b43-4abf0d1399b1/OpportunityDetail?opportunityId=036e6271-cd1b-4d7f-9800-d088e128bd30'], 'jobBoard.Name "Envision Radiology Careers"; posting: "her potentially infectious body fluids. Envision Radiology is an equal opportunity employer (M/F/D/V). We re"', DATE '2026-10-25'),
  ('recruiting~EOS1000EOSI~1170f284-cf46-4ff7-b32f-76e224e7a2d4', 'EOS Hospitality', ARRAY['https://recruiting.ultipro.com/EOS1000EOSI/JobBoard/1170f284-cf46-4ff7-b32f-76e224e7a2d4/', 'http://www.EOSHospitality.com'], 'jobBoard.Name "All Opportunities at EOS"; footer link and text http://www.EOSHospitality.com', DATE '2026-10-25'),
  ('recruiting~EPR1000EPSUS~10653576-f6a1-4d69-8a9c-a0a96124abda', 'CAI Software', ARRAY['https://recruiting.ultipro.com/EPR1000EPSUS/JobBoard/10653576-f6a1-4d69-8a9c-a0a96124abda/', 'https://recruiting.ultipro.com/EPR1000EPSUS/JobBoard/10653576-f6a1-4d69-8a9c-a0a96124abda/OpportunityDetail?opportunityId=a8622e7b-6128-484c-a619-7ab92102c55b', 'https://caisoft.com/about/'], 'posting: "Developer Accelerate Performance. About CAI Software CAI Software builds purpose-built solutions that"', DATE '2026-10-25'),
  ('recruiting~EUL1000EULEN~7f63c405-6579-4eb2-954a-482585dd4149', 'Grupo Eulen USA', ARRAY['https://recruiting.ultipro.com/EUL1000EULEN/JobBoard/7f63c405-6579-4eb2-954a-482585dd4149/', 'https://www.eulen.com/us/'], 'footer "Grupo Eulen USA, Aviation Services"', DATE '2026-10-25'),
  ('recruiting~FAR1008FNBC~2ed885d0-15e6-4548-ac9c-d5c9607e02d7', 'Farmers National Banc Corp.', ARRAY['https://recruiting.ultipro.com/FAR1008FNBC/JobBoard/2ed885d0-15e6-4548-ac9c-d5c9607e02d7/', 'https://recruiting.ultipro.com/FAR1008FNBC/JobBoard/2ed885d0-15e6-4548-ac9c-d5c9607e02d7/OpportunityDetail?opportunityId=de538f21-5ea0-4beb-9be6-040bed689793', 'https://farmersbankgroup.com/about-farmers-national-bank.html'], 'footer "About Farmers National Banc Corp."; posting: "igibility of all newly hired employees. Farmers National Banc Corp. is an Equal Opportunity Employer: disability/vete"', DATE '2026-10-25'),
  ('recruiting~GEN1025~37481dc2-ddb2-1941-a0f9-befbbf45ab11', 'Genesee & Wyoming', ARRAY['https://recruiting.ultipro.com/GEN1025/JobBoard/37481dc2-ddb2-1941-a0f9-befbbf45ab11/', 'https://recruiting.ultipro.com/GEN1025/JobBoard/37481dc2-ddb2-1941-a0f9-befbbf45ab11/OpportunityDetail?opportunityId=6f253f8f-daae-4b99-b383-d5307d257989', 'https://www.gwrr.com/about'], 'posting: "reer in the railroad industry? Join the Genesee & Wyoming Inc. (G&W) team part of a legacy that is"', DATE '2026-10-25'),
  ('recruiting~GRA1010GRAY~8d18afb5-245e-4c7e-a198-6a682201a90e', 'GrayRobinson', ARRAY['https://recruiting.ultipro.com/GRA1010GRAY/JobBoard/8d18afb5-245e-4c7e-a198-6a682201a90e/', 'https://recruiting.ultipro.com/GRA1010GRAY/JobBoard/8d18afb5-245e-4c7e-a198-6a682201a90e/OpportunityDetail?opportunityId=d210a8e8-28b4-4909-abec-f20bad383f4f', 'https://www.gray-robinson.com/'], 'posting: "GrayRobinson, a full-service law and government consulting fir"', DATE '2026-10-25'),
  ('recruiting~GUA1000GACM~14ab0bd3-29ec-43fc-ba76-27a9beaf97f5', 'Guardian Alarm', ARRAY['https://recruiting.ultipro.com/GUA1000GACM/JobBoard/14ab0bd3-29ec-43fc-ba76-27a9beaf97f5/', 'https://recruiting.ultipro.com/GUA1000GACM/JobBoard/14ab0bd3-29ec-43fc-ba76-27a9beaf97f5/OpportunityDetail?opportunityId=719049c2-b8f1-46ad-88ab-37fd5abaeb0c', 'https://guardianalarm.com'], 'footer "Guardian Alarm"; posting: "ated business applications that support Guardian Alarm''s operations and customer experience. This role w"', DATE '2026-10-25'),
  ('recruiting~HIL1004~783ada32-210a-ecf9-eab4-00a5ed980db3', 'Hilltop Community Resources', ARRAY['https://recruiting.ultipro.com/HIL1004/JobBoard/783ada32-210a-ecf9-eab4-00a5ed980db3/', 'https://recruiting.ultipro.com/HIL1004/JobBoard/783ada32-210a-ecf9-eab4-00a5ed980db3/OpportunityDetail?opportunityId=1095f0df-5151-467e-af6d-28c9b5df1ef1', 'https://www.htop.org/careers/'], 'posting: "sivity, Growth, and Fun. Who We Are: At Hilltop Community Resources, we are more than a multi-faceted non-profit orga"', DATE '2026-10-25'),
  ('recruiting~IFL1000IFLY~1cbe2e6c-5bff-312c-9bbb-ac39038cb6bb', 'iFLY', ARRAY['https://recruiting.ultipro.com/IFL1000IFLY/JobBoard/1cbe2e6c-5bff-312c-9bbb-ac39038cb6bb/', 'https://recruiting.ultipro.com/IFL1000IFLY/JobBoard/1cbe2e6c-5bff-312c-9bbb-ac39038cb6bb/OpportunityDetail?opportunityId=3799547f-356c-44c9-a5ff-c193fd216245', 'https://www.iflyworld.com/ccpa/applicant-notice/'], 'jobBoard.Name "iFLY Careers"; footer "iFLY California Applicant Privacy Notice"; posting: "e candidates regardless of location. At iFLY, our mission is to deliver the dream of flight to"', DATE '2026-10-25'),
  ('recruiting~JAC1008JACAM2~78f93132-0f92-4d96-92fd-6bc9a0e91b52', 'JACAM Catalyst', ARRAY['https://recruiting.ultipro.com/JAC1008JACAM2/JobBoard/78f93132-0f92-4d96-92fd-6bc9a0e91b52/', 'http://www.jacamcatalyst.com'], 'board banner "JACAM CATALYST CAREERS"; footer link jacamcatalyst.com; posting: "Jacam Chemical Company 2013, LLC"', DATE '2026-10-25'),
  ('recruiting~KIL1000~68c62bcb-20f8-3231-d728-9190572df832', 'Kilpatrick Townsend & Stockton', ARRAY['https://recruiting.ultipro.com/KIL1000/JobBoard/68c62bcb-20f8-3231-d728-9190572df832/', 'https://recruiting.ultipro.com/KIL1000/JobBoard/68c62bcb-20f8-3231-d728-9190572df832/OpportunityDetail?opportunityId=03e86739-69a8-4099-90a4-e379e19f20e5', 'http://www.ktslaw.com/en/AboutUs'], 'posting: "e visit our website at www.ktslaw.com . Kilpatrick Townsend & Stockton LLP is committed to equal employment opportunity"', DATE '2026-10-25'),
  ('recruiting~LUM1000NWL~c00e73a9-0a5f-4082-8257-fcddd1029261', 'Nemacolin', ARRAY['https://recruiting.ultipro.com/LUM1000NWL/JobBoard/c00e73a9-0a5f-4082-8257-fcddd1029261/', 'https://recruiting.ultipro.com/LUM1000NWL/JobBoard/c00e73a9-0a5f-4082-8257-fcddd1029261/OpportunityDetail?opportunityId=1416d4a3-4d68-4831-a526-961d3712860e', 'http://www.nemacolin.com'], 'jobBoard.Name "Nemacolin Career Opportunities"; footer "http://www.nemacolin.com"; posting: "required. Begin a Meaningful Career at Nemacolin At Nemacolin resort in Pennsylvania''s Laurel High"', DATE '2026-10-25'),
  ('recruiting~MAR1033MBL~4c3007c3-6354-41de-a13f-d95be60d91e9', 'MBL', ARRAY['https://recruiting.ultipro.com/MAR1033MBL/JobBoard/4c3007c3-6354-41de-a13f-d95be60d91e9/', 'https://recruiting.ultipro.com/MAR1033MBL/JobBoard/4c3007c3-6354-41de-a13f-d95be60d91e9/OpportunityDetail?opportunityId=cffd871e-2553-499f-8f50-385d95700863', 'https://www.mbl.edu/about/careers-internships'], 'jobBoard.Name "MBL"; footer "https://www.mbl.edu/about/careers-internships"; posting: "ly and respectfully with members of the MBL campus community, students and faculty. 5. Respon"', DATE '2026-10-25'),
  ('recruiting~MEL1004MHTC~fbc00c76-0292-40eb-b052-02b511393eac', 'Melwood', ARRAY['https://recruiting.ultipro.com/MEL1004MHTC/JobBoard/fbc00c76-0292-40eb-b052-02b511393eac/'], 'jobBoard.Name "Melwood Community Services"', DATE '2026-10-25'),
  ('recruiting~MER1020MERZ~84f5dbc2-c467-5a9e-3a37-6174c98926eb', 'Merz North America', ARRAY['https://recruiting.ultipro.com/MER1020MERZ/JobBoard/84f5dbc2-c467-5a9e-3a37-6174c98926eb/', 'http://www.merzusa.com/'], 'jobBoard.Name "Career Opportunities at Merz North America"', DATE '2026-10-25'),
  ('recruiting~MER1020MERZ~a6b53edd-7e9e-4bfb-bd93-0f6a6f0f275d', 'Merz Aesthetics', ARRAY['https://recruiting.ultipro.com/MER1020MERZ/JobBoard/a6b53edd-7e9e-4bfb-bd93-0f6a6f0f275d/', 'https://recruiting.ultipro.com/MER1020MERZ/JobBoard/a6b53edd-7e9e-4bfb-bd93-0f6a6f0f275d/OpportunityDetail?opportunityId=32a513e1-ebf2-4d99-8ef8-8e30ff6d9108', 'http://www.merzusa.com/'], 'jobBoard.Name "Merz Aesthetics, Anteis - Career Opportunities"; posting: "Live your best life with Merz Aesthetics"; posting: "king a living. Live your best life with Merz Aesthetics. A Brief Overview The Global Quality Operations M"', DATE '2026-10-25'),
  ('recruiting~MES1002MESSD~888390fa-f9e8-4b6f-9977-7e3a214369f0', 'Meso Scale Diagnostics', ARRAY['https://recruiting.ultipro.com/MES1002MESSD/JobBoard/888390fa-f9e8-4b6f-9977-7e3a214369f0/', 'https://recruiting.ultipro.com/MES1002MESSD/JobBoard/888390fa-f9e8-4b6f-9977-7e3a214369f0/OpportunityDetail?opportunityId=ed446765-6887-452b-9894-4749b4196add', 'https://www.mesoscale.com/en/technical_resources/our_technology'], 'posting: "qual_employment_opportunity_statement . Meso Scale Diagnostics uses E-Verify to validate the work eligibility of"', DATE '2026-10-25'),
  ('recruiting~MES1005MESR~dbd63926-d756-486f-a254-b2a6ede1d26e', 'Messer', ARRAY['https://recruiting.ultipro.com/MES1005MESR/JobBoard/dbd63926-d756-486f-a254-b2a6ede1d26e/', 'https://recruiting.ultipro.com/MES1005MESR/JobBoard/dbd63926-d756-486f-a254-b2a6ede1d26e/OpportunityDetail?opportunityId=ba8c9d5b-fc32-4a94-aabd-f847891693fa'], 'posting: "About Messer Messer is the largest privately held industrial g"', DATE '2026-10-25'),
  ('recruiting~MES1005MESR~fa3fc0aa-75f1-4eac-9152-b4e8b8cbe849', 'Messer', ARRAY['https://recruiting.ultipro.com/MES1005MESR/JobBoard/fa3fc0aa-75f1-4eac-9152-b4e8b8cbe849/', 'https://recruiting.ultipro.com/MES1005MESR/JobBoard/fa3fc0aa-75f1-4eac-9152-b4e8b8cbe849/OpportunityDetail?opportunityId=1a1742a5-21ba-49a1-ba69-d2b033098cb9', 'https://www.messer-us.com/careers'], 'footer "Messer Careers"; posting: "to ensure continuous product supply to Messer NA customers. Typical location will make and deli"', DATE '2026-10-25'),
  ('recruiting~MIC1003MEI~e3674ed3-2699-442b-aa28-c0b8436281b9', 'Micro Center', ARRAY['https://recruiting.ultipro.com/MIC1003MEI/JobBoard/e3674ed3-2699-442b-aa28-c0b8436281b9/', 'https://recruiting.ultipro.com/MIC1003MEI/JobBoard/e3674ed3-2699-442b-aa28-c0b8436281b9/OpportunityDetail?opportunityId=78c921f7-a1cb-480e-b7cc-9f7443ad6328'], 'posting: "MICRO CENTER is the nation''s leading computer and electronic d"', DATE '2026-10-25'),
  ('recruiting~MIC1008MICPT~9f087488-7494-c18e-5713-c97b9f3d8219', 'MicroPort', ARRAY['https://recruiting.ultipro.com/MIC1008MICPT/JobBoard/9f087488-7494-c18e-5713-c97b9f3d8219/', 'https://recruiting.ultipro.com/MIC1008MICPT/JobBoard/9f087488-7494-c18e-5713-c97b9f3d8219/OpportunityDetail?opportunityId=5a8c8203-ba8a-4704-8e1b-4ae556b35de1', 'http://www.ortho.microport.com/index.cfm/corporate/about-us/who-we-are1/'], 'posting: "to check your email for follow-ups. At MicroPort, we relentlessly strive to master every detail of"', DATE '2026-10-25'),
  ('recruiting~MID1029MISO~362b6b1d-f1c3-46f5-9554-4aa90e2bda64', 'MISO', ARRAY['https://recruiting.ultipro.com/MID1029MISO/JobBoard/362b6b1d-f1c3-46f5-9554-4aa90e2bda64/', 'https://recruiting.ultipro.com/MID1029MISO/JobBoard/362b6b1d-f1c3-46f5-9554-4aa90e2bda64/OpportunityDetail?opportunityId=82cbb2c8-1da7-45d9-934f-b946b73a87b2', 'http://www.misoenergy.org/meet-miso/careers/'], 'posting: "ance and company objectives are met. At MISO we offer a comprehensive benefits package, includ"', DATE '2026-10-25'),
  ('recruiting~MIM1000MMEDX~1d9bee39-4128-4512-aa23-005f0e124469', 'MIMEDX', ARRAY['https://recruiting.ultipro.com/MIM1000MMEDX/JobBoard/1d9bee39-4128-4512-aa23-005f0e124469/', 'https://recruiting.ultipro.com/MIM1000MMEDX/JobBoard/1d9bee39-4128-4512-aa23-005f0e124469/OpportunityDetail?opportunityId=c98fa2b5-adbc-44e0-81dd-23005f0c203c'], 'jobBoard.Name "MIMEDX Careers"; posting: "At MIMEDX , our purpose starts with helping humans heal. We"', DATE '2026-10-25'),
  ('recruiting~MOD1003MWA~8990acfc-04f3-d65f-0565-a772e1a0157b', 'Modern Woodmen of America', ARRAY['https://recruiting.ultipro.com/MOD1003MWA/JobBoard/8990acfc-04f3-d65f-0565-a772e1a0157b/', 'https://recruiting.ultipro.com/MOD1003MWA/JobBoard/8990acfc-04f3-d65f-0565-a772e1a0157b/OpportunityDetail?opportunityId=57e870dd-2c25-4aa8-a1f6-fbd0e337438b', 'http://www.modernwoodmen.org'], 'posting: "tomer service make a meaningful impact? Modern Woodmen of America is looking for a proactive and organized individu"', DATE '2026-10-25'),
  ('recruiting~ORA1000OLCC~17560d62-b19a-4c09-9909-fe2b9c713df3', 'Holiday Inn Club Vacations', ARRAY['https://recruiting.ultipro.com/ORA1000OLCC/JobBoard/17560d62-b19a-4c09-9909-fe2b9c713df3/', 'https://recruiting.ultipro.com/ORA1000OLCC/JobBoard/17560d62-b19a-4c09-9909-fe2b9c713df3/OpportunityDetail?opportunityId=cccb1800-3964-412f-9d60-6585af209fc6'], 'posting: "ense of at least 3 years is required At Holiday Inn Club Vacations, we believe in strengthening families. And we loo"', DATE '2026-10-25'),
  ('recruiting~PAR1026PARS~b9883763-2d52-4511-a00a-57166395312c', 'Paradies Lagardère', ARRAY['https://recruiting.ultipro.com/PAR1026PARS/JobBoard/b9883763-2d52-4511-a00a-57166395312c/', 'http://paradieslagardere.com/'], 'footer "Learn more about Paradies Lagardère"', DATE '2026-10-25'),
  ('recruiting~PEN1019PMOI~9c2e3b43-1929-4405-b387-470097c98b4a', 'Penn-Mar Human Services', ARRAY['https://recruiting.ultipro.com/PEN1019PMOI/JobBoard/9c2e3b43-1929-4405-b387-470097c98b4a/', 'https://recruiting.ultipro.com/PEN1019PMOI/JobBoard/9c2e3b43-1929-4405-b387-470097c98b4a/OpportunityDetail?opportunityId=8e3a0590-e1b3-4ff0-a43b-c6afb68b47b4', 'https://www.penn-mar.org/join-our-team/'], 'posting: "Lasting Impact Through People Strategy Penn-Mar Human Services is seeking a strategic, collaborative Chief Human"', DATE '2026-10-25'),
  ('recruiting~PGW1000PAUT~f1df8566-65d8-4efe-8046-4e96e46eeadf', 'PGW Auto Glass', ARRAY['https://recruiting.ultipro.com/PGW1000PAUT/JobBoard/f1df8566-65d8-4efe-8046-4e96e46eeadf/', 'https://recruiting.ultipro.com/PGW1000PAUT/JobBoard/f1df8566-65d8-4efe-8046-4e96e46eeadf/OpportunityDetail?opportunityId=2ccbe394-9513-4ead-99e0-c0a349e0a9bc'], 'jobBoard.Name "PGW Auto Glass"; posting: "As a part of our growth, PGW Auto Glass, a leader in the Auto Glass industry with over 10"', DATE '2026-10-25'),
  ('recruiting~POL1006~c0e3f015-388f-2bf6-e3ac-af081fcad685', 'PM Hotel Group', ARRAY['https://recruiting.ultipro.com/POL1006/JobBoard/c0e3f015-388f-2bf6-e3ac-af081fcad685/', 'https://recruiting.ultipro.com/POL1006/JobBoard/c0e3f015-388f-2bf6-e3ac-af081fcad685/OpportunityDetail?opportunityId=0eff55c1-e1d8-4f48-8ee4-1f884bea21ed', 'https://pmhotelgroup.com/'], 'posting: "er characteristic not related. Modus by PM Hotel Group will not discharge or in any other manner discrim"', DATE '2026-10-25'),
  ('recruiting~QSA1000QSAC~d1dee834-9977-44db-8afd-d97fd6e60e44', 'QSAC', ARRAY['https://recruiting.ultipro.com/QSA1000QSAC/JobBoard/d1dee834-9977-44db-8afd-d97fd6e60e44/', 'https://recruiting.ultipro.com/QSA1000QSAC/JobBoard/d1dee834-9977-44db-8afd-d97fd6e60e44/OpportunityDetail?opportunityId=d45e8462-4074-4abc-b5aa-7e5067c6dc38', 'http://www.qsac.com'], 'jobBoard.Name "QSAC Careers"; posting: "tion are M-F 8:00 - 3:30 pm Job Summary QSAC is seeking dedicated and energetic full time 1:1"', DATE '2026-10-25'),
  ('recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522', 'Axia Women''s Health', ARRAY['https://recruiting.ultipro.com/REG1001RWHM/JobBoard/3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/', 'https://recruiting.ultipro.com/REG1001RWHM/JobBoard/3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/OpportunityDetail?opportunityId=7deb6d1c-ad1f-4dd0-9576-531649c8b45c', 'http://www.axiawh.com', 'https://axiawh.com/careers/'], 'jobBoard.Name "Axia Women''s Health"; employer site "Careers - Axia Women''s Health" links this board; posting: "Axia Women''s Health is the nation''s largest community-based, integrat"', DATE '2026-10-25'),
  ('recruiting~SAV1002STCF~7d92e82b-af74-464d-859b-c5b8cba6e92e', 'Save the Children', ARRAY['https://recruiting.ultipro.com/SAV1002STCF/JobBoard/7d92e82b-af74-464d-859b-c5b8cba6e92e/', 'https://recruiting.ultipro.com/SAV1002STCF/JobBoard/7d92e82b-af74-464d-859b-c5b8cba6e92e/OpportunityDetail?opportunityId=03536636-ed82-4af0-b5f4-eb63ca69aaf2', 'https://www.savethechildren.org/us/about-us/privacy-policy'], 'posting: "ion Division: Head Start, U.S. Programs Save the Children For over 100 years, Save the Children has been fi"', DATE '2026-10-25'),
  ('recruiting~SEA1007SEACO~7851737e-66c7-908f-77e9-6d69f4eb0ead', 'Seacoast Bank', ARRAY['https://recruiting.ultipro.com/SEA1007SEACO/JobBoard/7851737e-66c7-908f-77e9-6d69f4eb0ead/', 'https://recruiting.ultipro.com/SEA1007SEACO/JobBoard/7851737e-66c7-908f-77e9-6d69f4eb0ead/OpportunityDetail?opportunityId=172628d6-f2a2-4126-bf1a-ff86a6b08899', 'https://seacoastbank.com'], 'jobBoard.Name "Seacoast Bank Careers"; footer "Seacoast Bank"; posting: "ributor who will help shape and advance Seacoast Bank''s enterprise credit risk management capabilities."', DATE '2026-10-25'),
  ('recruiting~SER1005SEIU~e131b2ae-a5ce-4fb1-a93c-84c36a485721', 'SEIU', ARRAY['https://recruiting.ultipro.com/SER1005SEIU/JobBoard/e131b2ae-a5ce-4fb1-a93c-84c36a485721/', 'https://recruiting.ultipro.com/SER1005SEIU/JobBoard/e131b2ae-a5ce-4fb1-a93c-84c36a485721/OpportunityDetail?opportunityId=ab759b49-40fc-4714-921a-20f4369e59cc'], 'jobBoard.Name "Current SEIU Opportunities"; posting: "SEIU (Service Employees International Union) JOB TITLE"', DATE '2026-10-25'),
  ('recruiting~WEI1003~0e982683-539b-1a76-d39a-221637b5ef2e', 'Weiler', ARRAY['https://recruiting.ultipro.com/WEI1003/JobBoard/0e982683-539b-1a76-d39a-221637b5ef2e/', 'https://recruiting.ultipro.com/WEI1003/JobBoard/0e982683-539b-1a76-d39a-221637b5ef2e/OpportunityDetail?opportunityId=766e816a-70db-49eb-9827-6f54c78a334a', 'https://www.weilercorp.com'], 'jobBoard.Name "Weiler Career Opportunities"; posting: "upkeep, and building maintenance of the Weiler facilities and grounds. This job requires a stron"', DATE '2026-10-25'),
  ('recruiting~WEL1008WLLT~30969ce4-3b7e-40a6-b86c-34d3616fe0ed', 'Welltower', ARRAY['https://recruiting.ultipro.com/WEL1008WLLT/JobBoard/30969ce4-3b7e-40a6-b86c-34d3616fe0ed/', 'https://recruiting.ultipro.com/WEL1008WLLT/JobBoard/30969ce4-3b7e-40a6-b86c-34d3616fe0ed/OpportunityDetail?opportunityId=53d92c66-4a20-4aab-b3b0-d77c67603f48'], 'jobBoard.Name "Welltower Inc. Careers"; posting: "WELLTOWER - REIMAGINE REAL ESTATE WITH US At Welltower, we''"', DATE '2026-10-25'),
  ('recruiting~WES1010~9ca96e8c-accb-8dab-a29c-32c8da6f8d67', 'Westminster Communities of Florida', ARRAY['https://recruiting.ultipro.com/WES1010/JobBoard/9ca96e8c-accb-8dab-a29c-32c8da6f8d67/', 'https://recruiting.ultipro.com/WES1010/JobBoard/9ca96e8c-accb-8dab-a29c-32c8da6f8d67/OpportunityDetail?opportunityId=75b5fb15-c6bd-424e-aa86-1fb21936f06c', 'http://www.westminsterretirement.com/'], 'footer "©2004-2018 Westminster Communities of Florida"; posting: "Westminster Communities of Florida is a national leader in senior living and dedicat"', DATE '2026-10-25'),
  ('recruiting~WES1010~dc686796-57ca-4fa7-a2d7-68f4e5612bd8', 'Westminster Communities of Florida', ARRAY['https://recruiting.ultipro.com/WES1010/JobBoard/dc686796-57ca-4fa7-a2d7-68f4e5612bd8/', 'https://recruiting.ultipro.com/WES1010/JobBoard/dc686796-57ca-4fa7-a2d7-68f4e5612bd8/OpportunityDetail?opportunityId=75b5fb15-c6bd-424e-aa86-1fb21936f06c', 'http://www.westminsterretirement.com/'], 'footer "©2004-2018 Westminster Communities of Florida"; posting: "Westminster Communities of Florida is a national leader in senior living and dedicat"', DATE '2026-10-25'),
  ('recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46', 'Banner Engineering', ARRAY['https://recruiting.ultipro.com/ban1010/JobBoard/e9066a66-c3b9-e25c-d036-116705c05e46/', 'https://recruiting.ultipro.com/ban1010/JobBoard/e9066a66-c3b9-e25c-d036-116705c05e46/OpportunityDetail?opportunityId=0310a87e-6047-4b21-8798-d343dfaf8361', 'https://www.bannerengineering.com/us/en/company/careers.html'], 'jobBoard.Name "Banner Engineering Career Opportunities"; posting: "Why Work at Banner? For over 50 years, Banner Engineering has been at the forefront of industrial automatio"', DATE '2026-10-25'),
  ('recruiting~map1002mapmg~9c5b2d47-fac0-4e56-9f06-b9cc2013276d', 'Mid-Atlantic Permanente Medical Group', ARRAY['https://recruiting.ultipro.com/map1002mapmg/JobBoard/9c5b2d47-fac0-4e56-9f06-b9cc2013276d/', 'https://recruiting.ultipro.com/map1002mapmg/JobBoard/9c5b2d47-fac0-4e56-9f06-b9cc2013276d/OpportunityDetail?opportunityId=cb2dbf31-148f-4f4f-a2ec-04274bdba860'], 'posting: "The Mid-Atlantic Permanente Medical Group (MAPMG) is a leading group of over 1,800 physicia"', DATE '2026-10-25')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, evidence = EXCLUDED.evidence, quote = EXCLUDED.quote, read_on = EXCLUDED.read_on;

-- SELF-CHECK. Raises, and so rolls every statement above back, unless:
--   1. every evidence row this file writes names the same employer as its
--      override, and carries at least one http(s) link and the words read;
--   2. the batch is whole (88 rows) and names no board the trigger cannot
--      reach (a token without a "~");
--   3. neither pooled Oracle board took a name;
--   4. no client role holds a privilege on the evidence, row level security
--      is on, and the service role can read it;
--   5. the trigger that names every write is still on job_board_postings,
--      where that table exists.
DO $$
DECLARE
  n int;
  bad text;
BEGIN
  SELECT count(*) INTO n FROM public.company_name_evidence WHERE read_on = DATE '2026-10-25';
  IF n < 88 THEN
    RAISE EXCEPTION 'self-check 20261025100000: % evidence row(s) dated 2026-10-25, want 88', n;
  END IF;
  SELECT string_agg(e.slug, ', ') INTO bad
    FROM public.company_name_evidence e
    LEFT JOIN public.company_name_overrides o ON o.slug = e.slug
   WHERE e.read_on = DATE '2026-10-25'
     AND (o.display_name IS DISTINCT FROM e.display_name
          OR e.slug NOT LIKE '%~%'
          OR length(e.quote) < 10
          OR EXISTS (SELECT 1 FROM unnest(e.evidence) l WHERE l !~ '^https?://[^[:space:]]+$'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261025100000: these overrides are missing, differ from their evidence, or carry a bad link: %', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_name_overrides WHERE slug IN ('erhk~us2~CX_1001', 'fa-enmi-saasfaprod1~ocs~CX_1')) THEN
    RAISE EXCEPTION 'self-check 20261025100000: a pooled Oracle board (erhk Default, fa-enmi) took one employer''s name';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.company_name_evidence'::regclass) THEN
    RAISE EXCEPTION 'self-check 20261025100000: row level security is off on public.company_name_evidence';
  END IF;
  IF has_table_privilege('anon', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check 20261025100000: anon or authenticated can read or write public.company_name_evidence';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.company_name_evidence', 'SELECT') THEN
    RAISE EXCEPTION 'self-check 20261025100000: the service role cannot read public.company_name_evidence';
  END IF;
  IF to_regclass('public.job_board_postings') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.job_board_postings')
          AND t.tgname = 'trg_company_name_override' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'self-check 20261025100000: trg_company_name_override is not on job_board_postings, so no write would take these names';
  END IF;
  RAISE NOTICE 'self-check 20261025100000: % boards named by their employer, each with its evidence', n;
END $$;
