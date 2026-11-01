-- THE BOARDS NAMED AFTER THE DEPLOY ARE RENAMED ON THE NEXT PASS.
--
-- WHAT HAPPENED (2026-10-31). Lovable deployed GitHub main f8d72a9b, and with
-- it job-board 2026-09-09.96 (NAME_SYNC_VERSION 6), but did not apply
-- 20261025100000 or 20261026100000, the two files the ledger ordered BEFORE
-- job-board: drizzle/migrations holds no stub for either, and the live
-- company-suggest still served "parallels wordmark on light" for
-- 8a680274-...~9201289910657_2 (Parallels, 20261025100000) and "PUREHomeRiver
-- Logo@2x (1)" for eea42ed6-...~9200441095595_2 (PURE HomeRiver) at 19:35Z.
-- Both files rest on one fact: moving NAME_SYNC_VERSION is what makes
-- job-board's name-sync lane rename the stored rows (postings, closures,
-- company snapshots, the closure rollup) of every board an override names,
-- once. The lane ran version 6 at the first pass-end after the deploy, over
-- the overrides that existed then ("name sync v6 complete: 6 renamed, 119
-- already correct", 2026-10-31T19:19:32Z), and wrote job_board_meta
-- name_sync_version {version: 6}; a stamp of its own version keeps the lane
-- idle from then on. Applied now, the two files name every new write
-- (trg_company_name_override) and never a stored row, so the 104 boards they
-- name by override (88 and 16) keep their logo and label names in search, on
-- company pages and in suggestions.
--
-- WHAT THIS FILE DOES, without a job-board deploy:
--   1. It refuses, changing nothing, unless both files are applied (below).
--   2. It deletes job_board_meta name_sync_version and name_sync_progress.
--      With no version stamp the lane runs at job-board .96's next pass-end;
--      with no progress row its queue starts from the first token
--      (nameSyncQueue with no prior), so no cursor left by an earlier walk
--      skips a board. The lane builds its tokens at that hop: every catalogue
--      token an override names by its exact key (each of the 104 slugs the
--      two files write is a catalogue token; none is a Workday tenant key)
--      and every RENAMED_TOKENS token (20261026100000's 64 catalogue renames,
--      which the first walk already renamed, since they ride in .96 itself).
--      It renames a board's rows only where they differ, up to four 90-second
--      hops a pass, resumes the next pass if boards wait, and stamps version
--      6 again when every board is done.
--   3. It checks its own effect: neither key is left.
-- Nothing else is written: no override, no evidence, no stored row (S11-133:
-- a rename in one transaction holds row locks against ingest and rewrites both
-- generated tsvectors, so the lane does it a board at a time).
--
-- WHY THE DELETE IS SAFE. The lane is the only writer of both keys, and while
-- name_sync_version reads 6 it returns before reading anything else, so no hop
-- is mid-walk when this first applies. Deleting a walk's progress (a re-run of
-- this file while the lane walks) starts that walk again from the first token:
-- every board is read once more and renamed only where its rows differ.
--
-- WHY IT REFUSES. Applied before the two files, it would arm a walk over the
-- overrides the first walk already read; the lane would stamp 6 again before
-- the names exist, and the incident would repeat. So it reads what the two
-- files' own self-checks assert: each of 20261025100000's 88 boards has its
-- override and its evidence row (read on 2026-10-25), naming one employer;
-- each of 20261026100000's 80 evidence rows is there (read on 2026-10-25 or
-- 2026-10-26), and the 16 whose token carries a "~" have the override their
-- evidence names; and trg_company_name_override is on job_board_postings, so
-- every write takes the names. The two slug lists below are those files'
-- own, letter for letter (the test reads both files and compares). A refusal
-- names the file to apply, never an edit: apply 20261025100000, then
-- 20261026100000, unedited, then this file again.
--
-- ORDER: right after 20261025100000 and 20261026100000 (docs/deploy-ledger.json
-- migrationOrder, afterMigrations). It waits for nothing else: no function
-- deploys with it, and job-board .96 already serves.
--
-- RE-RUNNABLE: the refusal only reads, the delete removes what is there, and
-- the self-check asks only that the keys are gone. A re-run after the lane
-- stamped 6 again arms one more walk, which renames nothing.
--
-- MEASURE: the job-board status action's passEnd.steps.names reads "name sync
-- v6" with a renamed count (a hop that stopped on its clock says how far it
-- got; the last says "complete") at a time after this file applied. The
-- employer facet company-suggest reads is rebuilt by the tail's serve step,
-- which runs before its names step, so "parallels" answers Parallels and
-- "homeriver" PURE HomeRiver from the pass after the one that renames.
--
-- ROLLBACK: none needed. The lane writes the stamp again; the overrides and
-- the trigger are the two files' own.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

-- REFUSE UNLESS BOTH NAME FILES ARE APPLIED, then re-arm the lane, in one
-- statement: a refusal deletes nothing whatever transaction the runner holds.
DO $$
DECLARE
  v_a text[] := ARRAY[
    '149c7964-ca14-4211-b982-ef50dfb8b504~9200868940886_2',
    '214ae4ed-5f0a-4657-b50a-6e318870a1f6~9200797842407_3',
    '70cd76e3-8c19-42a4-8d01-5d91b9c3222e~9201469061155_2',
    '8a680274-0b2e-46cf-b2cc-49bd2ef0c20f~9201289910657_2',
    '9f16667e-93e9-453a-b7cc-2bfeb3eda460~19000101_000003',
    'eea42ed6-3dcf-47f3-b99b-29a304948b2b~9200441095595_2',
    'eexs~us2~CX_11009',
    'eexs~us2~CX_3001',
    'ehwy~us2~CX',
    'ehwy~us2~CX_1',
    'ekpl~us6~CX_1',
    'emdz~us2~CX_1',
    'fa-exer-saasfaprod1~ocs~CX_1',
    'fa-exer-saasfaprod1~ocs~CX_1001',
    'icfcjb~ocs~CX_1',
    'recruiting2~AME1033ABHOW~8819f2ba-041d-48c2-9cfe-c854415f43d2',
    'recruiting2~AME1104ANBT~9474d2f8-2ad2-46f8-bbe3-f435f50628bd',
    'recruiting2~ARC1033ARCHS~ec1bad7b-421b-4c92-bf84-dae0f2173612',
    'recruiting2~ART1010AICH~d263cd2b-c4ef-4e10-8876-a2896406a573',
    'recruiting2~ASI1002AAMF~9e5e0e8e-237d-4ca6-91c0-a4f1fdd16163',
    'recruiting2~AUS1003AUIN~611d5a38-76c4-4f66-a55f-2bc012d98024',
    'recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703',
    'recruiting2~AUS1003AUIN~b8542df4-bc14-47ac-9e01-2eb2423bd205',
    'recruiting2~CAL1001CALA~46b96419-fba6-4dd0-a5fa-715bdfcf845b',
    'recruiting2~CKE1000CKER~8d7aeff6-90f7-47bf-9f70-771c5260877f',
    'recruiting2~CON1051CONPC~4c5261a3-56a0-4867-9d86-1673f2d804c2',
    'recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d',
    'recruiting2~GOL1019GDWC~07a2cf6e-052c-4ffa-b81d-99900254b1f5',
    'recruiting2~HUS1001HUSCH~b6637591-8c8d-49b8-b093-5524b203b157',
    'recruiting2~KEM1000~4ca2399d-585f-4556-b3a0-94af57ab68ea',
    'recruiting2~LUB1000LUBT~287e5d40-e2cb-41a7-8c5d-756dc9c5a838',
    'recruiting2~LUB1000LUBT~2dc69741-bb0f-433d-96a9-d7731bfa452a',
    'recruiting2~MCF1000~d8a61458-fc16-88c5-cdbe-b242fca9113e',
    'recruiting2~MID1025MIDF~de6dc764-d7e7-4ebc-99c5-bb453e31e24b',
    'recruiting2~MUN1001MCHK~acccd54e-ac6e-44a1-a6d4-8a1f25cceea3',
    'recruiting2~PAP1001~7297d137-c573-4bf4-8ab4-09ad7dac6ec8',
    'recruiting2~RES1015RPLLC~dc0817a6-b35b-4938-ae2a-d5d14087e134',
    'recruiting2~SAP1000SPID~5e557a61-9707-4f47-8f76-9c11b2bfbf9e',
    'recruiting2~STA1013~94aec289-5757-a8f0-d3bb-77f9cd846172',
    'recruiting2~SUN1000SUNCO~5882c1c5-18e3-8740-5e61-37d8f7574d64',
    'recruiting~AHF1000AHFP~eb870e08-1b72-44d8-a4c4-d8b21f6f9297',
    'recruiting~AME1068~34b788f5-e07e-3fb3-8e73-08c36602a07b',
    'recruiting~AME1101AMRI~f0aaafcc-5031-43d3-b658-e19a8bac98ee',
    'recruiting~AMG1002AMGC~f40ecd9c-1926-422b-82bf-5d5df3c0ad54',
    'recruiting~ANA1003ALOG~a4de26ba-aa2d-4502-9d0f-577ea07dc7ca',
    'recruiting~BYR1000BYRNE~d5855859-9eae-dd60-5965-11eeffbec7a1',
    'recruiting~COM1052~2e5d0965-0540-a0b3-7480-d7e4ddca0af6',
    'recruiting~ENV1004ERLL~01ddc4d3-605b-44e6-9b43-4abf0d1399b1',
    'recruiting~EOS1000EOSI~1170f284-cf46-4ff7-b32f-76e224e7a2d4',
    'recruiting~EPR1000EPSUS~10653576-f6a1-4d69-8a9c-a0a96124abda',
    'recruiting~EUL1000EULEN~7f63c405-6579-4eb2-954a-482585dd4149',
    'recruiting~FAR1008FNBC~2ed885d0-15e6-4548-ac9c-d5c9607e02d7',
    'recruiting~GEN1025~37481dc2-ddb2-1941-a0f9-befbbf45ab11',
    'recruiting~GRA1010GRAY~8d18afb5-245e-4c7e-a198-6a682201a90e',
    'recruiting~GUA1000GACM~14ab0bd3-29ec-43fc-ba76-27a9beaf97f5',
    'recruiting~HIL1004~783ada32-210a-ecf9-eab4-00a5ed980db3',
    'recruiting~IFL1000IFLY~1cbe2e6c-5bff-312c-9bbb-ac39038cb6bb',
    'recruiting~JAC1008JACAM2~78f93132-0f92-4d96-92fd-6bc9a0e91b52',
    'recruiting~KIL1000~68c62bcb-20f8-3231-d728-9190572df832',
    'recruiting~LUM1000NWL~c00e73a9-0a5f-4082-8257-fcddd1029261',
    'recruiting~MAR1033MBL~4c3007c3-6354-41de-a13f-d95be60d91e9',
    'recruiting~MEL1004MHTC~fbc00c76-0292-40eb-b052-02b511393eac',
    'recruiting~MER1020MERZ~84f5dbc2-c467-5a9e-3a37-6174c98926eb',
    'recruiting~MER1020MERZ~a6b53edd-7e9e-4bfb-bd93-0f6a6f0f275d',
    'recruiting~MES1002MESSD~888390fa-f9e8-4b6f-9977-7e3a214369f0',
    'recruiting~MES1005MESR~dbd63926-d756-486f-a254-b2a6ede1d26e',
    'recruiting~MES1005MESR~fa3fc0aa-75f1-4eac-9152-b4e8b8cbe849',
    'recruiting~MIC1003MEI~e3674ed3-2699-442b-aa28-c0b8436281b9',
    'recruiting~MIC1008MICPT~9f087488-7494-c18e-5713-c97b9f3d8219',
    'recruiting~MID1029MISO~362b6b1d-f1c3-46f5-9554-4aa90e2bda64',
    'recruiting~MIM1000MMEDX~1d9bee39-4128-4512-aa23-005f0e124469',
    'recruiting~MOD1003MWA~8990acfc-04f3-d65f-0565-a772e1a0157b',
    'recruiting~ORA1000OLCC~17560d62-b19a-4c09-9909-fe2b9c713df3',
    'recruiting~PAR1026PARS~b9883763-2d52-4511-a00a-57166395312c',
    'recruiting~PEN1019PMOI~9c2e3b43-1929-4405-b387-470097c98b4a',
    'recruiting~PGW1000PAUT~f1df8566-65d8-4efe-8046-4e96e46eeadf',
    'recruiting~POL1006~c0e3f015-388f-2bf6-e3ac-af081fcad685',
    'recruiting~QSA1000QSAC~d1dee834-9977-44db-8afd-d97fd6e60e44',
    'recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522',
    'recruiting~SAV1002STCF~7d92e82b-af74-464d-859b-c5b8cba6e92e',
    'recruiting~SEA1007SEACO~7851737e-66c7-908f-77e9-6d69f4eb0ead',
    'recruiting~SER1005SEIU~e131b2ae-a5ce-4fb1-a93c-84c36a485721',
    'recruiting~WEI1003~0e982683-539b-1a76-d39a-221637b5ef2e',
    'recruiting~WEL1008WLLT~30969ce4-3b7e-40a6-b86c-34d3616fe0ed',
    'recruiting~WES1010~9ca96e8c-accb-8dab-a29c-32c8da6f8d67',
    'recruiting~WES1010~dc686796-57ca-4fa7-a2d7-68f4e5612bd8',
    'recruiting~ban1010~e9066a66-c3b9-e25c-d036-116705c05e46',
    'recruiting~map1002mapmg~9c5b2d47-fac0-4e56-9f06-b9cc2013276d'
  ];
  v_b text[] := ARRAY[
    '4cd0ed49-a098-4d7e-89ec-a1207c6fb05b~9200637700125_2',
    '68553c3c-1468-4491-bd06-4ce87445742a~9200535968617_2',
    'adp:06ac6923-7485-4dbc-af8c-2d543fd02bde',
    'adp:30e05070-07b1-4b26-9028-b97dae32cdd1',
    'adp:33719718-bd74-496b-9eb7-d8baee2c8ea7',
    'adp:33f858b8-3c41-480e-a1e6-b328430e1cdd',
    'adp:36278fed-189f-477f-a74e-30a70a38d2c3',
    'adp:3e2ad120-703f-4dda-beb3-756a4696c20c',
    'adp:410ef665-4e61-4022-acec-17e867d3d827',
    'adp:47560b19-b691-4f4c-9de8-ff510ff2a256',
    'adp:4a8a08f1-ff6c-4d60-8308-4b09a199dd38',
    'adp:4cd83be9-0114-42e8-a339-fe7788450331',
    'adp:51389d2e-2a8e-4609-8f9f-8feea3ec0c45',
    'adp:582157cb-34cb-4bca-8237-ec7c1f3fd8d1',
    'adp:5dab8858-9030-438f-84ab-71856dec3db2',
    'adp:61eae558-f513-41ba-9f35-9cd7387146b8',
    'adp:67bfed39-352a-407e-bb98-1ee7787db55a',
    'adp:6a0a1cc7-b180-45b3-a723-1c8159d2f829',
    'adp:6aa48373-3ed3-4d60-ad3e-50273d106d20',
    'adp:71562ff3-8368-4253-b712-0c0c15bc181b',
    'adp:71c26da2-4704-491b-88a3-5f5ea5a7ac35',
    'adp:86896124-2b91-4d23-9046-319fe1a16882',
    'adp:8d661a1d-66d3-4337-be21-bf05f238bb42',
    'adp:98617f59-2ed0-4bd6-9f68-20fa241f2e5a',
    'adp:a4238dcf-5c61-4963-9b15-def8050f8004',
    'adp:a581af05-9b21-4dfd-b2f0-ae50924865ed',
    'adp:a771ec58-05da-4fe2-8ec6-fc8ee1a9e309',
    'adp:b077750a-f5a1-4e81-82fd-9f5755b7ecab',
    'adp:b3bc545f-6177-4880-8881-2ac6904aec6b',
    'adp:b5499531-3dcf-47e8-a051-b12d365cb034',
    'adp:bb661c48-7edc-400c-adfb-40f8f7743374',
    'adp:bf5dbe8a-7475-427e-966d-4942d6eddde3',
    'adp:c5fe07e6-50e2-4c35-959c-bbc803e50f04',
    'adp:c65bb879-0106-458b-ba3a-1d1c1287115f',
    'adp:d5874300-92af-4404-8c7d-f22dacd18835',
    'adp:d78f952e-d034-4077-9a68-c93dee92e3f7',
    'adp:df9f4474-51bf-4d5c-ba2d-f8c1edc1e317',
    'adp:e106c720-c83e-4a46-b5ff-cdf2225d71f8',
    'adp:eae41664-19fb-4412-96f8-43f15d52332b',
    'adp:ef82fdaa-4e54-44dc-a222-b12d9b478366',
    'adp:f2a07ead-ba9a-4ba0-b713-c8c25ed4edcb',
    'ashby:didero',
    'ashby:elyos',
    'ashby:ftmo',
    'ashby:lemonade',
    'ashby:skyflow',
    'ashby:volka',
    'bamboohr:415',
    'd290c04e-0230-4cd9-8bf0-f116bfab1405~19000101_000003',
    'eexs~us2~CX_12051',
    'eexs~us2~CX_21005',
    'eify~us6~CX_1001',
    'ejgo~em2~CX_1',
    'fa-evlo-saasfaprod1~ocs~CX_1',
    'fa-evlo-saasfaprod1~ocs~CX_1001',
    'fa-evlo-saasfaprod1~ocs~CX_2',
    'fa-evxn-saasfaukgovprod1~ocs~CX_1',
    'fa-evxn-saasfaukgovprod1~ocs~CX_1001',
    'fa-ewqq-saasfaprod1~ocs~CX_1',
    'fa-exux-saasfaprod1~ocs~CX_1',
    'greenhouse:alphasightsresumedrop',
    'greenhouse:corelight',
    'greenhouse:notexternal',
    'greenhouse:xebiaapac',
    'greenhouse:xebiacee',
    'greenhouse:xebiafrance',
    'greenhouse:xebialatam',
    'greenhouse:xebiamea',
    'greenhouse:xebiausa',
    'lever:crossing-minds',
    'lever:healthcare',
    'lever:vacancies',
    'recruiting~LAF1002LAFA~1a07d948-3361-48d7-89f2-002c5a48346c',
    'recruiting~LOW1003LFCS~cfc2ee58-1207-4e12-a838-876cbc96b1f9',
    'rippling:careers-page',
    'rippling:ferric-recruiting',
    'rippling:lylaw-recruitment',
    'rippling:meundies-recruiting',
    'rippling:paradise-media-recruitment',
    'teamtailor:geant'
  ];
  v_bad text[];
  v_gone text;
BEGIN
  IF to_regclass('public.company_name_evidence') IS NULL THEN
    RAISE EXCEPTION '20261030100000 refuses: public.company_name_evidence does not exist, so 20261025100000 is not applied. Apply 20261025100000 and then 20261026100000, unedited, then this file again';
  END IF;

  -- 20261025100000: each board has its override and its evidence, naming one employer.
  SELECT array_agg(s ORDER BY s) INTO v_bad
    FROM unnest(v_a) AS s
   WHERE NOT EXISTS (
     SELECT 1 FROM public.company_name_overrides o
       JOIN public.company_name_evidence e ON e.slug = o.slug
      WHERE o.slug = s AND o.display_name = e.display_name AND e.read_on = DATE '2026-10-25');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '20261030100000 refuses: 20261025100000 is not applied (% of its 88 boards lack the override and evidence it writes, first: %). Apply 20261025100000 and then 20261026100000, unedited, then this file again',
      cardinality(v_bad), array_to_string(v_bad[1:3], ', ');
  END IF;

  -- 20261026100000: each evidence row, and each "~" board's override naming the employer its evidence names.
  SELECT array_agg(s ORDER BY s) INTO v_bad
    FROM unnest(v_b) AS s
   WHERE NOT EXISTS (
           SELECT 1 FROM public.company_name_evidence e
            WHERE e.slug = s AND e.read_on IN (DATE '2026-10-25', DATE '2026-10-26'))
      OR (s LIKE '%~%' AND NOT EXISTS (
           SELECT 1 FROM public.company_name_overrides o
             JOIN public.company_name_evidence e ON e.slug = o.slug
            WHERE o.slug = s AND o.display_name = e.display_name));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '20261030100000 refuses: 20261026100000 is not applied (% of its 80 boards lack the evidence or override it writes, first: %). Apply 20261025100000 and then 20261026100000, unedited, then this file again',
      cardinality(v_bad), array_to_string(v_bad[1:3], ', ');
  END IF;

  IF to_regclass('public.job_board_postings') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.job_board_postings')
          AND t.tgname = 'trg_company_name_override' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '20261030100000 refuses: trg_company_name_override is not on job_board_postings, so new writes would not take the names; send this error, do not apply anything else';
  END IF;

  -- The lane runs again at the next pass-end, from its first token.
  SELECT string_agg(format('%s %s', k, v::text), '; ' ORDER BY k) INTO v_gone
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  DELETE FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  RAISE NOTICE '20261030100000: the name-sync lane is re-armed (removed: %); the next pass-end walks every board from the first', coalesce(v_gone, 'nothing, the keys were already gone');
END $$;

-- SELF-CHECK. Raises, and so rolls the delete back with it in one transaction,
-- unless neither key is left: a stamp would keep the lane idle, and a progress
-- row would start its walk past the first token.
DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_left
    FROM public.job_board_meta WHERE k IN ('name_sync_version', 'name_sync_progress');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'self-check 20261030100000: job_board_meta still holds %, so job-board''s name-sync lane would not walk every board again', v_left;
  END IF;
  RAISE NOTICE 'self-check 20261030100000: name_sync_version and name_sync_progress are gone; job-board .96 renames the stored rows at its next pass-end';
END $$;
