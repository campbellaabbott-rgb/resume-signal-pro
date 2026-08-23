-- A DEMO SANDBOX IS NOT AN EMPLOYER, EVEN WHEN A REAL COMPANY OWNS IT.
--
-- 111 pinpoint tenants belong to real companies (LivaNova, Verifone, Utility
-- Warehouse...) that set up a Pinpoint trial and never went live: every
-- posting they serve is drawn from Pinpoint's 6 canned seed titles ("Head of
-- DEI - Belfast/UK/US", "Marketing Manager", "Marketing Executive",
-- "Customer Service Rep"). Verified as a FULL SUBSET on removal day
-- (2026-08-24): 469 servable rows across all 111 tokens, 6 distinct titles,
-- 0 real ones — and those titles occur 0 times across the other 14 vendors.
-- Every one is a job a reader can waste an application on.
--
-- The census blocklist never caught them because it screens names and tokens
-- (demo|test|sandbox), and these carry REAL company names; only the content
-- is canned. The merge protocol now fingerprints the content
-- (scripts/merge-all.mjs PINPOINT_DEMO_TITLES), so they cannot re-enter.
-- Mixed boards (pinpoint:accenture, kempinski) are NOT touched: the rule is
-- full-subset only.
--
-- HARD DELETE, and the DEPLOY ORDER IS LOAD-BEARING: the job-board function
-- (whose catalog no longer carries these tokens) must deploy BEFORE this
-- migration runs. In that window the stale-bundle guard skips the orphan
-- prune (catalog < high-water), which is exactly what keeps 469 fake
-- postings from being logged as real board exits; this migration then
-- deletes the rows (nothing left to log) and lowers the high-water mark to
-- the new catalog size so the prune resumes. LEAST() keeps the lowering
-- idempotent.

DELETE FROM public.job_board_postings
WHERE source = 'pinpoint'
  AND company_token IN (
  'aiven',
  'ajbell',
  'alan',
  'alixpartners',
  'alten',
  'amplitude',
  'analysysmason',
  'asmglobal',
  'assistantlaunch',
  'bakerhicks',
  'bcn',
  'bison',
  'boomi',
  'bosch',
  'brave',
  'chattermill',
  'checkr',
  'circlek',
  'closinglock',
  'controlrisks',
  'costellomedical',
  'cube',
  'damen',
  'datamark',
  'dmgevents',
  'dms',
  'egis',
  'eisneramper',
  'ekimetrics',
  'elastic',
  'euromonitor',
  'everbridge',
  'exadel',
  'focus',
  'forbrightbank',
  'fundingcircle',
  'groupon',
  'haasf1team',
  'harness',
  'hellofresh',
  'improbable',
  'innovid',
  'iqeq',
  'keyloop',
  'kraken',
  'lendable',
  'liberis',
  'light',
  'linenchest',
  'livanova',
  'lottie',
  'lowell',
  'lxt',
  'magnopus',
  'mcafee',
  'mearsgroup',
  'mejuri',
  'metaview',
  'msamlin',
  'multiplier',
  'next',
  'ogilvy',
  'overstory',
  'revolutionspace',
  'riverflex',
  'rothschildandco',
  'savanta',
  'scc',
  'scope',
  'seeq',
  'semperis',
  'sfg20',
  'shiftmove',
  'siteminder',
  'slu',
  'smarsh',
  'sofi',
  'songtradr',
  'soprasteria',
  'spinnakersupport',
  'spire',
  'sptlabtech',
  'squiz',
  'stackinfra',
  'stagecoach',
  'sunrun',
  'systemiq',
  'technologyadvice',
  'technosylva',
  'telegraph',
  'theaccessgroup',
  'thoughtmachine',
  'tileshop',
  'topdoglaw',
  'toyota',
  'transunion',
  'tritility',
  'ttc',
  'ttp',
  'ugsolutions',
  'unit4',
  'unmind',
  'utilitywarehouse',
  'uvcyber',
  'verifone',
  'version1',
  'wearesocial',
  'whitbywood',
  'wifinity',
  'zendesk',
  'zuora'
);

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31709))),
    updated_at = now()
WHERE k = 'catalog_highwater';
