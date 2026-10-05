-- A WORKDAY SLICE READ AS A WHOLE BOARD WROTE CLOSURES NOBODY MADE.
--
-- Register L1-01 (platform debug sweep 2026-10-04), the mechanism behind
-- defect-sweep 1.17. job-board .89 fixes the cause; this file marks what the
-- cause already wrote. Apply it AFTER job-board answers status.version
-- 2026-09-09.89 (docs/job-board-deploy-notes.md, .89), or the old bundle keeps
-- writing rows of the same kind after it.
--
-- WHAT HAPPENED. Many Workday tenants state `total` only on the offset-0 page
-- and answer `total: 0` on every later page (measured 2026-10-05: 540 of the
-- 689 Workday boards whose verification stamp read 0 or over 250; Adobe 526,
-- Novartis 816, TD 1,521, T-Mobile 2,000 at offset 0, 0 past it). A visit is
-- capped at MAX_POSTINGS_PER_VISIT (500 from 2026-08-25, 250 from 2026-09-06),
-- so such a board is read over several visits and every visit after the first
-- starts mid-feed and sees a total of 0. The collector's windowed test
-- (`feedTotal > rows read`) was then false, the slice was taken for the whole
-- board, and every stored posting outside it was stamped missing and, after
-- the grace, deleted and logged here with absence_basis 'full_read' (NULL
-- before the basis column existed) as an employer takedown. 207 of those
-- boards served nothing on 2026-10-05.
--
-- WHICH ROWS. A Workday 'full_read' (or pre-basis) closure on a board whose
-- own advertised count exceeded the visit cap in force when it was logged:
-- such a board cannot be read whole in one visit, so a full read of it was
-- impossible and every such closure came from a mid-feed slice. The count is
-- the largest the board is known to have stated, from three places:
--   - the daily board_state history (from 2026-09-06). It keeps only the
--     day's LAST visit, and a mid-feed visit writes NULL, so a board whose
--     last visit of every day began mid-feed is absent from it;
--   - the live verification stamp, which the defect itself zeroed on 322 of
--     the 540 boards;
--   - so also the 540 boards measured on 2026-10-05 against their own CXS
--     lists (offset-0 total, and total 0 at offset 20), inlined below.
-- A board in none of the three is not covered (one whose stamp read 1-250 on
-- 2026-10-05 and whose every board_state day began mid-feed).
-- The one way this over-marks: a board that shrank under the cap and was then
-- genuinely read whole; those closures leave the estimator with the rest
-- (suspect is read as excluded everywhere), which is the cautious direction
-- for a table that is sold as "the employer took the role down".
--
-- A CEILING, BECAUSE THE OLD BUNDLE MAY STILL BE WRITING. Each statement
-- under READ COMMITTED reads a fresh snapshot, so a closure the old bundle
-- commits between the marking and the check would make the check fail and the
-- file roll back. The rule is applied once to the closures that exist when
-- the block starts (event_id <= the max read first), the check covers the
-- same set, and a closure committed just behind the ceiling is caught by a
-- second pass before the check can call it left over.
--
-- REVERSIBLE. Every row this file marks is listed in
-- job_board_closure_repairs (service role only) under the repair name, so the
-- marking can be audited or undone exactly:
--   UPDATE public.job_board_closures c SET suspect = false
--     FROM public.job_board_closure_repairs r
--    WHERE r.event_id = c.event_id AND r.repair = 'workday_mid_feed_zero_l1_01';
-- THE WHOLE FILE IS RE-RUNNABLE (IF NOT EXISTS, ON CONFLICT DO NOTHING, a
-- suspect = false guard): if it applied before .89 served, the old bundle's
-- later closures are past its ceiling and stay unmarked; run the file again
-- once .89 serves.
--
-- NOT DONE HERE. The paired job_board_exits rows (exit_reason 'removed') have
-- no suspect column and stay. Postings stamped missing by the defect and not
-- yet deleted heal on their own under .89: a windowed visit unstamps every id
-- it serves, and only a proven lap may close one.

CREATE TABLE IF NOT EXISTS public.job_board_closure_repairs (
  event_id  bigint PRIMARY KEY,
  repair    text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_board_closure_repairs IS
  'One row per job_board_closures event a data repair marked suspect, named by the repair, so the marking can be audited or reversed exactly. Service role only.';

ALTER TABLE public.job_board_closure_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_board_closure_repairs FROM PUBLIC;
REVOKE ALL ON public.job_board_closure_repairs FROM anon;
REVOKE ALL ON public.job_board_closure_repairs FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.job_board_closure_repairs TO service_role;

SET LOCAL statement_timeout = '15min';

DO $$
DECLARE
  v_tokens  text[];
  v_tops    bigint[];
  v_ceiling bigint;
  v_left    bigint := 0;
  v_pass    int := 0;
  v_marked  bigint;
  v_unmarked_listed bigint;
BEGIN
  IF to_regclass('public.job_board_closure_repairs') IS NULL THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.job_board_closure_repairs'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs does not have row-level security on';
  END IF;
  IF has_table_privilege('anon', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('anon', 'public.job_board_closure_repairs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify 20261005100000: job_board_closure_repairs is readable or writable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.job_board_closure_repairs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.job_board_closure_repairs', 'INSERT') THEN
    RAISE EXCEPTION 'self-verify 20261005100000: service_role cannot read and write job_board_closure_repairs';
  END IF;

  -- The boards each source names, and the largest count each stated. Read
  -- once, into two arrays (a few hundred entries), so the marking and the
  -- check below judge the same list.
  SELECT array_agg(t.company_token ORDER BY t.company_token), array_agg(t.top ORDER BY t.company_token)
    INTO v_tokens, v_tops
    FROM (
      SELECT s.company_token, max(s.feed_total)::bigint AS top
        FROM (
          SELECT company_token, feed_total::bigint AS feed_total
            FROM public.job_board_board_state
           WHERE source = 'workday' AND feed_total IS NOT NULL
          UNION ALL
          SELECT company_token, feed_total::bigint
            FROM public.job_board_verifications
           WHERE company_token LIKE '%~wd%' AND feed_total IS NOT NULL
          UNION ALL
          -- Measured 2026-10-05: offset-0 total, total 0 at offset 20.
          SELECT m.company_token, m.feed_total::bigint
            FROM (VALUES
            ('3m~wd1~Search', 696), ('aah~wd5~External', 2000), ('aampower~wd1~AAM-Career-Site', 365), ('abbott~wd5~abbottcareers', 2000),
            ('abbott~wd5~abbottcareers2', 1232), ('abb~wd3~external_career_page', 2000), ('abcfws~wd1~abcfws', 274), ('accenture~wd103~AccentureCareers', 2000),
            ('acciona~wd3~ACCIONA_Employment_Channel', 535), ('ace~wd5~careers', 460), ('acg~wd1~Careers', 256), ('adobe~wd5~external_experienced', 526),
            ('advanceauto~wd5~AdvanceExternalCareers', 2000), ('adventisthealthcare~wd1~AdventistHealthCareCareers', 439), ('aep~wd1~AEPCareerSite', 282), ('agecare~wd10~AgeCare_Careers_External', 750),
            ('agilent~wd5~Agilent_Careers', 346), ('ag~wd3~Airbus', 2000), ('aia~wd3~External', 971), ('aig~wd1~aig', 475),
            ('airliquidehr~wd3~AirLiquideExternalCareer', 1056), ('airliquidehr~wd3~AirgasExternalCareer', 405), ('airproducts~wd5~AP0001', 373), ('alcon~wd5~careers_alcon', 318),
            ('alfalaval~wd3~Alfa_Laval_jobs', 335), ('allegion~wd5~careers', 329), ('alliancewd~wd3~renault-group-careers', 428), ('allstate~wd5~allstate_careers', 441),
            ('altamed~wd1~Careers', 275), ('amat~wd1~External', 2000), ('americanredcross~wd1~American_Red_Cross_Careers', 383), ('amerivet~wd5~Amerivet', 300),
            ('analogdevices~wd1~External', 839), ('aoins~wd5~AutoOwners', 286), ('aptiv~wd5~APTIV_CAREERS', 750), ('archildrens~wd1~External_Career_Site', 256),
            ('arcis~wd12~extNa', 468), ('aresmgmt~wd1~External', 263), ('aritzia~wd3~External', 525), ('arrow~wd1~ac', 471),
            ('aspendental~wd1~careers_aspen_dental', 1742), ('atd~wd1~American_Tire_Distributors', 266), ('atriumhospitality~wd5~AtriumHospitality', 325), ('att~wd1~ATTGeneral', 1132),
            ('autodesk~wd1~Ext', 372), ('avav~wd1~AVAV', 361), ('avera~wd5~avera-careers', 1092), ('aveva~wd3~AVEVA_careers', 254),
            ('avisbudget~wd1~ABG_Careers', 588), ('babilou~wd3~Babilou', 2000), ('bah~wd1~BAH_Jobs', 2000), ('bakerhughes~wd5~BakerHughes', 658),
            ('bakertilly~wd5~btcareers', 448), ('bannerhealth~wd108~Careers', 1317), ('barcelo~wd3~Barcelo_Careers', 461), ('barrywehmiller~wd1~BWCareers', 391),
            ('baxter~wd1~baxter', 498), ('baystatehealth~wd12~External_Careers', 396), ('bbinsurance~wd1~Careers', 285), ('bbva~wd3~BBVA', 547),
            ('bdx~wd1~EXTERNAL_CAREER_SITE_USA', 661), ('beigene~wd5~BeiGene', 263), ('belk~wd1~Jobs-Stores', 1547), ('belron~wd3~Safelite_Careers', 547),
            ('bernergroup~wd3~Careers_Berner_Group', 301), ('bhs~wd1~careers', 1425), ('biibhr~wd3~external', 254), ('bilh~wd1~External', 2000),
            ('bjswholesaleclub~wd1~BJsCareers', 1385), ('blueorigin~wd5~BlueOrigin', 1773), ('bmo~wd3~External', 864), ('bne~wd1~Hardees', 737),
            ('bobsdf~wd1~Bobs_Careers', 368), ('boeing~wd1~EXTERNAL_CAREERS', 752), ('borgwarner~wd5~BorgWarner_Careers', 317), ('boydgroup~wd1~boydcareers', 1371),
            ('bpinternational~wd3~bpcareers', 293), ('brenntag~wd3~brenntag_jobs', 378), ('bridgestone~wd5~External', 2000), ('brighthorizons~wd5~External-NorthAmerica', 648),
            ('brighthorizons~wd5~External-UnitedKingdom', 861), ('brightli~wd5~BrightliTalent', 427), ('bristolmyerssquibb~wd5~BMS', 674), ('broadridge~wd5~Careers', 284),
            ('bronsonhg~wd1~newhires', 458), ('brookshires~wd108~BGC', 1803), ('brownhealth~wd12~External_Careers', 1531), ('brunswick~wd1~search', 422),
            ('bupa~wd3~EXT_CAREER', 629), ('cadence~wd1~External_Careers', 614), ('cae~wd3~career', 348), ('calibercollision~wd1~Caliber', 1498),
            ('campingworld~wd5~Jobs', 749), ('capefearvalley~wd1~CFV', 309), ('capitalhealth~wd1~CapitalHealthCareers', 506), ('capri~wd1~Michael_Kors', 505),
            ('cardinalhealth~wd1~EXT', 819), ('card~wd5~Search', 255), ('carmax~wd1~External', 1180), ('carters~wd1~CartersCareers', 1026),
            ('catalent~wd1~External', 286), ('cat~wd5~caterpillarcareers', 878), ('ccc~wd5~ccc_External', 251), ('cc~wd3~ChanelCareers', 1119),
            ('cdfh~wd3~External', 494), ('cecentertainment~wd5~CEC_Careers', 2000), ('centene~wd5~Centene_External', 326), ('cgm~wd3~cgm', 270),
            ('chevronstations~wd1~CSI', 337), ('childrensplace~wd1~TCP02', 1281), ('christianacare~wd5~CCHS', 315), ('churchs~wd1~Field', 702),
            ('cibc~wd3~search', 508), ('cigna~wd5~cignacareers', 560), ('cinemark~wd1~cinemark', 736), ('circlehealth~wd103~chgcareers', 526),
            ('circlek~wd3~CircleKStoreJobs', 2000), ('citicclsa~wd3~External', 332), ('clarios~wd5~clarioscareers', 257), ('clearskyhealth~wd1~CSH', 330),
            ('cnx~wd1~external_global', 1617), ('coffeeandbagelbrands~wd1~coffeeandbagelbrands', 623), ('columbiasportswearcompany~wd5~CSC_Careers', 330), ('conagrabrands~wd1~Careers_US', 270),
            ('copart~wd12~Copart', 390), ('costar~wd1~CoStarCareers', 428), ('countryfinancial~wd5~COUNTRYAgencyExternal', 258), ('coxhealth~wd5~CoxHealth_External', 508),
            ('cranecompany~wd5~Careers', 312), ('crhc~wd1~Concord_Careers', 370), ('crowdstrike~wd5~crowdstrikecareers', 355), ('csusystem~wd12~fortcollins_careers', 275),
            ('ctbcholding~wd3~External', 625), ('curtisswright~wd1~CW_External_Career_Site', 364), ('cwi~wd1~CW_Careers', 324), ('cw~wd1~External', 2000),
            ('danaher~wd1~DanaherJobs', 1403), ('daveandbusters~wd1~Dave_and_Busters_Careers', 1129), ('db~wd3~DBWebsite', 1156), ('dealertire~wd5~4710', 296),
            ('debeka~wd3~Karriere', 848), ('deckers~wd5~Deckers', 417), ('dentalcorp~wd3~dentalcorp', 436), ('dentsuaegis~wd3~DAN_GLOBAL', 863),
            ('denverhealth~wd1~dhha-main', 359), ('desjardins~wd10~desjardins', 280), ('destinationpet~wd5~DPEC', 304), ('dexcom~wd1~Dexcom', 277),
            ('diageo~wd3~Diageo_Careers', 277), ('dickssportinggoods~wd1~DSG', 2000), ('drivenbrands~wd1~DrivenBrandsCareerSite', 2000), ('dutchbros~wd1~DBShops', 911),
            ('dxctechnology~wd1~DXCJobs', 1152), ('dyson~wd3~dyson_careers', 455), ('easyservice~wd5~MercyHealthCareers', 1242), ('easyservice~wd5~roperstfrancishealthcare', 335),
            ('ebay~wd5~apply', 294), ('edwards~wd5~edwardscareers', 401), ('eiffage~wd3~Eiffage_Careers', 1958), ('elanco~wd5~External_Career', 363),
            ('ensemblehp~wd5~EnsembleHealthPartnersCareers', 432), ('entegris~wd1~EntegrisCareers', 613), ('equinix~wd1~External', 266), ('equitylifestyleproperties~wd5~ELS', 629),
            ('erickson~wd108~External', 521), ('erm~wd3~ERM_Careers', 510), ('essentiahealth~wd1~Essentia_Health', 801), ('essity~wd3~Job_opportunities', 325),
            ('europcar~wd103~EuropcarCareerPage', 635), ('evonik~wd3~External_Careers', 329), ('extraspace~wd5~ESS_External', 514), ('faithtechnologies~wd1~fti', 338),
            ('fedex~wd1~fxe-eu_external', 867), ('ferguson~wd1~Ferguson_Experienced', 437), ('ferrovial~wd3~Ferrovial_Career_Site', 521), ('fielmann~wd3~External', 1767),
            ('fifththird~wd5~53careers', 935), ('fina~wd103~DeloitteRecrute', 549), ('firststudent~wd1~firststudent', 1150), ('fivebelow~wd1~fivebelowcareers', 2000),
            ('flextronics~wd1~Careers', 1518), ('flir~wd1~flircareers', 762), ('fmr~wd1~fidelitycareers', 800), ('fogo~wd5~Fogo', 408),
            ('fortrea~wd1~Fortrea', 330), ('fourseasons~wd3~search', 1874), ('fox~wd1~Domestic', 361), ('freseniusmedicalcare~wd3~fme', 2000),
            ('freudenberg~wd3~freudenberg-group', 702), ('galderma~wd3~External', 347), ('gartner~wd5~EXT', 754), ('gbmc~wd1~gbmc', 306),
            ('gdit~wd5~External_Career_Site', 1250), ('generac~wd5~External', 451), ('generalmotors~wd5~Careers_GM', 790), ('genpact~wd108~External_Careers', 1825),
            ('genpt~wd1~Careers', 2000), ('georgfischer~wd103~GeorgFischer_Careers', 329), ('gfs~wd5~usjobs-gen-gfs', 667), ('gianttiger~wd3~gianttiger', 516),
            ('gilead~wd1~gileadcareers', 505), ('globalfoundries~wd1~External', 708), ('globe~wd3~GLB_Careers', 374), ('globusmedical~wd5~GMED_Careers', 345),
            ('gobeacon~wd1~beaconmobilitycareers', 380), ('gohealthuc~wd12~External', 440), ('goldbeck~wd103~goldbeck-jobs', 805), ('goldenagri~wd3~SMART_Careers', 284),
            ('goodlifefitness~wd3~Careers', 313), ('granite~wd1~careers', 265), ('graybar~wd1~Careers', 437), ('greif~wd5~Greif', 283),
            ('greystar~wd1~External', 1555), ('groundworks~wd1~Groundworks', 351), ('gsknch~wd3~GSKCareers', 315), ('gsk~wd5~GSKCareers', 689),
            ('guestservices~wd5~GSI', 306), ('guidehouse~wd1~External', 827), ('gundersenhealth~wd5~Gundersen', 420), ('hargroveepc~wd12~Hargrove_Careers', 256),
            ('harman~wd3~HARMAN', 519), ('hcmportal~wd5~Search', 1474), ('hdsupply~wd1~external', 366), ('heidelbergmaterials~wd3~Global_HM_Career_Site', 857),
            ('heinz~wd1~KraftHeinz_Careers', 889), ('heinz~wd1~KraftHeinz_Careers_BC', 261), ('hellmann~wd103~hellmannexternaljobs', 341), ('hendrick~wd5~HendrickCareers', 478),
            ('hhs~wd12~HHS1HourlyJobs', 354), ('highmarkhealth~wd1~highmark', 1881), ('hitachi~wd1~hitachi', 2000), ('hntb~wd5~HNTB_Careers', 557),
            ('homedepot~wd5~careerdepot', 984), ('hpe~wd5~Jobsathpe', 1430), ('hpe~wd5~acjobsite', 1543), ('hp~wd5~EXTEU-AC-CareerSite', 1223),
            ('hp~wd5~ExternalCareerSite', 926), ('hshs~wd1~hshscareers', 403), ('hubinternational~wd1~HUBInternational', 560), ('humana~wd5~CenterWell_External_Career_Site', 1855),
            ('humana~wd5~Humana_External_Career_Site', 293), ('huron~wd1~huroncareers', 261), ('hyperiongrp~wd3~Hyperion_External', 330), ('hyvee~wd1~HyVeeCareers', 1766),
            ('icf~wd5~ICFExternal_Career_Site', 397), ('idex~wd3~toutes-nos-offres-demploi', 615), ('iff~wd5~IFF_Careers', 327), ('iheartmedia~wd5~External_iHM', 301),
            ('ilitch~wd5~LC', 987), ('imh~wd108~IntermountainCareers', 1417), ('ingrammicro~wd5~IngramMicro', 505), ('intel~wd1~External', 606),
            ('ipsen~wd103~Ipsen_Careers', 270), ('iqvia~wd1~IQVIA', 1876), ('ironmountain~wd5~iron-mountain-jobs', 324), ('ivytech~wd1~Ivy_Tech_Careers', 516),
            ('jabil~wd5~Jabil_Careers', 2000), ('jbhunt~wd501~Careers', 504), ('jbtm~wd108~JBT_Marel_Career_Site', 259), ('jcrew~wd1~JCrewCareers', 1166),
            ('jcrew~wd1~MadewellCareers', 356), ('jdgroupnam~wd1~JDFL_Store_Careers', 871), ('jll~wd1~jllcareers', 2000), ('johnsonelectric~wd3~Career_JE', 274),
            ('kansashealthsystem~wd1~careers', 1041), ('kbr~wd5~KBR_Careers', 1795), ('kemper~wd5~Kemper_Careers', 359), ('keybank~wd5~External_Career_Site', 570),
            ('kiongroup~wd3~KIONGroup', 983), ('kiongroup~wd3~KION_SCS', 369), ('kla~wd1~Search', 1078), ('knitwellgroup~wd1~US_Retail_Jobs', 2000),
            ('kohls~wd504~kohlscareers', 2000), ('kone~wd3~Careers', 889), ('ksb~wd3~KSB_ExternalCareerSite', 296), ('kyndryl~wd5~KyndrylProfessionalCareers', 888),
            ('lego~wd103~LEGO_External', 495), ('leidos~wd5~External', 2000), ('lennar~wd1~lennar_jobs', 319), ('leonardocompany~wd3~LeonardoCareerSite', 731),
            ('lesschwab~wd1~stores', 1162), ('levistraussandco~wd5~External', 1333), ('livenation~wd503~LNExternalSite', 1422), ('lkqcorp~wd5~ExternalCareerSite-LKQ', 618),
            ('loewshotels~wd5~loewshotels', 314), ('loganhealth~wd1~Logan_Careers', 469), ('lonza~wd3~Lonza_Careers', 600), ('lseg~wd3~Careers', 662),
            ('lsu~wd1~LSU', 279), ('lumentum~wd5~LITE', 257), ('lvhn~wd1~lvhn', 1221), ('mango~wd3~Mango_Work_Your_Passion', 1643),
            ('manulife~wd3~MFCJH_Jobs', 643), ('marathonhealth~wd501~Marathon-Health-Careers', 524), ('marinabaysands~wd102~External', 348), ('marmon~wd501~Marmon_Careers', 741),
            ('marvell~wd1~MarvellCareers', 281), ('marywashingtonhealthcare~wd5~Externalcareers', 312), ('masseyservices~wd5~masseyservices', 343), ('massgeneralbrigham~wd1~MGBExternal', 2000),
            ('mastercard~wd1~CorporateCareers', 1031), ('mastercorp~wd1~MC', 335), ('mbda~wd3~MBDA-Italy', 312), ('mbk~wd5~MSLCareers', 282),
            ('mcgill~wd3~McGill_Careers', 564), ('mchapusa~wd5~MCHAP_External', 346), ('mckesson~wd3~External_Careers', 629), ('mdlz~wd3~External', 1233),
            ('medivet~wd3~MedivetCareers', 277), ('medline~wd5~Medline', 615), ('medtronic~wd1~MedtronicCareers', 1066), ('meijer~wd5~Meijer_Stores_Hourly', 1430),
            ('meijer~wd5~Meijer_Stores_Leadership', 283), ('memorialhealthcare~wd1~MHS_Careers', 560), ('mgmresorts~wd5~MGMCareers', 441), ('michaels~wd5~External', 2000),
            ('michelinhr~wd3~Michelin', 747), ('miele~wd3~miele-jobs', 278), ('mmc~wd1~MMC', 1938), ('mmc~wd1~careers', 680),
            ('montage~wd1~Montage_International', 443), ('montefiore~wd12~MMC', 459), ('monumenthealth~wd1~goldcareers', 630), ('motorolasolutions~wd5~Careers', 891),
            ('mouvrh~wd103~External_Career_Site_grand_frais', 282), ('ms~wd5~external', 1353), ('ms~wd5~private', 442), ('mtb~wd5~mtb', 785),
            ('mufgub~wd3~MUFG-Careers', 692), ('multicare~wd1~multicare', 1335), ('musc~wd1~MUSC', 2000), ('my7elevenhr~wd12~Careers', 626),
            ('myhrabc~wd5~Global', 988), ('myhrhome~wd1~OneMainCareers', 375), ('mymvw~wd5~MVW', 540), ('nc~wd108~NC_Careers', 798),
            ('nexstar~wd5~nexstar', 608), ('nghs~wd1~External', 421), ('niagarawater~wd5~Niagara', 344), ('nordsonhcm~wd501~nordsoncareers', 251),
            ('northeastern~wd1~careers', 447), ('novartis~wd3~Novartis_Careers', 816), ('nshs~wd1~ns-eeh', 1158), ('ntrs~wd1~northerntrust', 574),
            ('ntu~wd3~Careers', 736), ('nuffieldhealth~wd3~NH_Careers', 415), ('nvent~wd5~nVent', 573), ('nvidia~wd5~NVIDIAExternalCareerSite', 2000),
            ('nwis~wd12~NW', 351), ('nxp~wd3~careers', 784), ('nyp~wd1~nypcareers', 269), ('ocbc~wd102~External', 1186),
            ('ochsner~wd1~Ochsner', 1864), ('ochsner~wd1~OchsnerPhysician', 349), ('ohiohealth~wd5~OhioHealthJobs', 1037), ('okgov~wd1~okgovjobs', 525),
            ('oldmutual~wd3~Old_Mutual_Careers', 525), ('onehealthineers~wd3~SHSJB', 509), ('onehealthineers~wd3~ijmhrms', 272), ('onelineage~wd1~External', 393),
            ('oshkoshcorporation~wd5~Oshkosh', 551), ('osu~wd1~OSUCareers', 1016), ('oumedicine~wd5~OUHealthCareers', 439), ('pacs~wd108~pacs', 2000),
            ('palmbeachstate~wd1~external', 270), ('papajohns~wd1~PapaJohnsCareers', 1619), ('parexel~wd1~Parexel_External_Careers', 343), ('parsons~wd5~Search', 1928),
            ('pciservices~wd1~External', 287), ('peopleandbaby~wd3~People-Baby', 257), ('pernodricard~wd3~pernod-ricard', 295), ('petvalu~wd3~External_Career_Site_Pet_Valu_Canada', 437),
            ('pfg~wd3~SaveonfoodsCareers', 328), ('pfizer~wd1~PfizerCareers', 511), ('pg~wd5~1000', 823), ('philips~wd3~jobs-and-careers', 837),
            ('pnc~wd5~External', 2000), ('ppg~wd5~ppg_careers', 705), ('promachbuilt~wd108~promach', 283), ('prudential~wd3~prudential', 480),
            ('prysmiangroup~wd3~Careers', 598), ('psu~wd1~PSU_Academic', 416), ('psu~wd1~PSU_Staff', 1452), ('puma~wd502~Jobs_at_Puma', 665),
            ('pvh~wd1~PVH_Careers', 1563), ('pyebarkerfire~wd1~PB_V2', 317), ('qtsdatacenters~wd5~qts', 277), ('quickenloans~wd5~rocket_careers', 381),
            ('r1rcm~wd1~R1RCM', 457), ('rakuten~wd1~RakutenInc', 706), ('raymondjames~wd1~RaymondJamesCareers', 319), ('rbc~wd3~RBCGLOBAL1', 871),
            ('reece~wd105~ReeceCareers', 272), ('regalrexnord~wd1~Careers', 507), ('reitmr~wd5~Sonesta', 283), ('relx~wd3~LexisNexisLegal', 272),
            ('relx~wd3~relx', 787), ('republic~wd5~Republic', 1720), ('revera~wd3~talemetry_external', 526), ('rivhs~wd1~Non-ProviderRHS', 705),
            ('roberthalf~wd1~RobertHalfStaffingCareers', 252), ('rochester~wd5~UR_Staff', 1396), ('rockwellautomation~wd1~External_Rockwell_Automation', 386), ('rollsroyce~wd3~professional', 478),
            ('rosendin~wd1~Careers', 264), ('rrhs~wd5~RRH', 1378), ('rsm~wd1~rsmcareers', 742), ('rxo~wd501~rxojobs', 389),
            ('ryder~wd5~RyderCareers', 468), ('saintfrancis~wd115~External', 559), ('saintlukes~wd1~saintlukeshealthcareers', 532), ('salesforce~wd12~External_Career_Site', 1519),
            ('salvationarmyca~wd3~tsacb', 262), ('salvationarmy~wd3~Volunteer', 527), ('sandvik~wd3~sandvik-jobs', 392), ('sanford~wd5~SanfordHealth', 2000),
            ('sanofi~wd3~SanofiCareers', 801), ('santander~wd3~SantanderCareers', 928), ('saputo~wd5~Saputo_External_Careers', 283), ('sasllc~wd1~Careers', 280),
            ('sbdinc~wd1~Stanley_Black_Decker_Career_Site', 627), ('schnucks~wd5~SchnucksCareers', 277), ('sci~wd5~sci', 1144), ('searhc~wd5~SEARHC', 263),
            ('seaworldentertainment~wd1~SEA', 388), ('sec~wd3~Samsung_Careers', 658), ('sedgwick~wd1~Sedgwick', 573), ('selinc~wd1~SEL', 307),
            ('sentara~wd1~SCS', 2000), ('sharp~wd1~External', 313), ('shi~wd12~shicareers', 252), ('shm~wd5~Summit_CityMD', 631),
            ('shusa~wd5~External', 311), ('sih~wd5~SIH_External', 267), ('simcorp~wd3~SimCorp_Jobs', 265), ('simedarby~wd3~SimeCareerSite', 425),
            ('skechers~wd5~One-career-site', 1672), ('slihrms~wd3~Careers', 2000), ('sluhn~wd1~SLUHN', 960), ('smithfieldfoods~wd1~Careers', 517),
            ('smithnephew~wd5~External', 303), ('solenis~wd1~Solenis', 445), ('solutionhealth~wd1~Careers', 535), ('son~wd108~NebraskaStateCareers', 272),
            ('southshorehealth~wd5~SSH_Careers', 258), ('spartannash~wd1~SpartanNash_Careers', 1161), ('spectrumhealth~wd5~CorewellHealthCareers', 2000), ('spgi~wd5~SPGI_Careers', 263),
            ('srsdistribution~wd1~GMS', 343), ('ssctech~wd1~ssctechnologies', 329), ('standoutforgood~wd12~StandOutForGood', 521), ('stanfordmedicine~wd115~SHC_External_Career_Site', 346),
            ('stcharles~wd1~External', 286), ('stormontvail~wd1~SVH', 261), ('stryker~wd1~StrykerCareers', 1465), ('stvinc~wd5~stv', 390),
            ('sulzer~wd502~SulzerJobs', 351), ('summitbhc~wd1~Summit_BHC', 285), ('sunbeltrentals~wd1~sbcareers', 983), ('sunlife~wd3~Experienced-Jobs', 273),
            ('sunrun~wd5~Sunrun_Careers', 268), ('swarovski~wd3~swarovski', 781), ('syneoshealth~wd12~Syneos_Health_External_Site', 740), ('synnex~wd5~hyvecareers', 598),
            ('synnex~wd5~tdsynnexcareers', 804), ('sysco~wd5~syscocareers', 2000), ('tamus~wd1~System-wide_External', 774), ('tapestry~wd108~Tapestry_Careers', 2000),
            ('target~wd5~targetcareers', 2000), ('taskus~wd1~Careers', 427), ('taymax~wd5~External_Careers', 334), ('td~wd3~TD_Bank_Careers', 1523),
            ('theapexgroup~wd3~apexgroupcareers', 1032), ('thedacare~wd5~ThedaCare_Career_Site1', 447), ('theirc~wd1~External_Careers', 339), ('thomsonreuters~wd5~External_Career_Site', 424),
            ('thrivent~wd5~external', 328), ('thriveworks~wd5~Thriveworks', 1069), ('tidalwaveautospa~wd1~TWAS', 514), ('tmobile~wd1~External', 2000),
            ('toryburch~wd1~toryburchcareers', 349), ('travelers~wd5~External', 377), ('trinityhealth~wd1~Jobs', 2000), ('trumed~wd1~TMC_External_Career_Site', 295),
            ('trumpf~wd3~TRUMPF_Graduates_and_Professionals', 288), ('tti~wd1~Milwaukee', 314), ('tuftsmedicine~wd1~Jobs', 437), ('tysonfoods~wd5~TSN', 618),
            ('tysonfoods~wd5~TSN5', 424), ('uasys~wd5~UAMS_All_Careers', 281), ('uasys~wd5~UASYS', 721), ('uchicago~wd5~External', 402),
            ('ufpi~wd503~ufpi', 407), ('uhaul~wd1~UhaulJobs', 2000), ('uline~wd1~Uline_Careers', 427), ('umiami~wd1~UMCareerStaff', 1741),
            ('umiami~wd1~UMFaculty', 279), ('ummc~wd5~UMCCareers', 507), ('ummh~wd1~Careers', 1090), ('unisys~wd5~External', 417),
            ('unitingcareqld~wd105~UnitingCareCareers', 302), ('uobgroup~wd3~UOBExternal', 1031), ('uoflhealth~wd1~UofLHealthCareers', 474), ('uottawa~wd3~uOttawa_External_Career_Site', 404),
            ('upenn~wd1~careers-at-penn', 486), ('usbank~wd1~US_Bank_Careers', 1179), ('usfoods~wd1~usfoodscareersExternal', 663), ('utaustin~wd1~UTstaff', 611),
            ('valeo~wd3~valeo_jobs', 1003), ('valet~wd1~Career_Site', 303), ('valmont~wd1~ValmontCareers', 284), ('vanguard~wd5~vanguard_external', 339),
            ('vfc~wd5~vans_careers', 599), ('vfc~wd5~vfc_careers', 1316), ('viatris~wd5~External', 363), ('virtua~wd1~Virtua_Health_External_Career_Site', 763),
            ('vrtx~wd501~Vertex_Careers', 297), ('vumc~wd1~vumccareers', 857), ('vwr~wd1~avantorjobs', 256), ('walshgroup~wd12~walshgroup', 398),
            ('warnerbros~wd5~global', 280), ('wasteconnections~wd1~Careers', 700), ('wegmans~wd1~Wegmans', 540), ('weis~wd108~Careers', 972),
            ('wellstar~wd1~wellstarcareers', 1026), ('westlake~wd1~westlake', 291), ('wf~wd1~wellsfargojobs', 1552), ('whitecap~wd1~careers', 691),
            ('wisconsin~wd1~UW_Comprehensives', 367), ('wisconsin~wd1~UW_Madison', 349), ('wk~wd3~External', 440), ('workday~wd5~Workday', 372),
            ('worldmarket~wd5~cost_plus_world_market_jobs', 589), ('worldvision~wd1~WorldVisionInternational', 276), ('wustl~wd1~External', 677), ('xcelenergy~wd1~External', 254),
            ('xylem~wd5~xylem-careers', 516), ('ymcaatlanta~wd1~YMCA-Careers', 306), ('zeissgroup~wd3~External', 845), ('zeppelin~wd3~careers', 325)
            ) AS m(company_token, feed_total)
        ) s
       GROUP BY s.company_token
      HAVING max(s.feed_total) > 250
    ) t;
  IF coalesce(array_length(v_tokens, 1), 0) < 540 THEN
    RAISE EXCEPTION 'self-verify 20261005100000: only % Workday board(s) named over the cap; the 540 measured boards alone are more', coalesce(array_length(v_tokens, 1), 0);
  END IF;

  -- The closures that exist now. Anything committed after this read is past
  -- the ceiling: neither marked nor counted against the check.
  SELECT coalesce(max(event_id), 0) INTO v_ceiling FROM public.job_board_closures;

  LOOP
    v_pass := v_pass + 1;

    INSERT INTO public.job_board_closure_repairs (event_id, repair)
    SELECT c.event_id, 'workday_mid_feed_zero_l1_01'
      FROM public.job_board_closures c
      JOIN unnest(v_tokens, v_tops) AS b(company_token, top) ON b.company_token = c.company_token
     WHERE c.event_id <= v_ceiling
       AND c.source = 'workday'
       AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
       AND c.suspect = false
       AND (c.closed_at >= timestamptz '2026-09-06 00:00:00+00'
            OR (b.top > 500 AND c.closed_at >= timestamptz '2026-08-25 00:00:00+00'))
    ON CONFLICT (event_id) DO NOTHING;

    UPDATE public.job_board_closures c
       SET suspect = true
      FROM public.job_board_closure_repairs r
     WHERE r.event_id = c.event_id
       AND r.repair = 'workday_mid_feed_zero_l1_01'
       AND c.suspect = false;

    -- Nothing the rule names under the ceiling was left unmarked. A second
    -- pass catches a closure whose id was drawn before the ceiling was read
    -- but whose insert committed after the marking above.
    SELECT count(*) INTO v_left
      FROM public.job_board_closures c
      JOIN unnest(v_tokens, v_tops) AS b(company_token, top) ON b.company_token = c.company_token
     WHERE c.event_id <= v_ceiling
       AND c.source = 'workday'
       AND (c.absence_basis = 'full_read' OR c.absence_basis IS NULL)
       AND c.suspect = false
       AND (c.closed_at >= timestamptz '2026-09-06 00:00:00+00'
            OR (b.top > 500 AND c.closed_at >= timestamptz '2026-08-25 00:00:00+00'));
    EXIT WHEN v_left = 0 OR v_pass >= 3;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-verify 20261005100000: % Workday mid-feed closure(s) at or under event_id % were left unmarked after % passes', v_left, v_ceiling, v_pass;
  END IF;

  -- Every listed event is marked.
  SELECT count(*) INTO v_unmarked_listed
    FROM public.job_board_closure_repairs r
    JOIN public.job_board_closures c ON c.event_id = r.event_id
   WHERE r.repair = 'workday_mid_feed_zero_l1_01' AND c.suspect = false;
  IF v_unmarked_listed > 0 THEN
    RAISE EXCEPTION 'self-verify 20261005100000: % listed closure(s) are still not suspect', v_unmarked_listed;
  END IF;

  SELECT count(*) INTO v_marked FROM public.job_board_closure_repairs WHERE repair = 'workday_mid_feed_zero_l1_01';
  RAISE NOTICE 'self-verify 20261005100000: % Workday closure(s) written by mid-feed slices are marked suspect and listed in job_board_closure_repairs (% boards named, ceiling event_id %); the table is service-role only', v_marked, array_length(v_tokens, 1), v_ceiling;
END $$;
