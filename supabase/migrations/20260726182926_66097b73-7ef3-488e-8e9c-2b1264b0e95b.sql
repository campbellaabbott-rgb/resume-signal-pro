UPDATE public.company_name_overrides SET display_name = 'Haleon' WHERE slug = 'gsknch';
UPDATE public.job_board_postings  SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';
UPDATE public.job_board_closures  SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';
UPDATE public.job_board_company_snapshots SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';