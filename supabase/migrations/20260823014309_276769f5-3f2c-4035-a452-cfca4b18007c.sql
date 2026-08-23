DELETE FROM public.job_board_postings
WHERE (source = 'greenhouse' AND company_token IN (
        'rohansrecruiterssandbox','example','examplecorpsandbox','pulse','liquidpersonnel','crisprecruit','n2alljobs'
      ))
   OR (source = 'lever'      AND company_token = 'cogentanalytics')
   OR (source = 'lever'      AND company_token = 'levertest')
   OR (source = 'workable'   AND company_token = 'unitedplacementgroup')
   OR (source = 'teamtailor' AND company_token = 'morrisgroupsite')
   OR (source = 'icims'      AND company_token = 'jobs.mastec.com');