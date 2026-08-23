-- THE KING OF ROHAN IS NOT A JOB.
--
-- A board whose header promises "zero ghost jobs" was serving, live and
-- verified by POST {"q":"King of Rohan"} returning a card with a working
-- apply URL: "King of Rohan" @ "random location", "Lead Orc" @ "perfect
-- place", "Saruman's buddy" @ "everywhere" — Greenhouse demo tenants that
-- were registered as employers. Alongside them, five recruitment agencies
-- had passed the corporate-only policy (two of them promoted into the
-- 10-minute re-crawl set), and three employers were registered TWICE under
-- different display names, so the same requisition rendered as two cards
-- with byte-identical apply URLs.
--
-- The boards are removed from sources.ts in the same commit. That stops
-- future fetches — but a posting is only stamped missing_since by a
-- successful fetch of ITS OWN feed, which for a deregistered board never
-- happens again. Without this delete the fictional jobs would keep serving
-- for up to thirty days after the fix that removed their source.
--
-- KEYED ON (source, company_token), NOT ON TOKEN ALONE. The ashby employer
-- "Pulse" legitimately shares the token "pulse" with the removed greenhouse
-- agency Pulse Healthcare; a token-only delete would take a real employer's
-- board down with it.
--
-- The duplicate-name rows (jobs.mastec.com, n2alljobs, morrisgroupsite) are
-- safe to delete outright: every requisition they carry is also served by
-- the surviving token for the same employer — measured, byte-identical
-- apply URLs (uspcareers-mastec.icims.com/jobs/67637 appeared as two cards).

DELETE FROM public.job_board_postings
WHERE (source = 'greenhouse' AND company_token IN (
        'rohansrecruiterssandbox',  -- fictional jobs, 5 postings
        'example',                  -- Greenhouse's own demo tenant, 21
        'examplecorpsandbox',       -- sandbox, 3
        'pulse',                    -- UK locum agency, 77
        'liquidpersonnel',          -- UK social-work agency, 225
        'crisprecruit',             -- legal-sector recruiter, 27
        'n2alljobs'                 -- duplicate of n2publishingglassdoor, 65
      ))
   OR (source = 'lever'      AND company_token = 'cogentanalytics')      -- client-role recruiter, 92
   OR (source = 'lever'      AND company_token = 'levertest')            -- vendor test board
   OR (source = 'workable'   AND company_token = 'unitedplacementgroup') -- lead-gen ads, 27
   OR (source = 'teamtailor' AND company_token = 'morrisgroupsite')      -- parent board republishing children, 93
   OR (source = 'icims'      AND company_token = 'jobs.mastec.com');     -- same reqs as careers.mastec.com, 614
