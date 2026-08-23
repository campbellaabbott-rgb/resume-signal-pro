-- AN APPLY BUTTON LANDS ON THE JOB, NOT A SEARCH PAGE.
--
-- Greenhouse lets an employer set absolute_url per posting, and some point
-- every posting at their careers landing page. Measured 2026-08-23: 270 apply
-- URLs on the board are shared by five or more DISTINCT titles, carrying
-- 11,202 postings. BAYADA alone hangs 1,601 postings (944 titles) off
-- https://jobs.bayada.com/en/jobs. The button looks fine — every posting has
-- SOME apply_url, zero nulls — and lands the reader on a search page with 944
-- jobs to hunt through.
--
-- The per-job page is reconstructible from the id we already store:
-- greenhouse:{token}:{jobid} -> https://job-boards.greenhouse.io/{token}/jobs/{jobid},
-- verified HTTP 200 against a live posting. The normalizer applies the same
-- rule at ingest from this commit on; this rewrites the rows already stored.
--
-- FIVE DISTINCT TITLES is the threshold, from the audit: a genuine per-job
-- URL is never legitimately shared by five different titles, while two or
-- three can be one reposted role. Grouped per employer, so one company's
-- landing page cannot trip another's rows.
--
-- Greenhouse only, deliberately: it carries the bulk of the measured 11,202
-- (BAYADA, Carvana, EquipmentShare, Stripe, Databricks, Elastic, Toast), its
-- canonical form is verified, and Workday already builds its canonical from
-- the CXS path. The residual on other vendors is left for the host-level
-- sweep to surface rather than guessed at.
--
-- Idempotent: rewritten rows carry a unique per-job URL, so no group of five
-- can form from them on a second run.

UPDATE public.job_board_postings p
SET apply_url = 'https://job-boards.greenhouse.io/' || p.company_token
                || '/jobs/' || split_part(p.id, ':', 3)
WHERE p.source = 'greenhouse'
  AND (p.company_token, p.apply_url) IN (
    SELECT company_token, apply_url
    FROM public.job_board_postings
    WHERE source = 'greenhouse'
    GROUP BY company_token, apply_url
    HAVING count(DISTINCT title) >= 5
  );
