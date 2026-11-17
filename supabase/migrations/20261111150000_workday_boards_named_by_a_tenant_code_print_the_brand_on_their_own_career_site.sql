-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-17 in the names build).
--
-- WORKDAY BOARDS NAMED BY A TENANT CODE PRINT THE BRAND ON THEIR OWN CAREER SITE.
--
-- Owner decision OD9 (a), 2026-11-08: a Workday board that shows a tenant code
-- shows the brand the employer presents on its own Workday career site, and
-- the legal hiring entity only where the site states no brand. The names
-- corpus of 2026-11-08 (board program BB-02, wave W8) found 1,430 tenants
-- printing their code ("Nghs", "Owensminor", "Beigene") on 82,757 served rows.
-- This file names 375 of them: 437 company_name_overrides keys over 29,716
-- rows served on 2026-11-08, each with its evidence row.
--
-- WHERE EVERY NAME CAME FROM. The employer's own words for itself, read
-- gently (GET only, robots.txt read first and honoured, at most one request
-- a second per host, never logged in): the Workday career site's page title
-- and og tags, its CXS sidebar (/wday/cxs/<tenant>/<site>/sidebar) and one or
-- two of its postings (the posting's text and its hiringOrganization), on
-- 2026-11-08 for the corpus, and again on 2026-11-17 for the 74 keys an
-- independent re-check read live. Each row of public.company_name_evidence
-- (20261025100000 made it; only the service role reads it) carries the page
-- the words were read on, the words themselves holding the name letter for
-- letter, and the day of the read. Nothing is guessed: a name the rules below
-- could not find in the employer's own text is not here.
--
-- THE INCLUSION RULE AND THE MEASURED PRECISION. The re-check of 2026-11-17
-- read 100 rows (96 tenants) of the corpus live and replaces the owner's
-- 30-row spot check. Precision by stratum, unique tenants, with the Wilson
-- 95% lower bound:
--   high confidence, hand-reviewed       36/37   97.3%  bound  86.2%  SHIPS
--   high confidence, machine-reviewed      3/8   37.5%  bound  13.7%
--   medium confidence, hand-reviewed     17/22   77.3%  bound  56.6%
--   medium confidence, machine-reviewed   8/14   57.1%  bound  32.6%
--   low confidence, any review            8/15   53.3%  bound  30.1%
-- A stratum ships only when its bound is at least 85%: only high confidence,
-- hand-reviewed does. Every wrong-row pattern the re-check found is then a
-- rule over the whole corpus, judged on the words of each board's own capture,
-- and a key any rule flags stays out: R1 a name found only in an image's alt
-- text ("HVAC Photo") or in none of the employer's text; R2 a title separator
-- or a board label in the name ("Wounded Warrior Project | WWP"); R3 a
-- truncation ("American" for American Global; on a tenant of several
-- employers, "Comfort Systems USA" where the site first says "Comfort Systems
-- USA Southwest"); R4 a name the site's own presentation never writes, read
-- only from a posting's legal label ("Environmental Resources Management"
-- where the site says ERM); R5 an acronym the site writes out ("NGHS"), or an
-- expansion of a code the site never writes ("Mass Financial Services"); R6 a
-- parent's name on a child's site; R7 a site that says the name trades as
-- another ("d/b/a Lument"); R8 on a tenant of several employers, a name found
-- only in text it shares with another employer's site. On the sample the rules
-- leave the shipped stratum 30/30 (bound 88.6%), and they flag every wrong row
-- of both high strata.
--
-- THE ROWS THE RE-CHECK READ LIVE ship from any stratum with the name it
-- judged right (74 keys, 57 tenants, 8,000 rows), each sampled wrong row
-- corrected: tscfl is Tallahassee State College (not "HVAC Photo"), mfs MFS,
-- nghs Northeast Georgia Health System, americanglobal American Global,
-- lumaenergy LUMA, woundedwarriorproject Wounded Warrior Project, cba's
-- CommBank board CommBank (not "Commonwealth Bank"), gcu's Orbis board Orbis
-- Education, erm ERM, isc ISC, travelhrportal Amex GBT (not "CWT"),
-- agreenspace Team Global Express. The stratum itself adds 287 tenant keys
-- (19,569 rows) and 76 board keys on 31 tenants of several employers (2,147
-- rows).
--
-- TENANTS OF SEVERAL EMPLOYERS are named board by board, by the exact token
-- (the trigger reads a full-token key first), never by the tenant slug, so a
-- site added later keeps its stored name instead of taking one member's. A
-- tenant with any full-token key is read one site at a time by
-- get_company_intel and get_similar_companies (workday_site_is_own_employer,
-- 20261012135000): 39 tenants here, 38 of them found by the corpus hosting
-- several employers, and maxar, whose one board named here (Vantor) sits on a
-- tenant whose robots.txt lists staffing agencies' sites.
--
-- LEFT OUT, KEEPING TODAY'S NAME: the strata under the bar (high confidence
-- machine-reviewed 263 tenants, medium hand-reviewed 417, medium
-- machine-reviewed 235, low 33); 106 keys a rule flagged (5,064 rows); the 27
-- code-unresolved tenants and the 7 unread ones, which the corpus never
-- proposed; tenants the re-check found with no single right name or a name in
-- motion (gi carries TYLin, Introba and Landrum & Brown; warnerbros read
-- Warner Bros. on 2026-11-08 and Skydance on 2026-11-17); 9 keys main already
-- names; and 10 names that fold equal to another catalogued employer's shown
-- name ("Deloitte", "BDO", "Goodwin"), which the company suggest and the
-- clusters would merge (S11-134). The list, every left-out key and its reason
-- are in the names build's final-names.json.
--
-- A NAME ALREADY SET IS KEPT. ON CONFLICT DO NOTHING: a key the table
-- already holds, from an earlier file or set by hand, keeps its name, and
-- its evidence is written only where the override reads this file's name.
--
-- THE LANE'S ONE READ. job-board's name-sync lane reads company_name_overrides
-- in one PostgREST answer, which returns at most 1,000 rows. The migrations
-- leave 505 rows before this file and 942 after it; the self-check
-- raises above 1,000, and the next names file waits until the lane pages
-- that read.
--
-- WHAT RENAMES THE STORED ROWS. trg_company_name_override names every write
-- from now on. The stored postings, closures, snapshots and closure rollup of
-- these boards are renamed by the name-sync lane, a board at a time on its
-- pass-end clock, once per NAME_SYNC_VERSION: this file re-arms it the way
-- 20261108100000 did, by removing job_board_meta name_sync_version and
-- name_sync_progress after the names exist.
--
-- ORDER: after 20261108100000 (applied) and after the frontend publish that
-- carries src/lib/employer-names.ts with the same 437 rows, so the bake and
-- the app print a name the moment the lane writes it. No function deploys
-- with it.
--
-- RE-RUNNABLE: both inserts are ON CONFLICT DO NOTHING; the re-arm removes
-- what is there, and a second run arms one more walk, which renames nothing.
-- No table is created, so no grant changes; the self-check says again that
-- no client role can read the evidence.
--
-- MEASURE: scripts/verify-deploy.d/99zzzzzzz-board-102-names.sh asks job-board
-- (list, x-rb-budget: probe) for six named boards once the lane has walked.
--
-- UNDO: none needed. A wrong name is corrected by a later file's
-- ON CONFLICT DO UPDATE, with its evidence.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '1min';

-- REFUSE, changing nothing, unless the evidence table and the trigger exist.
DO $$
BEGIN
  IF to_regclass('public.company_name_evidence') IS NULL THEN
    RAISE EXCEPTION '20261111150000 refuses: public.company_name_evidence does not exist, so 20261025100000 is not applied. Apply 20261025100000, unedited, then this file again';
  END IF;
  IF to_regclass('public.job_board_postings') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.job_board_postings')
          AND t.tgname = 'trg_company_name_override' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '20261111150000 refuses: trg_company_name_override is not on job_board_postings, so new writes would not take the names; send this error, do not apply anything else';
  END IF;
END $$;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('8x8inc', '8x8'),
  ('aaamidatlantic', 'AAA Club Alliance'),
  ('abcfws', 'ABC Fine Wine & Spirits'),
  ('acs', 'American Cancer Society'),
  ('acxiomllc', 'Acxiom'),
  ('aeci', 'Associated Electric Cooperative'),
  ('agreenspace', 'Team Global Express'),
  ('airasia', 'AirAsia'),
  ('akamerica', 'Asahi Kasei'),
  ('akumincorp', 'Akumin'),
  ('algonquincollege', 'Algonquin College'),
  ('allegromicro', 'Allegro'),
  ('alliancedata', 'Bread Financial'),
  ('alliedsolutions', 'Allied Solutions'),
  ('alpinephysicians', 'Alpine Physician Partners'),
  ('altamed', 'AltaMed'),
  ('americanglobal', 'American Global'),
  ('americanregent', 'American Regent'),
  ('andersonsinc', 'The Andersons'),
  ('andrewsdistributing', 'Andrews Distributing'),
  ('apog', 'Apogee'),
  ('argenx', 'argenx'),
  ('arianegroup', 'ArianeGroup'),
  ('asd', 'Academy District 20'),
  ('aspca', 'ASPCA'),
  ('aspenvalleyhealth', 'Aspen Valley Health'),
  ('athenahealth', 'athenahealth'),
  ('atlantabravesmlb', 'Atlanta Braves'),
  ('atmosenergy', 'Atmos Energy'),
  ('auchanportugal', 'Auchan'),
  ('austintexas', 'City of Austin'),
  ('autostore', 'AutoStore'),
  ('avfc', 'Aston Villa Football Club'),
  ('awg', 'Anglian Water'),
  ('badgermeter', 'Badger Meter'),
  ('baltimorecity~wd1~EPFL_External', 'Pratt Library'),
  ('baltimorecity~wd1~External', 'City of Baltimore'),
  ('barrywehmiller', 'Barry-Wehmiller'),
  ('bavariannordic', 'Bavarian Nordic'),
  ('bbh', 'Brown Brothers Harriman'),
  ('bbinsurance~wd1~Careers', 'Brown & Brown'),
  ('bbinsurance~wd1~Careers_Europe', 'Brown & Brown'),
  ('bcbst', 'BCBST'),
  ('beautyhealth', 'Hydrafacial'),
  ('begacheese', 'Bega'),
  ('beigene', 'BeOne'),
  ('bestbuycanada', 'Best Buy Canada'),
  ('bgfoods', 'B&G Foods'),
  ('bigcommerce', 'Commerce'),
  ('blackrock', 'BlackRock'),
  ('blueowl', 'Blue Owl'),
  ('bobsdf', 'Bob''s Discount Furniture'),
  ('boseallaboutme', 'Bose'),
  ('boystown', 'Boys Town'),
  ('braunintertec', 'Braun Intertec'),
  ('brocku', 'Brock University'),
  ('byu', 'Brigham Young University'),
  ('caaquebec', 'CAA-Quebec'),
  ('camdennational', 'Camden National Bank'),
  ('canadagoose', 'Canada Goose'),
  ('canalbarge', 'Canal Barge Company'),
  ('capefearvalley', 'Cape Fear Valley Health'),
  ('capitalhealth', 'Capital Health'),
  ('caresource', 'CareSource'),
  ('cba~wd3~Bankwest_Careers', 'Bankwest'),
  ('cba~wd3~CommBank_Careers', 'CommBank'),
  ('cbh', 'Cherry Bekaert'),
  ('ceritypartners', 'Cerity Partners'),
  ('cesco', 'Crescent Electric Supply Company'),
  ('ceu~wd3~CEU', 'Grupo CEU'),
  ('ceu~wd3~CEUAND', 'CEU Andalucía'),
  ('ceu~wd3~COL', 'Colegios CEU'),
  ('ceu~wd3~FP', 'Formación Profesional CEU'),
  ('ceu~wd3~UF3', 'Universidad CEU Fernando III'),
  ('ceu~wd3~uao', 'Universitat Abat Oliba CEU'),
  ('ceu~wd3~uch', 'Universidad CEU Cardenal Herrera'),
  ('ceu~wd3~usp', 'Universidad CEU San Pablo'),
  ('cfr', 'Buc-ee''s'),
  ('cgb', 'Consolidated Grain and Barge'),
  ('cgm', 'CGM'),
  ('chaptershealth~wd5~capitalcaringjobs', 'Capital Caring'),
  ('charlottenc', 'City of Charlotte'),
  ('chartermfg', 'Charter Manufacturing'),
  ('chghealthcare', 'CHG Healthcare'),
  ('christmanco', 'The Christman Company'),
  ('chrobinson', 'C.H. Robinson'),
  ('citicclsa', 'CITIC Securities International'),
  ('citjpl', 'Jet Propulsion Laboratory'),
  ('cityoforlando', 'City of Orlando'),
  ('clearesult', 'CLEAResult'),
  ('clearskyhealth', 'ClearSky Health'),
  ('clearwateranalytics', 'Clearwater Analytics'),
  ('cmcmarkets', 'CMC Markets'),
  ('colemanwm', 'Coleman Worldwide Moving'),
  ('collectorsuniverse', 'Collectors'),
  ('collegeboard', 'College Board'),
  ('comfortsystemsusa~wd1~BCM', 'BCM Controls'),
  ('comfortsystemsusa~wd1~Corpcareers', 'Comfort Systems USA'),
  ('comfortsystemsusa~wd1~Design_Mechanical', 'Design Mechanical'),
  ('comfortsystemsusa~wd1~DynaTen', 'DynaTen'),
  ('comfortsystemsusa~wd1~SM_Lawrence', 'S.M. Lawrence'),
  ('comfortsystemsusa~wd1~TempRight', 'Temp Right Service'),
  ('conagrabrands', 'Conagra Brands'),
  ('coorstek', 'CoorsTek'),
  ('corebridgefinancial~wd1~CorebridgeFinancial', 'Corebridge Financial'),
  ('corpartners~wd5~COR', 'Cor Partners'),
  ('corpartners~wd5~EngleMartin', 'Engle Martin'),
  ('corrohealth', 'CorroHealth'),
  ('countryfinancial~wd5~COUNTRYAgencyExternal', 'COUNTRY Financial'),
  ('countryfinancial~wd5~COUNTRYCorporateExternal', 'COUNTRY Financial'),
  ('countryfinancial~wd5~IllinoisFarmBureau', 'Illinois Farm Bureau'),
  ('creditacceptance', 'Credit Acceptance'),
  ('crhc', 'Concord Hospital'),
  ('crossoverhealth', 'Crossover Health'),
  ('crystalsugar', 'Crystal Sugar'),
  ('csagroup', 'CSA Group'),
  ('csusystem', 'Colorado State University'),
  ('daikinapplied', 'Daikin Applied'),
  ('dallascityhall', 'City of Dallas'),
  ('dallascollege', 'Dallas College'),
  ('datev', 'DATEV'),
  ('davispolk', 'Davis Polk'),
  ('dealertire~wd5~4710', 'Dent Wizard'),
  ('dealertire~wd5~Sonsio', 'Sonsio'),
  ('destinationpet', 'Destination Pet'),
  ('digitalturbine', 'Digital Turbine'),
  ('dlapiper', 'DLA Piper'),
  ('drinkpak', 'DrinkPAK'),
  ('druryhotels', 'Drury Hotels'),
  ('dsvgruppe', 'DSV-Gruppe'),
  ('dukeenergy', 'Duke Energy'),
  ('dupont', 'DuPont'),
  ('dynastymanagement~wd12~GREENWAY', 'Greenway Equipment'),
  ('dynastymanagement~wd12~SCOTT_PETROLEUM', 'Scott Petroleum'),
  ('earlywarning', 'Early Warning'),
  ('ebi~wd5~afbcareers', 'AFB International'),
  ('ebi~wd5~ebicareers', 'Ensign-Bickford Industries'),
  ('ebi~wd5~envirologixcareers', 'EnviroLogix'),
  ('ebnhc', 'NeighborHealth'),
  ('elderslimited', 'Elders'),
  ('elliottdavis', 'Elliott Davis'),
  ('emerysapp~wd501~ESS', 'Emery Sapp & Sons'),
  ('emerysapp~wd501~RUM', 'Rummel Construction'),
  ('epicorsoftware', 'Epicor'),
  ('erm', 'ERM'),
  ('eroadgroup', 'EROAD'),
  ('eset', 'ESET'),
  ('etch', 'Dolly Parton Children''s Hospital'),
  ('factset', 'FactSet'),
  ('fanniemae', 'Fannie Mae'),
  ('fau', 'Florida Atlantic University'),
  ('ffive', 'F5'),
  ('fib', 'First Interstate Bank'),
  ('fico', 'FICO'),
  ('fimc', 'Fairway Independent Mortgage'),
  ('firstam~wd1~fctcareers', 'FCT'),
  ('firstam~wd1~firstamericancareers', 'First American'),
  ('firstquality', 'First Quality'),
  ('flagshipinc', 'Flagship'),
  ('flpoly', 'Florida Polytechnic University'),
  ('fnz', 'FNZ'),
  ('formfactor', 'FormFactor'),
  ('freseniusglobal', 'Fresenius Kabi'),
  ('fticonsulting~wd108~CompassLexeconCareers', 'Compass Lexecon'),
  ('fticonsulting~wd108~FTIConsultingCareers', 'FTI Consulting'),
  ('fullsail', 'Full Sail'),
  ('gaig~wd1~GAIG_External', 'Great American Insurance Group'),
  ('gaig~wd1~National_Interstate_External', 'National Interstate Insurance'),
  ('gaig~wd1~Vanliner_External', 'Vanliner Insurance'),
  ('gategroup', 'gategroup'),
  ('gcu~wd1~GCE', 'Grand Canyon Education'),
  ('gcu~wd1~GCEC', 'Grand Canyon Education'),
  ('gcu~wd1~GCU', 'Grand Canyon University'),
  ('gcu~wd1~Orbis', 'Orbis Education'),
  ('gea', 'GEA'),
  ('geha', 'G.E.H.A'),
  ('genesishcs', 'Genesis HealthCare System'),
  ('georgesinc', 'George''s Inc'),
  ('georgiasown', 'Georgia''s Own'),
  ('giorgiglobal', 'CANPACK'),
  ('globelife', 'Globe Life'),
  ('godirect', 'Voya Financial'),
  ('gphealth', 'Great Plains Health'),
  ('gundersenhealth', 'Gundersen Health System'),
  ('hancockwhitney', 'Hancock Whitney'),
  ('harvestroad', 'Harvest Road'),
  ('hastingsdirect', 'Hastings Direct'),
  ('henryschein', 'Henry Schein'),
  ('hl', 'Houlihan Lokey'),
  ('hntb', 'HNTB'),
  ('hriproperties', 'HRI Hospitality'),
  ('hss', 'Hospital for Special Surgery'),
  ('hysteryale', 'Hyster-Yale'),
  ('icf', 'ICF'),
  ('icwgroup', 'ICW Group'),
  ('iheartmedia', 'iHeartMedia'),
  ('ijm', 'International Justice Mission'),
  ('ilb', 'Investitionsbank des Landes Brandenburg'),
  ('ineos', 'INEOS'),
  ('intervarsity', 'InterVarsity'),
  ('irhythmtech', 'iRhythm'),
  ('isc', 'ISC'),
  ('issgovernance', 'ISS STOXX'),
  ('jacksongov~wd5~court', '16th Judicial Circuit of Missouri'),
  ('jadeglobal', 'Jade Global'),
  ('jcrew~wd1~MadewellCareers', 'Madewell'),
  ('jda', 'Blue Yonder'),
  ('jerrys', 'Jerry''s Enterprises'),
  ('jm', 'Johns Manville'),
  ('johnsonbrothers', 'Johnson Brothers'),
  ('kaishaservice~wd1~GreenMetalsCareers', 'Green Metals'),
  ('kaishaservice~wd1~ToyotaTsushoAmerica', 'Toyota Tsusho America'),
  ('kcura', 'Relativity'),
  ('kimberlyclark', 'Kimberly-Clark'),
  ('kmkp~wd1~KACECareers', 'KACE'),
  ('kmkp~wd1~TPGCareers', 'Providencia'),
  ('kmkp~wd1~careers', 'MVM'),
  ('kpluss', 'K+S'),
  ('ksb', 'KSB'),
  ('ksbe', 'Kamehameha Schools'),
  ('kumc', 'University of Kansas Medical Center'),
  ('languageline~wd5~HAS_Careers', 'Health Advocate'),
  ('languageline~wd5~LLS_Careers', 'LanguageLine'),
  ('leecompany', 'Lee Company'),
  ('lendingclub', 'Happen Bank'),
  ('lfb', 'LFB'),
  ('lifefitness', 'Life Fitness'),
  ('livanova', 'LivaNova'),
  ('llbean', 'L.L.Bean'),
  ('loewshotels', 'Loews Hotels'),
  ('loganhealth', 'Logan Health'),
  ('lplfinancial', 'LPL Financial'),
  ('lumaenergy', 'LUMA'),
  ('luriechildrens', 'Ann & Robert H. Lurie Children''s Hospital of Chicago'),
  ('madrigalpharma', 'Madrigal'),
  ('mainegeneral', 'MaineGeneral'),
  ('manh', 'Manhattan Associates'),
  ('marathonhealth', 'Marathon Health'),
  ('maryfreebed', 'Mary Free Bed Rehabilitation Hospital'),
  ('marywashingtonhealthcare', 'Mary Washington Healthcare'),
  ('massmutual', 'MassMutual'),
  ('mattressfirm', 'Mattress Firm'),
  ('maxar~wd1~Vantor', 'Vantor'),
  ('mbda', 'MBDA'),
  ('mc', 'Montgomery College'),
  ('mchapusa', 'Marketplace Chaplains'),
  ('mechanicsbank', 'Mechanics Bank'),
  ('medimpact', 'MedImpact'),
  ('melocheinc', 'Meloche'),
  ('merceruniversity~wd1~external', 'Mercer University'),
  ('merceruniversity~wd1~student', 'Mercer University'),
  ('methodisthealthsystem', 'Methodist Health System'),
  ('mfs', 'MFS'),
  ('miamioh', 'Miami University'),
  ('michelinhr', 'Michelin'),
  ('minnstate', 'Minnesota State'),
  ('missionaustralia', 'Mission Australia'),
  ('modernatx', 'Moderna'),
  ('monolithicpower', 'Monolithic Power Systems'),
  ('morganlewis', 'Morgan Lewis'),
  ('msiexpress', 'MSI Express'),
  ('msssecurity', 'MSS Security'),
  ('msudenver', 'MSU Denver'),
  ('mwaa', 'Metropolitan Washington Airports Authority'),
  ('myhana', 'Maui Jim'),
  ('myhrhome', 'OneMain Financial'),
  ('nationalchurchresidences', 'National Church Residences'),
  ('nationwidechildrens', 'Nationwide Children''s'),
  ('navcanada', 'NAV CANADA'),
  ('nbtbancorp', 'NBT Bank'),
  ('ncratleos', 'NCR Atleos'),
  ('nebraskamed', 'Nebraska Medicine'),
  ('newperkinelmer', 'PerkinElmer'),
  ('nghs', 'Northeast Georgia Health System'),
  ('nordsonhcm', 'Nordson'),
  ('northwesternmutual', 'Northwestern Mutual'),
  ('nrpgroup', 'NRP'),
  ('nshe~wd1~CSN-External', 'College of Southern Nevada'),
  ('nshe~wd1~DRI-External', 'Desert Research Institute'),
  ('nshe~wd1~GBC-external', 'Great Basin College'),
  ('nshe~wd1~NSHE-external', 'Nevada System of Higher Education'),
  ('nshe~wd1~NSU-external', 'Nevada State University'),
  ('nshe~wd1~TMCC-External', 'Truckee Meadows Community College'),
  ('nshe~wd1~UNLV-External', 'University of Nevada, Las Vegas'),
  ('nshe~wd1~UNR-external', 'University of Nevada, Reno'),
  ('nshe~wd1~WNC-External', 'Western Nevada College'),
  ('nshe~wd1~wnc-waiver', 'Western Nevada College'),
  ('nus', 'National University'),
  ('oakvalleyhealth', 'Oak Valley Health'),
  ('ocdc', 'Oregon Child Development Coalition'),
  ('odfl', 'Old Dominion Freight Line'),
  ('oldrepublic', 'Old Republic Title'),
  ('oneok', 'ONEOK'),
  ('originbank', 'Origin Bank'),
  ('owensminor', 'Owens & Minor'),
  ('palmbeachstate', 'Palm Beach State College'),
  ('papedawson', 'Pape-Dawson'),
  ('pciservices', 'PCI Pharma Services'),
  ('pepperlfuchs', 'Pepperl+Fuchs'),
  ('permianres', 'Permian Resources'),
  ('pfg~wd3~QFCareers', 'Quality Foods'),
  ('pfg~wd3~SaveonfoodsCareers', 'Save-On-Foods'),
  ('pillsburylaw', 'Pillsbury'),
  ('pimacounty', 'Pima County'),
  ('pinerest', 'Pine Rest'),
  ('pipersandler', 'Piper Sandler'),
  ('plantemoran~wd1~opportunity', 'Plante Moran'),
  ('plantemoran~wd1~pmexternalcareers', 'Plante Moran'),
  ('plugpower', 'Plug Power'),
  ('powerdesigninc', 'Power Design'),
  ('premierresearch', 'Premier Research'),
  ('primetherapeutics', 'Prime Therapeutics'),
  ('progleasing', 'Progressive Leasing'),
  ('propetroservices~wd5~ProPetro_Careers', 'ProPetro Services'),
  ('pultegroup', 'PulteGroup'),
  ('puma~wd502~Jobs_at_Puma', 'PUMA'),
  ('qtsdatacenters', 'QTS'),
  ('quadreal~wd10~quadreal', 'QuadReal'),
  ('racwa', 'RAC'),
  ('rb', 'Federal Reserve System'),
  ('rbs', 'NatWest Group'),
  ('recoveryfocus', 'Waythrough'),
  ('redrobin', 'Red Robin'),
  ('rgare', 'RGA'),
  ('richlandonline', 'Richland County'),
  ('riministreet', 'Rimini Street'),
  ('ringcentral', 'RingCentral'),
  ('rockwoolgroup', 'ROCKWOOL Group'),
  ('rogersbh', 'Rogers Behavioral Health'),
  ('roswellpark', 'Roswell Park'),
  ('ryancompanies', 'Ryan Companies'),
  ('ryansg', 'Ryan Specialty'),
  ('saabusa', 'Saab'),
  ('sailpoint', 'SailPoint'),
  ('saintsfc', 'Southampton Football Club'),
  ('salinasvalleyhealth', 'Salinas Valley Health'),
  ('salvationarmy', 'Salvation Army'),
  ('sarahbush', 'Sarah Bush Lincoln'),
  ('sasllc', 'CHSGa'),
  ('saxobank', 'Saxo Bank'),
  ('sbasite', 'SBA Communications'),
  ('scanhealthplan', 'SCAN'),
  ('scottsmiraclegro', 'ScottsMiracle-Gro'),
  ('sdguthrie~wd3~NBPOL', 'NBPOL'),
  ('sdguthrie~wd3~SDGUTHRIEMINAMAS', 'SD Guthrie'),
  ('senecacasinos', 'Seneca Resorts & Casinos'),
  ('sfcollege', 'Santa Fe College'),
  ('sharpservices', 'Sharp Packaging Services'),
  ('shelterinsurance', 'Shelter Insurance'),
  ('shm', 'VillageMD'),
  ('sierraspace', 'Sierra Space'),
  ('silgancontainers', 'Silgan'),
  ('silvercross', 'Silver Cross'),
  ('simmonsbank', 'Simmons Bank'),
  ('situsamc', 'SitusAMC'),
  ('skbs', 'Städtisches Klinikum Braunschweig'),
  ('slc', 'Student Loans Company'),
  ('smithnephew', 'Smith+Nephew'),
  ('snapchat', 'Snap'),
  ('snc', 'SNC'),
  ('sonyglobal', 'Sony'),
  ('soterahealth', 'Sotera Health'),
  ('spinmaster', 'Spin Master'),
  ('starrcompanies', 'Starr'),
  ('stjude', 'St. Jude Children''s Research Hospital'),
  ('storaenso', 'Stora Enso'),
  ('stormontvail', 'Stormont Vail'),
  ('sumitomopharma', 'Sumitomo Pharma America'),
  ('svb', 'First Citizens India'),
  ('svha~wd3~SVHA_SVHA', 'St Vincent''s Health Australia'),
  ('svha~wd3~broadbean_external', 'St Vincent''s Health Australia'),
  ('svha~wd3~svha_svphm', 'St Vincent''s Private Melbourne'),
  ('synchronyfinancial', 'Synchrony'),
  ('taskus', 'TaskUs'),
  ('taylormorrison', 'Taylor Morrison'),
  ('tcsedsystem~wd1~KHSC', 'Kansas Health Science University'),
  ('tcsedsystem~wd1~TCSES', 'The Community Solution'),
  ('tcsedsystem~wd1~TCSPP', 'The Chicago School'),
  ('tcsedsystem~wd1~UWS', 'University of Western States'),
  ('texascapitalbank', 'Texas Capital'),
  ('theapexgroup', 'Apex Group'),
  ('theirc', 'International Rescue Committee'),
  ('thejacksonlaboratory', 'The Jackson Laboratory'),
  ('thgrp~wd12~TheHeritageGroup', 'The Heritage Group'),
  ('thgrp~wd12~monumentchemical', 'Monument Chemical'),
  ('tiaa', 'TIAA'),
  ('tigerbrands', 'Tiger Brands'),
  ('tihinsurance', 'CRC Group'),
  ('towerloan', 'Tower Loan'),
  ('transformingage', 'Transforming Age'),
  ('transunion', 'TransUnion'),
  ('travelhrportal', 'Amex GBT'),
  ('tscfl', 'Tallahassee State College'),
  ('tucsonaz', 'City of Tucson'),
  ('ucf~wd1~careers', 'University of Central Florida'),
  ('ukib', 'National Wealth Fund'),
  ('umb', 'UMB'),
  ('umphysicians', 'M Physicians'),
  ('unimelb', 'University of Melbourne'),
  ('uofl', 'University of Louisville'),
  ('upenn~wd1~PSOM', 'Perelman School of Medicine'),
  ('upenn~wd1~careers-at-penn', 'University of Pennsylvania'),
  ('upm', 'UPM'),
  ('uq', 'The University of Queensland'),
  ('usaa', 'USAA'),
  ('usyd', 'University of Sydney'),
  ('utaustin', 'University of Texas at Austin'),
  ('uva', 'University of Virginia'),
  ('vcuhealth', 'VCU Health'),
  ('veitusa', 'Veit'),
  ('veoliauki', 'Veolia'),
  ('vertexinc', 'Vertex'),
  ('vst', 'Vistra'),
  ('vwr', 'Avantor'),
  ('walshgroup', 'Walsh Group'),
  ('wasatchproperty~wd1~BlendtecCareers', 'Blendtec'),
  ('wasatchproperty~wd1~MarketStarCareers', 'MarketStar'),
  ('wasatchproperty~wd1~PDK', 'ProdataKey'),
  ('wasatchproperty~wd1~marketstarcareersemea', 'MarketStar'),
  ('wasatchproperty~wd1~marketstarcareersnamer', 'MarketStar'),
  ('waynefarms', 'Wayne-Sanderson Farms'),
  ('wellsky', 'WellSky'),
  ('westernalliancebank~wd5~AMH', 'AmeriHome Mortgage'),
  ('westernalliancebank~wd5~WAB', 'Western Alliance Bank'),
  ('wework', 'WeWork'),
  ('wexinc', 'WEX'),
  ('wgu', 'Western Governors University'),
  ('wilsonco', 'Wilson & Company'),
  ('woundedwarriorproject', 'Wounded Warrior Project'),
  ('wwecorp~wd5~IMG', 'IMG'),
  ('wwecorp~wd5~TKO', 'TKO'),
  ('wwecorp~wd5~private_postings', 'TKO'),
  ('wwecorp~wd5~wwecorp', 'WWE'),
  ('yeehong', 'Yee Hong Centre for Geriatric Care'),
  ('yeticoolers', 'YETI'),
  ('ymcaatlanta', 'YMCA of Metropolitan Atlanta'),
  ('younglife', 'Young Life')
ON CONFLICT (slug) DO NOTHING;

-- The evidence of each name, written only where the override now reads it.
INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on)
SELECT v.slug, v.display_name, v.evidence, v.quote, v.read_on
  FROM (VALUES
  ('8x8inc', '8x8', ARRAY['https://8x8inc.wd5.myworkdayjobs.com/8x8_External_Careers'], 'og:title: "Careers at 8x8"', DATE '2026-11-08'),
  ('aaamidatlantic', 'AAA Club Alliance', ARRAY['https://aaamidatlantic.wd5.myworkdayjobs.com/AAAMidAtlantic'], 'og:description: "...primary residence must reside within the footprint that AAA Club Alliance Inc. operates. Our club is located in Washington DC and 13 states including Connecticut,..."', DATE '2026-11-08'),
  ('abcfws', 'ABC Fine Wine & Spirits', ARRAY['https://abcfws.wd1.myworkdayjobs.com/abcfws'], 'og:description: "ABC Fine Wine & Spirits is an essential business in Florida that has been family owned and operated since 1936...."', DATE '2026-11-08'),
  ('acs', 'American Cancer Society', ARRAY['https://acs.wd5.myworkdayjobs.com/acscareers'], 'og:description: "At the American Cancer Society, our employees are the soul of our lifesaving mission to save lives. Our employment..."', DATE '2026-11-08'),
  ('acxiomllc', 'Acxiom', ARRAY['https://acxiomllc.wd5.myworkdayjobs.com/AcxiomUSA'], 'og:title: "Careers at Acxiom"', DATE '2026-11-08'),
  ('aeci', 'Associated Electric Cooperative', ARRAY['https://aeci.wd1.myworkdayjobs.com/AECI'], 'og:description: "Associated Electric Cooperative, Inc. is a member-owned, member-led, not-for-profit electric cooperative dedicated to..."', DATE '2026-11-08'),
  ('agreenspace', 'Team Global Express', ARRAY['https://agreenspace.wd3.myworkdayjobs.com/Global_Express_Career_Site'], 'og:description: "...& New Zealand With an unrivalled and expansive network, Team Global Express builds unique, innovative, and tailored transport and logistics solutions to connect..."', DATE '2026-11-17'),
  ('airasia', 'AirAsia', ARRAY['https://airasia.wd3.myworkdayjobs.com/Careers'], 'og:description: "AirAsia Berhad: Asia''s leading airline was established with the dream of making flying possible..."', DATE '2026-11-08'),
  ('akamerica', 'Asahi Kasei', ARRAY['https://akamerica.wd501.myworkdayjobs.com/aka'], 'og:description: "...cautious of fraudulent communications claiming to be from Asahi Kasei. Incidents have occurred in which individuals impersonating Asahi Kasei recruiters have..."', DATE '2026-11-08'),
  ('akumincorp', 'Akumin', ARRAY['https://akumincorp.wd5.myworkdayjobs.com/akumincareers'], 'og:description: "Akumin opens the doors to an exceptional career in outpatient care. Recognized as a trusted..."', DATE '2026-11-08'),
  ('algonquincollege', 'Algonquin College', ARRAY['https://algonquincollege.wd3.myworkdayjobs.com/CareerOpportunities'], 'og:description: "...resources and technology you need to be successful Algonquin College is proud to be recognized by Forbes as one of Canada''s Best Employers. Learn More..."', DATE '2026-11-08'),
  ('allegromicro', 'Allegro', ARRAY['https://allegromicro.wd5.myworkdayjobs.com/AllegroCareers'], 'og:title: "Careers at Allegro"', DATE '2026-11-08'),
  ('alliancedata', 'Bread Financial', ARRAY['https://alliancedata.wd5.myworkdayjobs.com/breadfinancial_India'], 'og:description: "About Bread Financial As a tech-forward financial services company, we strive to create value for both our..."', DATE '2026-11-17'),
  ('alliedsolutions', 'Allied Solutions', ARRAY['https://alliedsolutions.wd501.myworkdayjobs.com/Allied_External'], 'og:description: "...to stay informed about news, events and opportunities. Allied Solutions uses technology-enabled products and services to meet the insurance, lending and..."', DATE '2026-11-08'),
  ('alpinephysicians', 'Alpine Physician Partners', ARRAY['https://alpinephysicians.wd1.myworkdayjobs.com/wday/cxs/alpinephysicians/External/sidebar'], 'sidebar: "Alpine Physician Partners - About Us"', DATE '2026-11-08'),
  ('altamed', 'AltaMed', ARRAY['https://altamed.wd1.myworkdayjobs.com/Careers'], 'og:description: "...nation''s largest Federally Qualified Health Center (FQHC), AltaMed is at the forefront of providing affordable, high-quality health care to underserved..."', DATE '2026-11-08'),
  ('americanglobal', 'American Global', ARRAY['https://americanglobal.wd108.myworkdayjobs.com/American_Global_Careers'], 'og:description: "...journey. We look forward to learning more about you! At American Global, we''re more than just a workplace—we''re a close-knit team that values collaboration,..."', DATE '2026-11-17'),
  ('americanregent', 'American Regent', ARRAY['https://americanregent.wd1.myworkdayjobs.com/American_Regent_Careers'], 'og:description: "...portfolio of branded and generic specialty injectables. American Regent, Inc., a Daiichi Sankyo Group Company, is a top-10 injectable manufacturer. For over 50..."', DATE '2026-11-08'),
  ('andersonsinc', 'The Andersons', ARRAY['https://andersonsinc.wd1.myworkdayjobs.com/TheAndersonsCareers'], 'og:description: "The Andersons, Inc., is a North American agriculture and renewable fuels company that conducts business..."', DATE '2026-11-08'),
  ('andrewsdistributing', 'Andrews Distributing', ARRAY['https://andrewsdistributing.wd5.myworkdayjobs.com/AndrewsDistributing'], 'og:description: "Andrews Distributing Company is proudly family owned and operated, as the number one beer and spirits..."', DATE '2026-11-08'),
  ('apog', 'Apogee', ARRAY['https://apog.wd1.myworkdayjobs.com/Apogee'], 'og:title: "Apogee & Our Brands"', DATE '2026-11-08'),
  ('argenx', 'argenx', ARRAY['https://argenx.wd3.myworkdayjobs.com/External_Careers'], 'og:description: "argenx is a global immunology company dedicated to improving the lives of people suffering from..."', DATE '2026-11-08'),
  ('arianegroup', 'ArianeGroup', ARRAY['https://arianegroup.wd3.myworkdayjobs.com/wday/cxs/arianegroup/EXTERNALALL/sidebar'], 'sidebar: "À propos d''ArianeGroup"', DATE '2026-11-08'),
  ('asd', 'Academy District 20', ARRAY['https://asd.wd5.myworkdayjobs.com/asd20'], 'og:title: "Academy District 20"', DATE '2026-11-08'),
  ('aspca', 'ASPCA', ARRAY['https://aspca.wd1.myworkdayjobs.com/ASPCAWebsite'], 'og:title: "Thank you for your interest in joining the ASPCA!"', DATE '2026-11-08'),
  ('aspenvalleyhealth', 'Aspen Valley Health', ARRAY['https://aspenvalleyhealth.wd501.myworkdayjobs.com/AVH'], 'og:description: "...employees cannot apply via the external career site. At Aspen Valley Health (AVH), you''ll join a team committed to making a meaningful difference—every day. As one..."', DATE '2026-11-08'),
  ('athenahealth', 'athenahealth', ARRAY['https://athenahealth.wd1.myworkdayjobs.com/External'], 'og:description: "...and driven by our entrepreneurial spirit, our work at athenahealth is collaborative, transformative, and above all, it''s meaningful. Our employees take..."', DATE '2026-11-08'),
  ('atlantabravesmlb', 'Atlanta Braves', ARRAY['https://atlantabravesmlb.wd5.myworkdayjobs.com/AtlantaBraves'], 'og:description: "...National League pennants, and two World Series titles. The Atlanta Braves Organization upholds the highest standards through: Creating Welcoming Experiences..."', DATE '2026-11-08'),
  ('atmosenergy', 'Atmos Energy', ARRAY['https://atmosenergy.wd108.myworkdayjobs.com/External_Career_Site'], 'og:description: "Atmos Energy Corporation, a natural gas-only distributor, is an S&P 500 company headquartered in..."', DATE '2026-11-08'),
  ('auchanportugal', 'Auchan', ARRAY['https://auchanportugal.wd3.myworkdayjobs.com/auchan-retail'], 'og:description: "...e responsável, militante do bom, são e local. Uma marca: Auchan! A nossa ambição? A sa"', DATE '2026-11-08'),
  ('austintexas', 'City of Austin', ARRAY['https://austintexas.wd5.myworkdayjobs.com/coa_careers'], 'og:description: "Workday Jobs Hub JOIN THE CITY OF AUSTIN TEAM At the City of Austin, we are more than just an employer—we are a vibrant community dedicated to shaping one of..."', DATE '2026-11-08'),
  ('autostore', 'AutoStore', ARRAY['https://autostore.wd3.myworkdayjobs.com/autostore'], 'og:description: "...arises within your field of interest. Try our brand new AutoStore Pathfinder! Here you will be able to take a short questionnaire and read about where in..."', DATE '2026-11-08'),
  ('avfc', 'Aston Villa Football Club', ARRAY['https://avfc.wd502.myworkdayjobs.com/avfc_careers'], 'og:description: "There has never been a better time to join Aston Villa Football Club. Our drive to succeed is visible on the global stage, we are building a family ethos and..."', DATE '2026-11-08'),
  ('awg', 'Anglian Water', ARRAY['https://awg.wd3.myworkdayjobs.com/A1'], 'og:description: "The Anglian Water @one Alliance is a collaborative organisation of consultants and contractors working..."', DATE '2026-11-08'),
  ('badgermeter', 'Badger Meter', ARRAY['https://badgermeter.wd5.myworkdayjobs.com/US_CareerSite'], 'og:title: "Badger Meter"', DATE '2026-11-08'),
  ('baltimorecity~wd1~EPFL_External', 'Pratt Library', ARRAY['https://baltimorecity.wd1.myworkdayjobs.com/EPFL_External'], 'og:title: "Careers at the Pratt Library"', DATE '2026-11-08'),
  ('baltimorecity~wd1~External', 'City of Baltimore', ARRAY['https://baltimorecity.wd1.myworkdayjobs.com/External'], 'og:title: "The City of Baltimore Job Opportunities"', DATE '2026-11-08'),
  ('barrywehmiller', 'Barry-Wehmiller', ARRAY['https://barrywehmiller.wd1.myworkdayjobs.com/BWCareers'], 'og:description: "Throughout Barry-Wehmiller, we hold ourselves to a unique measure of success: by the way we touch the lives of..."', DATE '2026-11-08'),
  ('bavariannordic', 'Bavarian Nordic', ARRAY['https://bavariannordic.wd103.myworkdayjobs.com/BavarianNordic'], 'og:description: "Join Bavarian Nordic a fully integrated vaccine company focused on the development, manufacturing and..."', DATE '2026-11-08'),
  ('bbh', 'Brown Brothers Harriman', ARRAY['https://bbh.wd5.myworkdayjobs.com/BBH'], 'og:description: "Brown Brothers Harriman (BBH) is a global financial services firm known for premium service and specialist..."', DATE '2026-11-08'),
  ('bbinsurance~wd1~Careers', 'Brown & Brown', ARRAY['https://bbinsurance.wd1.myworkdayjobs.com/Careers'], 'og:description: "...customers. Founded in 1939 as a small, two-partner firm, Brown & Brown (NYSE: BRO) and our team of companies have grown into one of the world''s largest..."', DATE '2026-11-08'),
  ('bbinsurance~wd1~Careers_Europe', 'Brown & Brown', ARRAY['https://bbinsurance.wd1.myworkdayjobs.com/Careers_Europe'], 'og:description: "Founded in 1939 as a small, two-partner firm, Brown & Brown (NYSE: BRO) and our team of companies have grown into one of the world''s largest..."', DATE '2026-11-08'),
  ('bcbst', 'BCBST', ARRAY['https://bcbst.wd1.myworkdayjobs.com/External'], 'og:description: "...and a bright outlook for an even healthier tomorrow. At BCBST, we empower our employees to thrive both independently and collaboratively, creating a..."', DATE '2026-11-08'),
  ('beautyhealth', 'Hydrafacial', ARRAY['https://beautyhealth.wd12.myworkdayjobs.com/BeautyHealthCareer'], 'og:description: "Hydrafacial is a global category-creating company focused on bringing innovative products to market..."', DATE '2026-11-08'),
  ('begacheese', 'Bega', ARRAY['https://begacheese.wd3.myworkdayjobs.com/Bega_Careers'], 'og:description: "Bega Group is home to many trusted and iconic food and beverage brands. Whether it''s VEGEMITE..."', DATE '2026-11-08'),
  ('beigene', 'BeOne', ARRAY['https://beigene.wd5.myworkdayjobs.com/BeiGene'], 'og:title: "Careers at BeOne"', DATE '2026-11-17'),
  ('bestbuycanada', 'Best Buy Canada', ARRAY['https://bestbuycanada.wd3.myworkdayjobs.com/BestBuyCA_Career'], 'og:description: "At Best Buy Canada, we bring tech to life – and make it fun! We are one of Canada''s largest and most..."', DATE '2026-11-08'),
  ('bgfoods', 'B&G Foods', ARRAY['https://bgfoods.wd1.myworkdayjobs.com/BG_Foods_Careers'], 'og:description: "With its headquarters based in Parsippany, New Jersey, B&G Foods and our subsidiaries manufacture, sell and distribute high-quality, branded shelf-stable..."', DATE '2026-11-08'),
  ('bigcommerce', 'Commerce', ARRAY['https://bigcommerce.wd12.myworkdayjobs.com/Commerce'], 'og:description: "The Commerce story is one of global growth, incredible talent, and unstoppable passion in all we do...."', DATE '2026-11-17'),
  ('blackrock', 'BlackRock', ARRAY['https://blackrock.wd1.myworkdayjobs.com/BlackRock_Professional'], 'og:description: "BlackRock''s purpose is to help more and more people experience financial well-being. As a global..."', DATE '2026-11-08'),
  ('blueowl', 'Blue Owl', ARRAY['https://blueowl.wd1.myworkdayjobs.com/blueowl'], 'og:description: "Blue Owl (NYSE: OWL) is a leading asset manager that is redefining alternatives®. With $330..."', DATE '2026-11-08'),
  ('bobsdf', 'Bob''s Discount Furniture', ARRAY['https://bobsdf.wd1.myworkdayjobs.com/en-US/Bobs_Careers/job/Henrietta-NY/Sales-Associate---Guest-Experience-Specialist_R-32360'], 'posting: "...Experience Sales Specialists are a driving force behind Bob''s Discount Furniture''s success and expansion. Whether you''re looking for full-time or part-time opportunities,..."', DATE '2026-11-17'),
  ('boseallaboutme', 'Bose', ARRAY['https://boseallaboutme.wd503.myworkdayjobs.com/Bose_Careers'], 'og:title: "Bose Career Site"', DATE '2026-11-08'),
  ('boystown', 'Boys Town', ARRAY['https://boystown.wd1.myworkdayjobs.com/boystowncareers'], 'og:description: "Boys Town has been changing the way America cares for children and families since 1917. With over a..."', DATE '2026-11-08'),
  ('braunintertec', 'Braun Intertec', ARRAY['https://braunintertec.wd5.myworkdayjobs.com/BraunIntertecCareers'], 'og:description: "At Braun Intertec, we work at the intersection of the natural and built environments, combining science,..."', DATE '2026-11-08'),
  ('brocku', 'Brock University', ARRAY['https://brocku.wd3.myworkdayjobs.com/brocku_careers'], 'og:description: "Brock University is a comprehensive institution with rich academic programs and world-class research..."', DATE '2026-11-08'),
  ('byu', 'Brigham Young University', ARRAY['https://byu.wd1.myworkdayjobs.com/byu-careers'], 'og:description: "Brigham Young University (BYU) is widely recognized not just for its world-class education, but for its deep..."', DATE '2026-11-08'),
  ('caaquebec', 'CAA-Quebec', ARRAY['https://caaquebec.wd3.myworkdayjobs.com/CarrieresCAA-Quebec'], 'og:description: "By joining the ranks of CAA-Quebec, you add your individual touch to our community, with the shared goal of assisting our..."', DATE '2026-11-08'),
  ('camdennational', 'Camden National Bank', ARRAY['https://camdennational.wd12.myworkdayjobs.com/wday/cxs/camdennational/CNB-Careers/sidebar'], 'sidebar: "About Camden National Bank"', DATE '2026-11-08'),
  ('canadagoose', 'Canada Goose', ARRAY['https://canadagoose.wd3.myworkdayjobs.com/CanadaGooseCareers'], 'og:description: "At Canada Goose, you''ll find purpose in keeping the planet cold and the people on it warm. As part of our..."', DATE '2026-11-08'),
  ('canalbarge', 'Canal Barge Company', ARRAY['https://canalbarge.wd5.myworkdayjobs.com/CBC'], 'og:description: "Canal Barge Company and Marquette Transportation Company are leaders in the marine transportation industry...."', DATE '2026-11-08'),
  ('capefearvalley', 'Cape Fear Valley Health', ARRAY['https://capefearvalley.wd1.myworkdayjobs.com/CFV'], 'og:description: "For exceptional healthcare come to Cape Fear Valley Health where caring employees are committed to integrity, patient-centeredness and excellence..."', DATE '2026-11-17'),
  ('capitalhealth', 'Capital Health', ARRAY['https://capitalhealth.wd1.myworkdayjobs.com/CapitalHealthCareers'], 'og:description: "Welcome to Capital Health''s new career opportunity page. Here you will have access to view and apply to career..."', DATE '2026-11-08'),
  ('caresource', 'CareSource', ARRAY['https://caresource.wd1.myworkdayjobs.com/CareSource'], 'og:description: "The CareSource mission is known as our heartbeat. Just as we support our members to be the best version..."', DATE '2026-11-08'),
  ('cba~wd3~Bankwest_Careers', 'Bankwest', ARRAY['https://cba.wd3.myworkdayjobs.com/Bankwest_Careers'], 'og:description: "At Bankwest, we''re on a mission to become Australia''s favourite digital bank. We believe that banking..."', DATE '2026-11-17'),
  ('cba~wd3~CommBank_Careers', 'CommBank', ARRAY['https://cba.wd3.myworkdayjobs.com/CommBank_Careers'], 'og:description: "...driven by data, or called by creativity, a career with CommBank is for you. Our people bring their diverse backgrounds and unique perspectives to build a..."', DATE '2026-11-17'),
  ('cbh', 'Cherry Bekaert', ARRAY['https://cbh.wd12.myworkdayjobs.com/CherryBekaert'], 'og:description: "At Cherry Bekaert, your career is about you. With growing industry expertise, a strong support system, and..."', DATE '2026-11-08'),
  ('ceritypartners', 'Cerity Partners', ARRAY['https://ceritypartners.wd12.myworkdayjobs.com/ceritypartnerscareers'], 'og:description: "...people and relationships. Our people are the nucleus of Cerity Partners. You bring unique expertise, commitment, and knowledge to the firm. By working together,..."', DATE '2026-11-08'),
  ('cesco', 'Crescent Electric Supply Company', ARRAY['https://cesco.wd501.myworkdayjobs.com/CESCOCareers'], 'og:description: "Crescent Electric Careers Crescent Electric Supply Company is a nationwide leader in electrical supply distribution and solutions, helping to power..."', DATE '2026-11-08'),
  ('ceu~wd3~CEU', 'Grupo CEU', ARRAY['https://ceu.wd3.myworkdayjobs.com/CEU'], 'og:title: "Grupo CEU"', DATE '2026-11-08'),
  ('ceu~wd3~CEUAND', 'CEU Andalucía', ARRAY['https://ceu.wd3.myworkdayjobs.com/CEUAND'], 'og:title: "CEU Andalucía"', DATE '2026-11-08'),
  ('ceu~wd3~COL', 'Colegios CEU', ARRAY['https://ceu.wd3.myworkdayjobs.com/COL'], 'og:title: "Colegios CEU"', DATE '2026-11-08'),
  ('ceu~wd3~FP', 'Formación Profesional CEU', ARRAY['https://ceu.wd3.myworkdayjobs.com/FP'], 'og:title: "Formación Profesional CEU"', DATE '2026-11-08'),
  ('ceu~wd3~UF3', 'Universidad CEU Fernando III', ARRAY['https://ceu.wd3.myworkdayjobs.com/UF3'], 'og:title: "Universidad CEU Fernando III"', DATE '2026-11-08'),
  ('ceu~wd3~uao', 'Universitat Abat Oliba CEU', ARRAY['https://ceu.wd3.myworkdayjobs.com/uao'], 'og:description: "La Universitat Abat Oliba CEU de Barcelona es una de las cuatro universidades promovidas por la Asociación Católica de..."', DATE '2026-11-08'),
  ('ceu~wd3~uch', 'Universidad CEU Cardenal Herrera', ARRAY['https://ceu.wd3.myworkdayjobs.com/uch'], 'og:title: "Universidad CEU Cardenal Herrera"', DATE '2026-11-08'),
  ('ceu~wd3~usp', 'Universidad CEU San Pablo', ARRAY['https://ceu.wd3.myworkdayjobs.com/usp'], 'og:title: "Universidad CEU San Pablo"', DATE '2026-11-08'),
  ('cfr', 'Buc-ee''s', ARRAY['https://cfr.wd5.myworkdayjobs.com/Buc-careers'], 'og:title: "Buc-ee''s"', DATE '2026-11-17'),
  ('cgb', 'Consolidated Grain and Barge', ARRAY['https://cgb.wd5.myworkdayjobs.com/CGB_Careers'], 'og:description: "...diverse family of businesses at CGB Enterprises, Inc. are Consolidated Grain and Barge Co., River Bend Transport, River Bend Brokerage, AgriFinancial, CGB Marine, CGB Soybean..."', DATE '2026-11-08'),
  ('cgm', 'CGM', ARRAY['https://cgm.wd3.myworkdayjobs.com/cgm'], 'og:title: "CGM Career"', DATE '2026-11-08'),
  ('chaptershealth~wd5~capitalcaringjobs', 'Capital Caring', ARRAY['https://chaptershealth.wd5.myworkdayjobs.com/capitalcaringjobs'], 'og:title: "Capital Caring External Career Site"', DATE '2026-11-08'),
  ('charlottenc', 'City of Charlotte', ARRAY['https://charlottenc.wd12.myworkdayjobs.com/citgov'], 'og:description: "Our City, Our Mission When you join the City of Charlotte, you become part of Team Charlotte — a dedicated group of professionals working together..."', DATE '2026-11-08'),
  ('chartermfg', 'Charter Manufacturing', ARRAY['https://chartermfg.wd5.myworkdayjobs.com/Charter_Careers'], 'og:title: "Careers at Charter Manufacturing"', DATE '2026-11-08'),
  ('chghealthcare', 'CHG Healthcare', ARRAY['https://chghealthcare.wd1.myworkdayjobs.com/External'], 'og:description: "Since founding the locum tenens industry in 1979, CHG Healthcare has been dedicated to serving the healthcare workforce and making a difference in human..."', DATE '2026-11-08'),
  ('christmanco', 'The Christman Company', ARRAY['https://christmanco.wd108.myworkdayjobs.com/careers/job/Mesquite-TX/Electrician-Apprentice_R-100777'], 'posting: "...Notice to Recruiting Agencies (Unsolicited Resumes): The Christman Company does not accept unsolicited resumes from agencies. Please do not forward unsolicited..."', DATE '2026-11-17'),
  ('chrobinson', 'C.H. Robinson', ARRAY['https://chrobinson.wd5.myworkdayjobs.com/CHRobinson'], 'og:description: "Why Do You Belong at C.H. Robinson? C.H. Robinson solves logistics problems for companies across the globe and across..."', DATE '2026-11-08'),
  ('citicclsa', 'CITIC Securities International', ARRAY['https://citicclsa.wd3.myworkdayjobs.com/External'], 'og:title: "CITIC Securities International Careers"', DATE '2026-11-08'),
  ('citjpl', 'Jet Propulsion Laboratory', ARRAY['https://citjpl.wd5.myworkdayjobs.com/Jobs'], 'og:description: "Formed in 1936, the NASA Jet Propulsion Laboratory is a federally funded research and development center managed for NASA by the California..."', DATE '2026-11-17'),
  ('cityoforlando', 'City of Orlando', ARRAY['https://cityoforlando.wd5.myworkdayjobs.com/CityofOrlandoCareers'], 'og:description: "...you possess. Applications may be rejected if incomplete. City of Orlando accepts applications for current job openin"', DATE '2026-11-08'),
  ('clearesult', 'CLEAResult', ARRAY['https://clearesult.wd1.myworkdayjobs.com/CLEAResult_External_Careers'], 'og:description: "We change the way people use energy. CLEAResult started in Austin, Texas, in 2003 with a simple idea: a results-oriented company could..."', DATE '2026-11-08'),
  ('clearskyhealth', 'ClearSky Health', ARRAY['https://clearskyhealth.wd1.myworkdayjobs.com/CSH'], 'og:description: "Authentic. Inspiring. Transformative. ClearSky Health and our affiliated Hospitals provide high-quality care that transforms the lives of those..."', DATE '2026-11-08'),
  ('clearwateranalytics', 'Clearwater Analytics', ARRAY['https://clearwateranalytics.wd1.myworkdayjobs.com/Clearwater_Analytics_Careers'], 'og:description: "Thank you for your interest in a career with Clearwater! Clearwater Analytics (NYSE: CWAN) is transforming investment management with the industry''s most comprehensive..."', DATE '2026-11-08'),
  ('cmcmarkets', 'CMC Markets', ARRAY['https://cmcmarkets.wd3.myworkdayjobs.com/CMC_Markets_Careers'], 'og:description: "...with a vision to make financial markets more accessible, CMC Markets has grown into a FTSE 250 global multi-asset financial services firm, serving retail,..."', DATE '2026-11-08'),
  ('colemanwm', 'Coleman Worldwide Moving', ARRAY['https://colemanwm.wd1.myworkdayjobs.com/Coleman_Careers'], 'og:title: "Coleman Worldwide Moving Careers"', DATE '2026-11-08'),
  ('collectorsuniverse', 'Collectors', ARRAY['https://collectorsuniverse.wd1.myworkdayjobs.com/collectors'], 'og:description: "Collectors is the leading creator of innovative technology that provides value-added services for..."', DATE '2026-11-17'),
  ('collegeboard', 'College Board', ARRAY['https://collegeboard.wd1.myworkdayjobs.com/careers'], 'og:description: "College Board reaches more than 7 million students a year, helping them navigate the path from high..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~BCM', 'BCM Controls', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/BCM'], 'og:description: "BCM Controls is a leading provider of building automation, security systems and energy services for..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~Corpcareers', 'Comfort Systems USA', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/Corpcareers'], 'og:description: "Comfort Systems USA is composed of more than 45 operating companies in over 170 locations across the United..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~Design_Mechanical', 'Design Mechanical', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/Design_Mechanical'], 'og:description: "...First To Create A Winning Team At Comfort Systems USA – Design Mechanical, Inc., we care about our employees, their work-life balance, and their professional..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~DynaTen', 'DynaTen', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/DynaTen'], 'og:description: "DynaTen leads the Dallas/Fort Worth Metroplex in engineering, mechanical contracting, building..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~SM_Lawrence', 'S.M. Lawrence', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/SM_Lawrence'], 'og:description: "As part of Comfort Systems USA with 44 sister companies, S.M. Lawrence has the capabilities and the resources to be a part of any building project. In addition..."', DATE '2026-11-08'),
  ('comfortsystemsusa~wd1~TempRight', 'Temp Right Service', ARRAY['https://comfortsystemsusa.wd1.myworkdayjobs.com/TempRight'], 'og:description: "Comfort Systems USA - Temp Right Service is the premier provider of residential and commercial HVAC, design and build,..."', DATE '2026-11-08'),
  ('conagrabrands', 'Conagra Brands', ARRAY['https://conagrabrands.wd1.myworkdayjobs.com/Careers_US'], 'og:description: "At Conagra Brands, we have a rich heritage of making great food. We aspire to have the most impactful,..."', DATE '2026-11-08'),
  ('coorstek', 'CoorsTek', ARRAY['https://coorstek.wd1.myworkdayjobs.com/CoorsTekCareers'], 'og:description: "...Making the world measurably better...one person at a time. CoorsTek products and components touch people''s lives in unexpected, awe-inspiring ways. Though..."', DATE '2026-11-08'),
  ('corebridgefinancial~wd1~CorebridgeFinancial', 'Corebridge Financial', ARRAY['https://corebridgefinancial.wd1.myworkdayjobs.com/CorebridgeFinancial'], 'og:description: "Thank you for your interest in careers at Corebridge Financial and for creating a user account on our Careers site. This page will allow you to check..."', DATE '2026-11-08'),
  ('corpartners~wd5~COR', 'Cor Partners', ARRAY['https://corpartners.wd5.myworkdayjobs.com/COR'], 'og:title: "Cor Partners Careers"', DATE '2026-11-08'),
  ('corpartners~wd5~EngleMartin', 'Engle Martin', ARRAY['https://corpartners.wd5.myworkdayjobs.com/EngleMartin'], 'og:description: "Engle Martin was formed with a comprehensive business philosophy: to provide the best insurance claim..."', DATE '2026-11-08'),
  ('corrohealth', 'CorroHealth', ARRAY['https://corrohealth.wd1.myworkdayjobs.com/Corro'], 'og:description: "CorroHealth sits at the center of the revenue cycle revolution. Fundamental operations of the revenue..."', DATE '2026-11-08'),
  ('countryfinancial~wd5~COUNTRYAgencyExternal', 'COUNTRY Financial', ARRAY['https://countryfinancial.wd5.myworkdayjobs.com/COUNTRYAgencyExternal'], 'og:description: "COUNTRY Financial® Insurance Agents and COUNTRY Trust Bank® Financial Advisors are independent contractors..."', DATE '2026-11-08'),
  ('countryfinancial~wd5~COUNTRYCorporateExternal', 'COUNTRY Financial', ARRAY['https://countryfinancial.wd5.myworkdayjobs.com/wday/cxs/countryfinancial/COUNTRYCorporateExternal/sidebar'], 'sidebar: "Start a corporate career with COUNTRY Financial® today!"', DATE '2026-11-08'),
  ('countryfinancial~wd5~IllinoisFarmBureau', 'Illinois Farm Bureau', ARRAY['https://countryfinancial.wd5.myworkdayjobs.com/IllinoisFarmBureau'], 'og:description: "Plant your roots with a career at Illinois Farm Bureau! IFB is headquartered in Bloomington, IL, with hybrid positions available at our home..."', DATE '2026-11-08'),
  ('creditacceptance', 'Credit Acceptance', ARRAY['https://creditacceptance.wd5.myworkdayjobs.com/Credit_Acceptance'], 'og:title: "Credit Acceptance Careers"', DATE '2026-11-08'),
  ('crhc', 'Concord Hospital', ARRAY['https://crhc.wd1.myworkdayjobs.com/Concord_Careers'], 'og:description: "Concord Hospital (CH) is a nationally-accredited, progressive regional health system. Over the past two..."', DATE '2026-11-17'),
  ('crossoverhealth', 'Crossover Health', ARRAY['https://crossoverhealth.wd1.myworkdayjobs.com/Careers'], 'og:description: "...so that we can keep you updated on future job openings. Crossover Health is creating the future of health as it should be. A national, team-based medical group..."', DATE '2026-11-08'),
  ('crystalsugar', 'Crystal Sugar', ARRAY['https://crystalsugar.wd501.myworkdayjobs.com/crystalcareers'], 'og:description: "Our Cooperative Grows Opportunity. American Crystal Sugar Company is more than just a sugarbeet cooperative. Our company is deeply rooted in the..."', DATE '2026-11-08'),
  ('csagroup', 'CSA Group', ARRAY['https://csagroup.wd3.myworkdayjobs.com/csagroup'], 'og:title: "Careers at CSA Group"', DATE '2026-11-08'),
  ('csusystem', 'Colorado State University', ARRAY['https://csusystem.wd12.myworkdayjobs.com/fortcollins_careers'], 'og:description: "Inspired by its land-grant heritage, Colorado State University is committed to excellence and engagement, setting the standard for public research..."', DATE '2026-11-08'),
  ('daikinapplied', 'Daikin Applied', ARRAY['https://daikinapplied.wd1.myworkdayjobs.com/Daikin-Careers'], 'og:description: "...to connect, live and work. Perfecting the air we share. Daikin Applied is not just an HVAC company. We''re part of a global technology powerhouse that uses..."', DATE '2026-11-08'),
  ('dallascityhall', 'City of Dallas', ARRAY['https://dallascityhall.wd5.myworkdayjobs.com/codcareers'], 'og:description: "The City of Dallas is one of the largest employers in the DFW Metroplex. We offer growth opportunities and a..."', DATE '2026-11-08'),
  ('dallascollege', 'Dallas College', ARRAY['https://dallascollege.wd1.myworkdayjobs.com/Dallas_College_Careers'], 'og:description: "Dallas College is one of the largest community colleges in Texas. Since 1965, we have helped almost 3..."', DATE '2026-11-08'),
  ('datev', 'DATEV', ARRAY['https://datev.wd3.myworkdayjobs.com/Datev_Careers'], 'og:description: "...transparently, and responsibly. Information about DATEV Imprint Data Protection Click here for the English career page: Job vacancies @DATEV"', DATE '2026-11-08'),
  ('davispolk', 'Davis Polk', ARRAY['https://davispolk.wd5.myworkdayjobs.com/business-professionals-services-usa'], 'og:description: "Davis Polk is not only a top-tier law firm. We are a unique community of highly motivated..."', DATE '2026-11-08'),
  ('dealertire~wd5~4710', 'Dent Wizard', ARRAY['https://dealertire.wd5.myworkdayjobs.com/4710'], 'og:description: "About Dent Wizard: Crafting Excellence in Automotive Reconditioning At Dent Wizard, we''ve dedicated..."', DATE '2026-11-08'),
  ('dealertire~wd5~Sonsio', 'Sonsio', ARRAY['https://dealertire.wd5.myworkdayjobs.com/Sonsio'], 'og:description: "With a comprehensive lineup of Vehicle Protection plans, Sonsio offers industry-leading programs that cover Tire Road Hazard Protection, Appearance,..."', DATE '2026-11-08'),
  ('destinationpet', 'Destination Pet', ARRAY['https://destinationpet.wd5.myworkdayjobs.com/DPEC'], 'og:description: "Destination Pet, headquartered in Irving, Texas, is a national network of pet-obsessed professionals..."', DATE '2026-11-08'),
  ('digitalturbine', 'Digital Turbine', ARRAY['https://digitalturbine.wd501.myworkdayjobs.com/Digital_Turbine_External_Careers'], 'og:title: "Digital Turbine Careers"', DATE '2026-11-08'),
  ('dlapiper', 'DLA Piper', ARRAY['https://dlapiper.wd1.myworkdayjobs.com/dlapiper'], 'og:description: "DLA Piper is, at its core, bold, exceptional, collaborative and supportive Our people are the..."', DATE '2026-11-08'),
  ('drinkpak', 'DrinkPAK', ARRAY['https://drinkpak.wd503.myworkdayjobs.com/DrinkPAK'], 'og:title: "DrinkPAK Careers"', DATE '2026-11-08'),
  ('druryhotels', 'Drury Hotels', ARRAY['https://druryhotels.wd5.myworkdayjobs.com/druryjobs'], 'og:description: "At Drury Hotels, we prioritize our team''s personal growth and career development. As part of our team,..."', DATE '2026-11-17'),
  ('dsvgruppe', 'DSV-Gruppe', ARRAY['https://dsvgruppe.wd103.myworkdayjobs.com/DSV'], 'og:title: "DSV-Gruppe Karriere"', DATE '2026-11-08'),
  ('dukeenergy', 'Duke Energy', ARRAY['https://dukeenergy.wd1.myworkdayjobs.com/search'], 'og:description: "Current Duke Energy Employees Current employees should utilize the internal career page to apply for..."', DATE '2026-11-08'),
  ('dupont', 'DuPont', ARRAY['https://dupont.wd5.myworkdayjobs.com/Jobs'], 'og:description: "...into real world answers that help humanity prosper! DuPont is an equal opportunity employer. Qualified applicants will be considered without regard..."', DATE '2026-11-08'),
  ('dynastymanagement~wd12~GREENWAY', 'Greenway Equipment', ARRAY['https://dynastymanagement.wd12.myworkdayjobs.com/GREENWAY'], 'og:title: "Greenway Equipment Careers"', DATE '2026-11-08'),
  ('dynastymanagement~wd12~SCOTT_PETROLEUM', 'Scott Petroleum', ARRAY['https://dynastymanagement.wd12.myworkdayjobs.com/SCOTT_PETROLEUM'], 'og:description: "Scott Petroleum Corporation was founded as Scott Butane in 1935 by Solon A Scott Sr. as a distributor of..."', DATE '2026-11-08'),
  ('earlywarning', 'Early Warning', ARRAY['https://earlywarning.wd5.myworkdayjobs.com/earlywarningcareers'], 'og:description: "...for open positions via Job Hub in your Workday Account. Early Warning Services® delivers innovative payment and risk solutions to financial institutions..."', DATE '2026-11-08'),
  ('ebi~wd5~afbcareers', 'AFB International', ARRAY['https://ebi.wd5.myworkdayjobs.com/afbcareers'], 'og:title: "Careers at AFB International"', DATE '2026-11-08'),
  ('ebi~wd5~ebicareers', 'Ensign-Bickford Industries', ARRAY['https://ebi.wd5.myworkdayjobs.com/ebicareers'], 'og:title: "Careers at Ensign-Bickford Industries, Inc."', DATE '2026-11-08'),
  ('ebi~wd5~envirologixcareers', 'EnviroLogix', ARRAY['https://ebi.wd5.myworkdayjobs.com/envirologixcareers'], 'og:title: "Careers at EnviroLogix"', DATE '2026-11-08'),
  ('ebnhc', 'NeighborHealth', ARRAY['https://ebnhc.wd1.myworkdayjobs.com/EBNHC'], 'og:description: "There''s a reason NeighborHealth (formerly East Boston Neighborhood Health Center) is ranked as one of the "Top Places to..."', DATE '2026-11-08'),
  ('elderslimited', 'Elders', ARRAY['https://elderslimited.wd3.myworkdayjobs.com/Elders'], 'og:title: "Elders Careers"', DATE '2026-11-08'),
  ('elliottdavis', 'Elliott Davis', ARRAY['https://elliottdavis.wd5.myworkdayjobs.com/ED'], 'og:description: "Elliott Davis pairs forward-thinking tax, assurance and consulting services with industry-leading..."', DATE '2026-11-08'),
  ('emerysapp~wd501~ESS', 'Emery Sapp & Sons', ARRAY['https://emerysapp.wd501.myworkdayjobs.com/ESS'], 'og:description: "Emery Sapp & Sons, Inc. (ESS) is all about owning what we do from start to finish. We''re a 100%..."', DATE '2026-11-08'),
  ('emerysapp~wd501~RUM', 'Rummel Construction', ARRAY['https://emerysapp.wd501.myworkdayjobs.com/RUM'], 'og:description: "Rummel Construction is all about owning what we do from start to finish. We''re a 100% employee owned heavy..."', DATE '2026-11-08'),
  ('epicorsoftware', 'Epicor', ARRAY['https://epicorsoftware.wd5.myworkdayjobs.com/epicorjobs'], 'og:title: "Careers at Epicor"', DATE '2026-11-08'),
  ('erm', 'ERM', ARRAY['https://erm.wd3.myworkdayjobs.com/ERM_Careers'], 'og:description: "At ERM, sustainability is our business. We are the world''s largest advisory firm focused solely..."', DATE '2026-11-17'),
  ('eroadgroup', 'EROAD', ARRAY['https://eroadgroup.wd3.myworkdayjobs.com/EROAD'], 'og:description: "EROAD provide in-vehicle technology solutions to fleets in New Zealand, Australia and North..."', DATE '2026-11-08'),
  ('eset', 'ESET', ARRAY['https://eset.wd3.myworkdayjobs.com/ESET_External'], 'og:description: "Join ESET Talent Community and we will contact you. This is an option for candidates who haven''t..."', DATE '2026-11-08'),
  ('etch', 'Dolly Parton Children''s Hospital', ARRAY['https://etch.wd5.myworkdayjobs.com/ETCH'], 'og:description: "At Dolly Parton Children''s Hospital, care is at the CORE of who we are. We are comprised of team members who live out our..."', DATE '2026-11-08'),
  ('factset', 'FactSet', ARRAY['https://factset.wd108.myworkdayjobs.com/FactSetCareers'], 'og:title: "FactSet Careers"', DATE '2026-11-08'),
  ('fanniemae', 'Fannie Mae', ARRAY['https://fanniemae.wd1.myworkdayjobs.com/FannieMaeCareers'], 'og:description: "...community to be the first to hear about happenings at Fannie Mae and share your experience to hear about potential job opportunities for you. As a Fortune..."', DATE '2026-11-08'),
  ('fau', 'Florida Atlantic University', ARRAY['https://fau.wd1.myworkdayjobs.com/FAU'], 'og:description: "Florida Atlantic University is Where Tomorrow Begins. As a nationally recognized Carnegie R1 research institution and..."', DATE '2026-11-08'),
  ('ffive', 'F5', ARRAY['https://ffive.wd5.myworkdayjobs.com/f5jobs'], 'og:title: "Careers at F5"', DATE '2026-11-17'),
  ('fib', 'First Interstate Bank', ARRAY['https://fib.wd1.myworkdayjobs.com/FIBCareers'], 'og:description: "First Interstate Bank is an equal opportunity employer committed to a diverse workforce and a barrier-free..."', DATE '2026-11-08'),
  ('fico', 'FICO', ARRAY['https://fico.wd1.myworkdayjobs.com/External'], 'og:description: "FICO powers decisions that help people and businesses around the world prosper. Founded in..."', DATE '2026-11-08'),
  ('fimc', 'Fairway Independent Mortgage', ARRAY['https://fimc.wd1.myworkdayjobs.com/Fairway_Careers'], 'og:description: "At Fairway Independent Mortgage Corporation, we''ve been committed to delivering exceptional service and fostering a..."', DATE '2026-11-08'),
  ('firstam~wd1~fctcareers', 'FCT', ARRAY['https://firstam.wd1.myworkdayjobs.com/fctcareers'], 'og:title: "FCT Careers"', DATE '2026-11-08'),
  ('firstam~wd1~firstamericancareers', 'First American', ARRAY['https://firstam.wd1.myworkdayjobs.com/firstamericancareers'], 'og:description: "Our people are the foundation of First American''s success and that is the reason we put them first. This philosophy has cultivated a..."', DATE '2026-11-08'),
  ('firstquality', 'First Quality', ARRAY['https://firstquality.wd5.myworkdayjobs.com/FIRSTQUALITY'], 'og:description: "Founded over 35 years ago, First Quality is a family-owned company that has grown from a small business in McElhattan,..."', DATE '2026-11-08'),
  ('flagshipinc', 'Flagship', ARRAY['https://flagshipinc.wd5.myworkdayjobs.com/flagshipinc'], 'og:description: "...unchanged: From the CEO to the front-line workers, every Flagship employee works together to build long-term relationships with our clients by doing..."', DATE '2026-11-08'),
  ('flpoly', 'Florida Polytechnic University', ARRAY['https://flpoly.wd1.myworkdayjobs.com/External-Faculty'], 'og:description: "Florida Polytechnic University, started as a university of engineering and technology, is designed to be different so..."', DATE '2026-11-08'),
  ('fnz', 'FNZ', ARRAY['https://fnz.wd3.myworkdayjobs.com/fnz_careers'], 'og:description: "FNZ is committed to opening up wealth so that everyone, everywhere can invest in their future..."', DATE '2026-11-08'),
  ('formfactor', 'FormFactor', ARRAY['https://formfactor.wd1.myworkdayjobs.com/FFI-Careers'], 'og:title: "Careers at FormFactor"', DATE '2026-11-08'),
  ('freseniusglobal', 'Fresenius Kabi', ARRAY['https://freseniusglobal.wd3.myworkdayjobs.com/fk_careers_de'], 'og:title: "Fresenius Kabi Careers"', DATE '2026-11-08'),
  ('fticonsulting~wd108~CompassLexeconCareers', 'Compass Lexecon', ARRAY['https://fticonsulting.wd108.myworkdayjobs.com/CompassLexeconCareers'], 'og:description: "Compass Lexecon is a leading global economic consulting firm. We provide critical economic insight in..."', DATE '2026-11-08'),
  ('fticonsulting~wd108~FTIConsultingCareers', 'FTI Consulting', ARRAY['https://fticonsulting.wd108.myworkdayjobs.com/wday/cxs/fticonsulting/FTIConsultingCareers/sidebar'], 'sidebar: "...grow and achieve their full potential. To learn more about FTI Consulting, visit www.fticonsulting.com/careers and connect with us on Instagram and LinkedIn ."', DATE '2026-11-08'),
  ('fullsail', 'Full Sail', ARRAY['https://fullsail.wd1.myworkdayjobs.com/External'], 'og:description: "Mission People from around the world come to Full Sail University to pursue their educational goals, and they share one thing in common – a..."', DATE '2026-11-08'),
  ('gaig~wd1~GAIG_External', 'Great American Insurance Group', ARRAY['https://gaig.wd1.myworkdayjobs.com/GAIG_External'], 'og:title: "Careers at Great American Insurance Group"', DATE '2026-11-08'),
  ('gaig~wd1~National_Interstate_External', 'National Interstate Insurance', ARRAY['https://gaig.wd1.myworkdayjobs.com/National_Interstate_External'], 'og:title: "Careers at National Interstate Insurance Company"', DATE '2026-11-08'),
  ('gaig~wd1~Vanliner_External', 'Vanliner Insurance', ARRAY['https://gaig.wd1.myworkdayjobs.com/Vanliner_External'], 'og:title: "Careers at Vanliner Insurance Company"', DATE '2026-11-08'),
  ('gategroup', 'gategroup', ARRAY['https://gategroup.wd3.myworkdayjobs.com/GateGroup_External_Careers'], 'og:description: "gategroup is the global leader in airline catering, retail-on-board and hospitality products and..."', DATE '2026-11-08'),
  ('gcu~wd1~GCE', 'Grand Canyon Education', ARRAY['https://gcu.wd1.myworkdayjobs.com/GCE'], 'og:description: "At Grand Canyon Education, it is our privilege to serve students and those who support academic advancement. We..."', DATE '2026-11-17'),
  ('gcu~wd1~GCEC', 'Grand Canyon Education', ARRAY['https://gcu.wd1.myworkdayjobs.com/GCEC'], 'og:description: "At Grand Canyon Education, it is our privilege to serve students and those who support academic advancement. We..."', DATE '2026-11-17'),
  ('gcu~wd1~GCU', 'Grand Canyon University', ARRAY['https://gcu.wd1.myworkdayjobs.com/GCU/job/Tucson-AZ/Adjunct-RN-Faculty---Psychiatric-Clinical-Adjunct---Nursing---Tuscon_R000067323-1'], 'posting: "Grand Canyon University has an opening for Adjunct Clinical Nursing faculty members, and we invite applications..."', DATE '2026-11-17'),
  ('gcu~wd1~Orbis', 'Orbis Education', ARRAY['https://gcu.wd1.myworkdayjobs.com/Orbis'], 'og:description: "At Orbis Education, we create partnerships with universities to expand their pre-licensure healthcare..."', DATE '2026-11-17'),
  ('gea', 'GEA', ARRAY['https://gea.wd3.myworkdayjobs.com/GEACareers'], 'og:title: "Find a job at GEA"', DATE '2026-11-08'),
  ('geha', 'G.E.H.A', ARRAY['https://geha.wd5.myworkdayjobs.com/GEHACareers'], 'og:description: "...job market, if you receive correspondence from someone at G.E.H.A, we recommend you review the following facts to help verify if someone is truly a G.E.H.A..."', DATE '2026-11-17'),
  ('genesishcs', 'Genesis HealthCare System', ARRAY['https://genesishcs.wd1.myworkdayjobs.com/wday/cxs/genesishcs/GenesisHCS/sidebar'], 'sidebar: "...mission is to provide compassionate, quality healthcare. Genesis HealthCare System is an integrated healthcare delivery system based in Zanesville, Ohio. The system..."', DATE '2026-11-08'),
  ('georgesinc', 'George''s Inc', ARRAY['https://georgesinc.wd5.myworkdayjobs.com/JoinGeorges'], 'og:title: "George''s Inc"', DATE '2026-11-08'),
  ('georgiasown', 'Georgia''s Own', ARRAY['https://georgiasown.wd1.myworkdayjobs.com/GeorgiasOwnCareers'], 'og:description: "Georgia''s Own Credit Union named to 2025 Top Workplaces USA list Georgia''s Own Credit Union is proud to..."', DATE '2026-11-08'),
  ('giorgiglobal', 'CANPACK', ARRAY['https://giorgiglobal.wd3.myworkdayjobs.com/canpack'], 'og:description: "At CANPACK Group, our success is based on employees'' success. Our ability to grow and to be the..."', DATE '2026-11-17'),
  ('globelife', 'Globe Life', ARRAY['https://globelife.wd5.myworkdayjobs.com/Globe-Life-Careers'], 'og:description: "...No Ceiling The insurance industry may be traditional, but Globe Life has been, is, and always will be dedicated to building an inclusive, sustainable, and..."', DATE '2026-11-08'),
  ('godirect', 'Voya Financial', ARRAY['https://godirect.wd5.myworkdayjobs.com/voya_jobs'], 'og:description: "Voya Financial, Inc., is a leading retirement, employee benefits and investment management company...."', DATE '2026-11-17'),
  ('gphealth', 'Great Plains Health', ARRAY['https://gphealth.wd5.myworkdayjobs.com/wday/cxs/gphealth/GPH/sidebar'], 'sidebar: "Great Plains Health"', DATE '2026-11-08'),
  ('gundersenhealth', 'Gundersen Health System', ARRAY['https://gundersenhealth.wd5.myworkdayjobs.com/Gundersen'], 'og:description: "...in changing healthcare while finding a career you''ll love! Gundersen Health System offers a proud, local history spanning more than 100 years. Our personalized patient care..."', DATE '2026-11-08'),
  ('hancockwhitney', 'Hancock Whitney', ARRAY['https://hancockwhitney.wd5.myworkdayjobs.com/Careers'], 'og:description: "When you choose a career with Hancock Whitney (Nasdaq: HWC), we pledge a heartfelt promise: You can grow. You have a voice. You are..."', DATE '2026-11-08'),
  ('harvestroad', 'Harvest Road', ARRAY['https://harvestroad.wd105.myworkdayjobs.com/HIGCareers'], 'og:description: "...to sustainability through evidence-based practices, Harvest Road Group is proud to produce some of Australia''s highest quality food products. We are..."', DATE '2026-11-17'),
  ('hastingsdirect', 'Hastings Direct', ARRAY['https://hastingsdirect.wd3.myworkdayjobs.com/external_careers'], 'og:description: "...learn more about how we value diversity and inclusion at Hastings Direct and what our rewards and benefits package looks like? Are you interested in how we engage..."', DATE '2026-11-08'),
  ('henryschein', 'Henry Schein', ARRAY['https://henryschein.wd1.myworkdayjobs.com/External_Careers'], 'og:description: "Over 90 years ago Henry Schein borrowed $500 to start a corner pharmacy in Queens, New York, nearly 30 miles from..."', DATE '2026-11-08'),
  ('hl', 'Houlihan Lokey', ARRAY['https://hl.wd1.myworkdayjobs.com/Campus'], 'og:description: "Houlihan Lokey, Inc. (NYSE:HLI) is a leading global investment bank recognized for delivering..."', DATE '2026-11-17'),
  ('hntb', 'HNTB', ARRAY['https://hntb.wd5.myworkdayjobs.com/HNTB_Careers'], 'og:description: "At HNTB, we are harnessing the power of collaboration and innovation to establish a new vision..."', DATE '2026-11-08'),
  ('hriproperties', 'HRI Hospitality', ARRAY['https://hriproperties.wd12.myworkdayjobs.com/wday/cxs/hriproperties/HRI_Hospitality/sidebar'], 'sidebar: "Why Join HRI Hospitality?"', DATE '2026-11-08'),
  ('hss', 'Hospital for Special Surgery', ARRAY['https://hss.wd1.myworkdayjobs.com/en-US/HSS_Careers/job/New-York-NY/Nurse-Anesthetist_JR2025-101878-1'], 'posting: "nd healing environment. Consistent with this commitment, Hospital for Special Surgery provides care, admits, and treats patients and provides all services without regard to..."', DATE '2026-11-17'),
  ('hysteryale', 'Hyster-Yale', ARRAY['https://hysteryale.wd1.myworkdayjobs.com/Hyster-YaleCareers'], 'og:title: "Hyster-Yale Careers"', DATE '2026-11-08'),
  ('icf', 'ICF', ARRAY['https://icf.wd5.myworkdayjobs.com/ICFExternal_Career_Site'], 'og:title: "ICF Jobs"', DATE '2026-11-08'),
  ('icwgroup', 'ICW Group', ARRAY['https://icwgroup.wd5.myworkdayjobs.com/ICW'], 'og:description: "At ICW Group we offer a work environment that encourages entrepreneurialism and celebrates success...."', DATE '2026-11-08'),
  ('iheartmedia', 'iHeartMedia', ARRAY['https://iheartmedia.wd5.myworkdayjobs.com/External_iHM'], 'og:description: "...and want to be considered for future roles at iHeartMedia, we invite you to join our Talent Pool. Visit iHeartMedia.com to learn more about us...."', DATE '2026-11-08'),
  ('ijm', 'International Justice Mission', ARRAY['https://ijm.wd5.myworkdayjobs.com/careers-ijm'], 'og:description: "International Justice Mission (IJM) is the global leader in protecting vulnerable people from violence around the..."', DATE '2026-11-08'),
  ('ilb', 'Investitionsbank des Landes Brandenburg', ARRAY['https://ilb.wd103.myworkdayjobs.com/ilb_karriere'], 'og:description: "Die ILB - die Investitionsbank des Landes Brandenburg - ist das zentrale Förderinstitut für die Region Brandenburg. Gemeinsam beraten, fördern..."', DATE '2026-11-08'),
  ('ineos', 'INEOS', ARRAY['https://ineos.wd503.myworkdayjobs.com/INEOScareers'], 'og:description: "INEOS is a world class chemical company whose products touch every aspect of modern day life...."', DATE '2026-11-08'),
  ('intervarsity', 'InterVarsity', ARRAY['https://intervarsity.wd1.myworkdayjobs.com/wday/cxs/intervarsity/intervarsitychristianfellowshipcareers/sidebar'], 'sidebar: "...their faith, but they need someone to guide them. InterVarsity wants to reach the campus with the Good News, disciple students through Scripture and..."', DATE '2026-11-08'),
  ('irhythmtech', 'iRhythm', ARRAY['https://irhythmtech.wd5.myworkdayjobs.com/irhythm'], 'og:description: "At iRhythm, you''ll have the opportunity to grow your skills and your career while impacting the..."', DATE '2026-11-08'),
  ('isc', 'ISC', ARRAY['https://isc.wd10.myworkdayjobs.com/isc'], 'og:description: "Headquartered in Canada, ISC is a leading provider of registry and information management services for public data and..."', DATE '2026-11-17'),
  ('issgovernance', 'ISS STOXX', ARRAY['https://issgovernance.wd1.myworkdayjobs.com/ISScareers'], 'og:description: "ISS STOXX delivers world-class research, data, and technology solutions that empower capital market..."', DATE '2026-11-08'),
  ('jacksongov~wd5~court', '16th Judicial Circuit of Missouri', ARRAY['https://jacksongov.wd5.myworkdayjobs.com/court'], 'og:title: "16th Judicial Circuit of Missouri"', DATE '2026-11-08'),
  ('jadeglobal', 'Jade Global', ARRAY['https://jadeglobal.wd5.myworkdayjobs.com/Jade_Careers'], 'og:title: "Jade Global"', DATE '2026-11-08'),
  ('jcrew~wd1~MadewellCareers', 'Madewell', ARRAY['https://jcrew.wd1.myworkdayjobs.com/MadewellCareers/job/Las-Vegas-NV-USA-Downtown-Summerlin---Madewell/Stock-Associate_129702'], 'posting: "Our Story At Madewell, we believe that great style starts with great design. Since 2006, we''ve been creating..."', DATE '2026-11-17'),
  ('jda', 'Blue Yonder', ARRAY['https://jda.wd5.myworkdayjobs.com/JDA_Careers'], 'og:description: "...with respect, and operating with integrity. What do we do? Blue Yonder is the AI company for supply chain. As the world leader in end-to-end digital supply..."', DATE '2026-11-17'),
  ('jerrys', 'Jerry''s Enterprises', ARRAY['https://jerrys.wd1.myworkdayjobs.com/jerrysfoods'], 'og:description: "Jerry''s Enterprises, Inc. has a unique commitment to the customer and a strong history of excellence. For..."', DATE '2026-11-08'),
  ('jm', 'Johns Manville', ARRAY['https://jm.wd103.myworkdayjobs.com/External'], 'og:description: "Johns Manville is a proud member of the Berkshire Hathaway family of companies, serving customers in..."', DATE '2026-11-08'),
  ('johnsonbrothers', 'Johnson Brothers', ARRAY['https://johnsonbrothers.wd5.myworkdayjobs.com/JohnsonBrothers'], 'og:description: "Johnson Brothers is a third-generation, family-owned wine, beer, and spirits distributor founded in 1953..."', DATE '2026-11-08'),
  ('kaishaservice~wd1~GreenMetalsCareers', 'Green Metals', ARRAY['https://kaishaservice.wd1.myworkdayjobs.com/GreenMetalsCareers'], 'og:description: "Green Metals, Inc. is a new kind of scrap metal recycling and waste handling company with a business..."', DATE '2026-11-08'),
  ('kaishaservice~wd1~ToyotaTsushoAmerica', 'Toyota Tsusho America', ARRAY['https://kaishaservice.wd1.myworkdayjobs.com/ToyotaTsushoAmerica'], 'og:description: "Toyota Tsusho America, Inc. (TAI) is a multi-market, multi-business enterprise which has been operating in..."', DATE '2026-11-08'),
  ('kcura', 'Relativity', ARRAY['https://kcura.wd1.myworkdayjobs.com/External_Career_Site'], 'og:title: "Relativity Careers"', DATE '2026-11-08'),
  ('kimberlyclark', 'Kimberly-Clark', ARRAY['https://kimberlyclark.wd1.myworkdayjobs.com/global'], 'og:description: "...new ways to make a positive impact on the world we share. Kimberly-Clark and its trusted brands, including Huggies, Kleenex, Scott, Kotex, Cottonelle, Poise,..."', DATE '2026-11-08'),
  ('kmkp~wd1~KACECareers', 'KACE', ARRAY['https://kmkp.wd1.myworkdayjobs.com/KACECareers'], 'og:title: "KACE Job Openings"', DATE '2026-11-08'),
  ('kmkp~wd1~TPGCareers', 'Providencia', ARRAY['https://kmkp.wd1.myworkdayjobs.com/TPGCareers'], 'og:title: "Providencia Job Openings"', DATE '2026-11-08'),
  ('kmkp~wd1~careers', 'MVM', ARRAY['https://kmkp.wd1.myworkdayjobs.com/careers'], 'og:description: "MVM, Inc. is a professional services firm with 2,500 employees and counting across the United..."', DATE '2026-11-08'),
  ('kpluss', 'K+S', ARRAY['https://kpluss.wd3.myworkdayjobs.com/Career-KplusS'], 'og:title: "Career@K+S"', DATE '2026-11-08'),
  ('ksb', 'KSB', ARRAY['https://ksb.wd3.myworkdayjobs.com/KSB_ExternalCareerSite'], 'og:description: "KSB is a leading supplier of pumps, valves and related service. Our reliable, high-efficiency..."', DATE '2026-11-08'),
  ('ksbe', 'Kamehameha Schools', ARRAY['https://ksbe.wd1.myworkdayjobs.com/External'], 'og:title: "Kamehameha Schools Careers"', DATE '2026-11-08'),
  ('kumc', 'University of Kansas Medical Center', ARRAY['https://kumc.wd5.myworkdayjobs.com/kumc-jobs'], 'og:title: "University of Kansas Medical Center"', DATE '2026-11-08'),
  ('languageline~wd5~HAS_Careers', 'Health Advocate', ARRAY['https://languageline.wd5.myworkdayjobs.com/HAS_Careers'], 'og:description: "...to them not getting the care they need when they need it. Health Advocate makes healthcare easier for organizations, their employees, and their employees'' family..."', DATE '2026-11-08'),
  ('languageline~wd5~LLS_Careers', 'LanguageLine', ARRAY['https://languageline.wd5.myworkdayjobs.com/LLS_Careers'], 'og:description: "Important Notice to Candidates: There may be LanguageLine imposters on some recruiting platforms, so be aware of the following: LanguageLine does..."', DATE '2026-11-08'),
  ('leecompany', 'Lee Company', ARRAY['https://leecompany.wd1.myworkdayjobs.com/LeeCompany'], 'og:description: "Built on Expertise. Powered by People. Lee Company started with one truck and a passion for serving families and businesses. Three..."', DATE '2026-11-08'),
  ('lendingclub', 'Happen Bank', ARRAY['https://lendingclub.wd1.myworkdayjobs.com/External'], 'og:description: "Happen Bank (formerly LendingClub) is built around a simple purpose: to clear the way to help people..."', DATE '2026-11-08'),
  ('lfb', 'LFB', ARRAY['https://lfb.wd3.myworkdayjobs.com/LFB_External_Careers'], 'og:description: "Today, LFB is among the leading European bio-pharmaceutical companies providing mainly..."', DATE '2026-11-08'),
  ('lifefitness', 'Life Fitness', ARRAY['https://lifefitness.wd1.myworkdayjobs.com/searchLFN'], 'og:description: "Life Fitness / Hammer Strength has been inspiring the world to work out for more than 55 years. Every..."', DATE '2026-11-08'),
  ('livanova', 'LivaNova', ARRAY['https://livanova.wd5.myworkdayjobs.com/Search'], 'og:description: "...families. Interested in learning more about working at LivaNova? Visit careers.livanova.com for more."', DATE '2026-11-08'),
  ('llbean', 'L.L.Bean', ARRAY['https://llbean.wd1.myworkdayjobs.com/LLBean_Careers'], 'og:description: "...everything we make. So join us, adventure awaits... At L.L.Bean, we believe the outdoors brings out the best in all of us. We are commi"', DATE '2026-11-08'),
  ('loewshotels', 'Loews Hotels', ARRAY['https://loewshotels.wd5.myworkdayjobs.com/loewshotels'], 'og:description: "Headquartered in New York City, Loews Hotels & Co is rooted in deep heritage in the hotel industry and excellence in service. As one..."', DATE '2026-11-08'),
  ('loganhealth', 'Logan Health', ARRAY['https://loganhealth.wd1.myworkdayjobs.com/Logan_Careers'], 'og:description: "At Logan Health, our work is driven by our mission, vision, and values: Our Mission Quality,..."', DATE '2026-11-08'),
  ('lplfinancial', 'LPL Financial', ARRAY['https://lplfinancial.wd1.myworkdayjobs.com/External'], 'og:description: "LPL Financial is the nation''s largest independent broker-dealer.* Our company is widely known for its..."', DATE '2026-11-08'),
  ('lumaenergy', 'LUMA', ARRAY['https://lumaenergy.wd1.myworkdayjobs.com/lumacareers'], 'og:description: "LUMA was created especially for Puerto Rico. We combine the expertise and resources of our..."', DATE '2026-11-17'),
  ('luriechildrens', 'Ann & Robert H. Lurie Children''s Hospital of Chicago', ARRAY['https://luriechildrens.wd1.myworkdayjobs.com/externalportal'], 'og:description: "Ann & Robert H. Lurie Children''s Hospital of Chicago provides superior pediatric care in a setting that offers the latest benefits and..."', DATE '2026-11-17'),
  ('madrigalpharma', 'Madrigal', ARRAY['https://madrigalpharma.wd501.myworkdayjobs.com/Madrigal'], 'og:description: "...transforming the treatment of people with liver diseases. Madrigal is an Equal Opportunity Employer. All employment is decided on the basis of..."', DATE '2026-11-08'),
  ('mainegeneral', 'MaineGeneral', ARRAY['https://mainegeneral.wd5.myworkdayjobs.com/MaineGeneralCareers'], 'og:description: "MaineGeneral participates in E-Verify. Click the links below to view more information regarding..."', DATE '2026-11-08'),
  ('manh', 'Manhattan Associates', ARRAY['https://manh.wd5.myworkdayjobs.com/External'], 'og:description: "At Manhattan Associates our supply chain and omnichannel technology positively affect how people work, shop and..."', DATE '2026-11-08'),
  ('marathonhealth', 'Marathon Health', ARRAY['https://marathonhealth.wd501.myworkdayjobs.com/Marathon-Health-Careers'], 'og:description: "Marathon Health is a leading advanced primary care provider, partnering with employer and union plan..."', DATE '2026-11-08'),
  ('maryfreebed', 'Mary Free Bed Rehabilitation Hospital', ARRAY['https://maryfreebed.wd12.myworkdayjobs.com/MFB'], 'og:title: "Mary Free Bed Rehabilitation Hospital"', DATE '2026-11-08'),
  ('marywashingtonhealthcare', 'Mary Washington Healthcare', ARRAY['https://marywashingtonhealthcare.wd5.myworkdayjobs.com/Externalcareers'], 'og:description: "Working at Mary Washington Healthcare Whether you are a new grad, experienced clinical professional or wanting to begin a..."', DATE '2026-11-08'),
  ('massmutual', 'MassMutual', ARRAY['https://massmutual.wd1.myworkdayjobs.com/MMCareers'], 'og:description: "At MassMutual, we''re passionate about helping people secure their future and protect the ones they..."', DATE '2026-11-08'),
  ('mattressfirm', 'Mattress Firm', ARRAY['https://mattressfirm.wd1.myworkdayjobs.com/MattressFirmCareers'], 'og:description: "...for making a difference every day. In just under 40 years, Mattress Firm has grown to more than 2,400 stores nationwide, supported by a team of more than 6,000..."', DATE '2026-11-08'),
  ('maxar~wd1~Vantor', 'Vantor', ARRAY['https://maxar.wd1.myworkdayjobs.com/Vantor'], 'og:description: "Vantor is forging the new frontier of spatial intelligence, helping decision makers and..."', DATE '2026-11-17'),
  ('mbda', 'MBDA', ARRAY['https://mbda.wd3.myworkdayjobs.com/MBDA-UK'], 'og:description: "...Whatever your background, we welcome your application to MBDA UK and look forward to speaking with you soon."', DATE '2026-11-08'),
  ('mc', 'Montgomery College', ARRAY['https://mc.wd1.myworkdayjobs.com/external'], 'og:description: "Thank you for your interest in working at Montgomery College! Montgomery College respects the privacy of candidates for employment. When you use this..."', DATE '2026-11-08'),
  ('mchapusa', 'Marketplace Chaplains', ARRAY['https://mchapusa.wd5.myworkdayjobs.com/MCHAP_External'], 'og:description: "Marketplace Chaplains is the largest and longest continuing provider of workplace chaplains to corporate..."', DATE '2026-11-08'),
  ('mechanicsbank', 'Mechanics Bank', ARRAY['https://mechanicsbank.wd5.myworkdayjobs.com/MechanicsBank'], 'og:description: "About Mechanics Bank Backed by exceptional capital strength and substantial assets, we are a resilient and..."', DATE '2026-11-08'),
  ('medimpact', 'MedImpact', ARRAY['https://medimpact.wd5.myworkdayjobs.com/MedImpact'], 'og:description: "MedImpact was founded more than three decades ago by a pharmacist and independent drug store owner..."', DATE '2026-11-08'),
  ('melocheinc', 'Meloche', ARRAY['https://melocheinc.wd10.myworkdayjobs.com/emploismelocheinc'], 'og:description: "Le Groupe Meloche, fondé en 1974 à Salaberry-de-Valleyfield, est un chef de file en fabrication de..."', DATE '2026-11-08'),
  ('merceruniversity~wd1~external', 'Mercer University', ARRAY['https://merceruniversity.wd1.myworkdayjobs.com/external'], 'og:title: "Careers at Mercer University"', DATE '2026-11-08'),
  ('merceruniversity~wd1~student', 'Mercer University', ARRAY['https://merceruniversity.wd1.myworkdayjobs.com/student'], 'og:description: "...– About Us Student employees are vital to the success of Mercer University. At Mercer, we are dedicated to helping students find meaningful on-campus jobs and..."', DATE '2026-11-08'),
  ('methodisthealthsystem', 'Methodist Health System', ARRAY['https://methodisthealthsystem.wd1.myworkdayjobs.com/MHS_Careers'], 'og:description: "Methodist Health System is a faith-based organization with a mission to improve and save lives through..."', DATE '2026-11-17'),
  ('mfs', 'MFS', ARRAY['https://mfs.wd1.myworkdayjobs.com/MFS-Careers'], 'og:title: "MFS Careers"', DATE '2026-11-17'),
  ('miamioh', 'Miami University', ARRAY['https://miamioh.wd5.myworkdayjobs.com/miamioh-staff'], 'og:description: "Miami University is a major public university with a small college feel. Creating environments for..."', DATE '2026-11-08'),
  ('michelinhr', 'Michelin', ARRAY['https://michelinhr.wd3.myworkdayjobs.com/Michelin'], 'og:title: "Michelin careers"', DATE '2026-11-08'),
  ('minnstate', 'Minnesota State', ARRAY['https://minnstate.wd115.myworkdayjobs.com/Minnesota_State_Careers'], 'og:description: "...for new and prospective employees Welcome to the Minnesota State career site for external applicants. This page allows you to search for jobs, apply, and..."', DATE '2026-11-17'),
  ('missionaustralia', 'Mission Australia', ARRAY['https://missionaustralia.wd3.myworkdayjobs.com/MissionAustralia'], 'og:description: "Mission Australia is a national Christian charity motivated by a shared vision of an Australia where..."', DATE '2026-11-08'),
  ('modernatx', 'Moderna', ARRAY['https://modernatx.wd1.myworkdayjobs.com/M_tx'], 'og:description: "Our Mission and Vision At Moderna we are pioneering the development of a new class of drugs made of messenger RNA (mRNA)...."', DATE '2026-11-08'),
  ('monolithicpower', 'Monolithic Power Systems', ARRAY['https://monolithicpower.wd12.myworkdayjobs.com/MPS_Careers'], 'og:description: "Welcome to Monolithic Power Systems, Inc. Careers! Can''t find a suitable opening? Join our talent community using the "Get..."', DATE '2026-11-08'),
  ('morganlewis', 'Morgan Lewis', ARRAY['https://morganlewis.wd5.myworkdayjobs.com/morganlewis'], 'og:description: "At Morgan Lewis, we work in collaboration around the world—always ready to respond to the needs of our..."', DATE '2026-11-08'),
  ('msiexpress', 'MSI Express', ARRAY['https://msiexpress.wd5.myworkdayjobs.com/MSI_Express_External_Careers'], 'og:title: "MSI Express Careers"', DATE '2026-11-08'),
  ('msssecurity', 'MSS Security', ARRAY['https://msssecurity.wd105.myworkdayjobs.com/MSS'], 'og:description: "...including, with a national footprint across Australia, MSS Security has unrivalled experience in delivering the highest quality of service & protecting some..."', DATE '2026-11-08'),
  ('msudenver', 'MSU Denver', ARRAY['https://msudenver.wd1.myworkdayjobs.com/MSUDenver'], 'og:title: "MSU Denver Careers"', DATE '2026-11-08'),
  ('mwaa', 'Metropolitan Washington Airports Authority', ARRAY['https://mwaa.wd1.myworkdayjobs.com/MWAA'], 'og:description: "...Airport? Or the Dulles Toll Road? We do! We''re the Metropolitan Washington Airports Authority and we''re looking for talented, enthusiastic people to help us continue our tradition of..."', DATE '2026-11-08'),
  ('myhana', 'Maui Jim', ARRAY['https://myhana.wd5.myworkdayjobs.com/mauijim'], 'og:description: "At Maui Jim we are passionate about making the best sunglasses in the world and providing customer..."', DATE '2026-11-17'),
  ('myhrhome', 'OneMain Financial', ARRAY['https://myhrhome.wd1.myworkdayjobs.com/OneMainCareers'], 'og:description: "OneMain Financial (NYSE: OMF) is the leader in offering nonprime customers responsible access to credit and..."', DATE '2026-11-17'),
  ('nationalchurchresidences', 'National Church Residences', ARRAY['https://nationalchurchresidences.wd5.myworkdayjobs.com/wday/cxs/nationalchurchresidences/careers/sidebar'], 'sidebar: "About National Church Residences"', DATE '2026-11-08'),
  ('nationwidechildrens', 'Nationwide Children''s', ARRAY['https://nationwidechildrens.wd5.myworkdayjobs.com/NCHCareers'], 'og:description: "...who works here, you want to be part of it. Welcome to Nationwide Children''s Hospital, Where Passion Meets Purpose. Here, Diversity, Equity and Inclusion are..."', DATE '2026-11-08'),
  ('navcanada', 'NAV CANADA', ARRAY['https://navcanada.wd10.myworkdayjobs.com/NAV_Careers'], 'og:description: "NAV CANADA employees help guide the world''s aircraft safely and expeditiously through..."', DATE '2026-11-08'),
  ('nbtbancorp', 'NBT Bank', ARRAY['https://nbtbancorp.wd12.myworkdayjobs.com/NBT-B'], 'og:description: "NBT Bank offers a stimulating work environment that recognizes talent and encourages teamwork. Our..."', DATE '2026-11-08'),
  ('ncratleos', 'NCR Atleos', ARRAY['https://ncratleos.wd1.myworkdayjobs.com/ext_non_usalteos'], 'og:description: "...innovation to financial institutions across the globe. At NCR Atleos, you''ll have meaningful and relevant work experiences, with opportunities to learn and..."', DATE '2026-11-08'),
  ('nebraskamed', 'Nebraska Medicine', ARRAY['https://nebraskamed.wd5.myworkdayjobs.com/NM'], 'og:description: "Nebraska Medicine includes two hospitals, the state''s largest and highest rated Nebraska Medical Center and..."', DATE '2026-11-08'),
  ('newperkinelmer', 'PerkinElmer', ARRAY['https://newperkinelmer.wd1.myworkdayjobs.com/External'], 'og:description: "...of people and create a healthier world? When you work at PerkinElmer, that''s exactly what you''ll do. From our dedicated scientists and world-class operations..."', DATE '2026-11-08'),
  ('nghs', 'Northeast Georgia Health System', ARRAY['https://nghs.wd1.myworkdayjobs.com/External'], 'og:description: "Northeast Georgia Health System (NGHS) is a non-profit on a mission of improving the health of our community in all we..."', DATE '2026-11-17'),
  ('nordsonhcm', 'Nordson', ARRAY['https://nordsonhcm.wd501.myworkdayjobs.com/nordsoncareers'], 'og:description: "At Nordson, we believe that anything is possible. We empower our global team of employees to..."', DATE '2026-11-08'),
  ('northwesternmutual', 'Northwestern Mutual', ARRAY['https://northwesternmutual.wd5.myworkdayjobs.com/CORPORATE-CAREERS'], 'og:title: "Northwestern Mutual"', DATE '2026-11-08'),
  ('nrpgroup', 'NRP', ARRAY['https://nrpgroup.wd1.myworkdayjobs.com/NRP'], 'og:title: "NRP Careers"', DATE '2026-11-08'),
  ('nshe~wd1~CSN-External', 'College of Southern Nevada', ARRAY['https://nshe.wd1.myworkdayjobs.com/CSN-External'], 'og:title: "College of Southern Nevada"', DATE '2026-11-17'),
  ('nshe~wd1~DRI-External', 'Desert Research Institute', ARRAY['https://nshe.wd1.myworkdayjobs.com/DRI-External'], 'og:title: "Desert Research Institute"', DATE '2026-11-17'),
  ('nshe~wd1~GBC-external', 'Great Basin College', ARRAY['https://nshe.wd1.myworkdayjobs.com/GBC-external'], 'og:title: "Great Basin College"', DATE '2026-11-17'),
  ('nshe~wd1~NSHE-external', 'Nevada System of Higher Education', ARRAY['https://nshe.wd1.myworkdayjobs.com/NSHE-external'], 'og:title: "Nevada System of Higher Education"', DATE '2026-11-17'),
  ('nshe~wd1~NSU-external', 'Nevada State University', ARRAY['https://nshe.wd1.myworkdayjobs.com/NSU-external'], 'og:title: "Nevada State University"', DATE '2026-11-17'),
  ('nshe~wd1~TMCC-External', 'Truckee Meadows Community College', ARRAY['https://nshe.wd1.myworkdayjobs.com/TMCC-External'], 'og:title: "Truckee Meadows Community College"', DATE '2026-11-17'),
  ('nshe~wd1~UNLV-External', 'University of Nevada, Las Vegas', ARRAY['https://nshe.wd1.myworkdayjobs.com/UNLV-External'], 'og:title: "University of Nevada, Las Vegas"', DATE '2026-11-17'),
  ('nshe~wd1~UNR-external', 'University of Nevada, Reno', ARRAY['https://nshe.wd1.myworkdayjobs.com/UNR-external'], 'og:title: "University of Nevada, Reno"', DATE '2026-11-17'),
  ('nshe~wd1~WNC-External', 'Western Nevada College', ARRAY['https://nshe.wd1.myworkdayjobs.com/WNC-External'], 'og:title: "Western Nevada College"', DATE '2026-11-17'),
  ('nshe~wd1~wnc-waiver', 'Western Nevada College', ARRAY['https://nshe.wd1.myworkdayjobs.com/wnc-waiver'], 'og:title: "Western Nevada College"', DATE '2026-11-17'),
  ('nus', 'National University', ARRAY['https://nus.wd1.myworkdayjobs.com/careers'], 'og:title: "National University Careers"', DATE '2026-11-08'),
  ('oakvalleyhealth', 'Oak Valley Health', ARRAY['https://oakvalleyhealth.wd10.myworkdayjobs.com/OakValleyHealth'], 'og:description: "Oak Valley Health is one of Ontario''s leading community health care organizations. Across our two..."', DATE '2026-11-08'),
  ('ocdc', 'Oregon Child Development Coalition', ARRAY['https://ocdc.wd501.myworkdayjobs.com/careers'], 'og:description: "Join Our Team At Oregon Child Development Coalition (OCDC), we''re passionate about helping children and families thrive. As a statewide..."', DATE '2026-11-08'),
  ('odfl', 'Old Dominion Freight Line', ARRAY['https://odfl.wd1.myworkdayjobs.com/en-US/ODFL_Careers/job/Saint-Charles-MO/Diesel-Mechanic_R-2026-4869'], 'posting hiringOrganization: "Old Dominion Freight Line, Inc."', DATE '2026-11-17'),
  ('oldrepublic', 'Old Republic Title', ARRAY['https://oldrepublic.wd1.myworkdayjobs.com/oldrepublictitle'], 'og:title: "Work for Old Republic Title"', DATE '2026-11-17'),
  ('oneok', 'ONEOK', ARRAY['https://oneok.wd1.myworkdayjobs.com/ONEOK'], 'og:description: "At ONEOK (NYSE: OKE), we deliver energy products and services vital to an advancing world. We are..."', DATE '2026-11-08'),
  ('originbank', 'Origin Bank', ARRAY['https://originbank.wd1.myworkdayjobs.com/Careers'], 'og:description: "At Origin Bank, we don''t just offer jobs—we build careers rooted in purpose, growth, and community..."', DATE '2026-11-08'),
  ('owensminor', 'Owens & Minor', ARRAY['https://owensminor.wd1.myworkdayjobs.com/OMCareers'], 'og:description: "At Owens & Minor, our greatest strength is the unrivaled dedication of our teammates. Powered by more than..."', DATE '2026-11-17'),
  ('palmbeachstate', 'Palm Beach State College', ARRAY['https://palmbeachstate.wd1.myworkdayjobs.com/external'], 'og:description: "About the College Palm Beach State College, Florida''s first public community college, was founded in 1933 and has grown to become..."', DATE '2026-11-08'),
  ('papedawson', 'Pape-Dawson', ARRAY['https://papedawson.wd12.myworkdayjobs.com/PDE'], 'og:title: "Pape-Dawson Careers"', DATE '2026-11-08'),
  ('pciservices', 'PCI Pharma Services', ARRAY['https://pciservices.wd1.myworkdayjobs.com/External'], 'og:title: "PCI Pharma Services Careers"', DATE '2026-11-08'),
  ('pepperlfuchs', 'Pepperl+Fuchs', ARRAY['https://pepperlfuchs.wd103.myworkdayjobs.com/PepperlFuchs'], 'og:description: "...Pepperl and Ludwig Fuchs laid the foundation for today''s Pepperl+Fuchs Group in 1945 with a small radio workshop in Mannheim. These values remain the..."', DATE '2026-11-08'),
  ('permianres', 'Permian Resources', ARRAY['https://permianres.wd12.myworkdayjobs.com/Permian_Resources_Careers'], 'og:description: "Permian Resources (NYSE: PR) is an independent oil and natural gas company focused on driving sustainable..."', DATE '2026-11-08'),
  ('pfg~wd3~QFCareers', 'Quality Foods', ARRAY['https://pfg.wd3.myworkdayjobs.com/QFCareers'], 'og:description: "Small Town Grocery Store - Since 1982! Quality Foods started in small towns on Vancouver Island and grew with the communities. We believe that..."', DATE '2026-11-17'),
  ('pfg~wd3~SaveonfoodsCareers', 'Save-On-Foods', ARRAY['https://pfg.wd3.myworkdayjobs.com/SaveonfoodsCareers'], 'og:title: "Save-On-Foods"', DATE '2026-11-17'),
  ('pillsburylaw', 'Pillsbury', ARRAY['https://pillsburylaw.wd5.myworkdayjobs.com/External'], 'og:title: "Pillsbury Careers"', DATE '2026-11-08'),
  ('pimacounty', 'Pima County', ARRAY['https://pimacounty.wd5.myworkdayjobs.com/pimacareers'], 'og:description: "...build a career while being part of something bigger? At Pima County, you''ll find meaningful work, room to grow and a team committed to serving the place we..."', DATE '2026-11-08'),
  ('pinerest', 'Pine Rest', ARRAY['https://pinerest.wd5.myworkdayjobs.com/PineRest'], 'og:description: "Evidence-Based Hiring At Pine Rest, we believe in nurturing our employees as holistic beings, understanding their unique..."', DATE '2026-11-08'),
  ('pipersandler', 'Piper Sandler', ARRAY['https://pipersandler.wd501.myworkdayjobs.com/Piper_Sandler_Careers'], 'og:description: "Explore the career possibilities at Piper Sandler. At Piper Sandler, we connect capital with opportunity to build a better future. As a..."', DATE '2026-11-08'),
  ('plantemoran~wd1~opportunity', 'Plante Moran', ARRAY['https://plantemoran.wd1.myworkdayjobs.com/wday/cxs/plantemoran/opportunity/sidebar'], 'sidebar: "What differentiates Plante Moran?"', DATE '2026-11-08'),
  ('plantemoran~wd1~pmexternalcareers', 'Plante Moran', ARRAY['https://plantemoran.wd1.myworkdayjobs.com/pmexternalcareers'], 'og:title: "Plante Moran Careers"', DATE '2026-11-08'),
  ('plugpower', 'Plug Power', ARRAY['https://plugpower.wd5.myworkdayjobs.com/Plug_Power_Inc'], 'og:description: "...brochure. Check out these videos to learn more about PLUG: Plug Power''s Culture Code Who is Plug? Manufacturing Electrolyzers at scale Megawatt Fuel Cell Power..."', DATE '2026-11-08'),
  ('powerdesigninc', 'Power Design', ARRAY['https://powerdesigninc.wd5.myworkdayjobs.com/PDI'], 'og:description: "Power Design is a National Design Build Contractor, focused on innovative construction across multiple..."', DATE '2026-11-08'),
  ('premierresearch', 'Premier Research', ARRAY['https://premierresearch.wd12.myworkdayjobs.com/PremierResearch'], 'og:description: "Premier Research is more than a company – it''s a community furthering research to improve the lives of..."', DATE '2026-11-08'),
  ('primetherapeutics', 'Prime Therapeutics', ARRAY['https://primetherapeutics.wd1.myworkdayjobs.com/PrimeTherapeuticsCareers'], 'og:description: "At Prime Therapeutics (Prime), we are a different kind of PBM. We''re reimagining pharmacy solutions to provide..."', DATE '2026-11-08'),
  ('progleasing', 'Progressive Leasing', ARRAY['https://progleasing.wd5.myworkdayjobs.com/ProgLeasingCareers'], 'og:title: "Progressive Leasing"', DATE '2026-11-08'),
  ('propetroservices~wd5~ProPetro_Careers', 'ProPetro Services', ARRAY['https://propetroservices.wd5.myworkdayjobs.com/ProPetro_Careers'], 'og:description: "Thanks for your interest in ProPetro Services, Inc. and for checking out our career opportunities! We''d love for you to apply to any..."', DATE '2026-11-08'),
  ('pultegroup', 'PulteGroup', ARRAY['https://pultegroup.wd1.myworkdayjobs.com/PGI'], 'og:description: "Here at PulteGroup: We will not send correspondence from any non-PulteGroup email (for example, we will not..."', DATE '2026-11-08'),
  ('puma~wd502~Jobs_at_Puma', 'PUMA', ARRAY['https://puma.wd502.myworkdayjobs.com/Jobs_at_Puma'], 'og:title: "Join the PUMA Team!"', DATE '2026-11-08'),
  ('qtsdatacenters', 'QTS', ARRAY['https://qtsdatacenters.wd5.myworkdayjobs.com/qts'], 'og:title: "QTS Careers"', DATE '2026-11-08'),
  ('quadreal~wd10~quadreal', 'QuadReal', ARRAY['https://quadreal.wd10.myworkdayjobs.com/quadreal'], 'og:description: "For 10 years, QuadReal has created spaces that enhance the lives of the people and communities we serve...."', DATE '2026-11-08'),
  ('racwa', 'RAC', ARRAY['https://racwa.wd3.myworkdayjobs.com/RAC-WA'], 'og:title: "RAC Careers"', DATE '2026-11-08'),
  ('rb', 'Federal Reserve System', ARRAY['https://rb.wd5.myworkdayjobs.com/FRS'], 'og:title: "Federal Reserve System Careers"', DATE '2026-11-17'),
  ('rbs', 'NatWest Group', ARRAY['https://rbs.wd3.myworkdayjobs.com/RBS'], 'og:title: "NatWest Group Careers"', DATE '2026-11-08'),
  ('recoveryfocus', 'Waythrough', ARRAY['https://recoveryfocus.wd3.myworkdayjobs.com/Recovery_Focus_Careers'], 'og:description: "Waythrough launched in October 2024 following the merger of Humankind and Richmond Fellowship. In..."', DATE '2026-11-17'),
  ('redrobin', 'Red Robin', ARRAY['https://redrobin.wd1.myworkdayjobs.com/wday/cxs/redrobin/RedRobin_Careers/sidebar'], 'sidebar: "At Red Robin, we''re not your typical burger restaurant. Our fans love us for our quirky personality,..."', DATE '2026-11-08'),
  ('rgare', 'RGA', ARRAY['https://rgare.wd1.myworkdayjobs.com/Careers'], 'og:title: "RGA Careers"', DATE '2026-11-08'),
  ('richlandonline', 'Richland County', ARRAY['https://richlandonline.wd5.myworkdayjobs.com/richlandcountygovcareers'], 'og:title: "Richland County Careers"', DATE '2026-11-08'),
  ('riministreet', 'Rimini Street', ARRAY['https://riministreet.wd1.myworkdayjobs.com/riministreet'], 'og:description: "...work is challenging and meaningful, allowing everyone at Rimini Street to start and end each day with a sense of achievement and purpose. We are looking for..."', DATE '2026-11-08'),
  ('ringcentral', 'RingCentral', ARRAY['https://ringcentral.wd1.myworkdayjobs.com/RingCentral_Careers'], 'og:description: "RingCentral, Inc. (NYSE: RNG) is a leading provider of global enterprise cloud communications,..."', DATE '2026-11-08'),
  ('rockwoolgroup', 'ROCKWOOL Group', ARRAY['https://rockwoolgroup.wd3.myworkdayjobs.com/ROCKWOOL'], 'og:description: "At ROCKWOOL Group, we are committed to enriching the lives of everyone who experiences our products and..."', DATE '2026-11-08'),
  ('rogersbh', 'Rogers Behavioral Health', ARRAY['https://rogersbh.wd1.myworkdayjobs.com/RBHCareer'], 'og:title: "Rogers Behavioral Health Careers"', DATE '2026-11-08'),
  ('roswellpark', 'Roswell Park', ARRAY['https://roswellpark.wd5.myworkdayjobs.com/ExternalCareers'], 'og:description: "Welcome to Roswell Park Comprehensive Cancer Center, America''s first cancer center founded in 1898 by Dr. Roswell..."', DATE '2026-11-08'),
  ('ryancompanies', 'Ryan Companies', ARRAY['https://ryancompanies.wd5.myworkdayjobs.com/ryancompanies'], 'og:description: "...At Ryan, we don''t just build buildings – we build stories. Ryan Companies US, Inc. is an equal opportunity employer. All qualified applicants will receive..."', DATE '2026-11-08'),
  ('ryansg', 'Ryan Specialty', ARRAY['https://ryansg.wd5.myworkdayjobs.com/Ryan_Specialty_Career_Site'], 'og:description: "...and Insurance Business''s Top Insurance Employers, Ryan Specialty is home to some of the brightest talent in the insurance industry. Join our team and help..."', DATE '2026-11-08'),
  ('saabusa', 'Saab', ARRAY['https://saabusa.wd1.myworkdayjobs.com/Saab_careers'], 'og:description: "Be Part of Something Bigger When you take a job at Saab, you become a part of something bigger. You''ll work on exciting, meaningful projects..."', DATE '2026-11-08'),
  ('sailpoint', 'SailPoint', ARRAY['https://sailpoint.wd1.myworkdayjobs.com/SailPoint'], 'og:description: "SailPoint (Nasdaq: SAIL) is defining the new era of adaptive identity security. In a world where..."', DATE '2026-11-08'),
  ('saintsfc', 'Southampton Football Club', ARRAY['https://saintsfc.wd3.myworkdayjobs.com/SFC001'], 'og:description: "About Us POTENTIAL INTO EXCELLENCE Southampton Football Club is part of St. Mary''s Football Group, which also includes the affiliated registered..."', DATE '2026-11-08'),
  ('salinasvalleyhealth', 'Salinas Valley Health', ARRAY['https://salinasvalleyhealth.wd5.myworkdayjobs.com/SalinasValleyHealth'], 'og:description: "Salinas Valley Health, formerly Salinas Valley Memorial Hospital, founded in 1953, is the cornerstone of what..."', DATE '2026-11-08'),
  ('salvationarmy', 'Salvation Army', ARRAY['https://salvationarmy.wd3.myworkdayjobs.com/Salvos'], 'og:description: "...community, and opportunity. Mission, Vision & Values The Salvation Army is a Christian movement dedicated to sharing the love of Jesus. We share the love of..."', DATE '2026-11-17'),
  ('sarahbush', 'Sarah Bush Lincoln', ARRAY['https://sarahbush.wd1.myworkdayjobs.com/SarahBush'], 'og:description: "When you come to work for Sarah Bush Lincoln or Fayette County Hospital Long Term Care, you have our commitment to help make this the..."', DATE '2026-11-08'),
  ('sasllc', 'CHSGa', ARRAY['https://sasllc.wd1.myworkdayjobs.com/Careers'], 'og:description: "As a non-profit organization, CHSGa provides access to care across the healthcare spectrum in all 159 Georgia counties. We..."', DATE '2026-11-17'),
  ('saxobank', 'Saxo Bank', ARRAY['https://saxobank.wd3.myworkdayjobs.com/CareeratSaxoBank'], 'og:description: "About Saxo Bank Support our purpose We believe access to global capital markets is not only for the..."', DATE '2026-11-08'),
  ('sbasite', 'SBA Communications', ARRAY['https://sbasite.wd5.myworkdayjobs.com/SBA_Communications_Careers'], 'og:description: "...in touch if there''s a role that seems like a good match. SBA Communications is an industry leader in providing wireless communications infrastructure essential to..."', DATE '2026-11-08'),
  ('scanhealthplan', 'SCAN', ARRAY['https://scanhealthplan.wd108.myworkdayjobs.com/scancareers'], 'og:title: "SCAN Careers"', DATE '2026-11-08'),
  ('scottsmiraclegro', 'ScottsMiracle-Gro', ARRAY['https://scottsmiraclegro.wd5.myworkdayjobs.com/SMGExternal'], 'og:description: "...Talent Acquisition Team will reach out to you if we find a ScottsMiracle-Gro or Hawthorne role that suits your skills. Don''t see a job you''re interested in? Sign in..."', DATE '2026-11-08'),
  ('sdguthrie~wd3~NBPOL', 'NBPOL', ARRAY['https://sdguthrie.wd3.myworkdayjobs.com/NBPOL'], 'og:description: "...are the largest private-sector employer in PNG. Throughout NBPOL''s history, each chapter has been defined by learning and growth. Today, we produce..."', DATE '2026-11-08'),
  ('sdguthrie~wd3~SDGUTHRIEMINAMAS', 'SD Guthrie', ARRAY['https://sdguthrie.wd3.myworkdayjobs.com/SDGUTHRIEMINAMAS'], 'og:description: "SD Guthrie Berhad (SD Guthrie) is one of the world''s leading producers of Certified Sustainable Palm..."', DATE '2026-11-08'),
  ('senecacasinos', 'Seneca Resorts & Casinos', ARRAY['https://senecacasinos.wd12.myworkdayjobs.com/SGC'], 'og:description: "Welcome to Seneca Resorts & Casinos! We are thrilled that you are considering joining our team. At Seneca Resorts & Casinos,..."', DATE '2026-11-08'),
  ('sfcollege', 'Santa Fe College', ARRAY['https://sfcollege.wd5.myworkdayjobs.com/SFcareers'], 'og:description: "Santa Fe College (SF) has been recognized as one of the top-rated community colleges in the United States...."', DATE '2026-11-08'),
  ('sharpservices', 'Sharp Packaging Services', ARRAY['https://sharpservices.wd3.myworkdayjobs.com/Sharp'], 'og:title: "Sharp Packaging Services"', DATE '2026-11-08'),
  ('shelterinsurance', 'Shelter Insurance', ARRAY['https://shelterinsurance.wd5.myworkdayjobs.com/careers'], 'og:description: "The Shelter Insurance® group of companies is a leader in the insurance industry, providing customers with..."', DATE '2026-11-08'),
  ('shm', 'VillageMD', ARRAY['https://shm.wd5.myworkdayjobs.com/Summit_CityMD'], 'og:description: "...practices, patients'' homes and virtually through VillageMD and our operating companies Village Medical, Village Medical at Home, Summit Health,..."', DATE '2026-11-17'),
  ('sierraspace', 'Sierra Space', ARRAY['https://sierraspace.wd1.myworkdayjobs.com/Sierra_Space_External_Career_Site'], 'og:description: "About Sierra Space Headquartered in Colorado, Sierra Space is a mission-proven Defense Tech company..."', DATE '2026-11-08'),
  ('silgancontainers', 'Silgan', ARRAY['https://silgancontainers.wd1.myworkdayjobs.com/silgan'], 'og:title: "Silgan Careers"', DATE '2026-11-08'),
  ('silvercross', 'Silver Cross', ARRAY['https://silvercross.wd5.myworkdayjobs.com/SilverCrossCareers'], 'og:title: "Silver Cross Careers"', DATE '2026-11-08'),
  ('simmonsbank', 'Simmons Bank', ARRAY['https://simmonsbank.wd5.myworkdayjobs.com/SimmonsCareers'], 'og:description: "...been putting people first by making a commitment to you. Simmons Bank is the subsidiary bank for Simmons First National Corporation (NASDAQ: SFNC), a publicly..."', DATE '2026-11-08'),
  ('situsamc', 'SitusAMC', ARRAY['https://situsamc.wd1.myworkdayjobs.com/SitusAMC'], 'og:description: "SitusAMC is a leading independent provider of technology, strategic outsourcing, talent and..."', DATE '2026-11-08'),
  ('skbs', 'Städtisches Klinikum Braunschweig', ARRAY['https://skbs.wd103.myworkdayjobs.com/SKBS_Extern1'], 'og:title: "Städtisches Klinikum Braunschweig"', DATE '2026-11-08'),
  ('slc', 'Student Loans Company', ARRAY['https://slc.wd3.myworkdayjobs.com/SLC_Careers'], 'og:description: "...futures via access to further and higher education. The Student Loans Company is a non-profit making government-owned organisation, who enable opportunity by providing..."', DATE '2026-11-08'),
  ('smithnephew', 'Smith+Nephew', ARRAY['https://smithnephew.wd5.myworkdayjobs.com/External'], 'og:description: "Smith+Nephew is a global medical technology company. We design and manufacture technology that takes..."', DATE '2026-11-08'),
  ('snapchat', 'Snap', ARRAY['https://snapchat.wd1.myworkdayjobs.com/snap'], 'og:description: "Curious what it''s like to work at Snap? Meet the people behind our products and discover how our values shape the way we create,..."', DATE '2026-11-17'),
  ('snc', 'SNC', ARRAY['https://snc.wd1.myworkdayjobs.com/SNC_External_Career_Site'], 'og:description: "SNC is a trusted global leader in aerospace and national security. Our innovative solutions..."', DATE '2026-11-17'),
  ('sonyglobal', 'Sony', ARRAY['https://sonyglobal.wd1.myworkdayjobs.com/SonyGlobalCareers'], 'og:description: "...viewpoints. Integrity & Sincerity Earn the trust for the Sony brand through ethical and responsible conduct. Sustainability Fulfill our stakeholder..."', DATE '2026-11-08'),
  ('soterahealth', 'Sotera Health', ARRAY['https://soterahealth.wd501.myworkdayjobs.com/External'], 'og:description: "Come Make a Difference with Us. Sotera Health is driven by its mission, Safeguarding Global Health®. Along with our three best-in-class..."', DATE '2026-11-08'),
  ('spinmaster', 'Spin Master', ARRAY['https://spinmaster.wd3.myworkdayjobs.com/SpinMaster_Careers'], 'og:title: "Spin Master Careers"', DATE '2026-11-08'),
  ('starrcompanies', 'Starr', ARRAY['https://starrcompanies.wd1.myworkdayjobs.com/careers'], 'og:description: "Starr is a global insurance and investment organization providing property and casualty..."', DATE '2026-11-08'),
  ('stjude', 'St. Jude Children''s Research Hospital', ARRAY['https://stjude.wd1.myworkdayjobs.com/stjude'], 'og:title: "St. Jude Children''s Research Hospital Careers"', DATE '2026-11-08'),
  ('storaenso', 'Stora Enso', ARRAY['https://storaenso.wd502.myworkdayjobs.com/Stora_Enso_site_opportunities'], 'og:description: "...today can be made from a tree tomorrow, and highlights Stora Enso''s opportunity to contribute to a greener economy. Take a look at our open positions! At..."', DATE '2026-11-08'),
  ('stormontvail', 'Stormont Vail', ARRAY['https://stormontvail.wd1.myworkdayjobs.com/SVH'], 'og:description: "...Morgan Ray via email: morgan.ray@stormontvail.org Stormont Vail Health is a nonprofit integrated health system that has been serving the health care..."', DATE '2026-11-08'),
  ('sumitomopharma', 'Sumitomo Pharma America', ARRAY['https://sumitomopharma.wd5.myworkdayjobs.com/SMPA'], 'og:description: "...company based in Japan with operations in the U.S. (Sumitomo Pharma America, Inc.), focused on addressing patient needs in oncology, urology, women''s health, rare..."', DATE '2026-11-08'),
  ('svb', 'First Citizens India', ARRAY['https://svb.wd5.myworkdayjobs.com/firstcitizensindia'], 'og:description: "FC Global Services India LLP (First Citizens India), a part of First Citizens BancShares, Inc., a top 20 U.S. financial institution, is..."', DATE '2026-11-17'),
  ('svha~wd3~SVHA_SVHA', 'St Vincent''s Health Australia', ARRAY['https://svha.wd3.myworkdayjobs.com/SVHA_SVHA'], 'og:description: "...users can click Create Account from the Sign-in screen. St Vincent''s Health Australia has been serving Australians with compassionate health and aged care since our first..."', DATE '2026-11-17'),
  ('svha~wd3~broadbean_external', 'St Vincent''s Health Australia', ARRAY['https://svha.wd3.myworkdayjobs.com/broadbean_external'], 'og:description: "...users can click Create Account from the Sign-in screen. St Vincent''s Health Australia has been serving Australians with compassionate health and aged care since our first..."', DATE '2026-11-17'),
  ('svha~wd3~svha_svphm', 'St Vincent''s Private Melbourne', ARRAY['https://svha.wd3.myworkdayjobs.com/svha_svphm'], 'og:description: "St Vincent''s Private Melbourne is a facility of St Vincent''s Health Australia under the stewardship of Mary Aikenhead..."', DATE '2026-11-17'),
  ('synchronyfinancial', 'Synchrony', ARRAY['https://synchronyfinancial.wd5.myworkdayjobs.com/university'], 'og:description: "Synchrony is a premier consumer financial services company delivering customized financing programs..."', DATE '2026-11-08'),
  ('taskus', 'TaskUs', ARRAY['https://taskus.wd1.myworkdayjobs.com/Careers'], 'og:title: "TaskUs Careers"', DATE '2026-11-17'),
  ('taylormorrison', 'Taylor Morrison', ARRAY['https://taylormorrison.wd1.myworkdayjobs.com/TaylorMorrisonCareers'], 'og:description: "Welcome to the Taylor Morrison, Inc. Career Portal In order to be the best in the industry, you have to surround..."', DATE '2026-11-08'),
  ('tcsedsystem~wd1~KHSC', 'Kansas Health Science University', ARRAY['https://tcsedsystem.wd1.myworkdayjobs.com/KHSC'], 'og:title: "Kansas Health Science University Careers"', DATE '2026-11-08'),
  ('tcsedsystem~wd1~TCSES', 'The Community Solution', ARRAY['https://tcsedsystem.wd1.myworkdayjobs.com/TCSES'], 'og:title: "The Community Solution Careers"', DATE '2026-11-08'),
  ('tcsedsystem~wd1~TCSPP', 'The Chicago School', ARRAY['https://tcsedsystem.wd1.myworkdayjobs.com/TCSPP'], 'og:title: "The Chicago School Careers"', DATE '2026-11-08'),
  ('tcsedsystem~wd1~UWS', 'University of Western States', ARRAY['https://tcsedsystem.wd1.myworkdayjobs.com/UWS'], 'og:title: "University of Western States Careers"', DATE '2026-11-08'),
  ('texascapitalbank', 'Texas Capital', ARRAY['https://texascapitalbank.wd12.myworkdayjobs.com/Careers'], 'og:description: "Texas Capital is the premier full-service financial services firm founded and headquartered in Texas,..."', DATE '2026-11-08'),
  ('theapexgroup', 'Apex Group', ARRAY['https://theapexgroup.wd3.myworkdayjobs.com/apexgroupcareers'], 'og:description: "About Apex Group We are dedicated to driving positive change in financial services while fuelling the..."', DATE '2026-11-08'),
  ('theirc', 'International Rescue Committee', ARRAY['https://theirc.wd1.myworkdayjobs.com/External_Careers'], 'og:description: "The International Rescue Committee (IRC) helps people whose lives have been shattered by conflict and disaster to survive,..."', DATE '2026-11-17'),
  ('thejacksonlaboratory', 'The Jackson Laboratory', ARRAY['https://thejacksonlaboratory.wd503.myworkdayjobs.com/External_JAX'], 'og:description: "Bar Harbor: The Jackson Laboratory''s 43-acre scenic Bar Harbor campus is nestled between the Gulf of Maine and the mountains..."', DATE '2026-11-08'),
  ('thgrp~wd12~TheHeritageGroup', 'The Heritage Group', ARRAY['https://thgrp.wd12.myworkdayjobs.com/TheHeritageGroup'], 'og:description: "History The Heritage Group is a fourth-generation family-owned business managing and investing in a diverse..."', DATE '2026-11-08'),
  ('thgrp~wd12~monumentchemical', 'Monument Chemical', ARRAY['https://thgrp.wd12.myworkdayjobs.com/wday/cxs/thgrp/monumentchemical/sidebar'], 'sidebar: "Monument Chemical is a proud member of The Heritage Group family of companies. Explore all Heritage Group..."', DATE '2026-11-08'),
  ('tiaa', 'TIAA', ARRAY['https://tiaa.wd1.myworkdayjobs.com/Search'], 'og:description: "TIAA started out over 100 years ago to help ensure teachers could retire with dignity. Today,..."', DATE '2026-11-08'),
  ('tigerbrands', 'Tiger Brands', ARRAY['https://tigerbrands.wd103.myworkdayjobs.com/TigerBrands'], 'og:description: "Tiger Brands is proudly Africa''s largest listed manufacturer of fast-moving consumer goods (FMCG). We..."', DATE '2026-11-08'),
  ('tihinsurance', 'CRC Group', ARRAY['https://tihinsurance.wd1.myworkdayjobs.com/CRC_Careers'], 'og:description: "Join CRC Group, a leader in specialty wholesale insurance, and take your career to new heights. We''re a..."', DATE '2026-11-08'),
  ('towerloan', 'Tower Loan', ARRAY['https://towerloan.wd12.myworkdayjobs.com/Tower_Loan_Careers'], 'og:description: "...team will be in touch with you. Established since 1936, Tower Loan is proud to be one of America''s largest priva"', DATE '2026-11-08'),
  ('transformingage', 'Transforming Age', ARRAY['https://transformingage.wd108.myworkdayjobs.com/JoinUs'], 'og:description: "Transforming Age is a leading nonprofit organization committed to improving the lives of older adults by..."', DATE '2026-11-08'),
  ('transunion', 'TransUnion', ARRAY['https://transunion.wd5.myworkdayjobs.com/TransUnion'], 'og:description: "...or social media communication you weren''t expecting from TransUnion, take a moment to confirm the relevant information. Be wary when providing personal..."', DATE '2026-11-08'),
  ('travelhrportal', 'Amex GBT', ARRAY['https://travelhrportal.wd1.myworkdayjobs.com/Jobs/job/United-Kingdom/Strategic-Global-Account-Manager_J-84376-1'], 'posting: "Amex GBT is a place where colleagues find inspiration in travel as a force for good and – through..."', DATE '2026-11-17'),
  ('tscfl', 'Tallahassee State College', ARRAY['https://tscfl.wd12.myworkdayjobs.com/en-US/TSC_External_Career_Site/job/Site-1---Main-M---Campus/Healthcare-Lead-Instructor_REQ05326-1'], 'posting: "Join Our Team at Tallahassee State College Healthcare Lead Instructor Opportunity Are you passionate about higher education and..."', DATE '2026-11-17'),
  ('tucsonaz', 'City of Tucson', ARRAY['https://tucsonaz.wd1.myworkdayjobs.com/Tucson_Talent'], 'og:description: "City Organization The City of Tucson, founded in 1775 and incorporated in 1877, is a City Manager-led Mayor and Council..."', DATE '2026-11-08'),
  ('ucf~wd1~careers', 'University of Central Florida', ARRAY['https://ucf.wd1.myworkdayjobs.com/careers'], 'og:title: "University of Central Florida"', DATE '2026-11-08'),
  ('ukib', 'National Wealth Fund', ARRAY['https://ukib.wd3.myworkdayjobs.com/UKIB'], 'og:description: "The National Wealth Fund encourages a diverse workforce and welcomes applications from all suitably qualified..."', DATE '2026-11-08'),
  ('umb', 'UMB', ARRAY['https://umb.wd1.myworkdayjobs.com/UMBExternal'], 'og:title: "UMB Careers"', DATE '2026-11-08'),
  ('umphysicians', 'M Physicians', ARRAY['https://umphysicians.wd1.myworkdayjobs.com/umpcareers'], 'og:description: "Company Overview: At University of Minnesota Physicians (M Physicians), we are on a mission to deliver exceptional patient care, advance medicine through..."', DATE '2026-11-08'),
  ('unimelb', 'University of Melbourne', ARRAY['https://unimelb.wd105.myworkdayjobs.com/UoM_External_Career'], 'og:description: "...opportunities to shape the future and growth of the University of Melbourne - Executive Opportunities Welcome to the University of Melbourne – where our vision for..."', DATE '2026-11-08'),
  ('uofl', 'University of Louisville', ARRAY['https://uofl.wd1.myworkdayjobs.com/UofLCareerSite'], 'og:description: "The University of Louisville is committed to being a great place to work, learn and invest. It is a place where you..."', DATE '2026-11-08'),
  ('upenn~wd1~PSOM', 'Perelman School of Medicine', ARRAY['https://upenn.wd1.myworkdayjobs.com/PSOM'], 'og:title: "Perelman School of Medicine Careers"', DATE '2026-11-17'),
  ('upenn~wd1~careers-at-penn', 'University of Pennsylvania', ARRAY['https://upenn.wd1.myworkdayjobs.com/careers-at-penn'], 'og:description: "The University of Pennsylvania''s special character is reflected in the wide variety of backgrounds, experiences, and..."', DATE '2026-11-17'),
  ('upm', 'UPM', ARRAY['https://upm.wd103.myworkdayjobs.com/Careers'], 'og:title: "UPM Careers"', DATE '2026-11-08'),
  ('uq', 'The University of Queensland', ARRAY['https://uq.wd3.myworkdayjobs.com/uqcareers'], 'og:description: "The University of Queensland (UQ) acknowledges the Traditional Owners and their custodianship of the lands on which UQ..."', DATE '2026-11-08'),
  ('usaa', 'USAA', ARRAY['https://usaa.wd1.myworkdayjobs.com/USAAJOBSWD'], 'og:description: "If you are an existing USAA employee, please use the internal career site in OneSource to apply. Please do not type..."', DATE '2026-11-08'),
  ('usyd', 'University of Sydney', ARRAY['https://usyd.wd105.myworkdayjobs.com/USYD_EXTERNAL_CAREER_SITE'], 'og:title: "University of Sydney Career Site"', DATE '2026-11-08'),
  ('utaustin', 'University of Texas at Austin', ARRAY['https://utaustin.wd1.myworkdayjobs.com/UTstaff'], 'og:title: "The University of Texas at Austin Staff Jobs"', DATE '2026-11-08'),
  ('uva', 'University of Virginia', ARRAY['https://uva.wd1.myworkdayjobs.com/UVAStudentJobs'], 'og:description: "In 1819, Thomas Jefferson founded the University of Virginia and inaugurated a bold experiment. Two centuries later, Jefferson''s vision thrives...."', DATE '2026-11-08'),
  ('vcuhealth', 'VCU Health', ARRAY['https://vcuhealth.wd1.myworkdayjobs.com/VCUHealth_careers'], 'og:description: "...cancer treatment, exciting new medicine is happening at VCU Health. We have it all: • One college and four health sciences schools • An academic medical..."', DATE '2026-11-17'),
  ('veitusa', 'Veit', ARRAY['https://veitusa.wd503.myworkdayjobs.com/Veit'], 'og:description: "Veit is one of the country''s leading specialty contractors, with nearly a century of..."', DATE '2026-11-08'),
  ('veoliauki', 'Veolia', ARRAY['https://veoliauki.wd3.myworkdayjobs.com/VESCareers'], 'og:description: "Ready to see the world as we do? Who is Veolia? Where other people see waste, our community here at Veolia see opportunity. We''re..."', DATE '2026-11-08'),
  ('vertexinc', 'Vertex', ARRAY['https://vertexinc.wd1.myworkdayjobs.com/VertexInc'], 'og:description: "...news, and events tailored to your career interests. Vertex is an Affirmative Action and Equal Opportunity Employer. All qualified applicants will..."', DATE '2026-11-08'),
  ('vst', 'Vistra', ARRAY['https://vst.wd5.myworkdayjobs.com/vistra_careers'], 'og:description: "Vistra (NYSE: VST) is a leading Fortune 500 integrated retail electricity and power generation..."', DATE '2026-11-08'),
  ('vwr', 'Avantor', ARRAY['https://vwr.wd1.myworkdayjobs.com/avantorjobs'], 'og:title: "Careers at Avantor"', DATE '2026-11-17'),
  ('walshgroup', 'Walsh Group', ARRAY['https://walshgroup.wd12.myworkdayjobs.com/walshgroup'], 'og:title: "The Walsh Group"', DATE '2026-11-08'),
  ('wasatchproperty~wd1~BlendtecCareers', 'Blendtec', ARRAY['https://wasatchproperty.wd1.myworkdayjobs.com/BlendtecCareers'], 'og:description: "Blendtec designs, builds, and sells the most advanced residential and commercial blenders, and..."', DATE '2026-11-08'),
  ('wasatchproperty~wd1~MarketStarCareers', 'MarketStar', ARRAY['https://wasatchproperty.wd1.myworkdayjobs.com/MarketStarCareers'], 'og:title: "MarketStar Careers"', DATE '2026-11-08'),
  ('wasatchproperty~wd1~PDK', 'ProdataKey', ARRAY['https://wasatchproperty.wd1.myworkdayjobs.com/PDK'], 'og:title: "ProdataKey Careers"', DATE '2026-11-08'),
  ('wasatchproperty~wd1~marketstarcareersemea', 'MarketStar', ARRAY['https://wasatchproperty.wd1.myworkdayjobs.com/marketstarcareersemea'], 'og:title: "MarketStar Careers"', DATE '2026-11-08'),
  ('wasatchproperty~wd1~marketstarcareersnamer', 'MarketStar', ARRAY['https://wasatchproperty.wd1.myworkdayjobs.com/marketstarcareersnamer'], 'og:title: "MarketStar Careers"', DATE '2026-11-08'),
  ('waynefarms', 'Wayne-Sanderson Farms', ARRAY['https://waynefarms.wd1.myworkdayjobs.com/WayneFarms'], 'og:description: "A career that makes an amazing difference starts at Wayne-Sanderson Farms. Formed from two leading poultry companies with humble roots in farm supply and feed..."', DATE '2026-11-08'),
  ('wellsky', 'WellSky', ARRAY['https://wellsky.wd1.myworkdayjobs.com/WellSkyCareers'], 'og:description: "WellSky is a technology company leading the movement for intelligent, coordinated care worldwide...."', DATE '2026-11-08'),
  ('westernalliancebank~wd5~AMH', 'AmeriHome Mortgage', ARRAY['https://westernalliancebank.wd5.myworkdayjobs.com/AMH'], 'og:description: "About AmeriHome Mortgage AmeriHome Mortgage, a Western Alliance Bank company, is a leading national..."', DATE '2026-11-08'),
  ('westernalliancebank~wd5~WAB', 'Western Alliance Bank', ARRAY['https://westernalliancebank.wd5.myworkdayjobs.com/WAB'], 'og:description: "...banking companies. Through its primary subsidiary, Western Alliance Bank, Member FDIC, clients benefit from a full spectrum of tailored commercial banking..."', DATE '2026-11-08'),
  ('wework', 'WeWork', ARRAY['https://wework.wd1.myworkdayjobs.com/WeWork'], 'og:description: "WeWork was founded in 2010 with the vision to create environments where people and companies..."', DATE '2026-11-08'),
  ('wexinc', 'WEX', ARRAY['https://wexinc.wd5.myworkdayjobs.com/WEXInc'], 'og:description: "WEX is a global commerce platform that helps businesses solve for operational complexities..."', DATE '2026-11-08'),
  ('wgu', 'Western Governors University', ARRAY['https://wgu.wd5.myworkdayjobs.com/External'], 'og:description: "In 1997, a coalition of 19 U.S. governors founded Western Governors University with a singular vision: to make higher education more accessible by offering full degree..."', DATE '2026-11-08'),
  ('wilsonco', 'Wilson & Company', ARRAY['https://wilsonco.wd5.myworkdayjobs.com/wday/cxs/wilsonco/Careers/sidebar'], 'sidebar: "Why Wilson & Company?"', DATE '2026-11-08'),
  ('woundedwarriorproject', 'Wounded Warrior Project', ARRAY['https://woundedwarriorproject.wd5.myworkdayjobs.com/WWP'], 'og:title: "Wounded Warrior Project | WWP Careers"', DATE '2026-11-17'),
  ('wwecorp~wd5~IMG', 'IMG', ARRAY['https://wwecorp.wd5.myworkdayjobs.com/IMG'], 'og:description: "IMG is a leading global sports marketing agency, specializing in media rights management and..."', DATE '2026-11-08'),
  ('wwecorp~wd5~TKO', 'TKO', ARRAY['https://wwecorp.wd5.myworkdayjobs.com/TKO'], 'og:description: "TKO Group Holdings, Inc. (NYSE: TKO) is a premium sports and entertainment company. TKO owns..."', DATE '2026-11-08'),
  ('wwecorp~wd5~private_postings', 'TKO', ARRAY['https://wwecorp.wd5.myworkdayjobs.com/private_postings'], 'og:description: "TKO Group Holdings, Inc. (NYSE: TKO) is a premium sports and entertainment company. TKO owns..."', DATE '2026-11-08'),
  ('wwecorp~wd5~wwecorp', 'WWE', ARRAY['https://wwecorp.wd5.myworkdayjobs.com/wwecorp'], 'og:description: "WWE® is an integrated media organization and the recognized global leader in sports..."', DATE '2026-11-08'),
  ('yeehong', 'Yee Hong Centre for Geriatric Care', ARRAY['https://yeehong.wd10.myworkdayjobs.com/Yee_Hong'], 'og:description: "JOIN A GREAT TEAM, DOING GREAT WORK! Yee Hong Centre for Geriatric Care ("Yee Hong") is one of the largest not-for-profit, culturally-appropriate seniors care..."', DATE '2026-11-08'),
  ('yeticoolers', 'YETI', ARRAY['https://yeticoolers.wd5.myworkdayjobs.com/YETI'], 'og:description: "At YETI, we design products that last for generations, get you outside, and keep you there..."', DATE '2026-11-08'),
  ('ymcaatlanta', 'YMCA of Metropolitan Atlanta', ARRAY['https://ymcaatlanta.wd1.myworkdayjobs.com/YMCA-Careers'], 'og:description: "The YMCA of Metropolitan Atlanta is an association of volunteers, members and staff, open to and serving all, with..."', DATE '2026-11-08'),
  ('younglife', 'Young Life', ARRAY['https://younglife.wd5.myworkdayjobs.com/YoungLife_Careers'], 'og:description: ""We the members of the Young Life mission – trustees, staff, instructors at Young Life schools and volunteers – join..."', DATE '2026-11-08')
  ) AS v(slug, display_name, evidence, quote, read_on)
  JOIN public.company_name_overrides o ON o.slug = v.slug AND o.display_name = v.display_name
ON CONFLICT (slug) DO NOTHING;

-- RE-ARM THE NAME-SYNC LANE: with no version stamp it runs at the next
-- pass-end, and with no progress row it starts from the first token.
DO $$
DECLARE
  v_gone text;
BEGIN
  SELECT string_agg(format('%s %s', k, v::text), '; ' ORDER BY k) INTO v_gone
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  DELETE FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  RAISE NOTICE '20261111150000: the name-sync lane is re-armed (removed: %); the next pass-end walks every board from the first', coalesce(v_gone, 'nothing, the keys were already gone');
END $$;

-- SELF-CHECK. Raises, and so undoes every statement above, unless:
--   1. each of the 437 keys has its override, and each override this run
--      wrote has its evidence row naming the same employer, read on
--      2026-11-08 or 2026-11-17, with an https link and the words read; a
--      key the table already held keeps its own name and is only reported;
--   2. none of the re-check's twelve wrong names stands on its key, and the
--      two tenants it left out (gi, warnerbros) took no tenant key here;
--   3. no tenant of several employers took a tenant key in this run;
--   4. the table holds at most 1,000 rows, all the lane's one read returns;
--   5. no client role holds a privilege on the evidence, row level security
--      is on, and the service role can read it;
--   6. neither name-sync key is left, so the lane walks again.
DO $$
DECLARE
  v_slugs text[] := ARRAY[
    '8x8inc', 'aaamidatlantic', 'abcfws', 'acs', 'acxiomllc', 'aeci', 'agreenspace', 'airasia',
    'akamerica', 'akumincorp', 'algonquincollege', 'allegromicro', 'alliancedata',
    'alliedsolutions', 'alpinephysicians', 'altamed', 'americanglobal', 'americanregent',
    'andersonsinc', 'andrewsdistributing', 'apog', 'argenx', 'arianegroup', 'asd', 'aspca',
    'aspenvalleyhealth', 'athenahealth', 'atlantabravesmlb', 'atmosenergy', 'auchanportugal',
    'austintexas', 'autostore', 'avfc', 'awg', 'badgermeter', 'baltimorecity~wd1~EPFL_External',
    'baltimorecity~wd1~External', 'barrywehmiller', 'bavariannordic', 'bbh',
    'bbinsurance~wd1~Careers', 'bbinsurance~wd1~Careers_Europe', 'bcbst', 'beautyhealth',
    'begacheese', 'beigene', 'bestbuycanada', 'bgfoods', 'bigcommerce', 'blackrock', 'blueowl',
    'bobsdf', 'boseallaboutme', 'boystown', 'braunintertec', 'brocku', 'byu', 'caaquebec',
    'camdennational', 'canadagoose', 'canalbarge', 'capefearvalley', 'capitalhealth', 'caresource',
    'cba~wd3~Bankwest_Careers', 'cba~wd3~CommBank_Careers', 'cbh', 'ceritypartners', 'cesco',
    'ceu~wd3~CEU', 'ceu~wd3~CEUAND', 'ceu~wd3~COL', 'ceu~wd3~FP', 'ceu~wd3~UF3', 'ceu~wd3~uao',
    'ceu~wd3~uch', 'ceu~wd3~usp', 'cfr', 'cgb', 'cgm', 'chaptershealth~wd5~capitalcaringjobs',
    'charlottenc', 'chartermfg', 'chghealthcare', 'christmanco', 'chrobinson', 'citicclsa',
    'citjpl', 'cityoforlando', 'clearesult', 'clearskyhealth', 'clearwateranalytics', 'cmcmarkets',
    'colemanwm', 'collectorsuniverse', 'collegeboard', 'comfortsystemsusa~wd1~BCM',
    'comfortsystemsusa~wd1~Corpcareers', 'comfortsystemsusa~wd1~Design_Mechanical',
    'comfortsystemsusa~wd1~DynaTen', 'comfortsystemsusa~wd1~SM_Lawrence',
    'comfortsystemsusa~wd1~TempRight', 'conagrabrands', 'coorstek',
    'corebridgefinancial~wd1~CorebridgeFinancial', 'corpartners~wd5~COR',
    'corpartners~wd5~EngleMartin', 'corrohealth', 'countryfinancial~wd5~COUNTRYAgencyExternal',
    'countryfinancial~wd5~COUNTRYCorporateExternal', 'countryfinancial~wd5~IllinoisFarmBureau',
    'creditacceptance', 'crhc', 'crossoverhealth', 'crystalsugar', 'csagroup', 'csusystem',
    'daikinapplied', 'dallascityhall', 'dallascollege', 'datev', 'davispolk', 'dealertire~wd5~4710',
    'dealertire~wd5~Sonsio', 'destinationpet', 'digitalturbine', 'dlapiper', 'drinkpak',
    'druryhotels', 'dsvgruppe', 'dukeenergy', 'dupont', 'dynastymanagement~wd12~GREENWAY',
    'dynastymanagement~wd12~SCOTT_PETROLEUM', 'earlywarning', 'ebi~wd5~afbcareers',
    'ebi~wd5~ebicareers', 'ebi~wd5~envirologixcareers', 'ebnhc', 'elderslimited', 'elliottdavis',
    'emerysapp~wd501~ESS', 'emerysapp~wd501~RUM', 'epicorsoftware', 'erm', 'eroadgroup', 'eset',
    'etch', 'factset', 'fanniemae', 'fau', 'ffive', 'fib', 'fico', 'fimc', 'firstam~wd1~fctcareers',
    'firstam~wd1~firstamericancareers', 'firstquality', 'flagshipinc', 'flpoly', 'fnz',
    'formfactor', 'freseniusglobal', 'fticonsulting~wd108~CompassLexeconCareers',
    'fticonsulting~wd108~FTIConsultingCareers', 'fullsail', 'gaig~wd1~GAIG_External',
    'gaig~wd1~National_Interstate_External', 'gaig~wd1~Vanliner_External', 'gategroup',
    'gcu~wd1~GCE', 'gcu~wd1~GCEC', 'gcu~wd1~GCU', 'gcu~wd1~Orbis', 'gea', 'geha', 'genesishcs',
    'georgesinc', 'georgiasown', 'giorgiglobal', 'globelife', 'godirect', 'gphealth',
    'gundersenhealth', 'hancockwhitney', 'harvestroad', 'hastingsdirect', 'henryschein', 'hl',
    'hntb', 'hriproperties', 'hss', 'hysteryale', 'icf', 'icwgroup', 'iheartmedia', 'ijm', 'ilb',
    'ineos', 'intervarsity', 'irhythmtech', 'isc', 'issgovernance', 'jacksongov~wd5~court',
    'jadeglobal', 'jcrew~wd1~MadewellCareers', 'jda', 'jerrys', 'jm', 'johnsonbrothers',
    'kaishaservice~wd1~GreenMetalsCareers', 'kaishaservice~wd1~ToyotaTsushoAmerica', 'kcura',
    'kimberlyclark', 'kmkp~wd1~KACECareers', 'kmkp~wd1~TPGCareers', 'kmkp~wd1~careers', 'kpluss',
    'ksb', 'ksbe', 'kumc', 'languageline~wd5~HAS_Careers', 'languageline~wd5~LLS_Careers',
    'leecompany', 'lendingclub', 'lfb', 'lifefitness', 'livanova', 'llbean', 'loewshotels',
    'loganhealth', 'lplfinancial', 'lumaenergy', 'luriechildrens', 'madrigalpharma', 'mainegeneral',
    'manh', 'marathonhealth', 'maryfreebed', 'marywashingtonhealthcare', 'massmutual',
    'mattressfirm', 'maxar~wd1~Vantor', 'mbda', 'mc', 'mchapusa', 'mechanicsbank', 'medimpact',
    'melocheinc', 'merceruniversity~wd1~external', 'merceruniversity~wd1~student',
    'methodisthealthsystem', 'mfs', 'miamioh', 'michelinhr', 'minnstate', 'missionaustralia',
    'modernatx', 'monolithicpower', 'morganlewis', 'msiexpress', 'msssecurity', 'msudenver', 'mwaa',
    'myhana', 'myhrhome', 'nationalchurchresidences', 'nationwidechildrens', 'navcanada',
    'nbtbancorp', 'ncratleos', 'nebraskamed', 'newperkinelmer', 'nghs', 'nordsonhcm',
    'northwesternmutual', 'nrpgroup', 'nshe~wd1~CSN-External', 'nshe~wd1~DRI-External',
    'nshe~wd1~GBC-external', 'nshe~wd1~NSHE-external', 'nshe~wd1~NSU-external',
    'nshe~wd1~TMCC-External', 'nshe~wd1~UNLV-External', 'nshe~wd1~UNR-external',
    'nshe~wd1~WNC-External', 'nshe~wd1~wnc-waiver', 'nus', 'oakvalleyhealth', 'ocdc', 'odfl',
    'oldrepublic', 'oneok', 'originbank', 'owensminor', 'palmbeachstate', 'papedawson',
    'pciservices', 'pepperlfuchs', 'permianres', 'pfg~wd3~QFCareers', 'pfg~wd3~SaveonfoodsCareers',
    'pillsburylaw', 'pimacounty', 'pinerest', 'pipersandler', 'plantemoran~wd1~opportunity',
    'plantemoran~wd1~pmexternalcareers', 'plugpower', 'powerdesigninc', 'premierresearch',
    'primetherapeutics', 'progleasing', 'propetroservices~wd5~ProPetro_Careers', 'pultegroup',
    'puma~wd502~Jobs_at_Puma', 'qtsdatacenters', 'quadreal~wd10~quadreal', 'racwa', 'rb', 'rbs',
    'recoveryfocus', 'redrobin', 'rgare', 'richlandonline', 'riministreet', 'ringcentral',
    'rockwoolgroup', 'rogersbh', 'roswellpark', 'ryancompanies', 'ryansg', 'saabusa', 'sailpoint',
    'saintsfc', 'salinasvalleyhealth', 'salvationarmy', 'sarahbush', 'sasllc', 'saxobank',
    'sbasite', 'scanhealthplan', 'scottsmiraclegro', 'sdguthrie~wd3~NBPOL',
    'sdguthrie~wd3~SDGUTHRIEMINAMAS', 'senecacasinos', 'sfcollege', 'sharpservices',
    'shelterinsurance', 'shm', 'sierraspace', 'silgancontainers', 'silvercross', 'simmonsbank',
    'situsamc', 'skbs', 'slc', 'smithnephew', 'snapchat', 'snc', 'sonyglobal', 'soterahealth',
    'spinmaster', 'starrcompanies', 'stjude', 'storaenso', 'stormontvail', 'sumitomopharma', 'svb',
    'svha~wd3~SVHA_SVHA', 'svha~wd3~broadbean_external', 'svha~wd3~svha_svphm',
    'synchronyfinancial', 'taskus', 'taylormorrison', 'tcsedsystem~wd1~KHSC',
    'tcsedsystem~wd1~TCSES', 'tcsedsystem~wd1~TCSPP', 'tcsedsystem~wd1~UWS', 'texascapitalbank',
    'theapexgroup', 'theirc', 'thejacksonlaboratory', 'thgrp~wd12~TheHeritageGroup',
    'thgrp~wd12~monumentchemical', 'tiaa', 'tigerbrands', 'tihinsurance', 'towerloan',
    'transformingage', 'transunion', 'travelhrportal', 'tscfl', 'tucsonaz', 'ucf~wd1~careers',
    'ukib', 'umb', 'umphysicians', 'unimelb', 'uofl', 'upenn~wd1~PSOM', 'upenn~wd1~careers-at-penn',
    'upm', 'uq', 'usaa', 'usyd', 'utaustin', 'uva', 'vcuhealth', 'veitusa', 'veoliauki',
    'vertexinc', 'vst', 'vwr', 'walshgroup', 'wasatchproperty~wd1~BlendtecCareers',
    'wasatchproperty~wd1~MarketStarCareers', 'wasatchproperty~wd1~PDK',
    'wasatchproperty~wd1~marketstarcareersemea', 'wasatchproperty~wd1~marketstarcareersnamer',
    'waynefarms', 'wellsky', 'westernalliancebank~wd5~AMH', 'westernalliancebank~wd5~WAB', 'wework',
    'wexinc', 'wgu', 'wilsonco', 'woundedwarriorproject', 'wwecorp~wd5~IMG', 'wwecorp~wd5~TKO',
    'wwecorp~wd5~private_postings', 'wwecorp~wd5~wwecorp', 'yeehong', 'yeticoolers', 'ymcaatlanta',
    'younglife'
  ];
  v_multi text[] := ARRAY['baltimorecity', 'bbinsurance', 'cba', 'ceu', 'chaptershealth', 'comfortsystemsusa', 'corebridgefinancial', 'corpartners', 'countryfinancial', 'dealertire', 'dynastymanagement', 'ebi', 'emerysapp', 'firstam', 'fticonsulting', 'gaig', 'gcu', 'jacksongov', 'jcrew', 'kaishaservice', 'kmkp', 'languageline', 'maxar', 'merceruniversity', 'nshe', 'pfg', 'plantemoran', 'propetroservices', 'puma', 'quadreal', 'sdguthrie', 'svha', 'tcsedsystem', 'thgrp', 'ucf', 'upenn', 'wasatchproperty', 'westernalliancebank', 'wwecorp'];
  v_missing text[];
  v_bad text[];
  v_kept text[];
  v_n int;
  v_left text;
BEGIN
  IF cardinality(v_slugs) <> 437 OR (SELECT count(DISTINCT s) FROM unnest(v_slugs) s) <> 437 THEN
    RAISE EXCEPTION 'self-check 20261111150000: the key list holds % keys, not 437 distinct ones', cardinality(v_slugs);
  END IF;
  SELECT array_agg(s ORDER BY s) INTO v_missing
    FROM unnest(v_slugs) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.company_name_overrides o WHERE o.slug = s);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261111150000: % of the 437 keys have no override (first: %)', cardinality(v_missing), array_to_string(v_missing[1:3], ', ');
  END IF;
  -- An override this run wrote carries this transaction's added_at.
  SELECT array_agg(o.slug ORDER BY o.slug) INTO v_bad
    FROM public.company_name_overrides o
   WHERE o.slug = ANY (v_slugs)
     AND o.added_at = now()
     AND NOT EXISTS (
       SELECT 1 FROM public.company_name_evidence e
        WHERE e.slug = o.slug
          AND e.display_name = o.display_name
          AND e.read_on IN (DATE '2026-11-08', DATE '2026-11-17')
          AND length(e.quote) >= 10
          AND cardinality(e.evidence) >= 1
          AND NOT EXISTS (SELECT 1 FROM unnest(e.evidence) l WHERE l !~ '^https://[^[:space:]]+$'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261111150000: % override(s) this file wrote lack the evidence naming them (first: %)', cardinality(v_bad), array_to_string(v_bad[1:3], ', ');
  END IF;
  SELECT array_agg(format('%s (%s)', o.slug, o.display_name) ORDER BY o.slug) INTO v_kept
    FROM public.company_name_overrides o
   WHERE o.slug = ANY (v_slugs) AND o.added_at < now()
     AND NOT EXISTS (SELECT 1 FROM public.company_name_evidence e WHERE e.slug = o.slug AND e.display_name = o.display_name AND e.read_on IN (DATE '2026-11-08', DATE '2026-11-17'));
  IF v_kept IS NOT NULL THEN
    RAISE NOTICE 'self-check 20261111150000: % key(s) the table already held keep their own name: %', cardinality(v_kept), array_to_string(v_kept[1:10], '; ');
  END IF;
  SELECT array_agg(format('%s = %s', o.slug, o.display_name) ORDER BY o.slug) INTO v_bad
    FROM public.company_name_overrides o
    JOIN (VALUES ('tscfl', 'HVAC Photo'), ('mfs', 'Mass Financial Services'), ('nghs', 'NGHS'), ('americanglobal', 'American'), ('lumaenergy', 'New LUMA'), ('woundedwarriorproject', 'Wounded Warrior Project | WWP'), ('gcu~wd1~Orbis', 'Grand Canyon Education'), ('cba', 'Commonwealth Bank'), ('erm', 'Environmental Resources Management'), ('isc', 'Information Services'), ('travelhrportal', 'CWT'), ('agreenspace', 'NZ National Carriers')) AS w(slug, display_name)
      ON w.slug = o.slug AND w.display_name = o.display_name;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261111150000: a name the re-check of 2026-11-17 read as wrong stands: %', array_to_string(v_bad, '; ');
  END IF;
  SELECT array_agg(o.slug ORDER BY o.slug) INTO v_bad
    FROM public.company_name_overrides o
   WHERE o.added_at = now() AND (o.slug = ANY (v_multi) OR o.slug IN ('warnerbros', 'gi'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261111150000: this run wrote a tenant key for a tenant it names board by board or leaves out: %', array_to_string(v_bad, ', ');
  END IF;
  SELECT count(*) INTO v_n FROM public.company_name_overrides;
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'self-check 20261111150000: company_name_overrides holds % rows, and job-board''s name-sync lane reads at most 1,000 in its one read, so some boards would never be renamed; page that read first', v_n;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.company_name_evidence'::regclass) THEN
    RAISE EXCEPTION 'self-check 20261111150000: row level security is off on public.company_name_evidence';
  END IF;
  IF has_table_privilege('anon', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check 20261111150000: anon or authenticated can read or write public.company_name_evidence';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.company_name_evidence', 'SELECT') THEN
    RAISE EXCEPTION 'self-check 20261111150000: the service role cannot read public.company_name_evidence';
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_left
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261111150000: job_board_meta still holds %, so job-board''s name-sync lane would not walk these boards', v_left;
  END IF;
  RAISE NOTICE 'self-check 20261111150000: 437 keys present (% rows in the table); the name-sync lane renames their stored rows from the next pass-end', v_n;
END $$;
