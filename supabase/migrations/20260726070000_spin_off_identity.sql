-- Spin-off identity corrections (2026-07-26 live-walk finding, rank 1).
--
-- The gsknch Workday tenant predates the GSK/Haleon demerger: every posting
-- and JD on it is Haleon's (verified live: JDs open "Welcome to Haleon",
-- recruiter emails are @haleon.com, roles are Sensodyne/consumer-health) but
-- a name-override batch stamped the rows "GSK" — so the lander said "Open
-- roles at GSK" and matched GSK plc's ~98k public-records headcount to a
-- ~24k-employee company. Sourced facts pinned to the wrong legal entity.
-- Same class: the GE tenants are the post-split companies and should carry
-- their real names, not title-cased tenant slugs.
--
-- The refresh is insert-only for existing rows, so stored rows need this
-- one-time sync (postings + closures, which feed the leaderboards); new rows
-- pick the corrected names up from sources.ts.
UPDATE public.job_board_postings SET company = 'Haleon'      WHERE company_token = 'gsknch~wd3~GSKCareers'          AND company <> 'Haleon';
UPDATE public.job_board_closures SET company = 'Haleon'      WHERE company_token = 'gsknch~wd3~GSKCareers'          AND company <> 'Haleon';
UPDATE public.job_board_postings SET company = 'GE Aerospace' WHERE company_token = 'geaerospace~wd5~GE_ExternalSite' AND company <> 'GE Aerospace';
UPDATE public.job_board_closures SET company = 'GE Aerospace' WHERE company_token = 'geaerospace~wd5~GE_ExternalSite' AND company <> 'GE Aerospace';
UPDATE public.job_board_postings SET company = 'GE Vernova'  WHERE company_token = 'gevernova~wd5~Vernova_ExternalSite' AND company <> 'GE Vernova';
UPDATE public.job_board_closures SET company = 'GE Vernova'  WHERE company_token = 'gevernova~wd5~Vernova_ExternalSite' AND company <> 'GE Vernova';

-- iCIMS apply links (rank 6): every sampled iCIMS applyUrl ended in /login —
-- an email-collection wall with zero job content; the sibling /job URL renders
-- the actual posting (verified live). Ingest now rewrites; stored rows sync
-- here (bounded UPDATE over the ~60k icims rows).
UPDATE public.job_board_postings
SET apply_url = regexp_replace(apply_url, '/login$', '/job')
WHERE source = 'icims' AND apply_url LIKE '%/login';
