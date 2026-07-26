-- Haleon, part 2: the 20260726070000 UPDATE was silently reverted because
-- company_name_overrides carries ('gsknch','GSK') (set 20260721145736, before
-- the demerger was noticed) and the override enforcement re-stamps company
-- from that table — the exact mechanism doing its job on a stale fact.
-- Correct the override row FIRST, then the data tables stay corrected.
UPDATE public.company_name_overrides SET display_name = 'Haleon' WHERE slug = 'gsknch';
UPDATE public.job_board_postings  SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';
UPDATE public.job_board_closures  SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';
UPDATE public.job_board_company_snapshots SET company = 'Haleon' WHERE company_token = 'gsknch~wd3~GSKCareers' AND company <> 'Haleon';
